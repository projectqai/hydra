import { create } from "zustand";

const DEFAULT_OVERLAYS = {
  tracks: { friend: true, hostile: true, neutral: true, unknown: true },
  sensors: { online: true, degraded: true },
  network: { datalinks: true },
  visualization: { coverage: false },
} as const;

type OverlayCategory = keyof typeof DEFAULT_OVERLAYS;

type OverlayState = typeof DEFAULT_OVERLAYS & {
  toggle: <K extends OverlayCategory>(
    category: K,
    item: keyof (typeof DEFAULT_OVERLAYS)[K],
  ) => void;
};

export const useOverlayStore = create<OverlayState>()((set) => ({
  ...DEFAULT_OVERLAYS,
  toggle: (category, item) =>
    set((state) => ({
      [category]: {
        ...state[category],
        [item]: !state[category][item],
      },
    })),
}));
