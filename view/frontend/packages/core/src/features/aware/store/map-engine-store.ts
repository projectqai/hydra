import { createRef, type RefObject } from "react";
import { create } from "zustand";

import type { MapViewRef } from "../map-view";

export type FlyToTarget = {
  lat: number;
  lng: number;
  alt?: number;
  duration?: number;
  zoom?: number;
  timestamp: number;
} | null;

type MapEngineState = {
  ref: RefObject<MapViewRef | null>;
  isReady: boolean;
  flyToTarget: FlyToTarget;
};

export const useMapEngineStore = create<MapEngineState>()(() => ({
  ref: createRef<MapViewRef | null>(),
  isReady: false,
  flyToTarget: null,
}));

export function setMapReady(ready: boolean) {
  useMapEngineStore.setState({ isReady: ready });
}

export function useMapRef() {
  return useMapEngineStore((s) => s.ref);
}

export function useFlyToTarget() {
  return useMapEngineStore((s) => s.flyToTarget);
}

export function clearFlyToTarget() {
  useMapEngineStore.setState({ flyToTarget: null });
}

const getRef = () => useMapEngineStore.getState().ref.current;

export const mapEngineActions = {
  zoomIn: () => getRef()?.zoomIn(),
  zoomOut: () => getRef()?.zoomOut(),
  flyTo: (lat: number, lng: number, alt?: number, duration?: number, zoom?: number) => {
    useMapEngineStore.setState({
      flyToTarget: { lat, lng, alt, duration, zoom, timestamp: Date.now() },
    });
  },
  getView: () => getRef()?.getView() ?? null,
  startMeasurement: (type: string) => getRef()?.startMeasurement(type),
  stopMeasurement: () => getRef()?.stopMeasurement(),
  clearMeasurements: () => getRef()?.clearMeasurements(),
  setBaseLayer: (layer: string) => getRef()?.setBaseLayer(layer),
  setSceneMode: (mode: string) => getRef()?.setSceneMode(mode),
  setEntityVisibility: (tracksJson: string, sensorsJson: string) =>
    getRef()?.setEntityVisibility(tracksJson, sensorsJson),
  setCoverageVisible: (visible: boolean) => getRef()?.setCoverageVisible(visible),
  selectEntity: (id: string | null) => getRef()?.selectEntity(id),
  trackEntity: (id: string | null) => getRef()?.trackEntity(id),
};

export function useMapEngine() {
  return mapEngineActions;
}
