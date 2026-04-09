import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
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
import { Skeleton } from "@/components/ui/skeleton";
import type { Task, DashboardStats } from "@shared/schema";
import { Plus, GripVertical, Trash2, Edit2, Zap, Users, DollarSign, CheckCircle2, Terminal, X, Brain } from "lucide-react";
import { SiDiscord, SiWhatsapp } from "react-icons/si";

const columns = [
  { id: "backlog", label: "Backlog", color: "bg-muted-foreground" },
  { id: "doing", label: "Doing", color: "bg-yellow-500" },
  { id: "done", label: "Done", color: "bg-emerald-500" },
];

const priorityColors: Record<string, string> = {
  low: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  high: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  critical: "bg-red-500/15 text-red-400 border-red-500/20",
};

// ── Live output hook ──────────────────────────────────────
function useLiveOutput(taskId: number | null) {
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!taskId) { setOutput(""); setDone(false); return; }
    setOutput(""); setDone(false);
    const es = new EventSource(`/api/tasks/${taskId}/live`);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.done) { setDone(true); es.close(); }
      else if (d.replay) setOutput(d.chunk);
      else setOutput(prev => prev + d.chunk);
    };
    es.onerror = () => { setDone(true); es.close(); };
    return () => es.close();
  }, [taskId]);

  return { output, done };
}

// ── Live output panel ─────────────────────────────────────
function LivePanel({ tasks, agents }: { tasks: any[]; agents: any[] }) {
  const activeTasks = tasks.filter(t => t.status === "doing" && t.agent_id);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-select first active task
  useEffect(() => {
    if (activeTasks.length > 0 && (!selectedId || !activeTasks.find(t => t.id === selectedId))) {
      setSelectedId(activeTasks[0].id);
    }
    if (activeTasks.length === 0) setSelectedId(null);
  }, [activeTasks.map(t => t.id).join(",")]);

  const { output, done } = useLiveOutput(selectedId);

  // Auto-scroll to bottom as output grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  if (activeTasks.length === 0) {
    return (
      <div className="w-72 shrink-0 flex flex-col border border-border rounded-lg bg-card/50">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Output</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">No active tasks</p>
        </div>
      </div>
    );
  }

  const activeAgent = agents.find(a => a.id === tasks.find(t => t.id === selectedId)?.agent_id);

  return (
    <div className="w-72 shrink-0 flex flex-col border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Terminal className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider">Live Output</span>
        {!done && <span className="ml-auto flex items-center gap-1 text-[10px] text-yellow-400">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />running
        </span>}
        {done && <span className="ml-auto text-[10px] text-emerald-400">done</span>}
      </div>
      {/* Task tabs if multiple active */}
      {activeTasks.length > 1 && (
        <div className="flex gap-1 px-2 py-1 border-b border-border overflow-x-auto shrink-0">
          {activeTasks.map(t => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              className={`px-2 py-0.5 text-[10px] rounded whitespace-nowrap transition-colors ${
                selectedId === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {t.title.slice(0, 20)}
            </button>
          ))}
        </div>
      )}
      {/* Active task + agent label */}
      {activeAgent && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 shrink-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: activeAgent.avatar_color }} />
          <span className="text-[11px] text-muted-foreground truncate">{activeAgent.name} — {tasks.find(t => t.id === selectedId)?.title}</span>
        </div>
      )}
      {/* Scrolling output */}
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed text-muted-foreground bg-black/20 min-h-0">
        {output
          ? output.split("\n").map((line, i) => <div key={i} className="whitespace-pre-wrap break-all">{line || "\u00a0"}</div>)
          : <div className="text-muted-foreground/50 italic">Waiting for output…</div>
        }
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
    refetchInterval: 5000, // Dashboard is the command center — fast live sync
  });
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/stats"],
    refetchInterval: 10000,
  });
  const { data: agents } = useAgents();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const moveMutation = useMutation({
    mutationFn: async ({ id, status, position }: { id: number; status: string; position: number }) => {
      await apiRequest("PATCH", `/api/tasks/${id}/move`, { status, position });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Task deleted" });
    },
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const taskId = parseInt(draggableId);
    moveMutation.mutate({
      id: taskId,
      status: destination.droppableId,
      position: destination.index,
    });
  };

  const getColumnTasks = (status: string) =>
    (tasks || []).filter((t) => t.status === status).sort((a, b) => a.position - b.position);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="mb-6"><Skeleton className="h-8 w-48" /></div>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6" data-testid="page-dashboard">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Task Board</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Drag tasks between columns to update status</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-task">
              <Plus className="w-4 h-4 mr-1" /> New Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Task</DialogTitle></DialogHeader>
            <TaskForm agents={agents || []} onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <KpiChip icon={Zap} label="In Progress" value={stats.tasksByStatus.doing} color="text-yellow-400" bg="bg-yellow-500/10" />
          <KpiChip icon={CheckCircle2} label="Done Today" value={stats.tasksByStatus.done} color="text-emerald-400" bg="bg-emerald-500/10" />
          <KpiChip icon={Users} label="Active Agents" value={stats.activeAgents} color="text-blue-400" bg="bg-blue-500/10" />
          <KpiChip icon={Brain} label="Context Usage" value={`${stats.contextUsagePercent ?? 0}%`} color="text-purple-400" bg="bg-purple-500/10" />
          {(stats.todayTokens > 0 || stats.todayCost > 0) ? (
            <KpiChip icon={DollarSign} label="Today's Cost" value={`$${stats.todayCost.toFixed(4)}`} color="text-primary" bg="bg-primary/10" />
          ) : (
            <KpiChip icon={DollarSign} label="Total Tasks" value={stats.totalTasks} color="text-muted-foreground" bg="bg-muted" />
          )}
        </div>
      )}

      <div className="flex gap-4 min-h-[calc(100vh-220px)]">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex-1 grid grid-cols-3 gap-4">
          {columns.map((col) => (
            <div key={col.id} className="flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`w-2 h-2 rounded-full ${col.color}`} />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {col.label}
                </span>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-auto">
                  {getColumnTasks(col.id).length}
                </Badge>
              </div>
              <Droppable droppableId={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex-1 space-y-2 p-2 rounded-lg transition-colors min-h-[100px] ${
                      snapshot.isDraggingOver ? "bg-primary/5 border border-primary/20" : "bg-card/50 border border-transparent"
                    }`}
                    data-testid={`column-${col.id}`}
                  >
                    {getColumnTasks(col.id).map((task, index) => (
                      <Draggable key={task.id} draggableId={String(task.id)} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            data-testid={`task-card-${task.id}`}
                          >
                            <Card
                              className={`p-3 border-card-border bg-card ${
                                snapshot.isDragging ? "shadow-lg ring-1 ring-primary/30" : ""
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                <div {...provided.dragHandleProps} className="mt-0.5 cursor-grab text-muted-foreground">
                                  <GripVertical className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <Badge className={`text-[10px] px-1.5 h-4 border ${priorityColors[task.priority]}`}>
                                      {task.priority}
                                    </Badge>
                                    {task.notify_discord && <SiDiscord className="w-3 h-3 text-indigo-400" />}
                                    {task.notify_whatsapp && <SiWhatsapp className="w-3 h-3 text-emerald-400" />}
                                  </div>
                                  <p className="text-xs font-medium leading-snug mb-1">{task.title}</p>
                                  {task.agent_id && agents && (
                                    <div className="flex items-center gap-1 mt-1.5">
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: agents.find((a) => a.id === task.agent_id)?.avatar_color }}
                                      />
                                      <span className="text-[10px] text-muted-foreground">
                                        {agents.find((a) => a.id === task.agent_id)?.name}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex gap-0.5 shrink-0">
                                  <button
                                    onClick={() => setEditTask(task)}
                                    className="p-1 rounded hover:bg-accent text-muted-foreground"
                                    data-testid={`button-edit-task-${task.id}`}
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => deleteMutation.mutate(task.id)}
                                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                    data-testid={`button-delete-task-${task.id}`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </Card>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Live output panel */}
      <LivePanel tasks={tasks || []} agents={agents || []} />
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTask} onOpenChange={(o) => !o && setEditTask(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
          {editTask && <TaskForm task={editTask} agents={agents || []} onClose={() => setEditTask(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiChip({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: number | string; color: string; bg: string }) {
  return (
    <Card className="p-3 border-card-border flex items-center gap-2.5">
      <div className={`p-1.5 rounded-lg ${bg} ${color} shrink-0`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
        <p className={`text-base font-bold tabular-nums leading-tight ${color}`}>{value}</p>
      </div>
    </Card>
  );
}

function TaskForm({ task, agents, onClose }: { task?: Task; agents: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [agentId, setAgentId] = useState(task?.agent_id?.toString() || "none");
  const [status, setStatus] = useState(task?.status || "backlog");
  const [discord, setDiscord] = useState(task?.notify_discord || false);
  const [whatsapp, setWhatsapp] = useState(task?.notify_whatsapp || false);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        description: description || null,
        priority,
        agent_id: agentId !== "none" ? parseInt(agentId) : null,
        status,
        notify_discord: discord,
        notify_whatsapp: whatsapp,
      };
      if (task) {
        await apiRequest("PATCH", `/api/tasks/${task.id}`, body);
      } else {
        await apiRequest("POST", "/api/tasks", body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
      toast({ title: task ? "Task updated" : "Task created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title..."
          data-testid="input-task-title"
        />
      </div>
      <div>
        <Label className="text-xs">Description</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          rows={3}
          data-testid="input-task-description"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Assigned Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger data-testid="select-task-agent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {task && (
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="backlog">Backlog</SelectItem>
              <SelectItem value="doing">Doing</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch checked={discord} onCheckedChange={setDiscord} data-testid="switch-discord" />
          <Label className="text-xs flex items-center gap-1"><SiDiscord className="w-3 h-3" /> Discord</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={whatsapp} onCheckedChange={setWhatsapp} data-testid="switch-whatsapp" />
          <Label className="text-xs flex items-center gap-1"><SiWhatsapp className="w-3 h-3" /> WhatsApp</Label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate()}
          disabled={!title.trim() || mutation.isPending}
          data-testid="button-submit-task"
        >
          {mutation.isPending ? "Saving..." : task ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  );
}
