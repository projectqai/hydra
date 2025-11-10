import type { Affiliation, ShapeFeature, ShapeGeometry, ShapeProperties } from "../types";

const AFFILIATION_COLORS: Record<Affiliation, [number, number, number]> = {
  blue: [59, 130, 246],
  red: [205, 24, 24],
  neutral: [61, 141, 122],
  unknown: [247, 239, 129],
};

const NO_SYMBOL_COLOR: [number, number, number] = [156, 163, 175];

export function shapeToFeature(
  id: string,
  shape: ShapeGeometry,
  affiliation: Affiliation,
  hasSymbol: boolean,
): ShapeFeature {
  const color = hasSymbol ? AFFILIATION_COLORS[affiliation] : NO_SYMBOL_COLOR;
  const properties: ShapeProperties = { id, color, affiliation };

  if (shape.type === "polygon") {
    const outer = shape.outer.map((p) => [p.lng, p.lat] as [number, number]);
    if (outer.length > 0 && outer[0]) {
      outer.push(outer[0]);
    }
    const coordinates: [number, number][][] = [outer];
    if (shape.holes) {
      for (const hole of shape.holes) {
        const holeCoords = hole.map((p) => [p.lng, p.lat] as [number, number]);
        if (holeCoords.length > 0 && holeCoords[0]) {
          holeCoords.push(holeCoords[0]);
        }
        coordinates.push(holeCoords);
      }
    }
    return {
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates },
    };
  }

  if (shape.type === "polyline") {
    return {
      type: "Feature",
      properties,
      geometry: {
        type: "LineString",
        coordinates: shape.points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    };
  }

  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Point",
      coordinates: [shape.position.lng, shape.position.lat],
    },
  };
}
