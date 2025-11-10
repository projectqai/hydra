import type { Camera, Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

import { toVideoProtocol, type VideoProtocol } from "./components/video-stream/types";

type PIPWindow = {
  id: string;
  entityId: string;
  entityName: string | null;
  cameraUrl: string;
  cameraLabel: string | null;
  cameraProtocol: VideoProtocol;
};

type PIPState = {
  windows: PIPWindow[];
};

type PIPContextValue = PIPState & {
  openPIP: (entity: Entity, camera: Camera) => void;
  closePIP: (id: string) => void;
  closeAllPIP: () => void;
  isInPIP: (entityId: string, cameraUrl: string) => boolean;
};

const PIPContext = createContext<PIPContextValue | null>(null);

const CASCADE_OFFSET = 30;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;

let windowIdCounter = 0;
let lastWindowPosition: { x: number; y: number } | null = null;

const generateWindowId = () => `pip-${Date.now()}-${windowIdCounter++}`;

export function updateLastWindowPosition(pos: { x: number; y: number }) {
  lastWindowPosition = pos;
}

export function resetLastWindowPosition() {
  lastWindowPosition = null;
}

export function getInitialPosition(
  screenWidth: number,
  screenHeight: number,
  minTop: number,
): { x: number; y: number } {
  if (lastWindowPosition) {
    return {
      x: lastWindowPosition.x + CASCADE_OFFSET,
      y: Math.max(lastWindowPosition.y + CASCADE_OFFSET, minTop),
    };
  }
  return {
    x: (screenWidth - DEFAULT_WIDTH) / 2,
    y: Math.max((screenHeight - DEFAULT_HEIGHT) / 2, minTop),
  };
}

const INITIAL_STATE: PIPState = {
  windows: [],
};

export function PIPProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PIPState>(INITIAL_STATE);

  const openPIP = (entity: Entity, camera: Camera) => {
    setState((prev) => {
      const exists = prev.windows.some(
        (w) => w.entityId === entity.id && w.cameraUrl === camera.url,
      );
      if (exists) return prev;

      const newWindow: PIPWindow = {
        id: generateWindowId(),
        entityId: entity.id,
        entityName: entity.label || entity.controller?.name || null,
        cameraUrl: camera.url,
        cameraLabel: camera.label,
        cameraProtocol: toVideoProtocol(camera.protocol),
      };

      return {
        windows: [...prev.windows, newWindow],
      };
    });
  };

  const closePIP = (id: string) => {
    setState((prev) => {
      const remaining = prev.windows.filter((w) => w.id !== id);
      if (remaining.length === 0) {
        resetLastWindowPosition();
      }
      return { windows: remaining };
    });
  };

  const closeAllPIP = () => {
    resetLastWindowPosition();
    setState({ windows: [] });
  };

  const isInPIP = (entityId: string, cameraUrl: string) => {
    return state.windows.some((w) => w.entityId === entityId && w.cameraUrl === cameraUrl);
  };

  return (
    <PIPContext.Provider
      value={{
        ...state,
        openPIP,
        closePIP,
        closeAllPIP,
        isInPIP,
      }}
    >
      {children}
    </PIPContext.Provider>
  );
}

export function usePIPContext() {
  const context = useContext(PIPContext);
  if (!context) {
    throw new Error("usePIPContext must be used within PIPProvider");
  }
  return context;
}
