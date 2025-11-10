import type { Feature, LineString, Point, Polygon } from "geojson";

export type ActiveSensorSector =
  | "north"
  | "south"
  | "west"
  | "east"
  | "north-east"
  | "north-west"
  | "south-west"
  | "south-east";

export type ActiveSensorSectors = Set<ActiveSensorSector>;

export interface CircleSector<T = string> {
  label: T;
  start: number;
  end: number;
}

export type GeoPosition = {
  lat: number;
  lng: number;
  alt?: number;
};

export type ShapeGeometry =
  | { type: "polygon"; outer: GeoPosition[]; holes?: GeoPosition[][] }
  | { type: "polyline"; points: GeoPosition[] }
  | { type: "point"; position: GeoPosition };

export type ShapeFeature = Feature<Polygon | LineString | Point, ShapeProperties>;

export type ShapeProperties = {
  id: string;
  color: [number, number, number];
  affiliation: Affiliation;
};

export type Affiliation = "blue" | "red" | "neutral" | "unknown";

export type EntityData = {
  id: string;
  position: GeoPosition;
  symbol?: string;
  label?: string;
  affiliation?: Affiliation;
  coverageRadius?: number;
  ellipseRadius?: number;
  activeSectors?: ActiveSensorSectors;
  shape?: ShapeGeometry;
};

export type BaseLayer = "dark" | "satellite";

export type SceneMode = "2d" | "2.5d" | "3d";

export type EntityFilter = {
  tracks: { blue: boolean; red: boolean; neutral: boolean; unknown: boolean };
  sensors: Record<string, boolean>;
};

export type MeasurementType =
  | "distance"
  | "polyline"
  | "horizontal"
  | "vertical"
  | "height"
  | "area"
  | "point";

export type EntityDelta<T = EntityData> = {
  version: number;
  geoChanged: boolean;
  entities: T[];
  removed: string[];
};
