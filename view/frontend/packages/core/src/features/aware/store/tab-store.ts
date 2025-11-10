import { create } from "zustand";

type TabState = {
  initialTab: string | null;
  setInitialTab: (tab: string | null) => void;
  clearInitialTab: () => void;
};

export const useTabStore = create<TabState>()((set) => ({
  initialTab: null,
  setInitialTab: (tab) => set({ initialTab: tab }),
  clearInitialTab: () => set({ initialTab: null }),
}));
