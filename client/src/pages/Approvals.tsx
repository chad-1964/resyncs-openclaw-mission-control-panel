import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAgents } from "@/hooks/use-agents";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Approval } from "@shared/schema";
import {
  ShieldCheck, ShieldX, Clock, CheckCircle, XCircle, AlertTriangle,
  FileX, Globe, UserPlus, Calendar, DollarSign, Puzzle,
} from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pending:  { label: "Pending",  color: "text-amber-400 bg-amber-500/15",   icon: Clock },
  approved: { label: "Approved", color: "text-emerald-400 bg-emerald-500/15", icon: CheckCircle },
  rejected: { label: "Rejected", color: "text-red-400 bg-red-500/15",       icon: XCircle },
  expired:  { label: "Expired",  color: "text-zinc-400 bg-zinc-500/15",     icon: AlertTriangle },
};

const actionIcons: Record<string, any> = {
  file_delete: FileX,
  external_api: Globe,
  agent_create: UserPlus,
  schedule_modify: Calendar,
  cost_exceed: DollarSign,
  custom: Puzzle,
};

const actionLabels: Record<string, string> = {
  file_delete: "File Deletion",
  external_api: "External API Call",
  agent_create: "Agent Creation",
  schedule_modify: "Schedule Change",
  cost_exceed: "Cost Threshold",
  custom: "Custom Action",
};

export default function Approvals() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const { data: agents } = useAgents();
  const { toast } = useToast();

  const { data: allApprovals, isLoading } = useQuery<Approval[]>({
    queryKey: ["/api/approvals"],
    refetchInterval: 10000,
  });

  // Client-side filter — avoids cache key mismatch with prefetch
  const approvals = (allApprovals || []).filter(a =>
    statusFilter === "all" ? true : a.status === statusFilter
  );

  const decideMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: "approved" | "rejected" }) => {
      const res = await apiRequest("POST", `/api/approvals/${id}/decide`, { decision });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      toast({ title: `Request ${data.status}`, description: data.title });
    },
  });

  const agentName = (id: number | null) => {
    if (!id) return "System";
    return (agents as any)?.find((a: any) => a.id === id)?.name || `Agent #${id}`;
  };

  return (
    <div className="p-6" data-testid="page-approvals">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Approval Queue</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Review and approve agent actions that require human sign-off</p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      )}

      {!isLoading && (!approvals || approvals.length === 0) && (
        <div className="text-center py-16">
          <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm">
            {statusFilter === "pending"
              ? "No pending approvals. Agents are operating within their permissions."
              : "No approvals match this filter."}
          </p>
        </div>
      )}

      {!isLoading && approvals && approvals.length > 0 && (
        <div className="space-y-3">
          {approvals.map((approval) => {
            const StatusIcon = statusConfig[approval.status]?.icon || Clock;
            const ActionIcon = actionIcons[approval.action_type] || Puzzle;
            const isPending = approval.status === "pending";

            return (
              <Card key={approval.id} className={`p-4 border-card-border ${isPending ? "border-amber-500/30" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isPending ? "bg-amber-500/15" : "bg-accent"}`}>
                    <ActionIcon className={`w-5 h-5 ${isPending ? "text-amber-400" : "text-muted-foreground"}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium">{approval.title}</h3>
                      <Badge variant="outline" className={`text-[10px] ${statusConfig[approval.status]?.color || ""}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig[approval.status]?.label}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {actionLabels[approval.action_type]}
                      </Badge>
                    </div>

                    {approval.description && (
                      <p className="text-xs text-muted-foreground mb-2">{approval.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>From: {agentName(approval.agent_id)}</span>
                      <span>·</span>
                      <span>{new Date(approval.created_at).toLocaleString()}</span>
                      {approval.decided_by && (
                        <>
                          <span>·</span>
                          <span>Decided by: {approval.decided_by}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isPending && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => decideMutation.mutate({ id: approval.id, decision: "approved" })}
                        disabled={decideMutation.isPending}
                      >
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10"
                        onClick={() => decideMutation.mutate({ id: approval.id, decision: "rejected" })}
                        disabled={decideMutation.isPending}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
