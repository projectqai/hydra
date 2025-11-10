import { TaskStatus } from "@projectqai/proto/world";
import { useState } from "react";

import { worldClient } from "./world-client";

export function useRunTask() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const runTask = async (entityId: string) => {
    setIsPending(true);
    setError(null);

    try {
      const response = await worldClient.runTask({ entityId });

      if (response.status === TaskStatus.TaskStatusFailed) {
        throw new Error(response.humanReadableReason || "Task failed");
      }

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    } finally {
      setIsPending(false);
    }
  };

  return { runTask, isPending, error };
}
