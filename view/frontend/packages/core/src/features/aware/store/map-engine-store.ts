import { createRef, type RefObject } from "react";
import { create } from "zustand";

import type { MapViewRef } from "../map-view";

type MapEngineState = {
  ref: RefObject<MapViewRef | null>;
  isReady: boolean;
};

export const useMapEngineStore = create<MapEngineState>()(() => ({
  ref: createRef<MapViewRef | null>(),
  isReady: false,
}));

export function setMapReady(ready: boolean) {
  useMapEngineStore.setState({ isReady: ready });
}

export function useMapRef() {
  return useMapEngineStore((s) => s.ref);
}

const getRef = () => useMapEngineStore.getState().ref.current;

export const mapEngineActions = {
  zoomIn: () => getRef()?.zoomIn(),
  zoomOut: () => getRef()?.zoomOut(),
  flyTo: (lat: number, lng: number, alt?: number, duration?: number) =>
    getRef()?.flyTo(lat, lng, alt, duration),
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
