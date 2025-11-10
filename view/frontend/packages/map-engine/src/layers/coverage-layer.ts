import { ScatterplotLayer } from "@deck.gl/layers";

import type { EntityData } from "../types";

const COVERAGE_FILL: [number, number, number, number] = [59, 130, 246, 10];
const COVERAGE_STROKE: [number, number, number, number] = [59, 130, 246, 51];
const DEFAULT_RADIUS = 250;

export type CoverageLayerProps = {
  data: EntityData[];
  visible: boolean;
};

export function createCoverageLayer({ data, visible }: CoverageLayerProps) {
  return new ScatterplotLayer<EntityData>({
    id: "coverage",
    data,
    visible: visible && data.length > 0,
    getPosition: (d) => [d.position.lng, d.position.lat],
    getRadius: (d) => d.coverageRadius ?? DEFAULT_RADIUS,
    radiusUnits: "meters",
    getFillColor: COVERAGE_FILL,
    getLineColor: COVERAGE_STROKE,
    stroked: true,
    lineWidthMinPixels: 1,
    pickable: false,
  });
}
