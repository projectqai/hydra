import { createContext, useContext } from "react";

export type ShortcutHandler = () => boolean | void;

export type ShortcutRegistration = {
  id: string;
  key: string;
  handler: ShortcutHandler;
  priority: number;
};

export type KeyboardContextValue = {
  register: (shortcut: ShortcutRegistration) => () => void;
};

export const KeyboardContext = createContext<KeyboardContextValue | null>(null);

export function useKeyboardContext() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error("useKeyboardContext must be used within KeyboardProvider");
  }
  return context;
}
