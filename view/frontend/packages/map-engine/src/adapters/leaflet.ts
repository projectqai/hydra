import L from "leaflet";

import { DEFAULT_POSITION, LEAFLET_ICON_SIZE as ICON_SIZE, TILE_LAYERS } from "../constants";
import type { MapEngine, MapEngineEvents } from "../map-engine";
import type {
  Affiliation,
  BaseLayer,
  EntityData,
  EntityFilter,
  GeoPosition,
  SceneMode,
} from "../types";
import { generateSymbol } from "../utils/milsymbol";
import { generateSelectionFrame, getFrameSize } from "../utils/selection-frame";
import { getSectorSvgDataUri } from "../utils/sensor-svg";

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

type EntityLayers = {
  marker: L.Marker;
  coverage?: L.Circle;
  sectorOverlay?: L.ImageOverlay;
  lastSymbol?: string;
  lastLabel?: string;
  lastSectors?: string;
};

type EventListeners = { [K in keyof MapEngineEvents]: Set<MapEngineEvents[K]> };

export function createLeafletAdapter(options: { debug?: boolean } = {}): MapEngine {
  let map: L.Map | null = null;
  let tileLayer: L.TileLayer | null = null;
  let selectionMarker: L.Marker | null = null;
  let currentSelectionId: string | null = null;
  let trackedId: string | null = null;
  let coverageVisible = false;
  let destroyed = false;

  const entities = new Map<string, EntityLayers>();
  const affiliations = new Map<string, Affiliation>();
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

  const createIcon = (symbol: string, label?: string): L.DivIcon => {
    const labelElement = label
      ? `<div style="margin-top:4px;text-align:center;white-space:nowrap;font:12px Inter,sans-serif;color:#fff;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;pointer-events:none">${label}</div>`
      : "";
    return L.divIcon({
      html: `<div style="display:flex;flex-direction:column;align-items:center">
        <img src="${generateSymbol(symbol, ICON_SIZE)}" style="display:block"/>
        ${labelElement}
      </div>`,
      iconSize: [ICON_SIZE, ICON_SIZE],
      iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
      className: "",
    });
  };

  const createSelectionIcon = (affiliation: Affiliation): L.DivIcon => {
    const size = getFrameSize(ICON_SIZE);
    return L.divIcon({
      html: `<img src="${generateSelectionFrame(affiliation, ICON_SIZE)}" width="${size}" height="${size}"/>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2 - 4],
      className: "",
    });
  };

  const computeSectorBounds = (lat: number, lng: number): L.LatLngBounds => {
    const halfSizeLat = (SECTOR_SIZE_METERS / 2 / EARTH_RADIUS) * (180 / Math.PI);
    const halfSizeLng =
      (SECTOR_SIZE_METERS / 2 / (EARTH_RADIUS * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    // Offset south slightly to align with icon visual center (label shifts perceived center down)
    const offsetLat = halfSizeLat * 0.15;
    return L.latLngBounds(
      [lat - halfSizeLat - offsetLat, lng - halfSizeLng],
      [lat + halfSizeLat - offsetLat, lng + halfSizeLng],
    );
  };

  const updateSectorVisibility = () => {
    if (!map) return;
    const visible = map.getZoom() >= SECTOR_MIN_ZOOM;

    for (const { sectorOverlay } of entities.values()) {
      if (!sectorOverlay) continue;
      if (visible && !map.hasLayer(sectorOverlay)) sectorOverlay.addTo(map);
      else if (!visible && map.hasLayer(sectorOverlay)) sectorOverlay.remove();
    }
  };

  const removeEntity = (id: string) => {
    const layers = entities.get(id);
    if (!layers || !map) return;

    map.removeLayer(layers.marker);
    layers.coverage?.remove();
    layers.sectorOverlay?.remove();
    entities.delete(id);
    affiliations.delete(id);

    if (id === currentSelectionId) {
      currentSelectionId = null;
      selectionMarker?.remove();
      selectionMarker = null;
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
      map.on("zoomend", updateSectorVisibility);

      map.whenReady(() => {
        emit("ready");
        if (options.debug) console.log("[Leaflet] ready");
      });
    },

    destroy() {
      destroyed = true;
      map?.remove();
      map = null;
      tileLayer = null;
      entities.clear();
      affiliations.clear();
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

    flyTo(position: GeoPosition, options?: { duration?: number }) {
      map?.flyTo([position.lat, position.lng], map.getZoom(), {
        duration: options?.duration ?? 1.5,
      });
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

      const newIds = new Set(newEntities.map((e) => e.id));

      // Remove stale
      for (const id of entities.keys()) {
        if (!newIds.has(id)) removeEntity(id);
      }

      const showSectors = map.getZoom() >= SECTOR_MIN_ZOOM;

      for (const entity of newEntities) {
        const affiliation = entity.affiliation ?? "unknown";
        const visible = filter.tracks[affiliation];
        const latlng: L.LatLngExpression = [entity.position.lat, entity.position.lng];
        const hasCoverage = entity.ellipseRadius !== undefined;

        let layers = entities.get(entity.id);

        if (!layers) {
          const marker = L.marker(latlng, {
            icon: entity.symbol ? createIcon(entity.symbol, entity.label) : undefined,
            opacity: visible ? 1 : 0,
            keyboard: false,
          });
          marker.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            emit("entityClick", entity.id);
          });
          marker.addTo(map);

          layers = { marker, lastSymbol: entity.symbol, lastLabel: entity.label };

          if (hasCoverage) {
            layers.coverage = L.circle(latlng, COVERAGE_STYLE);
            if (coverageVisible) layers.coverage.addTo(map);

            const sectorsKey = entity.activeSectors
              ? Array.from(entity.activeSectors).sort().join(",")
              : "";
            const bounds = computeSectorBounds(entity.position.lat, entity.position.lng);
            layers.sectorOverlay = L.imageOverlay(
              getSectorSvgDataUri(entity.activeSectors ?? new Set()),
              bounds,
              { interactive: false },
            );
            layers.lastSectors = sectorsKey;
            if (showSectors) layers.sectorOverlay.addTo(map);
          }

          entities.set(entity.id, layers);
        } else {
          layers.marker.setLatLng(latlng);
          layers.marker.setOpacity(visible ? 1 : 0);

          if (
            entity.symbol &&
            (entity.symbol !== layers.lastSymbol || entity.label !== layers.lastLabel)
          ) {
            layers.marker.setIcon(createIcon(entity.symbol, entity.label));
            layers.lastSymbol = entity.symbol;
            layers.lastLabel = entity.label;
          }

          layers.coverage?.setLatLng(latlng);
          if (layers.sectorOverlay) {
            const bounds = computeSectorBounds(entity.position.lat, entity.position.lng);
            layers.sectorOverlay.setBounds(bounds);
            const sectorsKey = entity.activeSectors
              ? Array.from(entity.activeSectors).sort().join(",")
              : "";
            if (sectorsKey !== layers.lastSectors) {
              layers.sectorOverlay.setUrl(getSectorSvgDataUri(entity.activeSectors ?? new Set()));
              layers.lastSectors = sectorsKey;
            }
          }
        }

        affiliations.set(entity.id, affiliation);

        if (entity.id === currentSelectionId) selectionMarker?.setLatLng(latlng);
        if (entity.id === trackedId) map.panTo(latlng, { animate: true });
      }
    },

    setEntityVisibility(newFilter: EntityFilter) {
      filter = newFilter;
      for (const [id, { marker }] of entities) {
        const affiliation = affiliations.get(id) ?? "unknown";
        marker.setOpacity(newFilter.tracks[affiliation] ? 1 : 0);
      }
    },

    setCoverageVisible(visible: boolean) {
      coverageVisible = visible;
      if (!map) return;

      for (const { coverage } of entities.values()) {
        if (!coverage) continue;
        if (visible && !map.hasLayer(coverage)) coverage.addTo(map);
        else if (!visible && map.hasLayer(coverage)) coverage.remove();
      }
    },

    selectEntity(id: string | null) {
      selectionMarker?.remove();
      selectionMarker = null;
      currentSelectionId = id;

      if (!map || !id) return;

      const layers = entities.get(id);
      if (!layers) return;

      const affiliation = affiliations.get(id) ?? "unknown";
      selectionMarker = L.marker(layers.marker.getLatLng(), {
        icon: createSelectionIcon(affiliation),
        interactive: false,
        zIndexOffset: -1,
      }).addTo(map);
    },

    trackEntity(id: string | null) {
      const wasTracking = trackedId !== null;
      trackedId = id;

      if (wasTracking && !id) emit("trackingLost");
      if (!map || !id) return;

      const layers = entities.get(id);
      if (layers) map.flyTo(layers.marker.getLatLng(), map.getZoom());
    },

    on<E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) {
      listeners[event].add(handler);
    },

    off<E extends keyof MapEngineEvents>(event: E, handler: MapEngineEvents[E]) {
      listeners[event].delete(handler);
    },
  };
}
