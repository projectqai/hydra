import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";
import { create } from "zustand";

import { getEntityName, isAsset, isExpired, isTrack } from "../../../lib/api/use-track-utils";
import { worldClient } from "../../../lib/api/world-client";

const BATCH_INTERVAL_MS = 100;

let abortController: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

const previousPositions = new Map<string, { lat: number; lng: number }>();
let changeVersion = 0;

export type ChangeSet = {
  version: number;
  updatedIds: Set<string>;
  deletedIds: Set<string>;
  geoChanged: boolean;
};

function isDetectionEntity(entity: Entity): boolean {
  const detectorId = entity.detection?.detectorEntityId;
  return (
    detectorId !== undefined &&
    detectorId !== "" &&
    entity.bearing?.azimuth !== undefined &&
    entity.bearing?.elevation !== undefined
  );
}

const EMPTY_CHANGE: ChangeSet = {
  version: 0,
  updatedIds: new Set(),
  deletedIds: new Set(),
  geoChanged: false,
};

type EntityState = {
  entities: Map<string, Entity>;
  detectionEntityIds: Set<string>;
  tracks: Entity[];
  assets: Entity[];
  trackCount: number;
  assetCount: number;
  isConnected: boolean;
  error: Error | null;
  lastChange: ChangeSet;
};

type EntityActions = {
  startStream: () => void;
  stopStream: () => void;
  updateEntity: (id: string, updates: Partial<Entity>) => void;
  fetchEntity: (id: string) => Promise<Entity | null>;
  reset: () => void;
};

export const selectEntity = (id: string | null) => (state: EntityState) =>
  id ? state.entities.get(id) : undefined;

export const selectTracks = (state: EntityState) => state.tracks;
export const selectAssets = (state: EntityState) => state.assets;
export const selectTrackCount = (state: EntityState) => state.trackCount;
export const selectAssetCount = (state: EntityState) => state.assetCount;
export const selectLastChange = (state: EntityState) => state.lastChange;
export const selectDetectionEntityIds = (state: EntityState) => state.detectionEntityIds;

function computeDerivedState(entities: Map<string, Entity>) {
  const tracks: Entity[] = [];
  const assets: Entity[] = [];

  for (const entity of entities.values()) {
    if (isExpired(entity)) continue;
    if (isTrack(entity)) {
      tracks.push(entity);
    } else if (isAsset(entity)) {
      assets.push(entity);
    }
  }

  const sortByName = (a: Entity, b: Entity) => getEntityName(a).localeCompare(getEntityName(b));

  tracks.sort(sortByName);
  assets.sort(sortByName);

  return {
    tracks,
    assets,
    trackCount: tracks.length,
    assetCount: assets.length,
  };
}

export const useEntityStore = create<EntityState & EntityActions>()((set) => ({
  entities: new Map(),
  detectionEntityIds: new Set(),
  tracks: [],
  assets: [],
  trackCount: 0,
  assetCount: 0,
  isConnected: false,
  error: null,
  lastChange: EMPTY_CHANGE,

  startStream: () => {
    if (abortController) return;

    abortController = new AbortController();
    set({ error: null });

    const maxReconnectDuration = 60000;
    let reconnectStartTime: number | null = null;

    const pendingUpdates = new Map<string, Entity>();
    const pendingDeletes = new Set<string>();
    let flushScheduled = false;

    const flushUpdates = () => {
      flushScheduled = false;
      if (pendingUpdates.size === 0 && pendingDeletes.size === 0) return;

      const updatedIds = new Set(pendingUpdates.keys());
      const deletedIds = new Set(pendingDeletes);

      let geoChanged = deletedIds.size > 0;

      if (!geoChanged) {
        for (const [id, entity] of pendingUpdates) {
          if (!entity.geo) continue;
          const prev = previousPositions.get(id);
          if (!prev || prev.lat !== entity.geo.latitude || prev.lng !== entity.geo.longitude) {
            geoChanged = true;
            break;
          }
        }
      }

      set((state) => {
        let hasChanges = false;

        for (const id of pendingDeletes) {
          if (state.entities.has(id)) {
            hasChanges = true;
            break;
          }
        }

        if (!hasChanges) {
          for (const [id, entity] of pendingUpdates) {
            const existing = state.entities.get(id);
            if (existing !== entity) {
              hasChanges = true;
              break;
            }
          }
        }

        if (!hasChanges) {
          pendingUpdates.clear();
          pendingDeletes.clear();
          return state;
        }

        const next = new Map(state.entities);
        const nextDetectionIds = new Set(state.detectionEntityIds);

        for (const id of pendingDeletes) {
          next.delete(id);
          previousPositions.delete(id);
          nextDetectionIds.delete(id);
        }
        for (const [id, entity] of pendingUpdates) {
          next.set(id, entity);
          if (entity.geo) {
            previousPositions.set(id, {
              lat: entity.geo.latitude,
              lng: entity.geo.longitude,
            });
          }
          if (isDetectionEntity(entity)) {
            nextDetectionIds.add(id);
          } else {
            nextDetectionIds.delete(id);
          }
        }

        pendingUpdates.clear();
        pendingDeletes.clear();

        changeVersion++;
        const lastChange: ChangeSet = {
          version: changeVersion,
          updatedIds,
          deletedIds,
          geoChanged,
        };

        return {
          entities: next,
          detectionEntityIds: nextDetectionIds,
          lastChange,
          ...computeDerivedState(next),
        };
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      flushTimeout = setTimeout(flushUpdates, BATCH_INTERVAL_MS);
    };

    async function stream() {
      if (!abortController) return;
      const signal = abortController.signal;

      try {
        const response = worldClient.watchEntities({}, { signal });

        let receivedFirst = false;
        for await (const event of response) {
          if (signal.aborted) break;

          if (!receivedFirst) {
            set({ isConnected: true, error: null });
            reconnectStartTime = null;
            receivedFirst = true;
          }

          const { entity, t: changeType } = event;

          if (changeType === EntityChange.EntityChangeUpdated && entity) {
            pendingDeletes.delete(entity.id);
            pendingUpdates.set(entity.id, entity);
          } else if (
            (changeType === EntityChange.EntityChangeExpired ||
              changeType === EntityChange.EntityChangeUnobserved) &&
            entity?.id
          ) {
            pendingUpdates.delete(entity.id);
            pendingDeletes.add(entity.id);
          }

          scheduleFlush();
        }
      } catch (err) {
        if (!signal.aborted) {
          console.error("[entity-store] stream error:", err);
          set({ error: err as Error, isConnected: false });

          if (reconnectStartTime === null) {
            reconnectStartTime = Date.now();
          }

          const elapsed = Date.now() - reconnectStartTime;

          if (elapsed < maxReconnectDuration) {
            reconnectTimeout = setTimeout(() => {
              if (!signal.aborted) {
                stream();
              }
            }, 1000);
          } else {
            console.error("[entity-store] max reconnect duration reached");
          }
        }
      }
    }

    stream();
  },

  stopStream: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    set({ isConnected: false });
  },

  updateEntity: (id, updates) => {
    set((state) => {
      const existing = state.entities.get(id);
      if (!existing) return state;

      const updated = { ...existing, ...updates };
      const next = new Map(state.entities).set(id, updated);
      const nextDetectionIds = new Set(state.detectionEntityIds);

      if (isDetectionEntity(updated)) {
        nextDetectionIds.add(id);
      } else {
        nextDetectionIds.delete(id);
      }

      const prevPos = previousPositions.get(id);
      const geoChanged =
        updated.geo &&
        (!prevPos || prevPos.lat !== updated.geo.latitude || prevPos.lng !== updated.geo.longitude);

      if (updated.geo) {
        previousPositions.set(id, {
          lat: updated.geo.latitude,
          lng: updated.geo.longitude,
        });
      }

      changeVersion++;
      return {
        entities: next,
        detectionEntityIds: nextDetectionIds,
        lastChange: {
          version: changeVersion,
          updatedIds: new Set([id]),
          deletedIds: new Set(),
          geoChanged: !!geoChanged,
        },
        ...computeDerivedState(next),
      };
    });
  },

  fetchEntity: async (id) => {
    try {
      const response = await worldClient.getEntity({ id });
      if (response.entity) {
        const entity = response.entity;
        set((state) => {
          const next = new Map(state.entities).set(id, entity);
          const nextDetectionIds = new Set(state.detectionEntityIds);

          if (isDetectionEntity(entity)) {
            nextDetectionIds.add(id);
          } else {
            nextDetectionIds.delete(id);
          }

          const prevPos = previousPositions.get(id);
          const geoChanged =
            entity.geo &&
            (!prevPos ||
              prevPos.lat !== entity.geo.latitude ||
              prevPos.lng !== entity.geo.longitude);

          if (entity.geo) {
            previousPositions.set(id, {
              lat: entity.geo.latitude,
              lng: entity.geo.longitude,
            });
          }

          changeVersion++;
          return {
            entities: next,
            detectionEntityIds: nextDetectionIds,
            lastChange: {
              version: changeVersion,
              updatedIds: new Set([id]),
              deletedIds: new Set(),
              geoChanged: !!geoChanged,
            },
            ...computeDerivedState(next),
          };
        });
        return entity;
      }
      return null;
    } catch {
      return null;
    }
  },

  reset: () => {
    abortController?.abort();
    abortController = null;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    previousPositions.clear();
    changeVersion = 0;
    set({
      entities: new Map(),
      detectionEntityIds: new Set(),
      tracks: [],
      assets: [],
      trackCount: 0,
      assetCount: 0,
      isConnected: false,
      error: null,
      lastChange: EMPTY_CHANGE,
    });
  },
}));
