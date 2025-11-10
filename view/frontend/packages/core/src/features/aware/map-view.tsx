"use dom";

import type { MapActions } from "@hydra/map-engine/adapters/maplibre";
import { MapView as MapAdapter } from "@hydra/map-engine/adapters/maplibre";
import type { BaseLayer, EntityFilter } from "@hydra/map-engine/types";
import type { EntityData } from "@hydra/map-engine/types";
import type { DOMProps } from "expo/dom";
import { type DOMImperativeFactory, useDOMImperativeHandle } from "expo/dom";
import { type Ref, useEffect, useRef, useState } from "react";

import { deserializeEntity, type SerializedDelta } from "./utils/transform-entities";

export interface MapViewRef {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lng: number, alt?: number, duration?: number, zoom?: number) => void;
  pushDelta: (deltaJson: string) => void;
  pushSelection: (selectedId: string | null, trackedId: string | null) => void;
  pushSettings: (
    baseLayer: string,
    filterJson: string,
    coverageVisible: boolean,
    shapesVisible: boolean,
  ) => void;
}

type FlyToTarget = string | null;
type ZoomCommand = string | null;

type MapViewProps = {
  ref: Ref<MapViewRef>;
  filterJson?: string;
  flyToTarget?: FlyToTarget;
  zoomCommand?: ZoomCommand;
  baseLayer?: BaseLayer;
  coverageVisible?: boolean;
  shapesVisible?: boolean;
  onReady?: () => Promise<void>;
  onEntityClick?: (id: string | null) => Promise<void>;
  onTrackingLost?: () => Promise<void>;
  onViewChange?: (lat: number, lng: number, zoom: number) => Promise<void>;
  dom?: DOMProps;
};

export default function MapView({
  ref,
  filterJson,
  flyToTarget,
  zoomCommand,
  baseLayer = "dark",
  coverageVisible = false,
  shapesVisible = true,
  onReady,
  onEntityClick,
  onTrackingLost,
  onViewChange,
}: MapViewProps) {
  const mapActionsRef = useRef<MapActions | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const lastFlyToCommandRef = useRef<string | null>(null);
  const lastZoomCommandRef = useRef<string | null>(null);
  const pendingFlyToRef = useRef<{
    lat: number;
    lng: number;
    alt?: number;
    duration?: number;
    zoom?: number;
  } | null>(null);

  const entityMapRef = useRef(new Map<string, EntityData>());
  const [entityVersion, setEntityVersion] = useState(0);
  const [geoChanged, setGeoChanged] = useState(true);
  const [updatedIds, setUpdatedIds] = useState<Set<string>>(new Set());
  const [pushedSelectedId, setPushedSelectedId] = useState<string | null>(null);
  const [pushedTrackedId, setPushedTrackedId] = useState<string | null>(null);
  const [pushedBaseLayer, setPushedBaseLayer] = useState<BaseLayer>(baseLayer);
  const [pushedFilterJson, setPushedFilterJson] = useState<string>(filterJson ?? "");
  const [pushedCoverageVisible, setPushedCoverageVisible] = useState(coverageVisible);
  const [pushedShapesVisible, setPushedShapesVisible] = useState(shapesVisible);

  const filter: EntityFilter | undefined = pushedFilterJson
    ? JSON.parse(pushedFilterJson)
    : undefined;
  const resolvedFilter = filter ?? {
    tracks: { blue: true, red: true, neutral: true, unknown: true },
    sensors: {},
  };

  const applyDelta = (delta: SerializedDelta) => {
    const map = entityMapRef.current;
    for (const id of delta.removed) {
      map.delete(id);
    }
    const newUpdatedIds = new Set<string>();
    for (const e of delta.entities) {
      map.set(e.id, deserializeEntity(e));
      newUpdatedIds.add(e.id);
    }
    setUpdatedIds(newUpdatedIds);
    setGeoChanged(delta.geoChanged);
    setEntityVersion(delta.version);
  };

  const lastChange = { version: entityVersion, geoChanged, updatedIds };

  useDOMImperativeHandle(
    ref as Ref<DOMImperativeFactory>,
    () =>
      ({
        zoomIn: () => mapActionsRef.current?.zoomIn(),
        zoomOut: () => mapActionsRef.current?.zoomOut(),
        flyTo: (lat: number, lng: number, _alt?: number, duration?: number, zoom?: number) => {
          if (mapActionsRef.current) {
            mapActionsRef.current.flyTo({ lat, lng }, { duration: duration ?? 1.5, zoom });
          } else {
            pendingFlyToRef.current = { lat, lng, alt: _alt, duration, zoom };
          }
        },
        pushDelta: (deltaJson: string) => {
          const delta: SerializedDelta = JSON.parse(deltaJson);
          applyDelta(delta);
        },
        pushSelection: (selectedId: string | null, trackedId: string | null) => {
          setPushedSelectedId(selectedId);
          setPushedTrackedId(trackedId);
        },
        pushSettings: (
          baseLayer: string,
          filterJson: string,
          coverageVisible: boolean,
          shapesVisible: boolean,
        ) => {
          setPushedBaseLayer(baseLayer as BaseLayer);
          setPushedFilterJson(filterJson);
          setPushedCoverageVisible(coverageVisible);
          setPushedShapesVisible(shapesVisible);
        },
      }) as DOMImperativeFactory,
    [],
  );

  useEffect(() => {
    if (!flyToTarget || !actionsReady || !mapActionsRef.current) return;
    if (flyToTarget === lastFlyToCommandRef.current) return;

    lastFlyToCommandRef.current = flyToTarget;
    const parts = flyToTarget.split(",");
    const lat = parseFloat(parts[0] ?? "0");
    const lng = parseFloat(parts[1] ?? "0");
    const duration = parts[3] ? parseFloat(parts[3]) : 1.5;
    const zoom = parts[4] ? parseFloat(parts[4]) : undefined;

    mapActionsRef.current.flyTo({ lat, lng }, { duration, zoom });
  }, [flyToTarget, actionsReady]);

  useEffect(() => {
    if (!zoomCommand || !actionsReady || !mapActionsRef.current) return;
    if (zoomCommand === lastZoomCommandRef.current) return;

    lastZoomCommandRef.current = zoomCommand;

    const [direction] = zoomCommand.split("-");
    if (direction === "in") {
      mapActionsRef.current.zoomIn();
    } else {
      mapActionsRef.current.zoomOut();
    }
  }, [zoomCommand, actionsReady]);

  const handleActionsReady = (actions: MapActions) => {
    mapActionsRef.current = actions;
    setActionsReady(true);

    if (pendingFlyToRef.current) {
      const { lat, lng, duration, zoom } = pendingFlyToRef.current;
      actions.flyTo({ lat, lng }, { duration: duration ?? 1.5, zoom });
      pendingFlyToRef.current = null;
    }
  };

  const baseStyles = `
    html, body, #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background-color: #161616;
    }
  `;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#161616",
        position: "relative",
        zIndex: 0,
      }}
    >
      <style>{baseStyles}</style>
      <MapAdapter
        entityMap={entityMapRef.current}
        lastChange={lastChange}
        filter={resolvedFilter}
        selectedId={pushedSelectedId}
        trackedId={pushedTrackedId}
        baseLayer={pushedBaseLayer}
        coverageVisible={pushedCoverageVisible}
        shapesVisible={pushedShapesVisible}
        onEntityClick={async (id) => await onEntityClick?.(id)}
        onReady={async () => await onReady?.()}
        onTrackingLost={async () => await onTrackingLost?.()}
        onViewChange={async (lat, lng, zoom) => await onViewChange?.(lat, lng, zoom)}
        onActionsReady={handleActionsReady}
      />
    </div>
  );
}
