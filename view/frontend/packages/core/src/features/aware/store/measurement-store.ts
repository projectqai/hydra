import type { MeasurementType } from "@hydra/map-engine/types";
import { create } from "zustand";

type MeasurementState = {
  activeMeasurement: MeasurementType | null;
  setActiveMeasurement: (type: MeasurementType | null) => void;
};

export const useMeasurementStore = create<MeasurementState>()((set) => ({
  activeMeasurement: null,
  setActiveMeasurement: (type) => set({ activeMeasurement: type }),
}));
