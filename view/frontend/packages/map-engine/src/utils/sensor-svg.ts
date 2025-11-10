import { SensorSectors } from "../constants";
import type { ActiveSensorSectors } from "../types";

const INACTIVE_FILL = "rgba(33, 33, 33, 0.85)";
const ACTIVE_FILL = "rgba(205, 24, 24, 0.9)";
const STROKE_COLOR = "rgba(60, 60, 60, 0.9)";
const STROKE_WIDTH = 1.5;

const SIZE = 230;
const OUTER_RADIUS = 108;
const INNER_RADIUS = 92;
const GAP_DEGREES = 2;
const CENTER = SIZE / 2;

function generateArcPath(startDeg: number, endDeg: number): string {
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

  const startRad = toRad(startDeg + GAP_DEGREES);
  const endRad = toRad(endDeg - GAP_DEGREES);

  const outerStartX = CENTER + OUTER_RADIUS * Math.cos(startRad);
  const outerStartY = CENTER + OUTER_RADIUS * Math.sin(startRad);
  const outerEndX = CENTER + OUTER_RADIUS * Math.cos(endRad);
  const outerEndY = CENTER + OUTER_RADIUS * Math.sin(endRad);

  const innerStartX = CENTER + INNER_RADIUS * Math.cos(endRad);
  const innerStartY = CENTER + INNER_RADIUS * Math.sin(endRad);
  const innerEndX = CENTER + INNER_RADIUS * Math.cos(startRad);
  const innerEndY = CENTER + INNER_RADIUS * Math.sin(startRad);

  const largeArc = endDeg - startDeg - 2 * GAP_DEGREES > 180 ? 1 : 0;

  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${OUTER_RADIUS} ${OUTER_RADIUS} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerStartX} ${innerStartY}`,
    `A ${INNER_RADIUS} ${INNER_RADIUS} 0 ${largeArc} 0 ${innerEndX} ${innerEndY}`,
    "Z",
  ].join(" ");
}

const svgDataUriCache = new Map<string, string>();

function sectorSetToKey(sectors: ActiveSensorSectors): string {
  return Array.from(sectors).sort().join(",");
}

function generateSvgMarkup(activeSectors: ActiveSensorSectors): string {
  const paths = SensorSectors.map((sector) => {
    const fill = activeSectors.has(sector.label) ? ACTIVE_FILL : INACTIVE_FILL;
    const d = generateArcPath(sector.start, sector.end);
    return `<path d="${d}" fill="${fill}" stroke="${STROKE_COLOR}" stroke-width="${STROKE_WIDTH}"/>`;
  }).join("");

  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

export function getSectorSvgDataUri(activeSectors: ActiveSensorSectors): string {
  const stateKey = sectorSetToKey(activeSectors);
  let dataUri = svgDataUriCache.get(stateKey);

  if (!dataUri) {
    const svg = generateSvgMarkup(activeSectors);
    dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    svgDataUriCache.set(stateKey, dataUri);
  }

  return dataUri;
}
