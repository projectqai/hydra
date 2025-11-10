import { create } from "@bufbuild/protobuf";
import type { Entity } from "@projectqai/proto/world";
import { ConfigurationComponentSchema, GeoSpatialComponentSchema } from "@projectqai/proto/world";
import { useState } from "react";

import { useEntityStore } from "../../features/aware/store/entity-store";
import { worldClient } from "./world-client";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export function useEntityMutation() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const updateEntity = useEntityStore((s) => s.updateEntity);

  const updateEntityLocation = async (
    entity: Entity,
    geo: { latitude: number; longitude: number; altitude: number },
  ) => {
    const previousGeo = entity.geo;
    const geoComponent = create(GeoSpatialComponentSchema, geo);

    setIsPending(true);
    setError(null);
    updateEntity(entity.id, { geo: geoComponent });

    try {
      const response = await worldClient.push({
        changes: [{ ...entity, geo: geoComponent }],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected update");
      }
    } catch (err) {
      updateEntity(entity.id, { geo: previousGeo });
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  const updateEntityConfig = async (entity: Entity, value: JsonObject) => {
    if (!entity.config) return;

    const previousConfig = entity.config;
    const configComponent = create(ConfigurationComponentSchema, {
      ...entity.config,
      value,
    });

    setIsPending(true);
    setError(null);
    updateEntity(entity.id, { config: configComponent });

    try {
      const response = await worldClient.push({
        changes: [{ ...entity, config: configComponent }],
      });

      if (!response.accepted) {
        throw new Error(response.debug || "Server rejected update");
      }
    } catch (err) {
      updateEntity(entity.id, { config: previousConfig });
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  return { updateEntityLocation, updateEntityConfig, isPending, error };
}
