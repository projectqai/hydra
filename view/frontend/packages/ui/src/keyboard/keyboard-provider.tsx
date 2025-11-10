import { type ReactNode, useEffect, useRef } from "react";

import { KeyboardContext, type ShortcutRegistration } from "./keyboard-context";

type KeyboardProviderProps = {
  children: ReactNode;
};

type WebKeyboardEvent = {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
};

declare const window:
  | {
      addEventListener: (event: string, handler: (e: WebKeyboardEvent) => void) => void;
      removeEventListener: (event: string, handler: (e: WebKeyboardEvent) => void) => void;
    }
  | undefined;

export function KeyboardProvider({ children }: KeyboardProviderProps) {
  const registryRef = useRef<Map<string, ShortcutRegistration>>(new Map());

  const register = (shortcut: ShortcutRegistration) => {
    registryRef.current.set(shortcut.id, shortcut);
    return () => {
      registryRef.current.delete(shortcut.id);
    };
  };

  useEffect(() => {
    if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return;

    const handleKeyDown = (e: WebKeyboardEvent) => {
      const handlers = Array.from(registryRef.current.values())
        .filter((s) => s.key === e.key)
        .sort((a, b) => b.priority - a.priority);

      for (const shortcut of handlers) {
        const result = shortcut.handler();
        if (result === true) {
          e.preventDefault();
          e.stopPropagation();
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <KeyboardContext.Provider value={{ register }}>{children}</KeyboardContext.Provider>;
}
