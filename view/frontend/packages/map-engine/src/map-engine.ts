import type {
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  MeasurementType,
  SceneMode,
} from "./types";

export type MapEngineEvents = {
  ready: () => void;
  entityClick: (id: string | null) => void;
  trackingLost: () => void;
};

export type MapEngine = {
  // Lifecycle
  mount: (container: HTMLElement) => void | Promise<void>;
  destroy: () => void;

  // Camera
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (
    position: GeoPosition,
    options?: { duration?: number; zoom?: number },
  ) => void | Promise<void>;
  getView: () => { lat: number; lng: number; zoom: number } | null;

  // Layers
  setBaseLayer: (layer: BaseLayer) => void | Promise<void>;
  setSceneMode: (mode: SceneMode) => void | Promise<void>;

  // Entities
  syncEntities: (entities: EntityData[]) => void | Promise<void>;
  setEntityVisibility: (filter: EntityFilter) => void;

  // Visualization
  setCoverageVisible: (visible: boolean) => void | Promise<void>;

  // Selection
  selectEntity: (id: string | null) => void | Promise<void>;
  trackEntity: (id: string | null) => void | Promise<void>;

  // Measurement (optional - not all adapters support this)
  startMeasurement?: (type: MeasurementType) => void;
  stopMeasurement?: () => void;
  clearMeasurements?: () => void;

  // Events
  on: <E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) => void;
  off: <E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) => void;
};
