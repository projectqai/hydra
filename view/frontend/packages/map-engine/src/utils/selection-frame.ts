const cache = new Map<string, string>();

const AFFILIATION_COLORS: Record<string, string> = {
  friend: "#22D3EE",
  hostile: "#F87171",
  neutral: "#4ADE80",
  unknown: "#FBBF24",
};

export function generateSelectionFrame(affiliation: string, iconSize: number): string {
  const cacheKey = `${affiliation}:${iconSize}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const color = AFFILIATION_COLORS[affiliation] || AFFILIATION_COLORS.unknown;
  const padding = Math.round(iconSize * 0.25);
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
  const padding = Math.round(iconSize * 0.25);
  return iconSize + padding * 2;
}
