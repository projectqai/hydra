import type { Feature, Point } from "geojson";
import Supercluster from "supercluster";

import type { Affiliation } from "../types";

const CLUSTER_RADIUS = 100;
const CLUSTER_MAX_ZOOM = 15;
const SYMBOL_CLUSTER_MIN_ZOOM = 13;
const AFFILIATION_CLUSTER_MIN_ZOOM = 10;
const CLUSTER_NODE_SIZE = 128;

type ClusterProperties = {
  cluster: boolean;
  cluster_id?: number;
  point_count?: number;
  entityId?: string;
  affiliation?: Affiliation;
  symbol?: string;
  label?: string;
};

export type EntityInput = {
  id: string;
  lat: number;
  lng: number;
  affiliation: Affiliation;
  symbol: string | null;
  label: string | null;
};

export type FilterInput = {
  blue: boolean;
  red: boolean;
  neutral: boolean;
  unknown: boolean;
};

export type ClusterOutput = {
  isCluster: boolean;
  lat: number;
  lng: number;
  clusterId?: number;
  count?: number;
  clusterKey?: string;
  entityId?: string;
  affiliation: Affiliation;
  symbol?: string;
  label?: string;
};

const AFFILIATION_MAP: Record<Affiliation, number> = {
  blue: 0,
  red: 1,
  neutral: 2,
  unknown: 3,
};

type IndexType = "all" | "affiliation" | "symbol";

export class ClusterEngine {
  private clusterAll: Supercluster<ClusterProperties, object> | null = null;
  private clustersByAffiliation = new Map<
    Affiliation,
    Supercluster<ClusterProperties, { affiliation?: Affiliation }>
  >();
  private clustersBySymbol = new Map<
    string,
    Supercluster<ClusterProperties, { symbol?: string }>
  >();
  private activeIndexType: IndexType | null = null;

  private getTargetIndexType(zoom: number): IndexType {
    if (zoom >= SYMBOL_CLUSTER_MIN_ZOOM) return "symbol";
    if (zoom >= AFFILIATION_CLUSTER_MIN_ZOOM) return "affiliation";
    return "all";
  }

  buildIndices(entities: EntityInput[], filter: FilterInput, targetIndexType: IndexType) {
    if (targetIndexType === "symbol") {
      const entitiesBySymbol = new Map<string, EntityInput[]>();
      for (const e of entities) {
        const affiliation = e.affiliation ?? "unknown";
        if (!filter[affiliation]) continue;
        if (!e.symbol) continue;
        const symList = entitiesBySymbol.get(e.symbol) ?? [];
        symList.push(e);
        entitiesBySymbol.set(e.symbol, symList);
      }

      this.clustersBySymbol.clear();
      for (const [symbol, ents] of entitiesBySymbol) {
        const features: Feature<Point, ClusterProperties>[] = ents.map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: {
            cluster: false,
            entityId: e.id,
            affiliation: e.affiliation,
            symbol: e.symbol ?? undefined,
            label: e.label ?? undefined,
          },
        }));

        const cluster = new Supercluster<ClusterProperties, { symbol?: string }>({
          radius: CLUSTER_RADIUS,
          maxZoom: CLUSTER_MAX_ZOOM,
          minPoints: 3,
          nodeSize: CLUSTER_NODE_SIZE,
          map: (p) => ({ symbol: p.symbol }),
          reduce: (acc, p) => {
            acc.symbol = p.symbol;
          },
        });

        cluster.load(features);
        this.clustersBySymbol.set(symbol, cluster);
      }
    } else if (targetIndexType === "affiliation") {
      const entitiesByAffiliation = new Map<Affiliation, EntityInput[]>();
      for (const e of entities) {
        const affiliation = e.affiliation ?? "unknown";
        if (!filter[affiliation]) continue;
        if (!e.symbol) continue;
        const affList = entitiesByAffiliation.get(affiliation) ?? [];
        affList.push(e);
        entitiesByAffiliation.set(affiliation, affList);
      }

      this.clustersByAffiliation.clear();
      for (const [affiliation, ents] of entitiesByAffiliation) {
        const features: Feature<Point, ClusterProperties>[] = ents.map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: {
            cluster: false,
            entityId: e.id,
            affiliation: e.affiliation,
            symbol: e.symbol ?? undefined,
            label: e.label ?? undefined,
          },
        }));

        const cluster = new Supercluster<ClusterProperties, { affiliation?: Affiliation }>({
          radius: CLUSTER_RADIUS,
          maxZoom: SYMBOL_CLUSTER_MIN_ZOOM - 1,
          minPoints: 3,
          nodeSize: CLUSTER_NODE_SIZE,
          map: (p) => ({ affiliation: p.affiliation }),
          reduce: (acc, p) => {
            acc.affiliation = p.affiliation;
          },
        });

        cluster.load(features);
        this.clustersByAffiliation.set(affiliation, cluster);
      }
    } else {
      const allFeatures: Feature<Point, ClusterProperties>[] = entities
        .filter((e) => e.symbol && filter[e.affiliation ?? "unknown"])
        .map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.lng, e.lat] },
          properties: {
            cluster: false,
            entityId: e.id,
            affiliation: e.affiliation,
            symbol: e.symbol ?? undefined,
            label: e.label ?? undefined,
          },
        }));

      this.clusterAll = new Supercluster<ClusterProperties, object>({
        radius: CLUSTER_RADIUS,
        maxZoom: AFFILIATION_CLUSTER_MIN_ZOOM - 1,
        minPoints: 3,
        nodeSize: CLUSTER_NODE_SIZE,
      });
      this.clusterAll.load(allFeatures);
    }

    this.activeIndexType = targetIndexType;
  }

  getClusters(zoom: number): ClusterOutput[] {
    const integerZoom = Math.floor(zoom);
    const worldBounds: [number, number, number, number] = [-180, -85, 180, 85];
    const targetIndexType = this.getTargetIndexType(integerZoom);

    type FeatureWithSymbol = Feature<Point, ClusterProperties> & { _sourceSymbol?: string };
    let features: FeatureWithSymbol[] = [];

    if (targetIndexType === "symbol") {
      for (const [symbol, cluster] of this.clustersBySymbol.entries()) {
        for (const f of cluster.getClusters(worldBounds, integerZoom)) {
          (f as FeatureWithSymbol)._sourceSymbol = symbol;
          features.push(f as FeatureWithSymbol);
        }
      }
    } else if (targetIndexType === "affiliation") {
      features = [...this.clustersByAffiliation.values()].flatMap((c) =>
        c.getClusters(worldBounds, integerZoom),
      );
    } else if (this.clusterAll) {
      features = this.clusterAll.getClusters(worldBounds, integerZoom);
    }

    const results: ClusterOutput[] = [];

    for (const feature of features) {
      const coords = feature.geometry.coordinates as [number, number];
      const [lng, lat] = coords;
      const props = feature.properties;
      const sourceSymbol = feature._sourceSymbol;

      if (props.cluster) {
        const symbolForCluster = sourceSymbol ?? props.symbol;
        const clusterKey =
          targetIndexType === "symbol"
            ? (symbolForCluster ?? "unknown")
            : targetIndexType === "affiliation"
              ? (props.affiliation ?? "unknown")
              : "all";

        results.push({
          isCluster: true,
          lat,
          lng,
          clusterId: props.cluster_id,
          count: props.point_count ?? 0,
          clusterKey,
          affiliation: props.affiliation ?? "unknown",
          symbol: targetIndexType === "symbol" ? symbolForCluster : undefined,
        });
      } else {
        results.push({
          isCluster: false,
          lat,
          lng,
          entityId: props.entityId,
          affiliation: props.affiliation ?? "unknown",
          symbol: props.symbol,
          label: props.label,
        });
      }
    }

    return results;
  }

  process(
    entities: EntityInput[],
    filter: FilterInput,
    zoom: number,
    geoChanged: boolean,
  ): ClusterOutput[] {
    const targetIndexType = this.getTargetIndexType(Math.floor(zoom));
    const indexTypeChanged = targetIndexType !== this.activeIndexType;
    // Only rebuild when positions changed or zoom crossed clustering threshold
    // Non-geo changes (symbols, labels) are handled by using entityMap as source of truth
    const needsRebuild = geoChanged || indexTypeChanged || this.activeIndexType === null;

    if (needsRebuild) {
      this.buildIndices(entities, filter, targetIndexType);
    }

    return this.getClusters(zoom);
  }
}

export function buildTypedArrays(clusters: ClusterOutput[]) {
  let entityCount = 0;
  let clusterCount = 0;
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i]!.isCluster) clusterCount++;
    else entityCount++;
  }

  const entityPositions = new Float64Array(entityCount * 2);
  const entityAffiliations = new Uint8Array(entityCount);
  const entityIndices = new Uint32Array(entityCount);
  const clusterPositions = new Float64Array(clusterCount * 2);
  const clusterCounts = new Uint32Array(clusterCount);
  const clusterAffiliations = new Uint8Array(clusterCount);

  let ei = 0;
  let ci = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    if (c.isCluster) {
      clusterPositions[ci * 2] = c.lng;
      clusterPositions[ci * 2 + 1] = c.lat;
      clusterCounts[ci] = c.count ?? 0;
      clusterAffiliations[ci] = AFFILIATION_MAP[c.affiliation];
      ci++;
    } else {
      entityPositions[ei * 2] = c.lng;
      entityPositions[ei * 2 + 1] = c.lat;
      entityAffiliations[ei] = AFFILIATION_MAP[c.affiliation];
      entityIndices[ei] = ei;
      ei++;
    }
  }

  return {
    entityPositions,
    entityAffiliations,
    entityIndices,
    clusterPositions,
    clusterCounts,
    clusterAffiliations,
  };
}
