import type {
  ActiveSensorSectors,
  Affiliation,
  EntityData,
  GeoPosition,
  ShapeGeometry,
} from "@hydra/map-engine/types";
import type { Entity, PlanarPolygon, PlanarRing } from "@projectqai/proto/world";

import { timestampToMs } from "../../../lib/api/use-track-utils";
import type { ChangeSet } from "../store/entity-store";
import { degreesToSectors } from "./sensors";

export type SerializedEntityData = Omit<EntityData, "activeSectors"> & {
  activeSectors?: string[];
};

export type SerializedDelta = {
  version: number;
  geoChanged: boolean;
  entities: SerializedEntityData[];
  removed: string[];
};

function getAffiliation(sidc?: string): Affiliation {
  const code = sidc?.[1]?.toUpperCase();
  if (code === "F") return "blue";
  if (code === "H") return "red";
  if (code === "N") return "neutral";
  return "unknown";
}

function hasGeo(entity: Entity): entity is Entity & { geo: NonNullable<Entity["geo"]> } {
  return !!entity.geo;
}

function isEntityExpired(entity: Entity): boolean {
  if (!entity.lifetime?.until) return false;
  return timestampToMs(entity.lifetime.until) < Date.now();
}

function hasEllipse(entity: Entity): boolean {
  if (!entity.symbol) return false;
  const { milStd2525C } = entity.symbol;
  const sensorSymbolRegex = /^SFGPES-*$/gm;
  return milStd2525C.match(sensorSymbolRegex) !== null;
}

function ringToPositions(ring: PlanarRing): GeoPosition[] {
  return ring.points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
    alt: p.altitude,
  }));
}

function computeCentroid(positions: GeoPosition[]): GeoPosition {
  const sum = positions.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0,
  });
  return { lat: sum.lat / positions.length, lng: sum.lng / positions.length };
}

function extractShape(entity: Entity): ShapeGeometry | undefined {
  const plane = entity.shape?.geometry?.planar?.plane;
  if (!plane || plane.case === undefined) return undefined;

  switch (plane.case) {
    case "polygon": {
      const poly = plane.value as PlanarPolygon;
      if (!poly.outer) return undefined;
      return {
        type: "polygon",
        outer: ringToPositions(poly.outer),
        holes: poly.holes.length ? poly.holes.map(ringToPositions) : undefined,
      };
    }
    case "line":
      return { type: "polyline", points: ringToPositions(plane.value as PlanarRing) };
    case "point": {
      const pt = plane.value as { latitude: number; longitude: number; altitude?: number };
      return { type: "point", position: { lat: pt.latitude, lng: pt.longitude, alt: pt.altitude } };
    }
    default:
      return undefined;
  }
}

function transformEntity(entity: Entity): Omit<EntityData, "activeSectors"> | null {
  if (isEntityExpired(entity)) return null;

  const shape = extractShape(entity);
  const hasPosition = hasGeo(entity);

  if (!hasPosition && !shape) return null;

  let position: GeoPosition;
  if (hasPosition) {
    position = {
      lat: entity.geo.latitude,
      lng: entity.geo.longitude,
      alt: entity.geo.altitude,
    };
  } else if (shape!.type === "point") {
    position = shape!.position;
  } else {
    const pts = shape!.type === "polygon" ? shape!.outer : shape!.points;
    position = computeCentroid(pts);
  }

  return {
    id: entity.id,
    position,
    shape,
    symbol: entity.symbol?.milStd2525C,
    label: entity.label || entity.controller?.name || entity.id,
    affiliation: getAffiliation(entity.symbol?.milStd2525C),
    ellipseRadius: hasEllipse(entity) ? 250 : undefined,
  };
}

function computeDetectorSectors(
  entities: Map<string, Entity>,
  detectionEntityIds: Set<string>,
): Map<string, ActiveSensorSectors> {
  const detectorSectors = new Map<string, ActiveSensorSectors>();

  if (detectionEntityIds.size === 0) return detectorSectors;

  for (const id of detectionEntityIds) {
    const entity = entities.get(id);
    if (!entity) continue;
    if (isEntityExpired(entity)) continue;

    const detectorId = entity.detection?.detectorEntityId;
    const azimuth = entity.bearing?.azimuth;
    const elevation = entity.bearing?.elevation;

    if (detectorId === undefined || azimuth === undefined || elevation === undefined) continue;

    const sectors: ActiveSensorSectors = degreesToSectors([{ mid: azimuth, width: elevation }]);

    if (sectors.size > 0) {
      const existing = detectorSectors.get(detectorId) ?? new Set();
      for (const sector of sectors) {
        existing.add(sector);
      }
      detectorSectors.set(detectorId, existing);
    }
  }

  return detectorSectors;
}

function serializeEntity(
  e: Omit<EntityData, "activeSectors">,
  activeSectors?: ActiveSensorSectors,
): SerializedEntityData {
  return {
    ...e,
    activeSectors: activeSectors ? Array.from(activeSectors) : undefined,
  };
}

export function deserializeEntity(e: SerializedEntityData): EntityData {
  return {
    ...e,
    activeSectors: e.activeSectors
      ? (new Set(e.activeSectors) as EntityData["activeSectors"])
      : undefined,
  };
}

let lastDeltaVersion = -1;

export function buildDelta(
  entities: Map<string, Entity>,
  lastChange: ChangeSet | undefined,
  detectionEntityIds: Set<string>,
): SerializedDelta {
  const detectorSectors = computeDetectorSectors(entities, detectionEntityIds);

  const isInitial = lastDeltaVersion === -1;
  const versionGap = lastChange && lastChange.version !== lastDeltaVersion + 1;
  const needsFullRebuild = isInitial || !lastChange || versionGap;

  if (needsFullRebuild) {
    const result: SerializedEntityData[] = [];
    for (const entity of entities.values()) {
      const transformed = transformEntity(entity);
      if (transformed) {
        result.push(serializeEntity(transformed, detectorSectors.get(entity.id)));
      }
    }
    lastDeltaVersion = lastChange?.version ?? 0;
    return {
      version: lastDeltaVersion,
      geoChanged: true,
      entities: result,
      removed: [],
    };
  }

  const changed: SerializedEntityData[] = [];
  const removed: string[] = Array.from(lastChange.deletedIds);

  // Collect detector IDs that need re-serialization due to detection changes
  const affectedDetectorIds = new Set<string>();
  for (const [detectorId] of detectorSectors) {
    affectedDetectorIds.add(detectorId);
  }

  // Combine updated IDs with affected detectors
  const idsToProcess = new Set(lastChange.updatedIds);
  for (const detectorId of affectedDetectorIds) {
    idsToProcess.add(detectorId);
  }

  for (const id of idsToProcess) {
    const entity = entities.get(id);
    if (entity) {
      const transformed = transformEntity(entity);
      if (transformed) {
        changed.push(serializeEntity(transformed, detectorSectors.get(id)));
      } else if (lastChange.updatedIds.has(id)) {
        removed.push(id);
      }
    }
  }

  lastDeltaVersion = lastChange.version;
  return {
    version: lastChange.version,
    geoChanged: lastChange.geoChanged,
    entities: changed,
    removed,
  };
}

export function resetDeltaState(): void {
  lastDeltaVersion = -1;
}
