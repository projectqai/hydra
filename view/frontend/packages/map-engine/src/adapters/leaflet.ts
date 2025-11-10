import type { Feature, Point } from "geojson";
import L from "leaflet";
import Supercluster from "supercluster";

import { DEFAULT_POSITION, LEAFLET_ICON_SIZE as ICON_SIZE, TILE_LAYERS } from "../constants";
import type { MapEngine, MapEngineEvents } from "../map-engine";
import type {
  ActiveSensorSectors,
  Affiliation,
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  SceneMode,
} from "../types";
import { generateSymbolInfo } from "../utils/milsymbol";
import { generateSelectionFrame, getFrameSize } from "../utils/selection-frame";
import { getSectorSvgDataUri } from "../utils/sensor-svg";

const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 13;
const SYMBOL_CLUSTER_MIN_ZOOM = 8;
const CLUSTER_NODE_SIZE = 128;
const CLUSTER_SYMBOL_SIZE = 32;
const COVERAGE_RADIUS = 250;
const SECTOR_MIN_ZOOM = 14;
const SECTOR_SIZE_METERS = 44;
const EARTH_RADIUS = 6378137;

const COVERAGE_STYLE: L.CircleMarkerOptions = {
  radius: COVERAGE_RADIUS,
  color: "rgba(59, 130, 246, 0.2)",
  fillColor: "rgba(59, 130, 246, 0.04)",
  fillOpacity: 1,
  weight: 1,
};

type ClusterProperties = {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: string;
  entityId?: string;
  affiliation?: Affiliation;
  symbol?: string;
  label?: string;
};

type EventListeners = { [K in keyof MapEngineEvents]: Set<MapEngineEvents[K]> };

export function createLeafletAdapter(options: { debug?: boolean } = {}): MapEngine {
  let map: L.Map | null = null;
  let tileLayer: L.TileLayer | null = null;
  let selectionMarker: L.Marker | null = null;
  let selectionIsCluster = false;
  let currentSelectionId: string | null = null;
  let trackedId: string | null = null;
  let destroyed = false;

  const clustersByAffiliation = new Map<
    Affiliation,
    Supercluster<ClusterProperties, { affiliation?: Affiliation }>
  >();
  const clustersBySymbol = new Map<string, Supercluster<ClusterProperties, { symbol?: string }>>();
  let entityDataCache = new Map<string, EntityData>();
  const clusterMarkers = new Map<string, L.CircleMarker | L.Marker>();
  let clusterUpdateScheduled = false;

  let coverageVisible = false;
  const coverageCircles = new Map<string, L.Circle>();
  const sectorOverlays = new Map<string, { overlay: L.ImageOverlay; sectorsKey: string }>();
  const listeners: EventListeners = {
    ready: new Set(),
    entityClick: new Set(),
    trackingLost: new Set(),
  };

  let filter: EntityFilter = {
    tracks: { friend: true, hostile: true, neutral: true, unknown: true },
    sensors: {},
  };

  const emit = <E extends keyof MapEngineEvents>(
    event: E,
    ...args: Parameters<MapEngineEvents[E]>
  ) => {
    listeners[event].forEach((h) => (h as (...a: Parameters<MapEngineEvents[E]>) => void)(...args));
  };

  const createIcon = (sidc: string, label?: string): L.DivIcon => {
    const sym = generateSymbolInfo(sidc, ICON_SIZE);
    const offsetX = ICON_SIZE / 2 - sym.anchorX;
    const offsetY = ICON_SIZE / 2 - sym.anchorY;
    const labelElement = label
      ? `<div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;white-space:nowrap;font:12px Inter,sans-serif;color:#fff;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;pointer-events:none">${label}</div>`
      : "";
    return L.divIcon({
      html: `<div style="width:${ICON_SIZE}px;height:${ICON_SIZE}px;position:relative;overflow:visible">
        <img src="${sym.dataUri}" width="${sym.width}" height="${sym.height}" style="position:absolute;left:${offsetX}px;top:${offsetY}px"/>
        ${labelElement}
      </div>`,
      iconSize: [ICON_SIZE, ICON_SIZE],
      iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
      className: "",
    });
  };

  const createSelectionIcon = (
    affiliation: Affiliation,
    symbolSize: { width: number; height: number } | null,
    clusterSize: number | null = null,
  ): L.DivIcon => {
    const baseSize = clusterSize
      ? clusterSize
      : symbolSize
        ? Math.round(Math.max(symbolSize.width, symbolSize.height) * 0.8)
        : 34;
    const size = getFrameSize(baseSize);
    return L.divIcon({
      html: `<img src="${generateSelectionFrame(affiliation, baseSize)}" width="${size}" height="${size}"/>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      className: "",
    });
  };

  const computeSectorBounds = (lat: number, lng: number): L.LatLngBounds => {
    const halfSizeLat = (SECTOR_SIZE_METERS / 2 / EARTH_RADIUS) * (180 / Math.PI);
    const halfSizeLng =
      (SECTOR_SIZE_METERS / 2 / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    const offsetLat = halfSizeLat * 0.15;
    return L.latLngBounds(
      [lat - halfSizeLat - offsetLat, lng - halfSizeLng],
      [lat + halfSizeLat - offsetLat, lng + halfSizeLng],
    );
  };

  const updateCoverageAndSectors = (
    entityId: string,
    lat: number,
    lng: number,
    entity: EntityData,
  ) => {
    if (!map) return;

    const hasCoverage = entity.ellipseRadius !== undefined;
    const showSectors = map.getZoom() >= SECTOR_MIN_ZOOM;

    if (hasCoverage && coverageVisible) {
      let circle = coverageCircles.get(entityId);
      if (!circle) {
        circle = L.circle([lat, lng], COVERAGE_STYLE);
        circle.addTo(map);
        coverageCircles.set(entityId, circle);
      } else {
        circle.setLatLng([lat, lng]);
      }
    } else {
      const circle = coverageCircles.get(entityId);
      if (circle) {
        circle.remove();
        coverageCircles.delete(entityId);
      }
    }

    if (hasCoverage && entity.activeSectors && showSectors) {
      const sectorsKey = sectorSetToKey(entity.activeSectors);
      const existing = sectorOverlays.get(entityId);
      const bounds = computeSectorBounds(lat, lng);

      if (!existing) {
        const overlay = L.imageOverlay(getSectorSvgDataUri(entity.activeSectors), bounds, {
          interactive: false,
        });
        overlay.addTo(map);
        sectorOverlays.set(entityId, { overlay, sectorsKey });
      } else {
        existing.overlay.setBounds(bounds);
        if (existing.sectorsKey !== sectorsKey) {
          existing.overlay.setUrl(getSectorSvgDataUri(entity.activeSectors));
          existing.sectorsKey = sectorsKey;
        }
      }
    } else {
      const existing = sectorOverlays.get(entityId);
      if (existing) {
        existing.overlay.remove();
        sectorOverlays.delete(entityId);
      }
    }
  };

  const removeCoverageAndSectors = (entityId: string) => {
    const circle = coverageCircles.get(entityId);
    if (circle) {
      circle.remove();
      coverageCircles.delete(entityId);
    }
    const sector = sectorOverlays.get(entityId);
    if (sector) {
      sector.overlay.remove();
      sectorOverlays.delete(entityId);
    }
  };

  const sectorSetToKey = (sectors: ActiveSensorSectors): string => {
    return Array.from(sectors).sort().join(",");
  };

  const CLUSTER_BG = "rgba(33, 33, 33, 0.95)";
  const CLUSTER_COLORS = {
    low: "130, 148, 165", // steel blue
    medium: "59, 130, 246", // blue
    high: "247, 239, 129", // yellow
    critical: "249, 87, 56", // orange
  };

  const getClusterColor = (count: number): string => {
    if (count < 10) return CLUSTER_COLORS.low;
    if (count < 100) return CLUSTER_COLORS.medium;
    if (count < 1000) return CLUSTER_COLORS.high;
    return CLUSTER_COLORS.critical;
  };

  const createClusterIcon = (count: number, symbol?: string): L.DivIcon => {
    const displayCount = count < 1000 ? count : Math.round(count / 1000) + "k";
    const badgeSize = count < 100 ? 16 : count < 1000 ? 18 : 20;
    const fontSize = 12;
    const hitArea = 56;

    if (symbol) {
      const sym = generateSymbolInfo(symbol, CLUSTER_SYMBOL_SIZE);
      const offsetX = hitArea / 2 - sym.anchorX;
      const offsetY = hitArea / 2 - sym.anchorY;
      return L.divIcon({
        html: `<div style="width:${hitArea}px;height:${hitArea}px;position:relative;cursor:pointer;overflow:visible">
          <img src="${sym.dataUri}" width="${sym.width}" height="${sym.height}" style="position:absolute;left:${offsetX}px;top:${offsetY}px"/>
          <div style="
            position:absolute;
            left:${hitArea / 2 + CLUSTER_SYMBOL_SIZE / 2 - 4}px;
            top:${hitArea / 2 - CLUSTER_SYMBOL_SIZE / 2 - badgeSize + 4}px;
            min-width:${badgeSize}px;height:${badgeSize}px;
            padding:0 4px;
            background:rgba(33,33,33,0.95);
            border-radius:${badgeSize / 2}px;
            display:flex;align-items:center;justify-content:center;
            color:#fff;
            font-family:Inter,system-ui,sans-serif;
            font-weight:600;
            font-size:${fontSize}px;
            box-shadow:0 1px 3px rgba(0,0,0,0.4);
          ">${displayCount}</div>
        </div>`,
        iconSize: [hitArea, hitArea],
        iconAnchor: [hitArea / 2, hitArea / 2],
        className: "",
      });
    }

    const size = count < 100 ? 28 : count < 1000 ? 34 : 40;
    const color = getClusterColor(count);
    return L.divIcon({
      html: `<div style="width:${hitArea}px;height:${hitArea}px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
        <div style="
          width:${size}px;height:${size}px;
          background:${CLUSTER_BG};
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          color:rgb(${color});
          font-family:Inter,system-ui,sans-serif;
          font-weight:500;
          font-size:${fontSize}px;
          letter-spacing:-0.02em;
          box-shadow:0 0 0 1.5px rgba(${color},0.8),0 2px 6px rgba(0,0,0,0.5);
        ">${displayCount}</div>
      </div>`,
      iconSize: [hitArea, hitArea],
      iconAnchor: [hitArea / 2, hitArea / 2],
      className: "",
    });
  };

  const clearClusterMarkers = () => {
    for (const marker of clusterMarkers.values()) {
      marker.remove();
    }
    clusterMarkers.clear();
  };

  const scheduleClusterUpdate = () => {
    if (clusterUpdateScheduled) return;
    clusterUpdateScheduled = true;
    requestAnimationFrame(() => {
      clusterUpdateScheduled = false;
      updateClusters();
    });
  };

  const updateClusters = () => {
    if (!map || (clustersBySymbol.size === 0 && clustersByAffiliation.size === 0)) return;

    const zoom = Math.floor(map.getZoom());
    const bounds = map.getBounds();
    const useSymbolClusters = zoom >= SYMBOL_CLUSTER_MIN_ZOOM;

    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    const clusters = useSymbolClusters
      ? [...clustersBySymbol.values()].flatMap((c) => c.getClusters(bbox, zoom))
      : [...clustersByAffiliation.values()].flatMap((c) => c.getClusters(bbox, zoom));

    const activeIds = new Set<string>();

    for (const feature of clusters) {
      const coords = feature.geometry.coordinates as [number, number];
      const lng = coords[0];
      const lat = coords[1];
      const props = feature.properties as ClusterProperties;

      if (props.cluster) {
        const clusterKey = useSymbolClusters
          ? (props.symbol ?? "unknown")
          : (props.affiliation ?? "unknown");
        const markerId = `cluster-${clusterKey}-${props.cluster_id}`;
        activeIds.add(markerId);

        const clusterId = props.cluster_id!;
        const clusterSource = useSymbolClusters
          ? clustersBySymbol.get(clusterKey)
          : clustersByAffiliation.get(clusterKey as Affiliation);

        if (currentSelectionId && clusterSource && map) {
          const leaves = clusterSource.getLeaves(clusterId, Infinity);
          const selectedLeaf = leaves.find(
            (leaf) => (leaf.properties as ClusterProperties).entityId === currentSelectionId,
          );
          if (selectedLeaf) {
            const selectedAffiliation =
              (selectedLeaf.properties as ClusterProperties).affiliation ?? "unknown";
            if (selectionMarker) {
              selectionMarker.remove();
            }
            const count = props.point_count ?? 0;
            const clusterFrameSize = useSymbolClusters
              ? 40
              : count < 100
                ? 28
                : count < 1000
                  ? 34
                  : 40;
            selectionMarker = L.marker([lat, lng], {
              icon: createSelectionIcon(selectedAffiliation, null, clusterFrameSize),
              interactive: false,
              zIndexOffset: 1000,
            }).addTo(map);
            selectionIsCluster = true;
          }
        }

        let marker = clusterMarkers.get(markerId);
        if (!marker) {
          marker = L.marker([lat, lng], {
            icon: useSymbolClusters
              ? createClusterIcon(props.point_count ?? 0, props.symbol)
              : createClusterIcon(props.point_count ?? 0),
          });
          marker.on("click", (e) => {
            const markerPos = (e.target as L.Marker).getLatLng();
            const currentZoom = map!.getZoom();
            const expansionZoom =
              clusterSource?.getClusterExpansionZoom(clusterId) ?? currentZoom + 2;
            const targetZoom = Math.max(currentZoom + 1, Math.min(expansionZoom, 18));
            map!.flyTo(markerPos, targetZoom);
          });
          marker.addTo(map);
          clusterMarkers.set(markerId, marker);
        } else {
          (marker as L.Marker).setLatLng([lat, lng]);
          (marker as L.Marker).setIcon(
            useSymbolClusters
              ? createClusterIcon(props.point_count ?? 0, props.symbol)
              : createClusterIcon(props.point_count ?? 0),
          );
        }
      } else {
        const entityId = props.entityId!;
        const markerId = `entity-${entityId}`;
        activeIds.add(markerId);

        const affiliation: Affiliation = props.affiliation ?? "unknown";
        const visible = filter.tracks[affiliation];

        let marker = clusterMarkers.get(markerId);
        if (!marker) {
          marker = L.marker([lat, lng], {
            icon: props.symbol ? createIcon(props.symbol, props.label) : undefined,
            opacity: visible ? 1 : 0,
          });
          marker.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            emit("entityClick", entityId);
          });
          marker.addTo(map);
          clusterMarkers.set(markerId, marker);
        } else {
          (marker as L.Marker).setLatLng([lat, lng]);
          (marker as L.Marker).setOpacity(visible ? 1 : 0);
        }

        if (entityId === currentSelectionId) {
          if (selectionMarker && selectionIsCluster) {
            selectionMarker.remove();
            const symbolInfo = props.symbol ? generateSymbolInfo(props.symbol, ICON_SIZE) : null;
            selectionMarker = L.marker([lat, lng], {
              icon: createSelectionIcon(affiliation, symbolInfo),
              interactive: false,
              zIndexOffset: -1,
            }).addTo(map);
            selectionIsCluster = false;
          } else if (selectionMarker) {
            selectionMarker.setLatLng([lat, lng]);
          }
        }

        const entityData = entityDataCache.get(entityId);
        if (entityData && visible) {
          updateCoverageAndSectors(entityId, lat, lng, entityData);
        } else {
          removeCoverageAndSectors(entityId);
        }
      }
    }

    for (const [id, marker] of clusterMarkers) {
      if (!activeIds.has(id)) {
        marker.remove();
        clusterMarkers.delete(id);
        if (id.startsWith("entity-")) {
          removeCoverageAndSectors(id.slice(7));
        }
      }
    }

    if (currentSelectionId) {
      const entity = entityDataCache.get(currentSelectionId);
      if (entity && !selectionMarker) {
        const symbolInfo = entity.symbol ? generateSymbolInfo(entity.symbol, ICON_SIZE) : null;
        selectionMarker = L.marker([entity.position.lat, entity.position.lng], {
          icon: createSelectionIcon(entity.affiliation ?? "unknown", symbolInfo),
          interactive: false,
          zIndexOffset: -1,
        }).addTo(map);
        selectionIsCluster = false;
      } else if (!entity && selectionMarker) {
        selectionMarker.remove();
        selectionMarker = null;
        selectionIsCluster = false;
      }
    }
  };

  const rebuildCluster = (newEntities: EntityData[]) => {
    entityDataCache.clear();
    for (const e of newEntities) {
      entityDataCache.set(e.id, e);
    }

    const entitiesByAffiliation = new Map<Affiliation, EntityData[]>();
    const entitiesBySymbol = new Map<string, EntityData[]>();

    for (const e of newEntities) {
      const affiliation = e.affiliation ?? "unknown";
      if (!filter.tracks[affiliation]) continue;

      const affList = entitiesByAffiliation.get(affiliation) ?? [];
      affList.push(e);
      entitiesByAffiliation.set(affiliation, affList);

      const symbol = e.symbol ?? "unknown";
      const symList = entitiesBySymbol.get(symbol) ?? [];
      symList.push(e);
      entitiesBySymbol.set(symbol, symList);
    }

    clustersByAffiliation.clear();
    for (const [affiliation, entities] of entitiesByAffiliation) {
      const features: Feature<Point, ClusterProperties>[] = entities.map((e) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [e.position.lng, e.position.lat],
        },
        properties: {
          cluster: false,
          entityId: e.id,
          affiliation: e.affiliation,
          symbol: e.symbol,
          label: e.label,
        },
      }));

      const affiliationCluster = new Supercluster<ClusterProperties, { affiliation?: Affiliation }>(
        {
          radius: CLUSTER_RADIUS,
          maxZoom: SYMBOL_CLUSTER_MIN_ZOOM - 1,
          minPoints: 2,
          nodeSize: CLUSTER_NODE_SIZE,
          map: (props) => ({ affiliation: props.affiliation }),
          reduce: (acc, props) => {
            acc.affiliation = props.affiliation;
          },
        },
      );

      affiliationCluster.load(features);
      clustersByAffiliation.set(affiliation, affiliationCluster);
    }

    clustersBySymbol.clear();
    for (const [symbol, entities] of entitiesBySymbol) {
      const features: Feature<Point, ClusterProperties>[] = entities.map((e) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [e.position.lng, e.position.lat],
        },
        properties: {
          cluster: false,
          entityId: e.id,
          affiliation: e.affiliation,
          symbol: e.symbol,
          label: e.label,
        },
      }));

      const symbolCluster = new Supercluster<ClusterProperties, { symbol?: string }>({
        radius: CLUSTER_RADIUS,
        maxZoom: CLUSTER_MAX_ZOOM,
        minPoints: 2,
        nodeSize: CLUSTER_NODE_SIZE,
        map: (props) => ({ symbol: props.symbol }),
        reduce: (acc, props) => {
          acc.symbol = props.symbol;
        },
      });

      symbolCluster.load(features);
      clustersBySymbol.set(symbol, symbolCluster);
    }
  };

  return {
    mount(container: HTMLElement) {
      if (destroyed || map) return;

      map = L.map(container, {
        center: [DEFAULT_POSITION.lat, DEFAULT_POSITION.lng],
        zoom: DEFAULT_POSITION.zoom,
        zoomControl: false,
        preferCanvas: true,
      });

      const config = TILE_LAYERS.dark;
      const tileOptions: L.TileLayerOptions = { attribution: config.attribution };
      if (config.subdomains) tileOptions.subdomains = config.subdomains;
      if (config.maxZoom) tileOptions.maxZoom = config.maxZoom;
      tileLayer = L.tileLayer(config.url, tileOptions).addTo(map);

      map.on("click", () => emit("entityClick", null));
      map.on("move", scheduleClusterUpdate);
      map.on("moveend", updateClusters);
      map.on("zoomend", updateClusters);

      map.whenReady(() => {
        emit("ready");
        if (options.debug) console.log("[Leaflet] ready");
      });
    },

    destroy() {
      destroyed = true;
      clearClusterMarkers();
      for (const circle of coverageCircles.values()) circle.remove();
      coverageCircles.clear();
      for (const { overlay } of sectorOverlays.values()) overlay.remove();
      sectorOverlays.clear();
      clustersByAffiliation.clear();
      clustersBySymbol.clear();
      entityDataCache.clear();
      map?.remove();
      map = null;
      tileLayer = null;
      listeners.ready.clear();
      listeners.entityClick.clear();
      listeners.trackingLost.clear();
    },

    zoomIn() {
      map?.zoomIn();
    },

    zoomOut() {
      map?.zoomOut();
    },

    flyTo(position: GeoPosition, options?: { duration?: number; zoom?: number }) {
      const targetZoom = options?.zoom ?? map?.getZoom();
      map?.flyTo([position.lat, position.lng], targetZoom, {
        duration: options?.duration ?? 1.5,
      });
    },

    getView() {
      if (!map) return null;
      const center = map.getCenter();
      return { lat: center.lat, lng: center.lng, zoom: map.getZoom() };
    },

    setBaseLayer(layer: BaseLayer) {
      if (!map) return;
      tileLayer?.remove();
      const config = TILE_LAYERS[layer];
      const tileOptions: L.TileLayerOptions = { attribution: config.attribution };
      if (config.subdomains) tileOptions.subdomains = config.subdomains;
      if (config.maxZoom) tileOptions.maxZoom = config.maxZoom;
      tileLayer = L.tileLayer(config.url, tileOptions).addTo(map);
    },

    setSceneMode(mode: SceneMode) {
      if (mode !== "2d") console.warn("[Leaflet] only supports 2D mode");
    },

    syncEntities(newEntities: EntityData[]) {
      if (!map) return;

      if (currentSelectionId && selectionMarker) {
        const selected = newEntities.find((e) => e.id === currentSelectionId);
        if (selected) {
          selectionMarker.setLatLng([selected.position.lat, selected.position.lng]);
        }
      }

      if (trackedId) {
        const tracked = newEntities.find((e) => e.id === trackedId);
        if (tracked) {
          map.setView([tracked.position.lat, tracked.position.lng], map.getZoom(), {
            animate: false,
          });
        }
      }

      rebuildCluster(newEntities);
      updateClusters();
    },

    setEntityVisibility(newFilter: EntityFilter) {
      filter = newFilter;
      if (entityDataCache.size > 0) {
        rebuildCluster(Array.from(entityDataCache.values()));
        updateClusters();
      }
    },

    setCoverageVisible(visible: boolean) {
      coverageVisible = visible;
      updateClusters();
    },

    selectEntity(id: string | null) {
      selectionMarker?.remove();
      selectionMarker = null;
      selectionIsCluster = false;
      currentSelectionId = id;

      if (!map || !id) return;

      const entity = entityDataCache.get(id);
      if (!entity) return;

      const symbolInfo = entity.symbol ? generateSymbolInfo(entity.symbol, ICON_SIZE) : null;
      selectionMarker = L.marker([entity.position.lat, entity.position.lng], {
        icon: createSelectionIcon(entity.affiliation ?? "unknown", symbolInfo),
        interactive: false,
        zIndexOffset: -1,
      }).addTo(map);
    },

    trackEntity(id: string | null) {
      const wasTracking = trackedId !== null;
      trackedId = id;

      if (wasTracking && !id) emit("trackingLost");
      if (!map || !id) return;

      const entity = entityDataCache.get(id);
      if (entity) {
        map.flyTo([entity.position.lat, entity.position.lng], map.getZoom());
      }
    },

    on<E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) {
      listeners[event].add(handler);
    },

    off<E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) {
      listeners[event].delete(handler);
    },
  };
}
