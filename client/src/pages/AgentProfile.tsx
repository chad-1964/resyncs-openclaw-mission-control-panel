import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { triggerOpenClawSync } from "@/hooks/use-agents";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Task, Schedule, Report, ActivityLog } from "@shared/schema";
import {
  ArrowLeft, ListTodo, Calendar, FileText, Activity, Clock,
  Brain, Save, AlertCircle, Pencil, X, Check, Zap, Mic,
  Plus, Settings2, MessageCircle, BarChart2, FolderOpen,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Link } from "wouter";

interface AgentDetail {
  id: number;
  name: string;
  role: string;
  avatar_color: string;
  status: string;
  current_task_summary: string | null;
  is_active: boolean;
  soul: string | null;
  skills: string[] | null;
  model_config: Record<string, any> | null;
  tasks: Task[];
  reports: Report[];
  schedules: Schedule[];
  recentActivity: ActivityLog[];
}

// Preset avatar color swatches
const COLOR_SWATCHES = [
  "#0d9488", "#8b5cf6", "#f59e0b", "#3b82f6",
  "#ec4899", "#10b981", "#ef4444", "#f97316",
  "#6366f1", "#14b8a6", "#a855f7", "#84cc16",
];

export default function AgentProfile({ id }: { id: string }) {
  const agentId = parseInt(id);

  const { data: agent, isLoading, isError } = useQuery<AgentDetail>({
    queryKey: ["/api/agents", agentId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agents/${agentId}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-40 w-full mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="w-8 h-8" />
        <p className="text-sm">Failed to load agent. Your session may have expired.</p>
        <Link href="/"><button className="text-xs underline">Return to dashboard</button></Link>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    idle: "bg-emerald-500",
    working: "bg-yellow-500 animate-pulse",
    error: "bg-red-500",
    offline: "bg-muted-foreground",
  };

  return (
    <div className="p-6" data-testid="page-agent-profile">
      <Link href="/">
        <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4" data-testid="button-back-dashboard">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
      </Link>

      <AgentHeader agent={agent} agentId={agentId} statusColors={statusColors} />

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks" className="text-xs"><ListTodo className="w-3.5 h-3.5 mr-1" />Tasks</TabsTrigger>
          <TabsTrigger value="schedules" className="text-xs"><Calendar className="w-3.5 h-3.5 mr-1" />Schedules</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs"><FileText className="w-3.5 h-3.5 mr-1" />Reports</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs"><Activity className="w-3.5 h-3.5 mr-1" />Activity</TabsTrigger>
          <TabsTrigger value="tokens" className="text-xs"><BarChart2 className="w-3.5 h-3.5 mr-1" />Tokens</TabsTrigger>
          <TabsTrigger value="config" className="text-xs"><Settings2 className="w-3.5 h-3.5 mr-1" />Configuration</TabsTrigger>
          <TabsTrigger value="chat" className="text-xs"><MessageCircle className="w-3.5 h-3.5 mr-1" />Chat</TabsTrigger>
          <TabsTrigger value="files" className="text-xs"><FolderOpen className="w-3.5 h-3.5 mr-1" />Files</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-4">
          {agent.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No tasks assigned</p>
          ) : (
            <div className="space-y-2">
              {agent.tasks.map((task) => (
                <Card key={task.id} className="p-3 border-card-border">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] capitalize">{task.status}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{task.priority}</Badge>
                    <span className="text-xs font-medium">{task.title}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="schedules" className="mt-4">
          {agent.schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No schedules assigned</p>
          ) : (
            <div className="space-y-2">
              {agent.schedules.map((schedule) => (
                <Card key={schedule.id} className="p-3 border-card-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium">{schedule.name}</span>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {schedule.time} · {schedule.days.join(", ")}
                      </div>
                    </div>
                    <Badge variant={schedule.is_enabled ? "default" : "secondary"} className="text-[10px]">
                      {schedule.is_enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          {agent.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No reports generated</p>
          ) : (
            <div className="space-y-2">
              {agent.reports.map((report) => (
                <Link key={report.id} href="/reports">
                  <Card className="p-3 border-card-border cursor-pointer hover:border-primary/20">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">{report.type}</Badge>
                      <span className="text-xs font-medium">{report.title}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(report.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          {agent.recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No recent activity</p>
          ) : (
            <div className="space-y-2">
              {agent.recentActivity.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 py-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs">{entry.description}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tokens" className="mt-4">
          <TokensTab agentId={agentId} />
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <ConfigTab agent={agent} />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <ChatTab agent={agent} />
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <BootstrapFilesTab agent={agent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── AgentHeader — view mode + inline edit for identity fields ──
function AgentHeader({ agent, agentId, statusColors }: { agent: AgentDetail; agentId: number; statusColors: Record<string, string> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [color, setColor] = useState(agent.avatar_color);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/agents/${agentId}`, { name, role, avatar_color: color });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      setEditing(false);
    },
  });

  function cancelEdit() {
    setName(agent.name);
    setRole(agent.role);
    setColor(agent.avatar_color);
    setEditing(false);
  }

  return (
    <Card className="p-5 border-card-border mb-6">
      {editing ? (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0"
              style={{ backgroundColor: color }}
            >
              {name.charAt(0) || "?"}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Agent Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs mt-1" placeholder="e.g. CEO" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Role / Description</Label>
                <Input value={role} onChange={(e) => setRole(e.target.value)} className="h-8 text-xs mt-1" placeholder="e.g. Strategic Oversight" />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-[10px] text-muted-foreground">Avatar Color</Label>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  onClick={() => setColor(swatch)}
                  className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: swatch,
                    borderColor: color === swatch ? "white" : "transparent",
                    boxShadow: color === swatch ? `0 0 0 2px ${swatch}` : undefined,
                  }}
                />
              ))}
              <div className="flex items-center gap-1.5 ml-1">
                <div className="w-6 h-6 rounded-full border border-border" style={{ backgroundColor: color }} />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-7 w-24 text-xs font-mono"
                  placeholder="#0d9488"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" onClick={() => saveMutation.mutate()} disabled={!name.trim() || saveMutation.isPending}>
              <Check className="w-3.5 h-3.5 mr-1" />
              {saveMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            {saveMutation.isError && (
              <span className="text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />Save failed
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: agent.avatar_color }}
          >
            {agent.name.charAt(0)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{agent.name}</h1>
              <span className={`w-2.5 h-2.5 rounded-full ${statusColors[agent.status]}`} />
              <Badge variant="secondary" className="text-[10px] capitalize">{agent.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{agent.role}</p>
            {agent.current_task_summary && (
              <p className="text-xs text-primary mt-1">Currently: {agent.current_task_summary}</p>
            )}
            {/* Skill chips — read-only preview in header */}
            {agent.skills && agent.skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {agent.skills.slice(0, 5).map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {s}
                  </span>
                ))}
                {agent.skills.length > 5 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    +{agent.skills.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-6 text-center items-center">
            <div><p className="text-lg font-semibold">{agent.tasks.length}</p><p className="text-[10px] text-muted-foreground">Tasks</p></div>
            <div><p className="text-lg font-semibold">{agent.schedules.length}</p><p className="text-[10px] text-muted-foreground">Schedules</p></div>
            <div><p className="text-lg font-semibold">{agent.reports.length}</p><p className="text-[10px] text-muted-foreground">Reports</p></div>
            <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-accent text-muted-foreground ml-2" title="Edit agent identity">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── ConfigTab — Skills, Soul, Model Routing, Voice ──────
function ConfigTab({ agent }: { agent: AgentDetail }) {
  return (
    <div className="space-y-5">
      <SkillsSection agent={agent} />
      <SoulSection agent={agent} />
      <ModelRoutingSection agent={agent} />
      <VoiceSection agent={agent} />
    </div>
  );
}

// ── Skills — tag-style input ────────────────────────────
function SkillsSection({ agent }: { agent: AgentDetail }) {
  const [skills, setSkills] = useState<string[]>(agent.skills ?? []);
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/agents/${agent.id}`, { skills });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agent.id] });
      triggerOpenClawSync();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function addSkill(raw: string) {
    const tag = raw.trim().replace(/,+$/, "");
    if (!tag || skills.includes(tag)) { setInput(""); return; }
    setSkills([...skills, tag]);
    setInput("");
  }

  function removeSkill(tag: string) {
    setSkills(skills.filter((s) => s !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addSkill(input); }
    if (e.key === "Backspace" && !input && skills.length > 0) {
      setSkills(skills.slice(0, -1));
    }
  }

  return (
    <Card className="p-4 border-card-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-primary" />Skills & Capabilities
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Capability tags shown in the agent header. Type a skill and press Enter or comma to add.
          </p>
        </div>
        <Button size="sm" className="text-xs h-7" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saved ? "Saved!" : "Save Skills"}
        </Button>
      </div>

      {/* Tag input area */}
      <div
        className="min-h-[52px] flex flex-wrap gap-1.5 p-2 rounded-md border border-input bg-background cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {skills.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
          >
            {tag}
            <button onClick={() => removeSkill(tag)} className="hover:text-destructive transition-colors">
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => input.trim() && addSkill(input)}
          placeholder={skills.length === 0 ? "Add a skill (e.g. Financial Analysis)..." : ""}
          className="flex-1 min-w-[160px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Quick-add suggestions for empty state */}
      {skills.length === 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {["Research", "Reporting", "Data Analysis", "Communication", "Planning"].map((s) => (
            <button
              key={s}
              onClick={() => setSkills([...skills, s])}
              className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center gap-0.5"
            >
              <Plus className="w-2.5 h-2.5" />{s}
            </button>
          ))}
        </div>
      )}

      {saveMutation.isError && (
        <p className="text-[11px] text-destructive flex items-center gap-1 mt-2">
          <AlertCircle className="w-3.5 h-3.5" />Save failed — please try again
        </p>
      )}
    </Card>
  );
}

// ── Soul / Personality ──────────────────────────────────
function SoulSection({ agent }: { agent: AgentDetail }) {
  const [soul, setSoul] = useState(agent.soul ?? "");
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/agents/${agent.id}`, { soul: soul || null });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agent.id] });
      triggerOpenClawSync();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  return (
    <Card className="p-4 border-card-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-primary" />Soul / Personality
          </h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Full personality prompt, instructions, and behavioral rules for this agent.
            Stored in the database — never overwritten by script updates.
          </p>
        </div>
        <Button size="sm" className="text-xs h-7" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saved ? "Saved!" : "Save Soul"}
        </Button>
      </div>
      <Textarea
        value={soul}
        onChange={(e) => setSoul(e.target.value)}
        placeholder={`# ${agent.name} Agent\n\nYour role: ${agent.role}\n\nDescribe personality, tone, decision rules, escalation triggers...`}
        className="font-mono text-xs min-h-[220px] resize-y"
      />
      {saveMutation.isError && (
        <p className="text-[11px] text-destructive flex items-center gap-1 mt-2">
          <AlertCircle className="w-3.5 h-3.5" />Save failed — please try again
        </p>
      )}
    </Card>
  );
}

// ── Model Routing ───────────────────────────────────────
function ModelRoutingSection({ agent }: { agent: AgentDetail }) {
  const [raw, setRaw] = useState(agent.model_config ? JSON.stringify(agent.model_config, null, 2) : "");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const model_config = raw.trim() ? JSON.parse(raw) : null;
      const res = await apiRequest("PATCH", `/api/agents/${agent.id}`, { model_config });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agent.id] });
      setParseError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  function handleSave() {
    if (raw.trim()) {
      try { JSON.parse(raw); } catch { setParseError("Invalid JSON — fix syntax before saving"); return; }
    }
    setParseError(null);
    saveMutation.mutate();
  }

  const EXAMPLES = [
    { label: "Claude Opus (Anthropic)", value: { provider: "anthropic", model: "claude-opus-4-6" } },
    { label: "GPT-4o (OpenAI)", value: { provider: "openai", model: "gpt-4o" } },
    { label: "Llama 3.2 (Ollama — local)", value: { provider: "ollama", model: "llama3.2:latest", base_url: "http://localhost:11434" } },
    { label: "OpenRouter auto-routing", value: { provider: "openrouter", model: "auto", tier: 2 } },
  ];

  return (
    <Card className="p-4 border-card-border">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium">Model Routing</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Per-agent AI provider and model override. Supports Anthropic, OpenAI, OpenRouter, and Ollama (local).
            Leave blank to use global settings.
          </p>
        </div>
        <Button size="sm" className="text-xs h-7" onClick={handleSave} disabled={saveMutation.isPending || !!parseError}>
          <Save className="w-3.5 h-3.5 mr-1" />
          {saved ? "Saved!" : "Save Config"}
        </Button>
      </div>

      {/* Quick-fill examples */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => { setRaw(JSON.stringify(ex.value, null, 2)); setParseError(null); }}
            className="text-[10px] px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <Textarea
        value={raw}
        onChange={(e) => { setRaw(e.target.value); setParseError(null); }}
        placeholder={'{\n  "provider": "openrouter",\n  "model": "auto",\n  "tier": 2\n}'}
        className="font-mono text-xs min-h-[120px] resize-y"
      />
      {parseError && (
        <p className="text-[11px] text-destructive flex items-center gap-1 mt-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{parseError}
        </p>
      )}
      {saveMutation.isError && !parseError && (
        <p className="text-[11px] text-destructive flex items-center gap-1 mt-2">
          <AlertCircle className="w-3.5 h-3.5" />Save failed — please try again
        </p>
      )}
    </Card>
  );
}

// ── Chat Tab — live chat with the agent via OpenClaw CLI ─
type ChatMessage = { role: "user" | "assistant"; content: string };

// Slash commands available in chat
const SLASH_COMMANDS = [
  { cmd: "/new",   desc: "Start a fresh conversation" },
  { cmd: "/clear", desc: "Clear chat history" },
];

function ChatTab({ agent }: { agent: AgentDetail }) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (text: string) => {
      const outgoing: ChatMessage[] = [...messages, { role: "user", content: text }];
      const res = await apiRequest("POST", `/api/agents/${agent.id}/chat`, { messages: outgoing });
      const data = await res.json();
      return { outgoing, reply: data.text || data.error || "No response" };
    },
    onSuccess: ({ outgoing, reply }) => {
      setMessages([...outgoing, { role: "assistant", content: reply }]);
      // CEO may have spawned agents during this turn — sync to pick them up
      triggerOpenClawSync();
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    setInput("");
    setShowSlash(false);
    // Handle slash commands client-side
    if (text === "/new") {
      setMessages([]);
      return;
    }
    if (text === "/clear") {
      setMessages([]);
      return;
    }
    chatMutation.mutate(text);
  };

  return (
    <Card className="p-4">
      <div className="flex flex-col" style={{ height: 420 }}>
        <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-1">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-10 opacity-60">
              Send a message to chat with {agent.name}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted px-3 py-2 rounded-lg text-xs text-muted-foreground animate-pulse">
                {agent.name} is thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div className="relative flex gap-2">
          {/* Slash-command tooltip — shown when input is focused and starts with / or is empty on focus */}
          {showSlash && (
            <div className="absolute bottom-10 right-0 z-10 bg-popover border border-border rounded-md shadow-md p-1 min-w-[200px]">
              {SLASH_COMMANDS
                .filter(c => !input || c.cmd.startsWith(input))
                .map(c => (
                  <button
                    key={c.cmd}
                    className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent flex gap-2 items-center"
                    onMouseDown={(e) => { e.preventDefault(); setInput(c.cmd); setShowSlash(false); }}
                  >
                    <span className="font-mono text-primary">{c.cmd}</span>
                    <span className="text-muted-foreground">{c.desc}</span>
                  </button>
                ))}
            </div>
          )}
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSlash(e.target.value.startsWith("/"));
            }}
            onFocus={() => { if (!input) setShowSlash(true); }}
            onBlur={() => setTimeout(() => setShowSlash(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setShowSlash(false); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={`Message ${agent.name}… (/ for commands)`}
            className="text-xs h-8"
            disabled={chatMutation.isPending}
          />
          <Button size="sm" onClick={send} disabled={!input.trim() || chatMutation.isPending} className="h-8 px-3">
            <MessageCircle className="w-3.5 h-3.5" />
          </Button>
        </div>
        {chatMutation.isError && (
          <p className="text-[11px] text-destructive mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Chat failed — check OpenClaw is installed and a provider is configured.
          </p>
        )}
      </div>
    </Card>
  );
}

// ── Token Usage Tab ─────────────────────────────────────
const TOKEN_PERIODS = [
  { value: "today", label: "Today" },
  { value: "week",  label: "7 Days" },
  { value: "month", label: "30 Days" },
  { value: "all",   label: "All Time" },
];

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function TokensTab({ agentId }: { agentId: number }) {
  const [period, setPeriod] = useState("month");

  const { data, isLoading } = useQuery<{
    agentId: number; period: string;
    totalTokens: number; totalCost: number;
    daily: { date: string; tokens: number; cost: number }[];
    byModel: { model: string; tokens: number; cost: number }[];
  }>({
    queryKey: ["/api/agents", agentId, "costs", period],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agents/${agentId}/costs?period=${period}`);
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {TOKEN_PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
              period === p.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.totalTokens === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <Zap className="w-6 h-6 opacity-30" />
          <p className="text-sm">No usage recorded for this period</p>
          <p className="text-xs">Chat with this agent to generate token usage data.</p>
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3 border-card-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Tokens</p>
              <p className="text-xl font-bold tabular-nums text-yellow-400">{formatTokens(data.totalTokens)}</p>
            </Card>
            <Card className="p-3 border-card-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Estimated Cost</p>
              <p className="text-xl font-bold tabular-nums text-primary">${data.totalCost.toFixed(4)}</p>
            </Card>
          </div>

          {/* Daily token chart */}
          {data.daily.length > 0 && (
            <Card className="p-4 border-card-border">
              <h3 className="text-xs font-semibold mb-3">Daily Token Usage</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217,14%,18%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(215,12%,55%)" }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(215,12%,55%)" }} tickFormatter={formatTokens} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(220,14%,12%)", border: "1px solid hsl(217,14%,18%)", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(v: number) => [formatTokens(v) + " tokens", "Tokens"]}
                  />
                  <Bar dataKey="tokens" radius={[3, 3, 0, 0]} fill="hsl(173,58%,44%)" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Model breakdown */}
          {data.byModel.length > 0 && (
            <Card className="p-4 border-card-border">
              <h3 className="text-xs font-semibold mb-3">Model Breakdown</h3>
              <div className="divide-y divide-border/50">
                <div className="grid grid-cols-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Model</span>
                  <span className="text-right">Tokens</span>
                  <span className="text-right">Cost</span>
                </div>
                {data.byModel.map((row, i) => (
                  <div key={i} className="grid grid-cols-3 py-1.5 text-xs items-center">
                    <span className="font-mono text-[10px] text-muted-foreground truncate pr-2">{row.model}</span>
                    <span className="text-right tabular-nums">{formatTokens(row.tokens)}</span>
                    <span className="text-right tabular-nums font-medium">${row.cost.toFixed(6)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Voice Chat — Coming Soon placeholder ────────────────
function VoiceSection({ agent }: { agent: AgentDetail }) {
  // voice_config lives inside model_config.voice when built out.
  // Placeholder surfaces the roadmap for customers evaluating the product.
  const voiceConfig = agent.model_config?.voice ?? null;

  return (
    <Card className="p-4 border-card-border border-dashed opacity-75">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Mic className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium">Voice Chat</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
              Coming Soon
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Give each agent a unique voice. Configure text-to-speech provider (ElevenLabs, OpenAI TTS, or local Piper),
            speaking style, speed, and wake-word so users can interact with agents via voice commands.
            Voice config will be stored here in the database alongside the agent soul.
          </p>
          {voiceConfig && (
            <pre className="mt-2 text-[10px] font-mono bg-muted rounded p-2 text-muted-foreground">
              {JSON.stringify(voiceConfig, null, 2)}
            </pre>
          )}
          <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-muted-foreground">
            {["ElevenLabs TTS", "OpenAI TTS", "Piper (local)", "Wake Word", "STT (Whisper)", "Voice Persona"].map((f) => (
              <span key={f} className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />{f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Bootstrap Files — SOUL.md, IDENTITY.md, etc. ────────
interface BootstrapFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

function BootstrapFilesTab({ agent }: { agent: AgentDetail }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const openclawId = agent.openclaw_id || "main";

  const { data: filesData } = useQuery<{ basePath: string; files: BootstrapFile[] }>({
    queryKey: ["/api/openclaw/files", openclawId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/openclaw/files?agent=${openclawId}`);
      return res.json();
    },
  });

  const { data: fileContent, isLoading: loadingFile } = useQuery<{ filename: string; content: string; path: string | null }>({
    queryKey: ["/api/openclaw/files", selectedFile, openclawId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/openclaw/files/${selectedFile}?agent=${openclawId}`);
      return res.json();
    },
    enabled: !!selectedFile,
  });

  // When file content loads, set it in the editor
  const lastLoaded = useRef("");
  if (fileContent && fileContent.filename === selectedFile && fileContent.content !== lastLoaded.current) {
    lastLoaded.current = fileContent.content;
    setContent(fileContent.content);
    setDirty(false);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/openclaw/files/${selectedFile}?agent=${openclawId}`, { content });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/openclaw/files"] });
      lastLoaded.current = content;
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const files = filesData?.files || [];
  const fileDescriptions: Record<string, string> = {
    "SOUL.md": "Agent personality, instructions, and behavioral rules",
    "IDENTITY.md": "Who the agent is — name, role, capabilities summary",
    "AGENTS.md": "Known agents and delegation routing rules",
    "TOOLS.md": "Available tools and usage guidelines",
    "HEARTBEAT.md": "Periodic health check instructions",
    "USER.md": "User preferences and communication style",
    "MEMORY.md": "Persistent facts and learned context",
  };

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      {/* File list */}
      <div className="space-y-1">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2 px-2">OpenClaw Files</p>
        {["SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md", "USER.md", "MEMORY.md"].map((fname) => {
          const exists = files.some(f => f.name === fname);
          const isActive = selectedFile === fname;
          return (
            <button
              key={fname}
              onClick={() => { setSelectedFile(fname); setDirty(false); }}
              className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between transition-colors ${isActive ? "bg-teal-500/15 text-teal-400" : "hover:bg-accent/50 text-foreground"}`}
            >
              <span className="font-mono">{fname}</span>
              {exists ? (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="File exists" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" title="Not created yet" />
              )}
            </button>
          );
        })}
        <div className="pt-2 px-2">
          <p className="text-[9px] text-muted-foreground">
            Agent: <span className="font-mono text-foreground">{openclawId}</span>
          </p>
          {filesData?.basePath && (
            <p className="text-[9px] text-muted-foreground truncate" title={filesData.basePath}>
              {filesData.basePath}
            </p>
          )}
        </div>
      </div>

      {/* Editor */}
      <div>
        {!selectedFile ? (
          <Card className="p-8 border-card-border text-center">
            <FolderOpen className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground">Select a file to view or edit</p>
            <p className="text-[10px] text-muted-foreground mt-1">These files control how OpenClaw configures this agent at runtime</p>
          </Card>
        ) : (
          <Card className="p-4 border-card-border">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-mono font-semibold">{selectedFile}</h3>
                <p className="text-[10px] text-muted-foreground">{fileDescriptions[selectedFile] || "OpenClaw bootstrap file"}</p>
              </div>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-[10px] text-amber-400">Unsaved changes</span>}
                <Button size="sm" className="text-xs h-7" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !dirty}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {saved ? "Saved!" : "Save"}
                </Button>
              </div>
            </div>
            {loadingFile ? (
              <Skeleton className="h-[300px]" />
            ) : (
              <Textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                placeholder={`# ${selectedFile}\n\nThis file will be created when you save.`}
                className="font-mono text-xs min-h-[350px] resize-y"
              />
            )}
            {saveMutation.isError && (
              <p className="text-[11px] text-destructive flex items-center gap-1 mt-2">
                <AlertCircle className="w-3.5 h-3.5" />Save failed — check file permissions
              </p>
            )}
            {!fileContent?.path && !loadingFile && (
              <p className="text-[10px] text-muted-foreground mt-2">
                This file doesn't exist yet. It will be created when you save.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
