import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAgents } from "@/hooks/use-agents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { Report } from "@shared/schema";
import { Plus, Search, FileText, Clock, Loader2, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";

const statusIcons: Record<string, any> = {
  generating: Loader2,
  complete: CheckCircle,
  error: AlertCircle,
};

const statusColors: Record<string, string> = {
  generating: "text-yellow-400 bg-yellow-500/15",
  complete: "text-emerald-400 bg-emerald-500/15",
  error: "text-red-400 bg-red-500/15",
};

export default function Reports() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: agents } = useAgents();
  const { toast } = useToast();

  const { data: reports, isLoading } = useQuery<Report[]>({
    queryKey: ["/api/reports"],
    refetchInterval: 30000,
  });

  const filteredReports = (reports || []).filter((r) => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.content?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const types = [...new Set((reports || []).map((r) => r.type))];

  if (selectedReport) {
    return <ReportDetail id={selectedReport} onBack={() => setSelectedReport(null)} agents={agents || []} />;
  }

  return (
    <div className="p-6" data-testid="page-reports">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Agent-generated reports and analysis</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-create-report">
              <Plus className="w-4 h-4 mr-1" /> New Report
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Report</DialogTitle></DialogHeader>
            <ReportForm agents={agents || []} onClose={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search reports..."
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-reports"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-report-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-report-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="generating">Generating</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No reports found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report) => {
            const StatusIcon = statusIcons[report.status] || FileText;
            const agentName = agents?.find((a) => a.id === report.agent_id)?.name;
            const agentColor = agents?.find((a) => a.id === report.agent_id)?.avatar_color;
            return (
              <Card
                key={report.id}
                className="p-3 border-card-border cursor-pointer hover:border-primary/20 transition-colors"
                onClick={() => setSelectedReport(report.id)}
                data-testid={`report-card-${report.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-1.5 rounded ${statusColors[report.status]}`}>
                    <StatusIcon className={`w-4 h-4 ${report.status === "generating" ? "animate-spin" : ""}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{report.title}</span>
                      <Badge variant="secondary" className="text-[10px] h-4">{report.type}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {agentName && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: agentColor }} />
                          {agentName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(report.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    {report.tags.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {report.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] h-4 px-1.5">{tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportDetail({ id, onBack, agents }: { id: number; onBack: () => void; agents: any[] }) {
  // Use cached report from the list if available — no skeleton needed
  const cachedReports = queryClient.getQueryData<Report[]>(["/api/reports"]);
  const cachedReport = cachedReports?.find(r => r.id === id);

  const { data: report, isLoading } = useQuery<Report>({
    queryKey: ["/api/reports", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/reports/${id}`);
      return res.json();
    },
    initialData: cachedReport,
  });

  if (!report && isLoading) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }
  if (!report) {
    return <div className="p-6"><p className="text-sm text-muted-foreground">Report not found.</p></div>;
  }

  const agentName = agents?.find((a: any) => a.id === report.agent_id)?.name;

  return (
    <div className="p-6 max-w-3xl" data-testid="report-detail">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4" data-testid="button-back-reports">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Reports
      </button>
      <div className="mb-4">
        <h1 className="text-xl font-semibold mb-2">{report.title}</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">{report.type}</Badge>
          <Badge className={`text-[10px] ${statusColors[report.status]}`}>{report.status}</Badge>
          {agentName && <span>by {agentName}</span>}
          <span>{new Date(report.created_at).toLocaleString()}</span>
        </div>
      </div>
      {report.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{report.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function ReportForm({ agents, onClose }: { agents: any[]; onClose: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState("general");
  const [agentId, setAgentId] = useState("none");
  const [tags, setTags] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reports", {
        title,
        content: content || null,
        type,
        status: "complete",
        agent_id: agentId !== "none" ? parseInt(agentId) : null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Report created" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-report-title" />
      </div>
      <div>
        <Label className="text-xs">Content (Markdown)</Label>
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} data-testid="input-report-content" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Type</Label>
          <Input value={type} onChange={(e) => setType(e.target.value)} data-testid="input-report-type" />
        </div>
        <div>
          <Label className="text-xs">Agent</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {agents.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-xs">Tags (comma-separated)</Label>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="finance, quarterly" data-testid="input-report-tags" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!title.trim() || mutation.isPending} data-testid="button-submit-report">
          {mutation.isPending ? "Creating..." : "Create"}
        </Button>
      </div>
    </div>
  );
}
