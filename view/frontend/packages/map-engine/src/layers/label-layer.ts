import { TextLayer } from "@deck.gl/layers";

export type LabelData = {
  id: string;
  position: [number, number];
  label: string;
  offsetY: number;
};

export type LabelLayerProps = {
  data: LabelData[];
  visible: boolean;
};

export function createLabelLayer({ data, visible }: LabelLayerProps) {
  return new TextLayer<LabelData>({
    id: "labels",
    data,
    visible: visible && data.length > 0,
    getPosition: (d) => d.position,
    getText: (d) => d.label,
    getSize: 12,
    getColor: [255, 255, 255, 255],
    getTextAnchor: "middle",
    getAlignmentBaseline: "top",
    getPixelOffset: (d) => [0, d.offsetY / 2 + 4],
    fontFamily: "Inter, sans-serif",
    fontWeight: "normal",
    fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 255],
    pickable: false,
  });
}
