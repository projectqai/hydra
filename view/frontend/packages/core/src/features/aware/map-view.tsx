"use dom";

import type { MapEngine } from "@hydra/map-engine/map-engine";
import type { DOMProps } from "expo/dom";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef, useState } from "react";

import { deserializeEntities, type SerializedEntityData } from "./utils/transform-entities";

export interface MapViewRef {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lng: number, alt?: number, duration?: number) => void;
  startMeasurement: (type: string) => void;
  stopMeasurement: () => void;
  clearMeasurements: () => void;
  setBaseLayer: (layer: string) => void;
  setSceneMode: (mode: string) => void;
  setEntityVisibility: (tracksJson: string, sensorsJson: string) => void;
  setCoverageVisible: (visible: boolean) => void;
  selectEntity: (id: string | null) => void;
  trackEntity: (id: string | null) => void;
}

type MapViewProps = {
  ref: Ref<MapViewRef>;
  entities: SerializedEntityData[];
  onReady?: () => void | Promise<void>;
  onEntityClick?: (id: string | null) => void | Promise<void>;
  onTrackingLost?: () => void | Promise<void>;
  dom?: DOMProps;
};

const LEAFLET_CSS_ID = "leaflet-css";

if (typeof document !== "undefined" && !document.getElementById(LEAFLET_CSS_ID)) {
  const link = document.createElement("link");
  link.id = LEAFLET_CSS_ID;
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

async function createMapAdapter(options: { debug?: boolean }): Promise<MapEngine> {
  const { createLeafletAdapter } = await import("@hydra/map-engine/adapters/leaflet");
  return createLeafletAdapter(options);
}

export default function MapView({
  ref,
  entities,
  onReady,
  onEntityClick,
  onTrackingLost,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useDOMImperativeHandle(
    ref as Ref<DOMImperativeFactory>,
    () =>
      ({
        zoomIn: () => {
          engineRef.current?.zoomIn();
        },
        zoomOut: () => {
          engineRef.current?.zoomOut();
        },
        flyTo: (lat: number, lng: number, alt?: number, duration?: number) => {
          engineRef.current?.flyTo({ lat, lng, alt }, duration ? { duration } : undefined);
        },
        startMeasurement: (type: string) => {
          engineRef.current?.startMeasurement?.(
            type as
              | "distance"
              | "polyline"
              | "horizontal"
              | "vertical"
              | "height"
              | "area"
              | "point",
          );
        },
        stopMeasurement: () => {
          engineRef.current?.stopMeasurement?.();
        },
        clearMeasurements: () => {
          engineRef.current?.clearMeasurements?.();
        },
        setBaseLayer: (layer: string) => {
          engineRef.current?.setBaseLayer(layer as "dark" | "satellite");
        },
        setSceneMode: (mode: string) => {
          engineRef.current?.setSceneMode(mode as "2d" | "2.5d" | "3d");
        },
        setEntityVisibility: (tracksJson: string, sensorsJson: string) => {
          const tracks = JSON.parse(tracksJson);
          const sensors = JSON.parse(sensorsJson);
          engineRef.current?.setEntityVisibility({ tracks, sensors });
        },
        setCoverageVisible: (visible: boolean) => {
          engineRef.current?.setCoverageVisible(visible);
        },
        selectEntity: (id: string | null) => {
          engineRef.current?.selectEntity(id);
        },
        trackEntity: (id: string | null) => {
          engineRef.current?.trackEntity(id);
        },
      }) as DOMImperativeFactory,
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;
    const container = containerRef.current;

    createMapAdapter({ debug: __DEV__ })
      .then((engine) => {
        if (!mounted) {
          engine.destroy();
          return;
        }

        engineRef.current = engine;

        engine.on("ready", () => {
          setEngineReady(true);
          onReady?.();
        });

        engine.on("entityClick", (id) => onEntityClick?.(id));

        engine.on("trackingLost", () => {
          onTrackingLost?.();
        });

        return engine.mount(container);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to initialize map");
        console.error("Map engine initialization failed:", err);
      });

    return () => {
      mounted = false;
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, []);

  // Sync entities to map engine when they change or engine becomes ready
  useEffect(() => {
    if (!engineReady || !engineRef.current || !entities) return;
    engineRef.current.syncEntities(deserializeEntities(entities));
  }, [entities, engineReady]);

  if (error) {
    return (
      <div className="flex size-full items-center justify-center bg-black text-red-500">
        <div className="text-center">
          <p className="text-lg font-semibold">Failed to load map</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const baseStyles = `
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: #161616;
    }
  `;

  const leafletStyles = `
    .leaflet-container {
      z-index: 0 !important;
      background: #161616 !important;
    }
    .leaflet-div-icon {
      background: none !important;
      border: none !important;
    }
    .leaflet-control-container .leaflet-bottom.leaflet-right {
      left: 0 !important;
      right: 0 !important;
      bottom: 6px !important;
      display: flex !important;
      justify-content: center !important;
    }
    .leaflet-control-attribution {
      font-size: 10px !important;
      background: transparent !important;
      color: rgba(255,255,255,0.6);
      opacity: 0.4
    }
  `;

  return (
    <div style={{ width: "100%", height: "100%", background: "#161616" }}>
      <style>{baseStyles}</style>
      <style>{leafletStyles}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
