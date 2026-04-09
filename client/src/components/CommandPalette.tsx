import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Agent } from "@shared/schema";
import {
  LayoutDashboard, FolderOpen, ShieldCheck, Calendar, Users, FileText,
  BarChart3, Activity, TerminalSquare, Settings, Search, Bot,
  ArrowRight, Command,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: any;
  action: () => void;
  category: "page" | "agent" | "action";
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: open,
  });

  // Build command list
  const commands: CommandItem[] = [];

  // Pages
  const pages = [
    { path: "/", label: "Dashboard", icon: LayoutDashboard },
    { path: "/projects", label: "Projects", icon: FolderOpen },
    { path: "/approvals", label: "Approvals", icon: ShieldCheck },
    { path: "/calendar", label: "Calendar", icon: Calendar },
    { path: "/org-chart", label: "Org Chart", icon: Users },
    { path: "/reports", label: "Reports", icon: FileText },
    { path: "/analytics", label: "Analytics", icon: BarChart3 },
    { path: "/activity", label: "Activity Feed", icon: Activity },
    { path: "/terminal", label: "Terminal", icon: TerminalSquare },
    { path: "/settings", label: "Settings", icon: Settings },
  ];

  for (const p of pages) {
    commands.push({
      id: `page-${p.path}`,
      label: p.label,
      sublabel: "Go to page",
      icon: p.icon,
      action: () => { navigate(p.path); setOpen(false); },
      category: "page",
    });
  }

  // Agents
  if (agents) {
    for (const a of agents) {
      commands.push({
        id: `agent-${a.id}`,
        label: a.name,
        sublabel: a.role,
        icon: Bot,
        action: () => { navigate(`/agents/${a.id}`); setOpen(false); },
        category: "agent",
      });
    }
  }

  // Filter
  const q = query.toLowerCase();
  const filtered = q
    ? commands.filter(c => c.label.toLowerCase().includes(q) || (c.sublabel || "").toLowerCase().includes(q))
    : commands;

  // Keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery("");
        setSelected(0);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Arrow key navigation
  const handleKeyNav = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filtered[selected]) {
      e.preventDefault();
      filtered[selected].action();
    }
  }, [filtered, selected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg bg-[hsl(220,16%,10%)] border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyNav}
            placeholder="Search pages, agents, actions..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] text-muted-foreground bg-accent px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results found
            </div>
          ) : (
            <>
              {/* Group by category */}
              {(["page", "agent", "action"] as const).map(cat => {
                const items = filtered.filter(c => c.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {cat === "page" ? "Pages" : cat === "agent" ? "Agents" : "Actions"}
                    </div>
                    {items.map((item, i) => {
                      const globalIndex = filtered.indexOf(item);
                      const isSelected = globalIndex === selected;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          onClick={item.action}
                          onMouseEnter={() => setSelected(globalIndex)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isSelected ? "bg-teal-500/10 text-teal-400" : "hover:bg-accent/50"}`}
                        >
                          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm">{item.label}</span>
                            {item.sublabel && <span className="text-xs text-muted-foreground ml-2">{item.sublabel}</span>}
                          </div>
                          {isSelected && <ArrowRight className="w-3 h-3 text-teal-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="bg-accent px-1 py-0.5 rounded font-mono">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-accent px-1 py-0.5 rounded font-mono">↵</kbd> Open</span>
          <span className="flex items-center gap-1"><kbd className="bg-accent px-1 py-0.5 rounded font-mono">ESC</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
