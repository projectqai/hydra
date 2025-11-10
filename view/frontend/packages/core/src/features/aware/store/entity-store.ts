import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";
import { create } from "zustand";

import { worldClient } from "../../../lib/api/world-client";

const BATCH_INTERVAL_MS = 100;

let abortController: AbortController | null = null;
let reconnectTimeout: number | null = null;
let flushTimeout: number | null = null;

type EntityState = {
  entities: Map<string, Entity>;
  isConnected: boolean;
  error: Error | null;
};

type EntityActions = {
  startStream: () => void;
  stopStream: () => void;
  updateEntity: (id: string, updates: Partial<Entity>) => void;
  reset: () => void;
};

export const selectEntity = (id: string | null) => (state: EntityState) =>
  id ? state.entities.get(id) : undefined;

export const useEntityStore = create<EntityState & EntityActions>()((set) => ({
  entities: new Map(),
  isConnected: false,
  error: null,

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

      set((state) => {
        const next = new Map(state.entities);

        for (const id of pendingDeletes) {
          next.delete(id);
        }
        for (const [id, entity] of pendingUpdates) {
          next.set(id, entity);
        }

        pendingUpdates.clear();
        pendingDeletes.clear();

        return { entities: next };
      });
    };

    const scheduleFlush = () => {
      if (flushScheduled) return;
      flushScheduled = true;
      flushTimeout = window.setTimeout(flushUpdates, BATCH_INTERVAL_MS);
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
            set({ isConnected: true });
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
            reconnectTimeout = window.setTimeout(() => {
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

      return {
        entities: new Map(state.entities).set(id, { ...existing, ...updates }),
      };
    });
  },

  reset: () => {
    set({ entities: new Map(), isConnected: false, error: null });
  },
}));
