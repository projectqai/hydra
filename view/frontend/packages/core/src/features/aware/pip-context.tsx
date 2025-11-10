import type { Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

type Camera = {
  label: string;
  url: string;
};

type PIPState = {
  isVisible: boolean;
  entityId: string | null;
  entityName: string | null;
  cameraUrl: string | null;
  cameraLabel: string | null;
};

type PIPContextValue = PIPState & {
  openPIP: (entity: Entity, camera: Camera) => void;
  closePIP: () => void;
};

const PIPContext = createContext<PIPContextValue | null>(null);

const INITIAL_STATE: PIPState = {
  isVisible: false,
  entityId: null,
  entityName: null,
  cameraUrl: null,
  cameraLabel: null,
};

export function PIPProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PIPState>(INITIAL_STATE);

  const openPIP = (entity: Entity, camera: Camera) => {
    setState({
      isVisible: true,
      entityId: entity.id,
      entityName: entity.label || entity.controller?.name || null,
      cameraUrl: camera.url,
      cameraLabel: camera.label,
    });
  };

  const closePIP = () => {
    setState((prev) => ({ ...prev, isVisible: false }));
  };

  return (
    <PIPContext.Provider
      value={{
        ...state,
        openPIP,
        closePIP,
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
