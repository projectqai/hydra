import ms from "milsymbol";

export type SymbolInfo = {
  dataUri: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

const cache = new Map<string, SymbolInfo>();
const MAX_CACHE_SIZE = 500;

function getCacheKey(sidc: string, size: number, azimuth?: number): string {
  const rounded = azimuth ? Math.round(azimuth / 5) * 5 : 0;
  return `${sidc}:${size}:${rounded}`;
}

export function generateSymbolInfo(sidc: string, size = 32, azimuth?: number): SymbolInfo {
  const key = getCacheKey(sidc, size, azimuth);

  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const symbol = new ms.Symbol(sidc, {
    size,
    direction: azimuth?.toString(),
  });

  if (!symbol.isValid()) {
    console.warn("[SymbolCache] Invalid SIDC:", sidc);
  }

  const svgString = symbol.asSVG();
  const { width, height } = symbol.getSize();
  const anchor = symbol.getAnchor();

  const utf8Bytes = new TextEncoder().encode(svgString);
  const base64 = btoa(String.fromCharCode(...utf8Bytes));
  const dataUri = `data:image/svg+xml;base64,${base64}`;

  const info: SymbolInfo = {
    dataUri,
    width,
    height,
    anchorX: anchor.x,
    anchorY: anchor.y,
  };

  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }

  cache.set(key, info);
  return info;
}

export function generateSymbol(sidc: string, size = 32, azimuth?: number): string {
  return generateSymbolInfo(sidc, size, azimuth).dataUri;
}
