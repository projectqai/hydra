import type { ReactNode } from "react";

export type PanelContentProps = {
  children: ReactNode;
};

export function PanelContent({ children }: PanelContentProps) {
  return children;
}
