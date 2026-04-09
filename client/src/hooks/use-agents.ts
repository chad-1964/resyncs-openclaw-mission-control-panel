import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

/** Fire-and-forget sync: POST /api/system/openclaw/sync, then refresh agent list. */
export async function triggerOpenClawSync() {
  try {
    await apiRequest("POST", "/api/system/openclaw/sync");
    await queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
  } catch {
    // Non-fatal — sync failure should never break the UI
  }
}

export function useAgents() {
  return useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    refetchInterval: 30000,
  });
}

export function useAgent(id: number | null) {
  return useQuery({
    queryKey: ["/api/agents", id],
    queryFn: async () => {
      if (!id) return null;
      const res = await apiRequest("GET", `/api/agents/${id}`);
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 30000,
  });
}
