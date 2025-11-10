import { create } from "zustand";

type SelectionState = {
  selectedEntityId: string | null;
  viewedEntityId: string | null;
  isFollowing: boolean;
  select: (id: string | null) => void;
  toggleFollow: () => void;
  clearSelection: () => void;
};

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedEntityId: null,
  viewedEntityId: null,
  isFollowing: false,
  select: (id) =>
    set((s) => ({
      selectedEntityId: id,
      viewedEntityId: id ?? s.viewedEntityId,
      isFollowing: false,
    })),
  toggleFollow: () => set((s) => ({ isFollowing: !s.isFollowing })),
  clearSelection: () =>
    set({
      selectedEntityId: null,
      viewedEntityId: null,
      isFollowing: false,
    }),
}));
