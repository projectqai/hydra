import type { ActiveSensorSectors, Affiliation, EntityData } from "@hydra/map-engine/types";
import type { Entity } from "@projectqai/proto/world";

import { timestampToMs } from "../../../lib/api/use-track-utils";
import { degreesToSectors } from "./sensors";

function getAffiliation(sidc?: string): Affiliation {
  const code = sidc?.[1]?.toUpperCase();
  if (code === "F") return "friend";
  if (code === "H") return "hostile";
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
  if (!entity.symbol) {
    return false;
  }
  const { milStd2525C } = entity.symbol;
  const sensorSymbolRegex = /^SFGPES-*$/gm;
  return milStd2525C.match(sensorSymbolRegex) !== null;
}

export type SerializedEntityData = Omit<EntityData, "activeSectors"> & {
  activeSectors?: string[];
};

export function deserializeEntities(entities: SerializedEntityData[]): EntityData[] {
  return entities.map((e) => ({
    ...e,
    activeSectors: e.activeSectors
      ? (new Set(e.activeSectors) as EntityData["activeSectors"])
      : undefined,
  }));
}

export function transformEntities(entities: Map<string, Entity>): EntityData[] {
  const result: EntityData[] = [];

  const detectorSectors = new Map<string, ActiveSensorSectors>();
  for (const entity of entities.values()) {
    if (
      !isEntityExpired(entity) &&
      entity.detection?.detectorEntityId &&
      entity.bearing?.azimuth !== undefined &&
      entity.bearing?.elevation !== undefined
    ) {
      const sectors: ActiveSensorSectors = degreesToSectors([
        { mid: entity.bearing.azimuth, width: entity.bearing.elevation },
      ]);

      if (sectors.size > 0) {
        const existing = detectorSectors.get(entity.detection.detectorEntityId) ?? new Set();
        for (const sector of sectors) {
          existing.add(sector);
        }
        detectorSectors.set(entity.detection.detectorEntityId, existing);
      }
    }
  }

  for (const [, entity] of entities) {
    if (!hasGeo(entity) || isEntityExpired(entity) || !entity.symbol?.milStd2525C) continue;

    result.push({
      id: entity.id,
      position: {
        lat: entity.geo.latitude,
        lng: entity.geo.longitude,
        alt: entity.geo.altitude,
      },
      symbol: entity.symbol?.milStd2525C,
      label: entity.label || entity.controller?.name || entity.id,
      affiliation: getAffiliation(entity.symbol?.milStd2525C),
      ellipseRadius: hasEllipse(entity) ? 250 : undefined,
      activeSectors: detectorSectors.get(entity.id),
    });
  }

  return result;
}
