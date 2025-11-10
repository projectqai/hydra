import { useKeyboardShortcut } from "@hydra/ui/keyboard";
import { usePanelContext } from "@hydra/ui/panels";

import { usePIPContext } from "../pip-context";
import { useSelectionStore } from "../store/selection-store";

export function useEscapeHandler() {
  const { windows, closeAllPIP } = usePIPContext();
  const { unfocusRightPanel, collapseAll } = usePanelContext();
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const viewedEntityId = useSelectionStore((s) => s.viewedEntityId);
  const select = useSelectionStore((s) => s.select);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  useKeyboardShortcut(
    "Escape",
    () => {
      if (windows.length > 0) {
        closeAllPIP();
        return true;
      }
      if (selectedEntityId) {
        select(null);
        unfocusRightPanel();
        return true;
      }
      if (viewedEntityId) {
        clearSelection();
        collapseAll();
        return true;
      }
      return false;
    },
    { priority: 100 },
  );
}
