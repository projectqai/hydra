import type { BaseLayer } from "@hydra/map-engine/types";
import { createRef, type RefObject } from "react";
import { create } from "zustand";

import type { MapViewRef } from "../map-view";

export type FlyToTarget = string | null;
export type ZoomCommand = string | null;

type ViewState = { lat: number; lng: number; zoom: number };

type MapEngineState = {
  ref: RefObject<MapViewRef | null>;
  isReady: boolean;
  flyToTarget: FlyToTarget;
  zoomCommand: ZoomCommand;
  baseLayer: BaseLayer;
  currentView: ViewState;
};

const DEFAULT_VIEW: ViewState = { lat: 0, lng: 0, zoom: 2 };

export const useMapEngineStore = create<MapEngineState>()(() => ({
  ref: createRef<MapViewRef | null>(),
  isReady: false,
  flyToTarget: null,
  zoomCommand: null,
  baseLayer: "dark",
  currentView: DEFAULT_VIEW,
}));

export function setCurrentView(lat: number, lng: number, zoom: number) {
  useMapEngineStore.setState({ currentView: { lat, lng, zoom } });
}

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

export function useZoomCommand() {
  return useMapEngineStore((s) => s.zoomCommand);
}

const getRef = () => useMapEngineStore.getState().ref.current;

export const mapEngineActions = {
  zoomIn: () => getRef()?.zoomIn(),
  zoomOut: () => getRef()?.zoomOut(),
  flyTo: (lat: number, lng: number, alt?: number, duration?: number, zoom?: number) => {
    getRef()?.flyTo(lat, lng, alt, duration, zoom);
  },
  getView: () => useMapEngineStore.getState().currentView,
  setBaseLayer: (layer: string) => {
    useMapEngineStore.setState({ baseLayer: layer as BaseLayer });
  },
};

export function useMapEngine() {
  return mapEngineActions;
}
