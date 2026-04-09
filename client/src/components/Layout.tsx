import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTheme, COLOR_SCHEMES } from "@/lib/theme";
import { useAgents, triggerOpenClawSync } from "@/hooks/use-agents";
import CommandPalette from "@/components/CommandPalette";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DashboardStats } from "@shared/schema";
import {
  LayoutDashboard, Calendar, FileText, BarChart3, Activity,
  Settings, Search, Moon, Sun, ChevronLeft, ChevronRight,
  Zap, Users, ListTodo, Clock, LogOut, Plus, DollarSign, ShieldCheck,
} from "lucide-react";

const AGENT_COLORS = [
  "#0d9488","#8b5cf6","#f59e0b","#3b82f6",
  "#ec4899","#10b981","#ef4444","#f97316","#6366f1","#14b8a6",
];

function CreateAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName]   = useState("");
  const [role, setRole]   = useState("");
  const [color, setColor] = useState(AGENT_COLORS[0]);

  const mutation = useMutation({
    mutationFn: async () => {
      const openclaw_id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await apiRequest("POST", "/api/agents", { name, role, avatar_color: color, openclaw_id, agent_type: "permanent" });
    },
    onSuccess: () => {
      triggerOpenClawSync();
      setName(""); setRole(""); setColor(AGENT_COLORS[0]);
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">Create Agent</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Researcher" className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Deep research & analysis" className="h-8 text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Color</Label>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {AGENT_COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mutation.mutate()} disabled={!name.trim() || !role.trim() || mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create Agent"}
            </Button>
          </div>
          {mutation.isError && <p className="text-[11px] text-destructive">Failed to create agent — please try again.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/approvals", label: "Approvals", icon: ShieldCheck },
  { path: "/calendar", label: "Calendar", icon: Calendar },
  { path: "/reports", label: "Reports", icon: FileText },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/activity", label: "Activity Feed", icon: Activity },
  { path: "/settings", label: "Settings", icon: Settings },
];

function AgentDot({ color, status }: { color: string; status: string }) {
  const ring = status === "working" ? "ring-2 ring-primary/50 animate-pulse" : "";
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${ring}`}
      style={{ backgroundColor: color }}
    />
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, colorScheme, toggleTheme, setColorScheme } = useTheme();
  const { data: agents } = useAgents();
  const [collapsed, setCollapsed] = useState(false);

  // Sync OpenClaw agents on initial app load
  useEffect(() => { triggerOpenClawSync(); }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<any>(null);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      // Hard reload: clears all React state and JS cache, lands on login
      window.location.href = window.location.origin + window.location.pathname;
    },
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/stats"],
    refetchInterval: 30000,
  });

  const { data: approvalCount } = useQuery<{ pending: number }>({
    queryKey: ["/api/approvals/count"],
    refetchInterval: 15000,
    staleTime: 0, // Always refetch on mount — badge should show ASAP
  });

  // White-label branding from settings cache
  const cachedSettings = queryClient.getQueryData<any[]>(["/api/settings"]);
  const rawBrandName = cachedSettings?.find((s: any) => s.setting_key === "app_name")?.setting_value;
  const brandName = (typeof rawBrandName === "string" ? rawBrandName.replace(/^"|"$/g, "") : String(rawBrandName || "")) || "Mission Control";
  const rawBrandLogo = cachedSettings?.find((s: any) => s.setting_key === "app_logo_url")?.setting_value;
  const brandLogo = (typeof rawBrandLogo === "string" ? rawBrandLogo.replace(/^"|"$/g, "") : String(rawBrandLogo || "")) || "";
  const rawAdminName = cachedSettings?.find((s: any) => s.setting_key === "admin_name")?.setting_value;
  const adminName = (typeof rawAdminName === "string" ? rawAdminName.replace(/^"|"$/g, "") : String(rawAdminName || "")) || "";

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await apiRequest("GET", `/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data);
      setSearchOpen(true);
    } catch { setSearchResults(null); }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <CommandPalette />
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-sidebar-border shrink-0">
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                {brandLogo ? (
                  <img src={brandLogo} alt={brandName} className="w-4 h-4 object-contain" />
                ) : (
                  <Zap className="w-4 h-4 text-primary-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm truncate text-sidebar-foreground block">
                  {brandName}
                </span>
                {adminName && (
                  <Link href="/profile"><span className="text-[10px] text-muted-foreground hover:text-primary truncate block cursor-pointer transition-colors">{adminName}</span></Link>
                )}
              </div>
            </div>
          )}
          {collapsed && (
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center mx-auto">
              {brandLogo ? (
                <img src={brandLogo} alt={brandName} className="w-4 h-4 object-contain" />
              ) : (
                <Zap className="w-4 h-4 text-primary-foreground" />
              )}
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto p-1 rounded hover:bg-sidebar-accent text-muted-foreground"
            data-testid="toggle-sidebar"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 py-2 relative">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search..."
                className="pl-8 h-8 text-xs bg-sidebar-accent border-0"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onFocus={() => searchResults && setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
                data-testid="input-global-search"
              />
            </div>
            {searchOpen && searchResults && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-popover border border-popover-border rounded-lg shadow-lg z-50 max-h-64 overflow-auto">
                {searchResults.tasks?.length > 0 && (
                  <div className="p-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Tasks</p>
                    {searchResults.tasks.slice(0, 3).map((t: any) => (
                      <Link key={t.id} href="/" className="block px-2 py-1 text-xs rounded hover:bg-accent truncate">
                        {t.title}
                      </Link>
                    ))}
                  </div>
                )}
                {searchResults.reports?.length > 0 && (
                  <div className="p-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Reports</p>
                    {searchResults.reports.slice(0, 3).map((r: any) => (
                      <Link key={r.id} href={`/reports/${r.id}`} className="block px-2 py-1 text-xs rounded hover:bg-accent truncate">
                        {r.title}
                      </Link>
                    ))}
                  </div>
                )}
                {searchResults.schedules?.length > 0 && (
                  <div className="p-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Schedules</p>
                    {searchResults.schedules.slice(0, 3).map((s: any) => (
                      <Link key={s.id} href="/calendar" className="block px-2 py-1 text-xs rounded hover:bg-accent truncate">
                        {s.name}
                      </Link>
                    ))}
                  </div>
                )}
                {(!searchResults.tasks?.length && !searchResults.reports?.length && !searchResults.schedules?.length) && (
                  <p className="p-3 text-xs text-muted-foreground text-center">No results found</p>
                )}
              </div>
            )}
          </div>
        )}

        <ScrollArea className="flex-1">
          {/* Navigation */}
          <nav className="px-2 py-1">
            {navItems.map((item: any) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              const Icon = item.icon;
              return (
                <Link key={item.path} href={item.path}>
                  <div
                    className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors mb-0.5 cursor-pointer ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                    }`}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="flex-1">{item.label}</span>}
                    {!collapsed && item.path === "/approvals" && (approvalCount?.pending || 0) > 0 && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-semibold">
                        {approvalCount!.pending}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          {!collapsed && (
            <>
              {/* Agent Roster */}
              <Separator className="my-2 mx-3" />
              <div className="px-3 py-1">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Agent Roster
                  </p>
                  <button onClick={() => setCreateAgentOpen(true)} className="text-muted-foreground hover:text-foreground transition-colors" title="Create agent">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {agents?.map((agent) => (
                    <Link key={agent.id} href={`/agents/${agent.id}`}>
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-sidebar-accent cursor-pointer transition-colors"
                        data-testid={`agent-roster-${agent.id}`}
                      >
                        <AgentDot color={agent.avatar_color} status={agent.status} />
                        <span className="truncate text-sidebar-foreground">{agent.name}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground capitalize">{agent.status}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Running Tally */}
              {stats && (
                <>
                  <Separator className="my-2 mx-3" />
                  <div className="px-3 py-1 pb-3">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
                      Running Tally
                    </p>
                    <div className="space-y-1.5 px-1">
                      <TallyRow icon={ListTodo} label="Backlog" value={stats.tasksByStatus.backlog} />
                      <TallyRow icon={Zap} label="In Progress" value={stats.tasksByStatus.doing} color="text-yellow-500" />
                      <TallyRow icon={ListTodo} label="Done" value={stats.tasksByStatus.done} color="text-emerald-500" />
                      <TallyRow icon={Users} label="Active Agents" value={stats.activeAgents} />
                      <TallyRow icon={Clock} label="Schedules" value={`${stats.enabledSchedules}/${stats.totalSchedules}`} />
                      <TallyRow icon={FileText} label="Reports" value={stats.totalReports} />
                      {(stats.todayTokens > 0 || stats.todayCost > 0) && (
                        <>
                          <div className="border-t border-border/40 my-1" />
                          <TallyRow icon={Zap} label="Today's Tokens" value={formatTokens(stats.todayTokens)} color="text-yellow-400" />
                          <TallyRow icon={DollarSign} label="Today's Cost" value={`$${stats.todayCost.toFixed(4)}`} color="text-primary" />
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-sidebar-border px-3 py-2 shrink-0 space-y-0.5">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>
          {!collapsed && (
            <div className="flex items-center gap-1 px-2 py-1">
              {COLOR_SCHEMES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setColorScheme(s.id)}
                  title={s.label}
                  className={`w-4 h-4 rounded-full border-2 transition-transform ${colorScheme === s.id ? "border-foreground scale-125" : "border-transparent hover:scale-110"}`}
                  style={{ backgroundColor: s.accent }}
                />
              ))}
            </div>
          )}
          <button
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto" data-testid="main-content">
        {children}
      </main>

      {createAgentOpen && <CreateAgentDialog open={createAgentOpen} onClose={() => setCreateAgentOpen(false)} />}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TallyRow({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
      <span className={`font-semibold tabular-nums ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}
