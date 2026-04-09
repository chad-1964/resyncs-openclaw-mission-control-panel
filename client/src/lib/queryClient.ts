import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey[0]}`);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * Prefetch all core data on login — warms the cache so every page loads instantly.
 * Fires ~10 parallel requests, typically completes in <500ms.
 */
export async function prefetchCoreData() {
  const queries = [
    // Core data (Layout sidebar + Dashboard)
    "/api/agents",
    "/api/tasks",
    "/api/stats",
    "/api/approvals/count",
    // Page data
    "/api/projects",
    "/api/approvals?status=pending",
    "/api/schedules",
    "/api/reports",
    "/api/skills",
    "/api/cost-alerts",
    "/api/activity?limit=50",
    "/api/analytics/costs?period=week",
    "/api/integrations",
    "/api/settings",
    "/api/security/policies",
    "/api/performance",
    "/api/model-routes",
    "/api/api-connections",
    "/api/memory/stats",
    "/api/terminal/capabilities",
  ];

  await Promise.allSettled(
    queries.map(url => {
      // Use the full URL path (without query) as the primary key
      // For pages with filters, prefetch the default filter value
      const baseKey = url.split("?")[0];
      return queryClient.prefetchQuery({
        queryKey: [baseKey],
        queryFn: async () => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${res.status}`); // Don't cache failures
          return res.json();
        },
      });
    })
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,  // Refetch when user alt-tabs back to MC
      refetchOnMount: true,        // Refetch on mount if data is stale
      staleTime: 5000,             // Data is "fresh" for 5s (prevents double-fetch on fast nav), then stale
      gcTime: 1000 * 60 * 60 * 24, // Keep cache 24 hours — never see empty pages during a session
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
