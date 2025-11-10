import { IconLayer } from "@deck.gl/layers";

import type { EntityData } from "../types";
import { generateSelectionFrame, getFrameSize } from "../utils/selection-frame";

export type SelectionData = {
  entity: EntityData;
  sizePixels: number;
  offsetX: number;
  offsetY: number;
};

export type SelectionLayerProps = {
  data: SelectionData | null;
};

export function createSelectionLayer({ data }: SelectionLayerProps) {
  if (!data) {
    return new IconLayer<SelectionData>({
      id: "selection",
      data: [],
      visible: false,
      getPosition: () => [0, 0],
      getIcon: () => ({ url: "", width: 0, height: 0 }),
      getSize: 0,
    });
  }

  const affiliation = data.entity.affiliation ?? "unknown";
  const frameDataUri = generateSelectionFrame(affiliation, data.sizePixels);
  const frameSize = getFrameSize(data.sizePixels);

  return new IconLayer<SelectionData>({
    id: "selection",
    data: [data],
    visible: true,
    getPosition: (d) => [d.entity.position.lng, d.entity.position.lat],
    getIcon: () => ({
      url: frameDataUri,
      width: frameSize,
      height: frameSize,
      anchorX: frameSize / 2,
      anchorY: frameSize / 2,
    }),
    getSize: frameSize,
    getPixelOffset: (d) => [d.offsetX, d.offsetY],
    sizeUnits: "pixels",
    pickable: false,
  });
}
