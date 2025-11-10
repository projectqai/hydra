import ms from "milsymbol";

const cache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

function getCacheKey(sidc: string, size: number, azimuth?: number): string {
  const rounded = azimuth ? Math.round(azimuth / 5) * 5 : 0;
  return `${sidc}:${size}:${rounded}`;
}

export function generateSymbol(sidc: string, size = 32, azimuth?: number): string {
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

  // UTF-8 safe base64 encoding for SVG
  const utf8Bytes = new TextEncoder().encode(svgString);
  const base64 = btoa(String.fromCharCode(...utf8Bytes));
  const dataUri = `data:image/svg+xml;base64,${base64}`;

  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }

  cache.set(key, dataUri);
  return dataUri;
}
