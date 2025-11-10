import type { ActiveSensorSector, BaseLayer, CircleSector } from "./types";

export const ICON_SIZE = 32;

export const DEFAULT_POSITION = { lat: 52.3667, lng: 13.5033, zoom: 13 } as const;

export const BASE_LAYER_SOURCES: Record<
  BaseLayer,
  { url: string; attribution: string; maxZoom: number }
> = {
  dark: {
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    maxZoom: 20,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "© Esri",
    maxZoom: 19,
  },
};

export const ATTRIBUTIONS: Record<BaseLayer, string> = {
  dark: `MapLibre | ${BASE_LAYER_SOURCES.dark.attribution}`,
  satellite: `MapLibre | ${BASE_LAYER_SOURCES.satellite.attribution}`,
};

export const SensorSectors: Array<CircleSector<ActiveSensorSector>> = [
  { label: "north", start: -22.5, end: 22.5 },
  { label: "north-east", start: 22.5, end: 67.5 },
  { label: "east", start: 67.5, end: 112.5 },
  { label: "south-east", start: 112.5, end: 157.5 },
  { label: "south", start: 157.5, end: 202.5 },
  { label: "south-west", start: 202.5, end: 247.5 },
  { label: "west", start: 247.5, end: 292.5 },
  { label: "north-west", start: 292.5, end: 337.5 },
];
