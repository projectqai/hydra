const cache = new Map<string, string>();

const AFFILIATION_COLORS: Record<string, string> = {
  blue: "#3B82F6",
  red: "#CD1818",
  neutral: "#3D8D7A",
  unknown: "#F7EF81",
};

export function generateSelectionFrame(affiliation: string, iconSize: number): string {
  const cacheKey = `${affiliation}:${iconSize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const color = AFFILIATION_COLORS[affiliation] || AFFILIATION_COLORS.unknown;
  const padding = Math.round(iconSize * 0.1);
  const s = iconSize + padding * 2;
  const corner = Math.round(s * 0.2);
  const inset = 2;
  const stroke = 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" fill="none">
    <g stroke="${color}" stroke-width="${stroke}" stroke-linecap="square">
      <path d="M${inset},${inset + corner} V${inset} H${inset + corner}"/>
      <path d="M${s - inset - corner},${inset} H${s - inset} V${inset + corner}"/>
      <path d="M${inset},${s - inset - corner} V${s - inset} H${inset + corner}"/>
      <path d="M${s - inset - corner},${s - inset} H${s - inset} V${s - inset - corner}"/>
    </g>
  </svg>`;

  const utf8Bytes = new TextEncoder().encode(svg);
  const base64 = btoa(String.fromCharCode(...utf8Bytes));
  const dataUri = `data:image/svg+xml;base64,${base64}`;

  cache.set(cacheKey, dataUri);
  return dataUri;
}

export function getFrameSize(iconSize: number): number {
  const padding = Math.round(iconSize * 0.1);
  return iconSize + padding * 2;
}
