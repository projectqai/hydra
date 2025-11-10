import type { Entity } from "@projectqai/proto/world";
import { EntityChange } from "@projectqai/proto/world";
import { useEffect, useRef, useState } from "react";

import { worldClient } from "./world-client";

type UseEntityStreamOptions = {
  enabled?: boolean;
  maxReconnectDuration?: number;
};

export function useEntityStream(options: UseEntityStreamOptions = {}) {
  const { enabled = true, maxReconnectDuration = 60000 } = options;
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const abortController = new AbortController();

    async function startStream() {
      try {
        setError(null);

        const stream = worldClient.watchEntities({}, { signal: abortController.signal });

        let receivedFirstEvent = false;

        for await (const event of stream) {
          if (abortController.signal.aborted) break;

          if (!receivedFirstEvent) {
            setIsConnected(true);
            reconnectStartTimeRef.current = null;
            receivedFirstEvent = true;
          }

          const { entity, t: changeType } = event;

          setEntities((prev) => {
            const next = new Map(prev);

            if (changeType === EntityChange.EntityChangeUpdated && entity) {
              next.set(entity.id, entity);
            } else if (
              (changeType === EntityChange.EntityChangeExpired ||
                changeType === EntityChange.EntityChangeUnobserved) &&
              entity?.id
            ) {
              next.delete(entity.id);
            }

            return next;
          });
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("[useEntityStream] Stream error:", err);
          setError(err as Error);
          setIsConnected(false);

          if (reconnectStartTimeRef.current === null) {
            reconnectStartTimeRef.current = Date.now();
          }

          const elapsed = Date.now() - reconnectStartTimeRef.current;

          if (elapsed < maxReconnectDuration) {
            reconnectTimeoutRef.current = window.setTimeout(() => {
              if (!abortController.signal.aborted) {
                startStream();
              }
            }, 1000);
          } else {
            console.error("[useEntityStream] Max reconnect duration reached");
          }
        }
      }
    }

    startStream();

    return () => {
      abortController.abort();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
    };
  }, [enabled, maxReconnectDuration]);

  return {
    entities,
    isConnected,
    error,
  };
}
