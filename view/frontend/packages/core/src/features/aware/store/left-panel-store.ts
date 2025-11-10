import { create } from "zustand";

export type ListMode = "tracks" | "assets";

type LeftPanelState = {
  listMode: ListMode;
  setListMode: (mode: ListMode) => void;
};

export const useLeftPanelStore = create<LeftPanelState>()((set) => ({
  listMode: "tracks",
  setListMode: (mode) => set({ listMode: mode }),
}));
