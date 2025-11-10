import type { Layer, PickingInfo } from "@deck.gl/core";
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { useRef, useState } from "react";

import { ICON_SIZE } from "../constants";
import type { Affiliation, EntityData, EntityFilter } from "../types";
import { getSymbolAtlas, type OverflowEntry } from "../utils/symbol-atlas";
import { useClusterWorker } from "./use-cluster-worker";

const CLUSTER_SYMBOL_SIZE = 44;
const ICON_SIZE_MIN_PIXELS = 8;
const ICON_SIZE_MAX_PIXELS = 64;

const CLUSTER_BG: [number, number, number, number] = [50, 50, 50, 255];

const MILSYMBOL_COLORS_RGBA: Record<Affiliation, [number, number, number, number]> = {
  blue: [128, 224, 255, 255],
  red: [255, 128, 128, 255],
  neutral: [170, 255, 170, 255],
  unknown: [255, 255, 128, 255],
};

function getAffiliationColorRGBA(
  affiliation: Affiliation | undefined,
): [number, number, number, number] {
  return MILSYMBOL_COLORS_RGBA[affiliation ?? "unknown"];
}

type EntityRenderData = {
  entity: EntityData;
  position: [number, number];
  iconKey: string;
  size: number;
  overflow?: OverflowEntry;
};

type ClusterRenderData = {
  id: string;
  lat: number;
  lng: number;
  position: [number, number];
  count: number;
  symbol?: string;
  affiliation?: Affiliation;
  iconKey?: string;
  size?: number;
  radius: number;
  pixelOffset: [number, number];
  lineColor: [number, number, number, number];
  textColor: [number, number, number, number];
  overflow?: OverflowEntry;
};

export type UseEntityClustersOptions = {
  entityMap: Map<string, EntityData>;
  lastChange?: { version: number; geoChanged: boolean };
  filter: EntityFilter;
  selectedId: string | null;
  shapesVisible: boolean;
  zoom: number;
  onEntityClick?: (id: string) => void | Promise<void>;
  onClusterClick?: (clusterId: string, lat: number, lng: number, expansionZoom: number) => void;
};

export type UseEntityClustersResult = {
  layers: Layer[];
  selectionData: {
    entity: EntityData;
    sizePixels: number;
    offsetX: number;
    offsetY: number;
  } | null;
  labelData: { id: string; position: [number, number]; label: string; offsetY: number }[];
  coverageEntities: EntityData[];
};

export function useEntityClusters(options: UseEntityClustersOptions): UseEntityClustersResult {
  const {
    entityMap,
    lastChange,
    filter,
    selectedId,
    shapesVisible,
    zoom,
    onEntityClick,
    onClusterClick,
  } = options;

  const onEntityClickRef = useRef(onEntityClick);
  onEntityClickRef.current = onEntityClick;
  const onClusterClickRef = useRef(onClusterClick);
  onClusterClickRef.current = onClusterClick;

  const typedArrayPoolRef = useRef<{
    positions: Float64Array | null;
    radii: Float32Array | null;
    colors: Uint8Array | null;
  }>({ positions: null, radii: null, colors: null });

  const [atlasVersion, setAtlasVersion] = useState(0);
  const entityAtlasRef = useRef(getSymbolAtlas(ICON_SIZE));
  const clusterAtlasRef = useRef(getSymbolAtlas(CLUSTER_SYMBOL_SIZE));

  const version = lastChange?.version ?? 0;
  const geoChanged = lastChange?.geoChanged ?? true;

  const workerResult = useClusterWorker({
    entityMap,
    filter,
    zoom,
    version,
    geoChanged,
  });

  const integerZoom = Math.floor(zoom);

  if (!workerResult) {
    return {
      layers: [],
      selectionData: null,
      labelData: [],
      coverageEntities: [],
    };
  }

  const { clusters } = workerResult;

  const renderEntities: EntityRenderData[] = [];
  const renderClusters: ClusterRenderData[] = [];
  const coverageEntities: EntityData[] = [];
  const labelData: { id: string; position: [number, number]; label: string; offsetY: number }[] =
    [];
  const renderedEntityIds = new Set<string>();

  const entityAtlas = entityAtlasRef.current;
  const clusterAtlas = clusterAtlasRef.current;
  let needsAtlasUpdate = false;

  for (const cluster of clusters) {
    if (cluster.isCluster) {
      const affiliationColor = getAffiliationColorRGBA(cluster.affiliation);
      const count = cluster.count ?? 0;
      const clusterData: ClusterRenderData = {
        id: `${cluster.clusterKey}-${cluster.clusterId}`,
        lat: cluster.lat,
        lng: cluster.lng,
        position: [cluster.lng, cluster.lat],
        count,
        symbol: cluster.symbol,
        affiliation: cluster.affiliation,
        radius: count < 100 ? 18 : count < 1000 ? 22 : 26,
        pixelOffset: [12, -12],
        lineColor: affiliationColor,
        textColor: affiliationColor,
      };

      if (cluster.symbol && clusterAtlas) {
        const wasNew = !clusterAtlas.hasSymbol(cluster.symbol);
        const iconKey = clusterAtlas.getOrCreate(cluster.symbol);
        if (wasNew) needsAtlasUpdate = true;

        const overflowData = clusterAtlas.getOverflowData(cluster.symbol);
        const mapping = clusterAtlas.getMapping()[iconKey];

        if (overflowData) {
          clusterData.iconKey = iconKey;
          clusterData.size =
            CLUSTER_SYMBOL_SIZE * Math.sqrt(overflowData.height / overflowData.width);
          clusterData.pixelOffset = [overflowData.width / 2 - 4, -(overflowData.height / 2) + 4];
          clusterData.overflow = overflowData;
        } else if (mapping && mapping.width > 0 && mapping.height > 0) {
          clusterData.iconKey = iconKey;
          clusterData.size = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.height / mapping.width);
          clusterData.pixelOffset = [mapping.width / 2 - 4, -(mapping.height / 2) + 4];
        }
      }

      renderClusters.push(clusterData);
    } else {
      const entityId = cluster.entityId!;
      const entity = entityMap.get(entityId);
      const symbol = entity?.symbol ?? cluster.symbol;

      if (!symbol) continue;
      if (entity?.shape && !shapesVisible) continue;

      if (entityAtlas) {
        const wasNew = !entityAtlas.hasSymbol(symbol);
        const iconKey = entityAtlas.getOrCreate(symbol);
        if (wasNew) needsAtlasUpdate = true;

        const overflowData = entityAtlas.getOverflowData(symbol);
        const mapping = entityAtlas.getMapping()[iconKey];

        if (overflowData) {
          const size = ICON_SIZE * Math.sqrt(overflowData.height / overflowData.width);
          const position: [number, number] = entity
            ? [entity.position.lng, entity.position.lat]
            : [cluster.lng, cluster.lat];
          const renderEntity: EntityData = entity ?? {
            id: entityId,
            position: { lat: cluster.lat, lng: cluster.lng },
            affiliation: cluster.affiliation,
            symbol,
          };
          renderEntities.push({
            entity: renderEntity,
            position,
            iconKey,
            size,
            overflow: overflowData,
          });
          renderedEntityIds.add(entityId);

          if (entity?.label) {
            labelData.push({
              id: entity.id,
              position: [entity.position.lng, entity.position.lat],
              label: entity.label,
              offsetY: overflowData.height,
            });
          }
        } else if (mapping && mapping.width > 0 && mapping.height > 0) {
          const size = ICON_SIZE * Math.sqrt(mapping.height / mapping.width);
          const position: [number, number] = entity
            ? [entity.position.lng, entity.position.lat]
            : [cluster.lng, cluster.lat];
          const renderEntity: EntityData = entity ?? {
            id: entityId,
            position: { lat: cluster.lat, lng: cluster.lng },
            affiliation: cluster.affiliation,
            symbol,
          };
          renderEntities.push({
            entity: renderEntity,
            position,
            iconKey,
            size,
          });
          renderedEntityIds.add(entityId);

          if (entity?.label) {
            labelData.push({
              id: entity.id,
              position: [entity.position.lng, entity.position.lat],
              label: entity.label,
              offsetY: mapping.height,
            });
          }
        }
      }

      if (entity?.ellipseRadius !== undefined) {
        coverageEntities.push(entity);
      }
    }
  }

  if (needsAtlasUpdate) {
    entityAtlas?.onReady(() => {
      setAtlasVersion((v) => v + 1);
    });
    clusterAtlas?.onReady(() => {
      setAtlasVersion((v) => v + 1);
    });
  }

  const symbolClusters: ClusterRenderData[] = [];
  const overflowClusters: ClusterRenderData[] = [];
  const affiliationClusters: ClusterRenderData[] = [];
  for (let i = 0; i < renderClusters.length; i++) {
    const c = renderClusters[i]!;
    if (c.overflow) overflowClusters.push(c);
    else if (c.iconKey) symbolClusters.push(c);
    else affiliationClusters.push(c);
  }

  const positionsNeeded = affiliationClusters.length * 2;
  const radiiNeeded = affiliationClusters.length;
  const colorsNeeded = affiliationClusters.length * 4;

  const pool = typedArrayPoolRef.current;
  if (!pool.positions || pool.positions.length < positionsNeeded) {
    pool.positions = new Float64Array(Math.max(positionsNeeded, 64));
  }
  if (!pool.radii || pool.radii.length < radiiNeeded) {
    pool.radii = new Float32Array(Math.max(radiiNeeded, 32));
  }
  if (!pool.colors || pool.colors.length < colorsNeeded) {
    pool.colors = new Uint8Array(Math.max(colorsNeeded, 128));
  }

  const affClusterPositions = pool.positions;
  const affClusterRadii = pool.radii;
  const affClusterLineColors = pool.colors;

  for (let i = 0; i < affiliationClusters.length; i++) {
    const c = affiliationClusters[i]!;
    affClusterPositions[i * 2] = c.position[0];
    affClusterPositions[i * 2 + 1] = c.position[1];
    affClusterRadii[i] = c.radius;
    affClusterLineColors[i * 4] = c.lineColor[0];
    affClusterLineColors[i * 4 + 1] = c.lineColor[1];
    affClusterLineColors[i * 4 + 2] = c.lineColor[2];
    affClusterLineColors[i * 4 + 3] = c.lineColor[3];
  }

  let selectionData: {
    entity: EntityData;
    sizePixels: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  if (selectedId && entityAtlas) {
    const selectedRender = renderEntities.find((r) => r.entity.id === selectedId);
    if (selectedRender) {
      const overflow = selectedRender.overflow;
      const mapping = overflow ? null : entityAtlas.getMapping()[selectedRender.iconKey];
      const dims = overflow ?? mapping;

      if (dims && dims.width > 0 && dims.height > 0) {
        const renderedH = ICON_SIZE * Math.sqrt(dims.height / dims.width);
        const renderedW = ICON_SIZE * Math.sqrt(dims.width / dims.height);
        const renderedAnchorX = (dims.anchorX / dims.width) * renderedW;
        const renderedAnchorY = (dims.anchorY / dims.height) * renderedH;

        selectionData = {
          entity: selectedRender.entity,
          sizePixels: Math.max(renderedW, renderedH),
          offsetX: renderedW / 2 - renderedAnchorX,
          offsetY: renderedH / 2 - renderedAnchorY,
        };
      }
    }
  }

  const allClusters = [...symbolClusters, ...overflowClusters, ...affiliationClusters];
  if (selectedId && !selectionData && allClusters.length > 0 && entityMap.has(selectedId)) {
    const entity = entityMap.get(selectedId)!;
    if (entity.symbol && !entity.shape) {
      let nearestCluster: ClusterRenderData | null = null;
      let nearestDist = Infinity;
      for (const c of allClusters) {
        const dx = c.lng - entity.position.lng;
        const dy = c.lat - entity.position.lat;
        const dist = dx * dx + dy * dy;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCluster = c;
        }
      }

      if (nearestCluster) {
        let sizePixels: number;
        let offsetX = 0;
        let offsetY = 0;
        let isValid = true;

        if (nearestCluster.iconKey && clusterAtlas) {
          const mapping = clusterAtlas.getMapping()[nearestCluster.iconKey];
          if (mapping && mapping.width > 0 && mapping.height > 0) {
            const renderedH = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.height / mapping.width);
            const renderedW = CLUSTER_SYMBOL_SIZE * Math.sqrt(mapping.width / mapping.height);
            sizePixels = Math.max(renderedW, renderedH);
            const renderedAnchorX = (mapping.anchorX / mapping.width) * renderedW;
            const renderedAnchorY = (mapping.anchorY / mapping.height) * renderedH;
            offsetX = renderedW / 2 - renderedAnchorX;
            offsetY = renderedH / 2 - renderedAnchorY;
          } else {
            isValid = false;
            sizePixels = 0;
          }
        } else {
          const radius = nearestCluster.count < 100 ? 18 : nearestCluster.count < 1000 ? 22 : 26;
          const strokeWidth = 2;
          sizePixels = radius * 2 + strokeWidth;
        }

        if (isValid) {
          selectionData = {
            entity: {
              ...entity,
              position: { lat: nearestCluster.lat, lng: nearestCluster.lng },
            },
            sizePixels,
            offsetX,
            offsetY,
          };
        }
      }
    }
  }

  if (selectedId && !selectionData && entityMap.has(selectedId) && entityAtlas) {
    const entity = entityMap.get(selectedId)!;
    if (entity.symbol && !entity.shape) {
      const iconKey = entityAtlas.getOrCreate(entity.symbol);
      const overflow = entityAtlas.getOverflowData(entity.symbol) ?? undefined;
      const mapping = overflow ? null : entityAtlas.getMapping()[iconKey];
      const dims = overflow ?? mapping;

      if (dims && dims.width > 0 && dims.height > 0) {
        const renderedH = ICON_SIZE * Math.sqrt(dims.height / dims.width);
        const renderedW = ICON_SIZE * Math.sqrt(dims.width / dims.height);
        const renderedAnchorX = (dims.anchorX / dims.width) * renderedW;
        const renderedAnchorY = (dims.anchorY / dims.height) * renderedH;

        if (!renderedEntityIds.has(selectedId)) {
          renderEntities.push({
            entity,
            position: [entity.position.lng, entity.position.lat],
            iconKey,
            size: ICON_SIZE * Math.sqrt(dims.height / dims.width),
            overflow,
          });
        }

        selectionData = {
          entity,
          sizePixels: Math.max(renderedW, renderedH),
          offsetX: renderedW / 2 - renderedAnchorX,
          offsetY: renderedH / 2 - renderedAnchorY,
        };
      }
    }
  }

  const handleEntityClick = (info: PickingInfo): boolean => {
    if (info.object) {
      const data = info.object as EntityRenderData;
      onEntityClickRef.current?.(data.entity.id);
      return true;
    }
    return false;
  };

  const handleClusterClick = (info: PickingInfo): boolean => {
    if (!info.object) return false;
    const data = info.object as ClusterRenderData;
    onClusterClickRef.current?.(data.id, data.lat, data.lng, integerZoom + 2);
    return true;
  };

  const handleAffiliationClusterClick = (info: PickingInfo): boolean => {
    if (info.index < 0) return false;
    const data = affiliationClusters[info.index];
    if (!data) return false;
    onClusterClickRef.current?.(data.id, data.lat, data.lng, integerZoom + 2);
    return true;
  };

  const textureParameters = {
    minFilter: "linear" as const,
    magFilter: "linear" as const,
    mipmapFilter: "linear" as const,
  };

  const entityFallbackLayer = new ScatterplotLayer<EntityRenderData>({
    id: "entity-fallback-dots",
    data: renderEntities,
    visible: renderEntities.length > 0,
    getPosition: (d) => d.position,
    getRadius: 4,
    radiusUnits: "pixels",
    getFillColor: (d) => getAffiliationColorRGBA(d.entity.affiliation),
    pickable: false,
  });

  const atlasEntities = renderEntities.filter((e) => !e.overflow);
  const overflowEntities = renderEntities.filter((e) => e.overflow);

  const entityAtlasData = entityAtlas?.getImageData();
  const entityAtlasMapping = entityAtlas?.getMapping() ?? {};
  const clusterAtlasData = clusterAtlas?.getImageData();
  const clusterAtlasMapping = clusterAtlas?.getMapping() ?? {};

  const layers: Layer[] = [
    entityFallbackLayer,
    ...(!entityAtlasData
      ? []
      : [
          new IconLayer<EntityRenderData>({
            id: "entities",
            data: atlasEntities,
            visible: atlasEntities.length > 0,
            getPosition: (d) => d.position,
            iconAtlas: entityAtlasData as unknown as string,
            iconMapping: entityAtlasMapping,
            getIcon: (d) => d.iconKey,
            getSize: (d) => d.size,
            sizeUnits: "pixels",
            sizeMinPixels: ICON_SIZE_MIN_PIXELS,
            sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
            pickable: true,
            autoHighlight: true,
            highlightColor: [59, 130, 246, 80],
            onClick: handleEntityClick,
            onIconError: (error) => console.error("[IconLayer] ICON ERROR:", error),
            alphaCutoff: 0.001,
            textureParameters,
            updateTriggers: {
              getIcon: atlasVersion,
            },
            parameters: {
              depthCompare: "always",
              depthWriteEnabled: false,
            },
          }),
        ]),
    new IconLayer<EntityRenderData>({
      id: "entities-overflow",
      data: overflowEntities,
      visible: overflowEntities.length > 0,
      getPosition: (d) => d.position,
      getIcon: (d) => ({
        url: d.overflow!.dataUrl,
        width: d.overflow!.width,
        height: d.overflow!.height,
        anchorX: d.overflow!.anchorX,
        anchorY: d.overflow!.anchorY,
      }),
      getSize: (d) => d.size,
      sizeUnits: "pixels",
      sizeMinPixels: ICON_SIZE_MIN_PIXELS,
      sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
      pickable: true,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleEntityClick,
      onIconError: (error) => console.error("[IconLayer] OVERFLOW ICON ERROR:", error),
      alphaCutoff: 0.001,
      textureParameters,
      parameters: {
        depthCompare: "always",
        depthWriteEnabled: false,
      },
    }),
    ...(!clusterAtlasData
      ? []
      : [
          new IconLayer<ClusterRenderData>({
            id: "symbol-clusters",
            data: symbolClusters,
            visible: symbolClusters.length > 0,
            getPosition: (d) => d.position,
            iconAtlas: clusterAtlasData as unknown as string,
            iconMapping: clusterAtlasMapping,
            getIcon: (d) => d.iconKey!,
            getSize: (d) => d.size!,
            sizeUnits: "pixels",
            sizeMinPixels: ICON_SIZE_MIN_PIXELS,
            sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
            pickable: true,
            autoHighlight: true,
            highlightColor: [59, 130, 246, 80],
            onClick: handleClusterClick,
            onIconError: (error) => console.error("[IconLayer] CLUSTER ICON ERROR:", error),
            alphaCutoff: 0.001,
            textureParameters,
            updateTriggers: {
              getIcon: atlasVersion,
            },
            parameters: {
              depthCompare: "always",
              depthWriteEnabled: false,
            },
          }),
        ]),
    new IconLayer<ClusterRenderData>({
      id: "symbol-clusters-overflow",
      data: overflowClusters,
      visible: overflowClusters.length > 0,
      getPosition: (d) => d.position,
      getIcon: (d) => ({
        url: d.overflow!.dataUrl,
        width: d.overflow!.width,
        height: d.overflow!.height,
        anchorX: d.overflow!.anchorX,
        anchorY: d.overflow!.anchorY,
      }),
      getSize: (d) => d.size!,
      sizeUnits: "pixels",
      sizeMinPixels: ICON_SIZE_MIN_PIXELS,
      sizeMaxPixels: ICON_SIZE_MAX_PIXELS,
      pickable: true,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleClusterClick,
      onIconError: (error) => console.error("[IconLayer] OVERFLOW CLUSTER ICON ERROR:", error),
      alphaCutoff: 0.001,
      textureParameters,
      parameters: {
        depthCompare: "always",
        depthWriteEnabled: false,
      },
    }),
    new TextLayer<ClusterRenderData>({
      id: "cluster-badges",
      data: [...symbolClusters, ...overflowClusters],
      visible: symbolClusters.length > 0 || overflowClusters.length > 0,
      getPosition: (d) => d.position,
      getText: (d) => (d.count < 1000 ? String(d.count) : `${Math.round(d.count / 1000)}k`),
      getSize: 12,
      getColor: [255, 255, 255, 255],
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      getPixelOffset: (d) => d.pixelOffset,
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: "600",
      fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
      background: true,
      getBackgroundColor: CLUSTER_BG,
      backgroundPadding: [4, 2],
      pickable: false,
    }),
    new ScatterplotLayer({
      id: "affiliation-clusters",
      data: {
        length: affiliationClusters.length,
        attributes: {
          getPosition: { value: affClusterPositions, size: 2 },
          getRadius: { value: affClusterRadii, size: 1 },
          getLineColor: { value: affClusterLineColors, size: 4, normalized: true },
        },
      },
      visible: affiliationClusters.length > 0,
      radiusUnits: "pixels",
      filled: true,
      getFillColor: CLUSTER_BG,
      stroked: true,
      lineWidthMinPixels: 2,
      pickable: true,
      autoHighlight: true,
      highlightColor: [59, 130, 246, 80],
      onClick: handleAffiliationClusterClick,
    }),
    new TextLayer<ClusterRenderData>({
      id: "affiliation-cluster-labels",
      data: affiliationClusters,
      visible: affiliationClusters.length > 0,
      getPosition: (d) => d.position,
      getText: (d) => (d.count < 1000 ? String(d.count) : `${Math.round(d.count / 1000)}k`),
      getSize: 12,
      getColor: (d) => d.textColor,
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: "500",
      fontSettings: { sdf: true, fontSize: 64, buffer: 8, radius: 16, cutoff: 0.2 },
      pickable: false,
    }),
  ];

  return { layers, selectionData, labelData, coverageEntities };
}
