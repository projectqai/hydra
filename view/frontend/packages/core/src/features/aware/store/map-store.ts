import type { BaseLayer, SceneMode } from "@hydra/map-engine/types";
import { create } from "zustand";

type MapState = {
  layer: BaseLayer;
  sceneMode: SceneMode;
  setLayer: (layer: BaseLayer) => void;
  setSceneMode: (mode: SceneMode) => void;
};

export const useMapStore = create<MapState>()((set) => ({
  layer: "dark",
  sceneMode: "3d",
  setLayer: (layer) => set({ layer }),
  setSceneMode: (sceneMode) => set({ sceneMode }),
}));
