import { useEffect, useId } from "react";

import { type ShortcutHandler, useKeyboardContext } from "./keyboard-context";

type UseKeyboardShortcutOptions = {
  priority?: number;
};

export function useKeyboardShortcut(
  key: string,
  handler: ShortcutHandler,
  options?: UseKeyboardShortcutOptions,
) {
  const id = useId();
  const { register } = useKeyboardContext();
  const priority = options?.priority ?? 0;

  useEffect(() => {
    return register({
      id,
      key,
      handler,
      priority,
    });
  }, [id, key, handler, priority, register]);
}
