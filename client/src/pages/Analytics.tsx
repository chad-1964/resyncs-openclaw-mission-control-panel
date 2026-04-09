import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAgents } from "@/hooks/use-agents";
import { useToast } from "@/hooks/use-toast";
import type { CostAnalytics, CostAlert } from "@shared/schema";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { DollarSign, TrendingUp, Cpu, Zap, RefreshCw, Bell, Plus, Trash2 } from "lucide-react";

const CHART_COLORS = [
  "hsl(173, 58%, 44%)",
  "hsl(262, 83%, 68%)",
  "hsl(43, 74%, 60%)",
  "hsl(340, 75%, 60%)",
  "hsl(221, 83%, 65%)",
  "hsl(142, 70%, 45%)",
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week",  label: "7 Days" },
  { value: "month", label: "30 Days" },
  { value: "all",   label: "All Time" },
];

export default function Analytics() {
  const [period, setPeriod] = useState("week");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ provider: string; status: string; entries: number }[] | null>(null);

  const { data: analytics, isLoading } = useQuery<CostAnalytics>({
    queryKey: ["/api/analytics/costs", period],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/analytics/costs?period=${period}`);
      return res.json();
    },
    placeholderData: (prev: any) => prev,
    staleTime: 0, // Always refetch on mount — period changes need fresh data
    refetchInterval: 30000,
  });

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiRequest("POST", "/api/analytics/sync", {});
      const json = await res.json();
      if (json.results) setSyncResult(json.results);
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/costs"] });
    } catch {
      // silent
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync on first load if there's no data — pulls from AI provider APIs
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (!isLoading && analytics && analytics.totalTokens === 0 && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      handleSync();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, analytics]);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 mb-6" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-muted-foreground min-h-[300px]">
        <RefreshCw className="w-8 h-8" />
        <p className="text-sm">Failed to load analytics. Your session may have expired.</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }

  const kpis = [
    { label: "Total Cost",    value: `$${analytics.totalCost.toFixed(4)}`,    icon: DollarSign, color: "text-primary" },
    { label: "Daily Average", value: `$${analytics.dailyAverage.toFixed(4)}`, icon: TrendingUp,  color: "text-emerald-400" },
    { label: "Total Tokens",  value: formatNumber(analytics.totalTokens),      icon: Zap,         color: "text-yellow-400" },
    { label: "Models Used",   value: String(analytics.activeModels),           icon: Cpu,         color: "text-purple-400" },
  ];

  const hasData = analytics.totalTokens > 0 || analytics.totalCost > 0;

  return (
    <div className="p-6" data-testid="page-analytics">
      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Cost Analytics</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Token usage and cost breakdown across agents and models</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync from APIs"}
          </Button>
          {syncResult && (
            <div className="text-[10px] text-muted-foreground space-y-0.5 text-right">
              {syncResult.map((r) => (
                <div key={r.provider}>
                  <span className="font-medium capitalize">{r.provider}</span>: {r.status}
                  {r.entries > 0 && <span className="text-emerald-400 ml-1">+{r.entries} entries</span>}
                </div>
              ))}
              {syncResult.length === 0 && <div className="text-amber-400">No API keys configured.</div>}
            </div>
          )}
        </div>
      </div>

      {/* Period Tabs */}
      <div className="flex gap-1 mb-5 bg-muted rounded-lg p-1 w-fit">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              period === p.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="p-4 border-card-border">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-card ${kpi.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-lg font-semibold tabular-nums">{kpi.value}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!hasData ? (
        <Card className="p-8 border-card-border flex flex-col items-center gap-2 text-muted-foreground">
          <Zap className="w-8 h-8 opacity-30" />
          <p className="text-sm font-medium">No usage data for this period</p>
          <p className="text-xs text-center max-w-xs">
            Chat with the CEO agent to start recording token usage, or click "Sync from APIs" to pull usage from your AI provider.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Daily Cost Trend — only useful when >1 day */}
          {analytics.dailyTrend.length > 1 && (
            <Card className="p-4 border-card-border col-span-1 lg:col-span-2">
              <h3 className="text-sm font-semibold mb-4">Cost Trend</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={analytics.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 14%, 18%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(220, 14%, 12%)", border: "1px solid hsl(217, 14%, 18%)", borderRadius: "8px", fontSize: "12px" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    formatter={(v: number) => [`$${v.toFixed(6)}`, "Cost"]}
                  />
                  <Line type="monotone" dataKey="cost" stroke="hsl(173, 58%, 44%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Per-Agent Cost */}
          {analytics.perAgentCost.length > 0 && (
            <Card className="p-4 border-card-border">
              <h3 className="text-sm font-semibold mb-4">Cost by Agent</h3>
              <ResponsiveContainer width="100%" height={Math.max(180, analytics.perAgentCost.length * 42)}>
                <BarChart data={analytics.perAgentCost} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 14%, 18%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="agent_name" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(220, 14%, 12%)", border: "1px solid hsl(217, 14%, 18%)", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(v: number) => [`$${v.toFixed(6)}`, "Cost"]}
                  />
                  <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                    {analytics.perAgentCost.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Per-Agent Tokens */}
          {analytics.perAgentCost.length > 0 && (
            <Card className="p-4 border-card-border">
              <h3 className="text-sm font-semibold mb-4">Tokens by Agent</h3>
              <ResponsiveContainer width="100%" height={Math.max(180, analytics.perAgentCost.length * 42)}>
                <BarChart data={analytics.perAgentCost} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217, 14%, 18%)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} tickFormatter={formatNumber} />
                  <YAxis type="category" dataKey="agent_name" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} width={110} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(220, 14%, 12%)", border: "1px solid hsl(217, 14%, 18%)", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(v: number) => [formatNumber(v) + " tokens", "Tokens"]}
                  />
                  <Bar dataKey="tokens" radius={[0, 4, 4, 0]}>
                    {analytics.perAgentCost.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Model Usage Donut */}
          {analytics.modelUsage.length > 0 && (
            <Card className="p-4 border-card-border">
              <h3 className="text-sm font-semibold mb-4">Model Usage</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={analytics.modelUsage}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="tokens"
                    nameKey="model"
                  >
                    {analytics.modelUsage.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(220, 14%, 12%)", border: "1px solid hsl(217, 14%, 18%)", borderRadius: "8px", fontSize: "12px" }}
                    formatter={(v: number, name: string) => [formatNumber(v) + " tokens", name]}
                  />
                  <Legend
                    formatter={(value) => (
                      <span className="text-xs text-muted-foreground" style={{ display: "inline-block", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
                    )}
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Detailed breakdown table */}
          {analytics.perAgentCost.length > 0 && (
            <Card className="p-4 border-card-border col-span-1 lg:col-span-2">
              <h3 className="text-sm font-semibold mb-3">Agent Breakdown</h3>
              <div className="divide-y divide-border/50">
                <div className="grid grid-cols-4 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Agent</span>
                  <span>Models Used</span>
                  <span className="text-right">Tokens</span>
                  <span className="text-right">Cost (USD)</span>
                </div>
                {analytics.perAgentCost.map((row, i) => (
                  <div key={i} className="grid grid-cols-4 py-2 text-xs items-center">
                    <span className="font-medium">{row.agent_name}</span>
                    <div className="flex flex-wrap gap-1">
                      {(row.models ?? []).map((m) => (
                        <span key={m} className="px-1.5 py-0.5 rounded bg-muted text-[9px] text-muted-foreground truncate max-w-[120px]" title={m}>
                          {m.replace(/^(openclaw\/|claude-|gpt-)/i, "").slice(0, 20)}
                        </span>
                      ))}
                      {(!row.models || row.models.length === 0) && (
                        <span className="text-muted-foreground/50 text-[9px]">—</span>
                      )}
                    </div>
                    <span className="text-right text-muted-foreground tabular-nums">{formatNumber(row.tokens)}</span>
                    <span className="text-right font-semibold tabular-nums">${row.cost.toFixed(6)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Cost Alerts Section */}
      <CostAlertsSection />
    </div>
  );
}

function CostAlertsSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: agents } = useAgents();
  const { toast } = useToast();

  const { data: alerts } = useQuery<CostAlert[]>({
    queryKey: ["/api/cost-alerts"],
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/cost-alerts/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cost-alerts"] }); toast({ title: "Alert deleted" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: number; is_active: boolean }) => {
      await apiRequest("PATCH", `/api/cost-alerts/${id}`, { is_active });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/cost-alerts"] }); },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/cost-alerts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-alerts"] });
      toast({ title: "Alert created" });
      setCreateOpen(false);
    },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const [newName, setNewName] = useState("");
  const [newThreshold, setNewThreshold] = useState("5.00");
  const [newPeriod, setNewPeriod] = useState("daily");
  const [newAgentId, setNewAgentId] = useState("all");
  const [newChannel, setNewChannel] = useState("ui");

  const agentName = (id: number | null) => {
    if (!id) return "All Agents";
    return agents?.find((a: any) => a.id === id)?.name || `Agent #${id}`;
  };

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold">Cost Alerts</h3>
          {alerts && alerts.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{alerts.filter(a => a.is_active).length} active</span>
          )}
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs">
              <Plus className="w-3 h-3 mr-1" /> Add Alert
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Create Cost Alert</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Alert Name</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., Daily budget limit" className="mt-1 h-8" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Threshold (USD)</Label>
                  <Input type="number" step="0.01" value={newThreshold} onChange={e => setNewThreshold(e.target.value)} className="mt-1 h-8" />
                </div>
                <div>
                  <Label className="text-xs">Period</Label>
                  <Select value={newPeriod} onValueChange={setNewPeriod}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Agent</Label>
                  <Select value={newAgentId} onValueChange={setNewAgentId}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Agents</SelectItem>
                      {(agents || []).map((a: any) => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Notify Via</Label>
                  <Select value={newChannel} onValueChange={setNewChannel}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ui">Dashboard</SelectItem>
                      <SelectItem value="discord">Discord</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end">
                <Button size="sm" disabled={!newName.trim() || createMutation.isPending} onClick={() => createMutation.mutate({
                  name: newName.trim(),
                  threshold_usd: parseFloat(newThreshold),
                  period: newPeriod,
                  agent_id: newAgentId === "all" ? null : parseInt(newAgentId),
                  notification_channel: newChannel,
                })}>
                  {createMutation.isPending ? "Creating..." : "Create Alert"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {(!alerts || alerts.length === 0) ? (
        <Card className="p-4 border-card-border text-center">
          <p className="text-xs text-muted-foreground">No cost alerts configured. Add one to get notified when spending exceeds thresholds.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <Card key={alert.id} className="p-3 border-card-border flex items-center gap-3">
              <Switch checked={alert.is_active} onCheckedChange={(v) => toggleMutation.mutate({ id: alert.id, is_active: v })} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{alert.name}</span>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{agentName(alert.agent_id)}</span>
                  <span>·</span>
                  <span>${alert.threshold_usd.toFixed(2)} / {alert.period}</span>
                  <span>·</span>
                  <span>via {alert.notification_channel}</span>
                  {alert.trigger_count > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-amber-400">triggered {alert.trigger_count}x</span>
                    </>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-red-400 h-7 w-7 p-0" onClick={() => deleteMutation.mutate(alert.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
