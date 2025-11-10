import type { ReactNode } from "react";

export type PanelCollapsedProps = {
  children: ReactNode;
};

export function PanelCollapsed({ children }: PanelCollapsedProps) {
  return children;
}
