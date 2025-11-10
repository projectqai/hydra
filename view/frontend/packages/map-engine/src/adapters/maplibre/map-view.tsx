import "maplibre-gl/dist/maplibre-gl.css";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { MapRef, ViewStateChangeEvent } from "react-map-gl/maplibre";
import { Map as MapGL, useControl } from "react-map-gl/maplibre";

import { BASE_LAYER_SOURCES, DEFAULT_POSITION } from "../../constants";
import {
  createCoverageLayer,
  createLabelLayer,
  createSelectionLayer,
  createSensorSectorLayer,
  createShapeLayer,
  prepareSectorData,
  type SectorRenderData,
  useEntityClusters,
} from "../../layers";
import type {
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  ShapeFeature,
  ShapeProperties,
} from "../../types";
import { shapeToFeature } from "../../utils/shape-to-geojson";

const SECTOR_MIN_ZOOM = 12;

type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
};

const INITIAL_VIEW_STATE: ViewState = {
  longitude: DEFAULT_POSITION.lng,
  latitude: DEFAULT_POSITION.lat,
  zoom: DEFAULT_POSITION.zoom,
};

type DeckGLOverlayProps = {
  layers: Layer[];
  pickingRadius?: number;
  onClick?: (info: PickingInfo) => void;
  onHover?: (info: PickingInfo) => void;
};

function DeckGLOverlay({ layers, pickingRadius, onClick, onHover }: DeckGLOverlayProps) {
  const overlay = useControl(
    () => new MapboxOverlay({ layers, pickingRadius, onClick, onHover, useDevicePixels: 2 }),
  );
  overlay.setProps({ layers, pickingRadius, onClick, onHover });
  return null;
}

const createRasterStyle = (
  tiles: string[],
  attribution: string,
  maxZoom = 20,
): StyleSpecification => ({
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    raster: {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom: maxZoom,
      attribution,
    },
  },
  layers: [{ id: "raster-layer", type: "raster", source: "raster" }],
});

const STYLES: Record<BaseLayer, StyleSpecification> = {
  dark: createRasterStyle(
    ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
    BASE_LAYER_SOURCES.dark.attribution,
    BASE_LAYER_SOURCES.dark.maxZoom,
  ),
  satellite: createRasterStyle(
    [BASE_LAYER_SOURCES.satellite.url],
    BASE_LAYER_SOURCES.satellite.attribution,
    BASE_LAYER_SOURCES.satellite.maxZoom,
  ),
};

const DEFAULT_FILTER: EntityFilter = {
  tracks: { blue: true, red: true, neutral: true, unknown: true },
  sensors: {},
};

export type MapActions = {
  flyTo: (position: GeoPosition, options?: { zoom?: number; duration?: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getView: () => { lat: number; lng: number; zoom: number } | null;
};

export type ChangeInfo = {
  version: number;
  geoChanged: boolean;
  updatedIds?: Set<string>;
};

export type MapViewProps = {
  entityMap?: Map<string, EntityData>;
  lastChange?: ChangeInfo;
  filter?: EntityFilter;
  selectedId?: string | null;
  trackedId?: string | null;
  baseLayer?: BaseLayer;
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  onEntityClick?: (id: string | null) => void | Promise<void>;
  onReady?: () => void | Promise<void>;
  onActionsReady?: (actions: MapActions) => void;
  onTrackingLost?: () => void | Promise<void>;
  onViewChange?: (lat: number, lng: number, zoom: number) => void | Promise<void>;
};

const EMPTY_MAP: Map<string, EntityData> = new Map();

export function MapView({
  entityMap = EMPTY_MAP,
  lastChange,
  filter = DEFAULT_FILTER,
  selectedId = null,
  trackedId = null,
  baseLayer = "dark",
  coverageVisible = false,
  shapesVisible = true,
  onEntityClick,
  onReady,
  onActionsReady,
  onTrackingLost,
  onViewChange,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);
  const [fontLoaded, setFontLoaded] = useState(false);
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;

  // Keep callback refs current to avoid stale closures in deck.gl layers
  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const actionsReadyCalledRef = useRef(false);
  const shapesCollectionRef = useRef<FeatureCollection<ShapeFeature["geometry"], ShapeProperties>>({
    type: "FeatureCollection",
    features: [],
  });
  const lastShapeVersionRef = useRef(-1);
  const lastTrackedPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLayerClickTimeRef = useRef(0);
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    document.fonts.load("16px Inter").then(() => setFontLoaded(true));
  }, []);

  // Update debounce timer when selection changes from outside (e.g., left panel)
  useEffect(() => {
    if (selectedId) {
      lastLayerClickTimeRef.current = Date.now();
    }
  }, [selectedId]);

  const handleMapLoad = () => {
    onReady?.();

    if (actionsReadyCalledRef.current) return;
    actionsReadyCalledRef.current = true;

    const actions: MapActions = {
      flyTo: (position, options) => {
        lastLayerClickTimeRef.current = Date.now();
        isAnimatingRef.current = true;
        mapRef.current?.flyTo({
          center: [position.lng, position.lat],
          zoom: options?.zoom,
          duration: (options?.duration ?? 1.5) * 1000,
        });
      },
      zoomIn: () => {
        isAnimatingRef.current = true;
        mapRef.current?.zoomIn({ duration: 400 });
      },
      zoomOut: () => {
        isAnimatingRef.current = true;
        mapRef.current?.zoomOut({ duration: 400 });
      },
      getView: () => {
        const vs = viewStateRef.current;
        return { lat: vs.latitude, lng: vs.longitude, zoom: vs.zoom };
      },
    };
    onActionsReady?.(actions);
  };

  const trackedEntity = trackedId ? entityMap.get(trackedId) : null;

  useEffect(() => {
    if (trackedId) {
      if (trackedEntity) {
        const pos = trackedEntity.position;
        const lastPos = lastTrackedPositionRef.current;

        if (!lastPos || lastPos.lat !== pos.lat || lastPos.lng !== pos.lng) {
          lastTrackedPositionRef.current = { lat: pos.lat, lng: pos.lng };
          mapRef.current?.easeTo({
            center: [pos.lng, pos.lat],
            duration: 300,
          });
        }
      } else {
        if (lastTrackedPositionRef.current) {
          lastTrackedPositionRef.current = null;
          onTrackingLost?.();
        }
      }
    } else {
      lastTrackedPositionRef.current = null;
    }
  }, [trackedId, trackedEntity, onTrackingLost]);

  const version = lastChange?.version ?? 0;
  const geoChanged = lastChange?.geoChanged ?? true;
  if (version !== lastShapeVersionRef.current) {
    const hasShapeInDelta = lastChange?.updatedIds
      ? Array.from(lastChange.updatedIds).some((id) => entityMap.get(id)?.shape)
      : false;
    const shouldRebuildShapes = geoChanged || hasShapeInDelta;

    lastShapeVersionRef.current = version;
    if (shouldRebuildShapes) {
      const shapeFeatures: ShapeFeature[] = [];
      for (const e of entityMap.values()) {
        if (!e.shape) continue;
        const affiliation = e.affiliation ?? "unknown";
        shapeFeatures.push(shapeToFeature(e.id, e.shape, affiliation, !!e.symbol));
      }
      shapesCollectionRef.current = { type: "FeatureCollection", features: shapeFeatures };
    }
  }

  const integerZoom = Math.floor(viewState.zoom);
  const showSectors = integerZoom >= SECTOR_MIN_ZOOM;

  const handleEntityClick = async (id: string) => {
    lastLayerClickTimeRef.current = Date.now();
    await onEntityClickRef.current?.(id);
  };

  const handleClusterClick = (
    _clusterId: string,
    lat: number,
    lng: number,
    expansionZoom: number,
  ) => {
    lastLayerClickTimeRef.current = Date.now();
    isAnimatingRef.current = true;
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: Math.min(expansionZoom + 1, 20),
      speed: 1.2,
    });
  };

  const {
    layers: clusterLayers,
    selectionData,
    labelData,
    coverageEntities,
  } = useEntityClusters({
    entityMap,
    lastChange,
    filter,
    selectedId,
    shapesVisible,
    zoom: viewState.zoom,
    onEntityClick: handleEntityClick,
    onClusterClick: handleClusterClick,
  });

  const sectorData: SectorRenderData[] = [];
  if (showSectors) {
    for (const entity of coverageEntities) {
      const sector = prepareSectorData(entity);
      if (sector) sectorData.push(sector);
    }
  }

  const visibleShapes = shapesCollectionRef.current.features.filter(
    (f) => filter.tracks[f.properties.affiliation],
  );

  const handleShapeClick = (id: string) => {
    onEntityClickRef.current?.(id);
  };

  const layers: Layer[] = [
    createCoverageLayer({
      data: coverageEntities,
      visible: coverageVisible,
    }),
    createSensorSectorLayer({
      data: sectorData,
      visible: showSectors,
    }),
    createShapeLayer({
      data: visibleShapes,
      visible: shapesVisible,
      selectedId,
      onClick: handleShapeClick,
    }),
    createSelectionLayer({
      data: selectionData,
    }),
    ...clusterLayers,
    createLabelLayer({
      data: labelData,
      visible: fontLoaded && labelData.length > 0,
    }),
  ];

  const handleClick = (info: PickingInfo) => {
    if (isDraggingRef.current) return;
    if (isAnimatingRef.current) return;
    const msSinceLayerClick = Date.now() - lastLayerClickTimeRef.current;
    if (msSinceLayerClick < 500) return;
    if (!info.picked) {
      onEntityClickRef.current?.(null);
    }
  };

  const setCursor = (cursor: string) => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas && canvas.style.cursor !== cursor) {
      canvas.style.cursor = cursor;
    }
  };

  const handleHover = (info: PickingInfo) => {
    setCursor(info.picked ? "pointer" : "grab");
  };

  const lastIntegerZoomRef = useRef(-1);

  const handleMove = (evt: ViewStateChangeEvent) => {
    const newIntegerZoom = Math.floor(evt.viewState.zoom);

    if (newIntegerZoom !== lastIntegerZoomRef.current) {
      lastIntegerZoomRef.current = newIntegerZoom;
      setViewState({
        longitude: evt.viewState.longitude,
        latitude: evt.viewState.latitude,
        zoom: evt.viewState.zoom,
      });
    }
  };

  const handleMoveEnd = (evt: ViewStateChangeEvent) => {
    lastIntegerZoomRef.current = Math.floor(evt.viewState.zoom);
    setViewState({
      longitude: evt.viewState.longitude,
      latitude: evt.viewState.latitude,
      zoom: evt.viewState.zoom,
    });
    onViewChange?.(evt.viewState.latitude, evt.viewState.longitude, evt.viewState.zoom);
    // Delay clearing animation flag to let layers re-render after zoom
    setTimeout(() => {
      isAnimatingRef.current = false;
    }, 200);
  };

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", zIndex: 0 }}>
      <MapGL
        ref={mapRef}
        mapStyle={STYLES[baseLayer]}
        attributionControl={false}
        initialViewState={INITIAL_VIEW_STATE}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        onIdle={handleMapLoad}
        onDragStart={() => {
          if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
            dragTimeoutRef.current = null;
          }
          isDraggingRef.current = true;
          setCursor("grabbing");
        }}
        onDragEnd={() => {
          setCursor("grab");
          dragTimeoutRef.current = setTimeout(() => {
            isDraggingRef.current = false;
            dragTimeoutRef.current = null;
          }, 300);
        }}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
      >
        <DeckGLOverlay
          layers={layers}
          pickingRadius={8}
          onClick={handleClick}
          onHover={handleHover}
        />
      </MapGL>
    </div>
  );
}
