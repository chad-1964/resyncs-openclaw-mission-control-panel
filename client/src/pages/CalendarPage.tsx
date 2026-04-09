import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAgents } from "@/hooks/use-agents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import type { Schedule, Integration } from "@shared/schema";
import { Plus, Clock, Trash2, Edit2, Power, CalendarDays, List, Shield, ChevronDown, Bell } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIME_SLOTS = [
  { label: "Morning", range: "06:00–11:59", filter: (t: string) => { const h = parseInt(t); return h >= 6 && h < 12; } },
  { label: "Afternoon", range: "12:00–17:59", filter: (t: string) => { const h = parseInt(t); return h >= 12 && h < 18; } },
  { label: "Evening", range: "18:00–23:59", filter: (t: string) => { const h = parseInt(t); return h >= 18 || h < 6; } },
];

const taskTypeColors: Record<string, string> = {
  general: "bg-muted-foreground/20 text-muted-foreground",
  research: "bg-blue-500/15 text-blue-400",
  monitoring: "bg-cyan-500/15 text-cyan-400",
  reporting: "bg-purple-500/15 text-purple-400",
  outreach: "bg-pink-500/15 text-pink-400",
  data_processing: "bg-orange-500/15 text-orange-400",
};

export default function CalendarPage() {
  const { data: schedules, isLoading } = useQuery<Schedule[]>({
    queryKey: ["/api/schedules"],
    refetchInterval: 30000,
  });
  const { data: agents } = useAgents();
  const { data: integrations } = useQuery<Integration[]>({ queryKey: ["/api/integrations"] });
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  const toggleMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/schedules/${id}/toggle`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Schedule deleted" });
    },
  });

  const getSchedulesForSlot = (day: string, slotFilter: (t: string) => boolean) => {
    return (schedules || []).filter(
      (s) => s.days.includes(day) && slotFilter(s.time)
    );
  };

  const getAgentName = (agentId: number | null) =>
    agents?.find((a) => a.id === agentId)?.name ?? "Unassigned";

  const getAgentColor = (agentId: number | null) =>
    agents?.find((a) => a.id === agentId)?.avatar_color ?? "#666";

  return (
    <div className="p-6" data-testid="page-calendar">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Schedules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage cron jobs and recurring tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setView("grid")}
              className={`px-2.5 py-1 text-xs ${view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              data-testid="button-view-grid"
            >
              <CalendarDays className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-2.5 py-1 text-xs ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
              data-testid="button-view-list"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-create-schedule">
                <Plus className="w-4 h-4 mr-1" /> New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Schedule</DialogTitle></DialogHeader>
              <ScheduleForm agents={agents || []} integrations={integrations || []} onClose={() => setCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {view === "grid" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {/* Header */}
            <div className="grid grid-cols-8 gap-px bg-border rounded-t-lg overflow-hidden">
              <div className="bg-card p-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" />
              {DAYS.map((day) => (
                <div key={day} className="bg-card p-2.5 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {day}
                </div>
              ))}
            </div>
            {/* Slots */}
            {TIME_SLOTS.map((slot) => (
              <div key={slot.label} className="grid grid-cols-8 gap-px bg-border">
                <div className="bg-card p-2.5 flex flex-col justify-center">
                  <span className="text-xs font-medium">{slot.label}</span>
                  <span className="text-[10px] text-muted-foreground">{slot.range}</span>
                </div>
                {DAYS.map((day) => {
                  const daySchedules = getSchedulesForSlot(day, slot.filter);
                  return (
                    <div key={day} className="bg-card p-1.5 min-h-[80px]">
                      {daySchedules.map((s) => {
                        const agentColor = getAgentColor(s.agent_id);
                        return (
                          <div
                            key={s.id}
                            className={`p-1.5 rounded-r text-[10px] mb-1 cursor-pointer transition-all duration-150 hover:brightness-125 ${
                              s.is_enabled ? "opacity-100" : "opacity-35"
                            }`}
                            style={{
                              // Subtle tinted background + vivid left border stripe in agent color
                              backgroundColor: `${agentColor}18`,
                              borderLeft: `2.5px solid ${agentColor}`,
                            }}
                            onClick={() => setEditSchedule(s)}
                            data-testid={`schedule-card-${s.id}`}
                          >
                            <div className="font-semibold truncate" style={{ color: agentColor }}>{s.name}</div>
                            <div className="text-muted-foreground flex items-center gap-1 mt-0.5" style={{ opacity: 0.7 }}>
                              <Clock className="w-2.5 h-2.5" />
                              {s.time}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {(schedules || []).map((s) => (
            <Card key={s.id} className="p-3 border-card-border" data-testid={`schedule-list-${s.id}`}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleMutation.mutate(s.id)}
                  className={`p-1.5 rounded ${s.is_enabled ? "text-primary" : "text-muted-foreground"}`}
                  data-testid={`button-toggle-schedule-${s.id}`}
                >
                  <Power className="w-4 h-4" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${!s.is_enabled ? "opacity-50" : ""}`}>{s.name}</span>
                    <Badge className={`text-[10px] h-4 ${taskTypeColors[s.task_type]}`}>{s.task_type.replace("_", " ")}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {s.time}
                    </span>
                    <span>{s.days.join(", ")}</span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getAgentColor(s.agent_id) }} />
                      {getAgentName(s.agent_id)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => setEditSchedule(s)} className="p-1.5 rounded hover:bg-accent text-muted-foreground" data-testid={`button-edit-schedule-${s.id}`}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteMutation.mutate(s.id)} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" data-testid={`button-delete-schedule-${s.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editSchedule} onOpenChange={(o) => !o && setEditSchedule(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Schedule</DialogTitle></DialogHeader>
          {editSchedule && (
            <ScheduleForm schedule={editSchedule} agents={agents || []} integrations={integrations || []} onClose={() => setEditSchedule(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Messaging integrations we can notify — maps integration name → schedule boolean field
const NOTIFY_CHANNEL_MAP: Record<string, "notify_discord" | "notify_whatsapp"> = {
  Discord: "notify_discord",
  WhatsApp: "notify_whatsapp",
};

function ScheduleForm({ schedule, agents, integrations, onClose }: { schedule?: Schedule; agents: any[]; integrations: Integration[]; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(schedule?.name || "");
  const [description, setDescription] = useState(schedule?.description || "");
  const [time, setTime] = useState(schedule?.time || "09:00");
  const [days, setDays] = useState<string[]>(schedule?.days || ["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [agentId, setAgentId] = useState(schedule?.agent_id?.toString() || "none");
  const [taskType, setTaskType] = useState(schedule?.task_type || "general");
  const [isEnabled, setIsEnabled] = useState(schedule?.is_enabled ?? true);
  const [priority, setPriority] = useState(schedule?.priority || "medium");
  const [onFailure, setOnFailure] = useState(schedule?.on_failure || "notify_only");
  const [maxRetries, setMaxRetries] = useState(schedule?.max_retries ?? 3);
  const [timeout, setTimeout_] = useState(schedule?.timeout_minutes ?? 60);
  const [notifyOnFailure, setNotifyOnFailure] = useState(schedule?.notify_on_failure ?? true);
  const [notifyDiscord, setNotifyDiscord] = useState(schedule?.notify_discord ?? false);
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(schedule?.notify_whatsapp ?? false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localTime, setLocalTime] = useState(new Date().toLocaleTimeString());

  // Sync browser timezone to server on form open + live clock
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    apiRequest("PATCH", "/api/settings/timezone", { value: tz }).catch(() => {});
    const tick = setInterval(() => setLocalTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(tick);
  }, []);

  const toggleDay = (day: string) => {
    setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        description: description || null,
        cron_expression: (() => {
          // Convert local time → UTC for the cron expression.
          // getTimezoneOffset() returns minutes that local is BEHIND UTC (positive = west of UTC).
          // e.g. CDT (UTC-5) → offset = 300, so local 18:05 + 300 min = 23:05 UTC.
          const [h, m] = time.split(":").map(Number);
          const offsetMin = new Date().getTimezoneOffset();
          const totalUtcMin = (h * 60 + m + offsetMin + 1440 * 2) % 1440;
          const utcH = Math.floor(totalUtcMin / 60);
          const utcM = totalUtcMin % 60;
          const dayPart = days.length > 0 && days.length < 7
            ? days.map((d: string) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(d)).filter(n => n >= 0).join(",")
            : "*";
          return `${utcM} ${utcH} * * ${dayPart}`;
        })(),
        time,
        days,
        agent_id: agentId !== "none" ? parseInt(agentId) : null,
        task_type: taskType,
        is_enabled: isEnabled,
        priority,
        on_failure: onFailure,
        max_retries: maxRetries,
        timeout_minutes: timeout,
        notify_on_failure: notifyOnFailure,
        notify_discord: notifyDiscord,
        notify_whatsapp: notifyWhatsapp,
      };
      if (schedule) {
        await apiRequest("PATCH", `/api/schedules/${schedule.id}`, body);
      } else {
        await apiRequest("POST", "/api/schedules", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({ title: schedule ? "Schedule updated" : "Schedule created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2.5">
      {/* Name + enabled on same row */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schedule name..." className="text-sm" data-testid="input-schedule-name" />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} data-testid="switch-schedule-enabled" />
          <Label className="text-xs text-muted-foreground">On</Label>
        </div>
      </div>

      {/* Description */}
      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={1} placeholder="What should the agent do..." className="text-sm resize-none" data-testid="input-schedule-description" />

      {/* Current time indicator */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-accent/50 text-[10px] text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Your time: <span className="font-mono text-foreground">{localTime}</span>
        <span className="ml-auto">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
      </div>

      {/* Time + Agent + Type in one row */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Time (your local)</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="text-sm h-8" data-testid="input-schedule-time" />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-schedule-agent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Type</Label>
          <Select value={taskType} onValueChange={setTaskType}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-schedule-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="research">Research</SelectItem>
              <SelectItem value="monitoring">Monitoring</SelectItem>
              <SelectItem value="reporting">Reporting</SelectItem>
              <SelectItem value="outreach">Outreach</SelectItem>
              <SelectItem value="data_processing">Data Processing</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Days */}
      <div className="flex gap-1">
        {DAYS.map((day) => (
          <button
            key={day}
            onClick={() => toggleDay(day)}
            className={`flex-1 py-1 text-[11px] rounded border transition-colors ${
              days.includes(day)
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
            data-testid={`button-day-${day.toLowerCase()}`}
          >
            {day}
          </button>
        ))}
      </div>

      {/* Notify channels — only show channels that are connected */}
      {(() => {
        const activeChannels = integrations.filter(
          i => i.is_connected && NOTIFY_CHANNEL_MAP[i.name]
        );
        if (activeChannels.length === 0) return null;
        const getValue = (field: "notify_discord" | "notify_whatsapp") =>
          field === "notify_discord" ? notifyDiscord : notifyWhatsapp;
        const setValue = (field: "notify_discord" | "notify_whatsapp", v: boolean) =>
          field === "notify_discord" ? setNotifyDiscord(v) : setNotifyWhatsapp(v);
        return (
          <div className="flex items-center gap-3 py-0.5">
            <Bell className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Notify</span>
            {activeChannels.map(i => {
              const field = NOTIFY_CHANNEL_MAP[i.name]!;
              return (
                <label key={i.name} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={getValue(field)}
                    onChange={e => setValue(field, e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary"
                    data-testid={`check-notify-${i.name.toLowerCase()}`}
                  />
                  <span className="text-xs">{i.name}</span>
                </label>
              );
            })}
          </div>
        );
      })()}

      {/* Advanced / Guardrails — collapsed by default */}
      <button
        type="button"
        onClick={() => setShowAdvanced(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full pt-0.5"
      >
        <Shield className="w-3 h-3" />
        <span className="uppercase tracking-wider font-medium">Guardrails</span>
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
      </button>

      {showAdvanced && (
        <div className="space-y-2.5 pt-1 border-t border-border/50">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">On Failure</Label>
              <Select value={onFailure} onValueChange={setOnFailure}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="notify_only">Notify Only</SelectItem>
                  <SelectItem value="auto_retry">Auto Retry</SelectItem>
                  <SelectItem value="skip_continue">Skip & Continue</SelectItem>
                  <SelectItem value="escalate">Escalate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Max Retries: {maxRetries}</Label>
            <Slider value={[maxRetries]} onValueChange={([v]) => setMaxRetries(v)} min={0} max={10} step={1} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Timeout: {timeout} min</Label>
            <Slider value={[timeout]} onValueChange={([v]) => setTimeout_(v)} min={1} max={1440} step={1} className="mt-1.5" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={notifyOnFailure} onCheckedChange={setNotifyOnFailure} data-testid="switch-notify-failure" />
            <Label className="text-xs">Notify on failure</Label>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!name.trim() || days.length === 0 || mutation.isPending}
          data-testid="button-submit-schedule"
        >
          {mutation.isPending ? "Saving..." : schedule ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}
