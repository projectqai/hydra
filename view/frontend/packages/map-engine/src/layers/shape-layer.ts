import type { PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer } from "@deck.gl/layers";

import type { ShapeFeature, ShapeProperties } from "../types";

export type ShapeLayerProps = {
  data: ShapeFeature[];
  visible: boolean;
  selectedId: string | null;
  onClick?: (id: string) => void | Promise<void>;
};

export function createShapeLayer({ data, visible, selectedId, onClick }: ShapeLayerProps) {
  return new GeoJsonLayer<ShapeProperties>({
    id: "shapes",
    data,
    visible: visible && data.length > 0,
    stroked: true,
    filled: false,
    getLineColor: (f) => [...f.properties.color, 255] as [number, number, number, number],
    getLineWidth: (f) => (f.properties.id === selectedId ? 3 : 2),
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 2,
    pointRadiusMinPixels: 8,
    pickable: true,
    onClick: (info: PickingInfo): boolean => {
      if (info.object) {
        const id = (info.object as ShapeFeature).properties?.id;
        if (id) {
          onClick?.(id);
          return true;
        }
      }
      return false;
    },
  });
}
