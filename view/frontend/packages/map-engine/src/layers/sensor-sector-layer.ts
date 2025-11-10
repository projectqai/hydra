import { IconLayer } from "@deck.gl/layers";

import type { ActiveSensorSectors, EntityData } from "../types";
import { getSectorSvgDataUri } from "../utils/sensor-svg";

export type SectorRenderData = {
  entity: EntityData;
  sectors: ActiveSensorSectors;
  sectorDataUri: string;
};

export type SensorSectorLayerProps = {
  data: SectorRenderData[];
  visible: boolean;
};

export function createSensorSectorLayer({ data, visible }: SensorSectorLayerProps) {
  return new IconLayer<SectorRenderData>({
    id: "sectors",
    data,
    visible: visible && data.length > 0,
    getPosition: (d) => [d.entity.position.lng, d.entity.position.lat],
    getIcon: (d) => ({ url: d.sectorDataUri, width: 230, height: 230, anchorY: 115 }),
    getSize: (d) => (d.entity.ellipseRadius ?? 250) * 2,
    sizeUnits: "meters",
    sizeMaxPixels: 230,
    pickable: false,
  });
}

export function prepareSectorData(entity: EntityData): SectorRenderData | null {
  if (!entity.ellipseRadius || !entity.activeSectors) return null;
  return {
    entity,
    sectors: entity.activeSectors,
    sectorDataUri: getSectorSvgDataUri(entity.activeSectors),
  };
}
