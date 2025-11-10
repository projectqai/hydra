import ms from "milsymbol";

const ATLAS_SIZE = 1024 as const;
const PADDING = 2 as const;

type AtlasEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

export type OverflowEntry = {
  dataUrl: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

export type IconMapping = Record<string, AtlasEntry>;

export type AtlasStats = {
  count: number;
  estimatedCapacity: number;
  usagePercent: number;
  atlasSize: number;
  isFull: boolean;
};

function estimateCapacity(symbolSize: number): number {
  const avgSymbolWidth = symbolSize * 1.4;
  const avgSymbolHeight = symbolSize * 1.6;
  const cols = Math.floor(ATLAS_SIZE / (avgSymbolWidth + PADDING));
  const rows = Math.floor(ATLAS_SIZE / (avgSymbolHeight + PADDING));
  return cols * rows;
}

export type SymbolAtlas = {
  getOrCreate: (sidc: string, size?: number) => string;
  preload: (sidcs: string[], size?: number) => Promise<void>;
  onReady: (callback: () => void) => void;
  isPending: () => boolean;
  getCanvas: () => HTMLCanvasElement;
  getImageData: () => ImageData;
  getMapping: () => IconMapping;
  getVersion: () => number;
  getStats: () => AtlasStats;
  hasSymbol: (sidc: string, size?: number) => boolean;
  getSymbolKey: (sidc: string, size?: number) => string;
  isOverflow: (sidc: string, size?: number) => boolean;
  getOverflowData: (sidc: string, size?: number) => OverflowEntry | null;
};

function createSymbolAtlas(symbolSize = 32): SymbolAtlas {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Failed to get 2d context");
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  const mapping = new Map<string, AtlasEntry>();
  const overflowSymbols = new Map<string, OverflowEntry>();
  let currentX = 0;
  let currentY = 0;
  let rowHeight = 0;
  let version = 0;
  let cachedImageData: ImageData | null = null;
  let cachedImageDataVersion = -1;
  let pendingLoads = 0;
  let onReadyCallbacks: (() => void)[] = [];

  const getCacheKey = (sidc: string, size: number) => `${sidc}:${size}`;

  const notifyReady = () => {
    const callbacks = onReadyCallbacks;
    onReadyCallbacks = [];
    callbacks.forEach((cb) => cb());
  };

  const getStats = () => {
    const count = mapping.size;
    const estimated = estimateCapacity(symbolSize);
    return {
      count,
      estimatedCapacity: estimated,
      usagePercent: Math.round((count / estimated) * 100),
      atlasSize: ATLAS_SIZE,
      isFull: currentY + symbolSize * 1.6 > ATLAS_SIZE,
    };
  };

  const getOrCreate = (sidc: string, size?: number): string => {
    const actualSize = size ?? symbolSize;
    const key = getCacheKey(sidc, actualSize);

    if (mapping.has(key)) return key;
    if (overflowSymbols.has(key)) return key;

    const symbol = new ms.Symbol(sidc, { size: actualSize });
    const { width, height } = symbol.getSize();
    const anchor = symbol.getAnchor();

    if (currentX + width + PADDING > ATLAS_SIZE) {
      currentX = 0;
      currentY += rowHeight + PADDING;
      rowHeight = 0;
    }

    if (currentY + height + PADDING > ATLAS_SIZE) {
      const stats = getStats();
      console.warn(
        `[SymbolAtlas] Atlas full! ${stats.count}/${stats.estimatedCapacity} symbols (${ATLAS_SIZE}x${ATLAS_SIZE}px). ` +
          `Symbol "${sidc}" using direct SVG rendering.`,
      );

      const svgString = symbol.asSVG();
      const base64 = btoa(unescape(encodeURIComponent(svgString)));
      overflowSymbols.set(key, {
        dataUrl: `data:image/svg+xml;base64,${base64}`,
        width,
        height,
        anchorX: anchor.x,
        anchorY: anchor.y,
      });

      return key;
    }

    const svgString = symbol.asSVG();
    const base64 = btoa(unescape(encodeURIComponent(svgString)));
    const dataUrl = `data:image/svg+xml;base64,${base64}`;

    const entry: AtlasEntry = {
      x: currentX,
      y: currentY,
      width,
      height,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };

    mapping.set(key, entry);
    pendingLoads++;

    const image = new Image();
    image.onload = () => {
      ctx.drawImage(image, entry.x, entry.y);
      version++;
      pendingLoads--;
      if (pendingLoads === 0) notifyReady();
    };
    image.onerror = () => {
      pendingLoads--;
      if (pendingLoads === 0) notifyReady();
    };
    image.src = dataUrl;

    currentX += width + PADDING;
    rowHeight = Math.max(rowHeight, height);

    return key;
  };

  const preload = async (sidcs: string[], size?: number): Promise<void> => {
    const actualSize = size ?? symbolSize;
    const toLoad: { dataUrl: string; entry: AtlasEntry }[] = [];

    for (const sidc of sidcs) {
      const key = getCacheKey(sidc, actualSize);
      if (mapping.has(key) || overflowSymbols.has(key)) continue;

      const symbol = new ms.Symbol(sidc, { size: actualSize });
      const { width, height } = symbol.getSize();
      const anchor = symbol.getAnchor();

      if (currentX + width + PADDING > ATLAS_SIZE) {
        currentX = 0;
        currentY += rowHeight + PADDING;
        rowHeight = 0;
      }

      if (currentY + height + PADDING > ATLAS_SIZE) {
        console.warn(
          `[SymbolAtlas] Atlas full during preload. Symbol "${sidc}" using direct SVG rendering.`,
        );

        const svgString = symbol.asSVG();
        const base64 = btoa(unescape(encodeURIComponent(svgString)));
        overflowSymbols.set(key, {
          dataUrl: `data:image/svg+xml;base64,${base64}`,
          width,
          height,
          anchorX: anchor.x,
          anchorY: anchor.y,
        });

        continue;
      }

      const svgString = symbol.asSVG();
      const base64 = btoa(unescape(encodeURIComponent(svgString)));
      const dataUrl = `data:image/svg+xml;base64,${base64}`;

      const entry: AtlasEntry = {
        x: currentX,
        y: currentY,
        width,
        height,
        anchorX: anchor.x,
        anchorY: anchor.y,
      };

      mapping.set(key, entry);
      toLoad.push({ dataUrl, entry });

      currentX += width + PADDING;
      rowHeight = Math.max(rowHeight, height);
    }

    await Promise.all(
      toLoad.map(
        ({ dataUrl, entry }) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, entry.x, entry.y);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = dataUrl;
          }),
      ),
    );

    version++;
  };

  return {
    getOrCreate,
    preload,
    onReady: (callback) => {
      if (pendingLoads === 0) callback();
      else onReadyCallbacks.push(callback);
    },
    isPending: () => pendingLoads > 0,
    getCanvas: () => canvas,
    getImageData: () => {
      if (cachedImageDataVersion !== version || !cachedImageData) {
        cachedImageData = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE);
        cachedImageDataVersion = version;
      }
      return cachedImageData;
    },
    getMapping: () => {
      const result: IconMapping = {};
      for (const [key, entry] of mapping) {
        result[key] = entry;
      }
      return result;
    },
    getVersion: () => version,
    getStats,
    hasSymbol: (sidc, size) => {
      const key = getCacheKey(sidc, size ?? symbolSize);
      return mapping.has(key) || overflowSymbols.has(key);
    },
    getSymbolKey: (sidc, size) => getCacheKey(sidc, size ?? symbolSize),
    isOverflow: (sidc, size) => overflowSymbols.has(getCacheKey(sidc, size ?? symbolSize)),
    getOverflowData: (sidc, size) =>
      overflowSymbols.get(getCacheKey(sidc, size ?? symbolSize)) ?? null,
  };
}

const atlases = new Map<number, SymbolAtlas>();

export function getSymbolAtlas(size = 32): SymbolAtlas {
  let atlas = atlases.get(size);
  if (!atlas) {
    atlas = createSymbolAtlas(size);
    atlases.set(size, atlas);
  }
  return atlas;
}

export function generateSymbol(sidc: string, size = 32): string {
  const symbol = new ms.Symbol(sidc, { size });
  const svgString = symbol.asSVG();
  const base64 = btoa(unescape(encodeURIComponent(svgString)));
  return `data:image/svg+xml;base64,${base64}`;
}
