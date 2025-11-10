import { useEffect, useRef, useState } from "react";

import type { Affiliation, EntityData, EntityFilter } from "../types";
import {
  buildTypedArrays,
  ClusterEngine,
  type ClusterOutput,
  type EntityInput,
  type FilterInput,
} from "./cluster-logic";

const MIN_UPDATE_INTERVAL_MS = 100;

export type ClusterWorkerResult = {
  clusters: ClusterOutput[];
  entityPositions: Float64Array;
  entityAffiliations: Uint8Array;
  entityIndices: Uint32Array;
  clusterPositions: Float64Array;
  clusterCounts: Uint32Array;
  clusterAffiliations: Uint8Array;
  version: number;
};

type UseClusterWorkerOptions = {
  entityMap: Map<string, EntityData>;
  filter: EntityFilter;
  zoom: number;
  version: number;
  geoChanged: boolean;
};

export function useClusterWorker(options: UseClusterWorkerOptions): ClusterWorkerResult | null {
  const { entityMap, filter, zoom, version, geoChanged } = options;
  const [result, setResult] = useState<ClusterWorkerResult | null>(null);
  const engineRef = useRef<ClusterEngine | null>(null);
  const lastSentVersionRef = useRef<number>(-1);
  const lastZoomRef = useRef<number>(-1);
  const lastUpdateTimeRef = useRef<number>(0);
  const pendingUpdateRef = useRef<number | null>(null);

  // Store latest values in refs to avoid stale closures in RAF callback
  const latestRef = useRef({ entityMap, filter, zoom, version, geoChanged });
  latestRef.current = { entityMap, filter, zoom, version, geoChanged };

  useEffect(() => {
    engineRef.current = new ClusterEngine();
  }, []);

  useEffect(() => {
    if (!engineRef.current) return;

    const integerZoom = Math.floor(zoom);
    const zoomChanged = integerZoom !== Math.floor(lastZoomRef.current);
    const versionChanged = version !== lastSentVersionRef.current;

    if (!versionChanged && !zoomChanged) return;

    const now = performance.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    const doUpdate = () => {
      if (!engineRef.current) return;

      // Use latest values from ref, not stale closure values
      const { entityMap: map, filter: f, zoom: z, version: v, geoChanged: geo } = latestRef.current;

      lastSentVersionRef.current = v;
      lastZoomRef.current = z;
      lastUpdateTimeRef.current = performance.now();

      const entityInputs: EntityInput[] = [];
      for (const e of map.values()) {
        entityInputs.push({
          id: e.id,
          lat: e.position.lat,
          lng: e.position.lng,
          affiliation: (e.affiliation ?? "unknown") as Affiliation,
          symbol: e.symbol ?? null,
          label: e.label ?? null,
        });
      }

      const filterInput: FilterInput = {
        blue: f.tracks.blue,
        red: f.tracks.red,
        neutral: f.tracks.neutral,
        unknown: f.tracks.unknown,
      };

      const clusters = engineRef.current.process(entityInputs, filterInput, z, geo);
      const arrays = buildTypedArrays(clusters);

      setResult({
        clusters,
        ...arrays,
        version: v,
      });
    };

    // Throttle updates to prevent overwhelming deck.gl
    if (timeSinceLastUpdate >= MIN_UPDATE_INTERVAL_MS) {
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
      doUpdate();
    } else if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = requestAnimationFrame(() => {
        pendingUpdateRef.current = null;
        doUpdate();
      });
    }

    return () => {
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, [entityMap, filter, zoom, version, geoChanged]);

  return result;
}

export type { ClusterOutput };
