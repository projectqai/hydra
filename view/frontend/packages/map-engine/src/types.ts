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

export type Affiliation = "friend" | "hostile" | "neutral" | "unknown";

export type EntityData = {
  id: string;
  position: GeoPosition;
  symbol?: string;
  label?: string;
  affiliation?: Affiliation;
  coverageRadius?: number;
  ellipseRadius?: number;
  activeSectors?: ActiveSensorSectors;
};

export type BaseLayer = "dark" | "satellite";

export type SceneMode = "2d" | "2.5d" | "3d";

export type EntityFilter = {
  tracks: { friend: boolean; hostile: boolean; neutral: boolean; unknown: boolean };
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
