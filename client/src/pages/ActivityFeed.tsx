import { useQuery } from "@tanstack/react-query";
import { useAgents } from "@/hooks/use-agents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityLog } from "@shared/schema";
import { useState } from "react";
import {
  PlusCircle, ArrowRight, Trash2, Calendar, RefreshCw,
  FileText, UserCircle, Activity,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const eventConfig: Record<string, { icon: any; color: string }> = {
  task_created: { icon: PlusCircle, color: "text-emerald-400 bg-emerald-500/15" },
  task_moved: { icon: ArrowRight, color: "text-blue-400 bg-blue-500/15" },
  task_deleted: { icon: Trash2, color: "text-red-400 bg-red-500/15" },
  schedule_created: { icon: Calendar, color: "text-purple-400 bg-purple-500/15" },
  schedule_updated: { icon: RefreshCw, color: "text-cyan-400 bg-cyan-500/15" },
  report_generated: { icon: FileText, color: "text-yellow-400 bg-yellow-500/15" },
  agent_status_change: { icon: UserCircle, color: "text-pink-400 bg-pink-500/15" },
};

export default function ActivityFeed() {
  const [agentFilter, setAgentFilter] = useState("all");
  const [limit, setLimit] = useState(50);
  const { data: agents } = useAgents();

  const { data: allActivity, isLoading } = useQuery<ActivityLog[]>({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/activity?limit=100`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  // Client-side filter — avoids cache key mismatch with prefetch
  const activity = (allActivity || [])
    .filter(a => agentFilter === "all" ? true : String(a.agent_id) === agentFilter)
    .slice(0, limit);

  const getAgentName = (agentId: number | null) =>
    agents?.find((a) => a.id === agentId)?.name;

  const getAgentColor = (agentId: number | null) =>
    agents?.find((a) => a.id === agentId)?.avatar_color;

  return (
    <div className="p-6" data-testid="page-activity">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Activity Feed</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Real-time event timeline</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-activity-agent">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {agents?.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !activity?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-1">
            {activity.map((entry) => {
              const config = eventConfig[entry.event_type] || eventConfig.task_created;
              const Icon = config.icon;
              const agentName = getAgentName(entry.agent_id);
              const agentColor = getAgentColor(entry.agent_id);

              return (
                <div key={entry.id} className="flex items-start gap-3 relative pl-2" data-testid={`activity-${entry.id}`}>
                  <div className={`p-1.5 rounded-full z-10 ${config.color} shrink-0`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 pb-3">
                    <p className="text-xs leading-snug">{entry.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {agentName && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agentColor }} />
                          {agentName}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatTimeAgo(entry.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {activity.length >= limit && (
            <button
              onClick={() => setLimit((l) => l + 50)}
              className="ml-10 text-xs text-primary hover:underline mt-2"
              data-testid="button-load-more-activity"
            >
              Load more...
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
