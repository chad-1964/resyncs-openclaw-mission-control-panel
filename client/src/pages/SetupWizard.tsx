import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Database, Bot, MessageCircle, Users, Globe,
  CheckCircle2, ArrowRight, ArrowLeft, Eye, EyeOff,
  Loader2, Zap, Settings2, Rocket, ChevronDown, ChevronRight,
  AlertCircle, Check, Info, Key, Sparkles, Server, Lock,
  Search, Share2,
} from "lucide-react";
import {
  SiAnthropic, SiOpenai, SiGoogle, SiWhatsapp, SiTelegram,
  SiDiscord, SiSlack, SiOllama, SiSignal,
} from "react-icons/si";
import { FaXTwitter } from "react-icons/fa6";

// ── Types ─────────────────────────────────────────────────

interface ModelConfig {
  apiKey: string;
  orgId?: string;
  endpointUrl?: string;
  providerName?: string; // used by the "custom" provider card
  configured: boolean;
  tested: boolean;
  testStatus: "idle" | "testing" | "success" | "failed";
}

interface ChatProviderConfig {
  fields: Record<string, string>;
  configured: boolean;
}

interface WizardData {
  // Step 1: Database (skipped when ?installer=1 — PHP already configured DB)
  dbType: "mariadb" | "mysql" | "postgresql" | "sqlite";
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  dbTestStatus: "idle" | "testing" | "success" | "failed";
  dbTestMessage: string;
  dbDetectedType: "mariadb" | "mysql" | null;
  // Step 2: Admin
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminConfirmPassword: string;
  // Step 2: AI Models
  models: Record<string, ModelConfig>;
  // Step 4: Chat Providers
  chatProviders: Record<string, ChatProviderConfig>;
  // Step 5: Agent Configuration
  agentPreset: "business" | "development" | "seo" | "social" | "custom";
  // Step 6: Domain & SSL
  domain: string;
  autoSsl: boolean;
  httpPort: number;
  httpsPort: number;
  // Server info
  serverIp: string;
  serverHostname: string;
}

const STEPS = [
  { label: "Welcome",   icon: Zap },
  { label: "Database",  icon: Database },
  { label: "Admin",     icon: Shield },
  { label: "AI Models", icon: Bot },
  { label: "Chat",      icon: MessageCircle },
  { label: "Agents",    icon: Users },
  { label: "Domain",    icon: Globe },
  { label: "Review",    icon: CheckCircle2 },
];

const MODEL_DEFS = [
  {
    key: "anthropic",
    name: "Anthropic (Claude)",
    icon: SiAnthropic,
    iconColor: "#D4A574",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "sk-ant-api03-..." }],
  },
  {
    key: "openai",
    name: "OpenAI (GPT-4/5)",
    icon: SiOpenai,
    iconColor: "#ffffff",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-proj-..." },
      { key: "orgId", label: "Organization ID (optional)", placeholder: "org-xxxxxxxx" },
    ],
  },
  {
    key: "google",
    name: "Google (Gemini)",
    icon: SiGoogle,
    iconColor: "#4285F4",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "AIzaSy..." }],
  },
  {
    key: "xai",
    name: "xAI (Grok)",
    icon: FaXTwitter,
    iconColor: "#ffffff",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "xai-..." }],
  },
  {
    key: "perplexity",
    name: "Perplexity",
    icon: Bot,
    iconColor: "#20B8CD",
    fields: [{ key: "apiKey", label: "API Key", placeholder: "pplx-..." }],
  },
  {
    // OpenRouter — unified gateway to 200+ models (OpenAI-compatible API)
    key: "openrouter",
    name: "OpenRouter",
    icon: Sparkles,
    iconColor: "#6366F1",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "sk-or-v1-..." },
      { key: "endpointUrl", label: "Endpoint URL", placeholder: "https://openrouter.ai/api/v1" },
    ],
  },
  {
    key: "ollama",
    name: "Ollama (Local)",
    icon: SiOllama,
    iconColor: "#ffffff",
    fields: [{ key: "endpointUrl", label: "Endpoint URL", placeholder: "http://localhost:11434" }],
  },
  {
    // Generic fallback for any OpenAI-compatible provider not listed above
    // (e.g. Mistral, Groq, Cohere, Together AI, DeepSeek, etc.)
    key: "custom",
    name: "Custom / Other",
    icon: Settings2,
    iconColor: "#94A3B8",
    fields: [
      { key: "providerName", label: "Provider Name", placeholder: "e.g. Mistral, Groq, DeepSeek..." },
      { key: "endpointUrl", label: "API Endpoint URL", placeholder: "https://api.example.com/v1" },
      { key: "apiKey", label: "API Key", placeholder: "Your API key" },
    ],
  },
];

const CHAT_PROVIDER_DEFS = [
  {
    key: "whatsapp",
    name: "WhatsApp",
    icon: SiWhatsapp,
    iconColor: "#25D366",
    fields: [
      { key: "phoneNumberId", label: "Phone Number ID", placeholder: "1xxxxxxxxxx" },
      { key: "businessAccountId", label: "Business Account ID", placeholder: "1xxxxxxxxxx" },
      { key: "accessToken", label: "Access Token", placeholder: "EAAxxxxxxxxx...", secret: true },
    ],
  },
  {
    key: "telegram",
    name: "Telegram",
    icon: SiTelegram,
    iconColor: "#26A5E4",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456789:ABCdefGHI...", secret: true },
      { key: "chatId", label: "Chat ID", placeholder: "-1001234567890" },
    ],
  },
  {
    key: "discord",
    name: "Discord",
    icon: SiDiscord,
    iconColor: "#5865F2",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "MTxxxxxxxx...", secret: true },
      { key: "channelId", label: "Channel ID", placeholder: "123456789012345678" },
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/..." },
    ],
  },
  {
    key: "slack",
    name: "Slack",
    icon: SiSlack,
    iconColor: "#4A154B",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxx", secret: true },
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/..." },
    ],
  },
  {
    key: "signal",
    name: "Signal",
    icon: SiSignal,
    iconColor: "#3A76F0",
    fields: [
      { key: "signalCliUrl", label: "Signal CLI URL", placeholder: "http://localhost:8080" },
    ],
  },
];

const AGENT_PRESETS = {
  business: {
    label: "Business Operations",
    description: "Full business operations team for managing your company",
    icon: Sparkles,
    agents: ["CEO", "Operations", "Accountant", "Marketing", "Customer Success", "Market Intelligence"],
  },
  development: {
    label: "Development Team",
    description: "Complete development team for software projects",
    icon: Settings2,
    agents: ["Project Manager", "Frontend Dev", "Backend Dev", "QA Engineer", "DevOps", "Technical Writer"],
  },
  seo: {
    label: "SEO & Content",
    description: "SEO specialists for organic growth, keyword research, and content optimization",
    icon: Search,
    agents: ["CEO", "SEO Strategist", "Content Writer", "Market Intelligence"],
  },
  social: {
    label: "Social Media",
    description: "Content creation, scheduling, and engagement across social platforms",
    icon: Share2,
    agents: ["CEO", "Social Media Manager", "Creative Director", "Marketing"],
  },
  custom: {
    label: "Custom",
    description: "Start with an empty roster and add agents later",
    icon: Users,
    agents: [],
  },
};

function defaultWizardData(): WizardData {
  const models: Record<string, ModelConfig> = {};
  for (const m of MODEL_DEFS) {
    models[m.key] = {
      apiKey: "",
      orgId: "",
      endpointUrl: m.key === "ollama" ? "http://localhost:11434"
        : m.key === "openrouter" ? "https://openrouter.ai/api/v1"
        : "",
      configured: false,
      tested: false,
      testStatus: "idle",
    };
  }
  const chatProviders: Record<string, ChatProviderConfig> = {};
  for (const c of CHAT_PROVIDER_DEFS) {
    const fields: Record<string, string> = {};
    for (const f of c.fields) fields[f.key] = "";
    chatProviders[c.key] = { fields, configured: false };
  }
  return {
    dbType: "mariadb",
    dbHost: "localhost",
    dbPort: 3306,
    dbName: "",
    dbUser: "",
    dbPassword: "",
    dbTestStatus: "idle",
    dbTestMessage: "",
    dbDetectedType: null,
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    adminConfirmPassword: "",
    models,
    chatProviders,
    agentPreset: "business",
    domain: "",
    autoSsl: true,
    httpPort: 80,
    httpsPort: 443,
    serverIp: "",
    serverHostname: "",
  };
}

// ── Helpers ───────────────────────────────────────────────

function getPasswordStrength(pw: string): { level: number; label: string; color: string } {
  if (!pw) return { level: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { level: 1, label: "Weak", color: "bg-red-500" };
  if (score === 2) return { level: 2, label: "Fair", color: "bg-orange-500" };
  if (score === 3) return { level: 3, label: "Strong", color: "bg-yellow-500" };
  return { level: 4, label: "Excellent", color: "bg-emerald-500" };
}

// ── SecureInput Component ─────────────────────────────────

function SecureInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-xs pr-9 font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
        data-testid={testId}
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────

function StepProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="w-full px-4 sm:px-8 py-6" data-testid="step-progress-bar">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between relative">
          {/* Connecting line (background) */}
          <div className="absolute top-4 left-4 right-4 h-[2px] bg-[hsl(217,14%,15%)]" />
          {/* Connecting line (filled) */}
          <div
            className="absolute top-4 left-4 h-[2px] bg-primary transition-all duration-500 ease-out"
            style={{
              width: `calc(${(currentStep / (STEPS.length - 1)) * 100}% - 32px)`,
            }}
          />

          {STEPS.map((step, i) => {
            const Icon = step.icon;
            const isComplete = i < currentStep;
            const isCurrent = i === currentStep;
            return (
              <div
                key={step.label}
                className="flex flex-col items-center relative z-10"
                data-testid={`step-indicator-${i}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isComplete
                      ? "bg-primary text-primary-foreground"
                      : isCurrent
                        ? "bg-primary/20 text-primary border-2 border-primary"
                        : "bg-[hsl(217,14%,14%)] text-muted-foreground border border-[hsl(217,14%,20%)]"
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                </div>
                <span
                  className={`text-[10px] mt-1.5 font-medium transition-colors duration-300 hidden sm:block ${
                    isCurrent
                      ? "text-primary"
                      : isComplete
                        ? "text-foreground/70"
                        : "text-muted-foreground/50"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────

interface OpenClawDetection {
  installed: boolean;
  version: string | null;
  agents: { id: string; hasSoul: boolean; name?: string }[];
  providers: { provider: string; hasKey: boolean }[];
  gatewayToken: string | null;
  gatewayUrl: string;
}

function StepWelcome({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  const [detection, setDetection] = useState<OpenClawDetection | null>(null);
  const [detecting, setDetecting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/setup/detect-openclaw");
        const d = await res.json();
        setDetection(d);
      } catch { /* skip */ }
      setDetecting(false);
    })();
  }, []);

  return (
    <div className="text-center space-y-8" data-testid="step-welcome">
      {/* Animated logo */}
      <div className="relative inline-flex items-center justify-center">
        <div className="absolute inset-0 w-24 h-24 mx-auto rounded-full bg-primary/10 animate-pulse" />
        <div className="relative w-24 h-24 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
          <Zap className="w-12 h-12 text-primary" />
        </div>
      </div>

      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-welcome-heading">
          Welcome to Mission Control
        </h1>
        <p className="text-sm text-primary font-medium">
          Powered by OpenClaw — AI Agent Orchestration
        </p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          This wizard will guide you through setting up your AI command center.
          It takes about 5 minutes.
        </p>
      </div>

      {/* OpenClaw Auto-Detection */}
      <div className="max-w-sm mx-auto text-left">
        {detecting ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg border border-border/50">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Scanning for existing OpenClaw installation...
          </div>
        ) : detection?.installed ? (
          <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-2">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">OpenClaw detected!</span>
              {detection.version && <span className="text-[10px] text-muted-foreground">v{detection.version}</span>}
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1">
              {detection.agents.length > 0 && (
                <p>
                  <span className="text-foreground font-medium">{detection.agents.length}</span> agent{detection.agents.length !== 1 ? "s" : ""} found
                  {detection.agents.length <= 4 && (
                    <span className="text-muted-foreground"> — {detection.agents.map(a => a.name || a.id).join(", ")}</span>
                  )}
                </p>
              )}
              {detection.providers.length > 0 && (
                <p>
                  <span className="text-foreground font-medium">{detection.providers.length}</span> API key{detection.providers.length !== 1 ? "s" : ""} configured
                  <span className="text-muted-foreground"> — {detection.providers.map(p => p.provider).join(", ")}</span>
                </p>
              )}
            </div>
            <p className="text-[10px] text-emerald-400/70">
              Your existing agents and API keys will be auto-imported during setup.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg border border-border/50">
            <Info className="w-3.5 h-3.5" />
            No OpenClaw installation detected — we'll set one up for you.
          </div>
        )}
      </div>

    </div>
  );
}

// ── Step 1: Database ──────────────────────────────────────

function StepDatabase({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  const testConnection = async () => {
    onChange({ dbTestStatus: "testing", dbTestMessage: "", dbDetectedType: null });
    try {
      const body = { host: data.dbHost, port: data.dbPort, user: data.dbUser, password: data.dbPassword, database: data.dbName };
      const res = await apiRequest("POST", "/api/setup/test-db", body);
      const json = await res.json();
      if (json.success) {
        const detected = json.detectedType || "mariadb";
        onChange({ dbTestStatus: "success", dbTestMessage: json.message || "Connection successful", dbDetectedType: detected, dbType: detected });
      } else {
        onChange({ dbTestStatus: "failed", dbTestMessage: json.message || "Connection failed", dbDetectedType: null });
      }
    } catch (err: any) {
      onChange({ dbTestStatus: "failed", dbTestMessage: err.message || "Connection failed", dbDetectedType: null });
    }
  };

  return (
    <div className="space-y-6" data-testid="step-database">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Database Configuration
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure your database — or use built-in SQLite for zero-config setup
        </p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Server className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Database Type</p>
              <p className="text-[10px] text-muted-foreground">
                Select your DB engine — auto-detected after Test Connection
              </p>
            </div>
            {data.dbDetectedType && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                Auto-detected
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {([
              { key: "sqlite",  label: "SQLite",  sub: "Built-in / Zero config", port: 0 },
              { key: "mariadb", label: "MariaDB", sub: "10.x / 11.x", port: 3306 },
              { key: "mysql",   label: "MySQL",   sub: "5.7 / 8.x",   port: 3306 },
              { key: "postgresql", label: "PostgreSQL", sub: "Coming soon", port: 5432, disabled: true },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && onChange({
                  dbType: opt.key, dbPort: opt.port,
                  dbTestStatus: opt.key === "sqlite" ? "success" : "idle",
                  dbTestMessage: opt.key === "sqlite" ? "SQLite — no configuration needed" : "",
                })}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-xs transition-all ${
                  opt.disabled
                    ? "border-[hsl(217,14%,13%)] text-muted-foreground/40 cursor-not-allowed"
                    : data.dbType === opt.key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-[hsl(217,14%,18%)] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <span className="font-semibold">{opt.label}</span>
                <span className="text-[10px] opacity-60">{opt.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {data.dbType === "sqlite" && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-400 font-medium">SQLite — Zero Configuration</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Data will be stored locally in <code className="text-[10px] bg-[hsl(220,16%,5%)]/60 px-1 py-0.5 rounded">.data/mc.sqlite</code>.
              No database server required. Perfect for local development, testing, and single-server deployments.
              You can migrate to MariaDB or MySQL later from Settings.
            </p>
          </div>
        )}

        {data.dbType !== "sqlite" && (<>
        <div className="space-y-3 rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,16%,5%)]/40 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Host</Label>
              <Input type="text" value={data.dbHost} onChange={(e) => onChange({ dbHost: e.target.value })} placeholder="localhost"
                className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Port</Label>
              <Input type="number" value={data.dbPort} onChange={(e) => onChange({ dbPort: parseInt(e.target.value) || 3306 })} placeholder="3306"
                className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Database Name</Label>
            <Input type="text" value={data.dbName} onChange={(e) => onChange({ dbName: e.target.value })} placeholder="mission_control"
              className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Username</Label>
            <Input type="text" value={data.dbUser} onChange={(e) => onChange({ dbUser: e.target.value })} placeholder="root"
              className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Password</Label>
            <SecureInput value={data.dbPassword} onChange={(v) => onChange({ dbPassword: v })} placeholder="Database password" testId="input-db-password" />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="secondary" onClick={testConnection} disabled={data.dbTestStatus === "testing"} data-testid="button-test-db">
            {data.dbTestStatus === "testing" ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Testing...</>
            ) : (
              <><Database className="w-4 h-4" />Test Connection</>
            )}
          </Button>
          {data.dbTestStatus === "success" && (
            <Badge className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/25" data-testid="badge-db-success">
              <CheckCircle2 className="w-3 h-3 mr-1" />Connected
            </Badge>
          )}
          {data.dbTestStatus === "failed" && (
            <Badge variant="destructive" className="text-xs" data-testid="badge-db-failed">
              <AlertCircle className="w-3 h-3 mr-1" />Failed
            </Badge>
          )}
        </div>
        {data.dbTestMessage && data.dbTestStatus === "failed" && (
          <p className="text-[10px] text-red-400" data-testid="text-db-error">{data.dbTestMessage}</p>
        )}
        </>)}
      </div>
    </div>
  );
}

// ── Step 2: Admin Account ─────────────────────────────────

function StepAdmin({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  const strength = getPasswordStrength(data.adminPassword);
  const passwordsMatch =
    data.adminConfirmPassword.length > 0 &&
    data.adminPassword === data.adminConfirmPassword;
  const passwordsMismatch =
    data.adminConfirmPassword.length > 0 &&
    data.adminPassword !== data.adminConfirmPassword;

  return (
    <div className="space-y-6" data-testid="step-admin">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          Create Admin Account
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          This will be the primary administrator for Mission Control
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Full Name
          </Label>
          <Input
            type="text"
            value={data.adminName}
            onChange={(e) => onChange({ adminName: e.target.value })}
            placeholder="John Smith"
            className="text-sm bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
            data-testid="input-admin-name"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Email Address
          </Label>
          <Input
            type="email"
            value={data.adminEmail}
            onChange={(e) => onChange({ adminEmail: e.target.value })}
            placeholder="admin@yourcompany.com"
            className="text-sm bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
            data-testid="input-admin-email"
          />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Password
          </Label>
          <SecureInput
            value={data.adminPassword}
            onChange={(v) => onChange({ adminPassword: v })}
            placeholder="Minimum 8 characters"
            testId="input-admin-password"
          />
          {/* Password strength indicator */}
          {data.adminPassword.length > 0 && (
            <div className="mt-2 space-y-1" data-testid="password-strength">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      level <= strength.level
                        ? strength.color
                        : "bg-[hsl(217,14%,18%)]"
                    }`}
                  />
                ))}
              </div>
              <p
                className={`text-[10px] ${
                  strength.level <= 1
                    ? "text-red-400"
                    : strength.level === 2
                      ? "text-orange-400"
                      : strength.level === 3
                        ? "text-yellow-400"
                        : "text-emerald-400"
                }`}
              >
                {strength.label}
              </p>
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Confirm Password
          </Label>
          <SecureInput
            value={data.adminConfirmPassword}
            onChange={(v) => onChange({ adminConfirmPassword: v })}
            placeholder="Re-enter your password"
            testId="input-admin-confirm-password"
          />
          {passwordsMatch && (
            <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
              <Check className="w-3 h-3" /> Passwords match
            </p>
          )}
          {passwordsMismatch && (
            <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Passwords do not match
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: AI Models ─────────────────────────────────────

function ModelCard({
  def,
  config,
  onUpdate,
}: {
  def: (typeof MODEL_DEFS)[0];
  config: ModelConfig;
  onUpdate: (c: Partial<ModelConfig>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = def.icon;

  const hasValue = def.fields.some((f) => {
    const val = (config as any)[f.key];
    return val && val.trim().length > 0;
  });

  const testModel = async () => {
    onUpdate({ testStatus: "testing" });
    const t0 = Date.now();
    try {
      const res = await fetch("/api/setup/test-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: def.key, apiKey: config.apiKey, endpointUrl: config.endpointUrl }),
      });
      const json = await res.json();
      console.log(`[test-model] ${def.key}: ${Date.now() - t0}ms — ${json.success ? "OK" : "FAIL"}: ${json.message}`);
      if (json.success) {
        onUpdate({ testStatus: "success", tested: true, configured: true });
      } else {
        onUpdate({ testStatus: "failed" });
      }
    } catch (err: any) {
      console.log(`[test-model] ${def.key}: ${Date.now() - t0}ms — ERROR: ${err.message}`);
      onUpdate({ testStatus: "failed" });
    }
  };

  return (
    <div
      className={`rounded-lg border transition-all duration-200 overflow-hidden ${
        config.configured
          ? "border-primary/30 bg-primary/[0.03]"
          : "border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80"
      }`}
      data-testid={`model-card-${def.key}`}
    >
      <button
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid={`toggle-model-${def.key}`}
      >
        <span
          className="w-6 h-6 flex items-center justify-center shrink-0"
          style={{ color: def.iconColor }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <span className="text-sm font-medium flex-1">{def.name}</span>
        {config.configured && (
          <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/25 mr-2">
            <Check className="w-2.5 h-2.5 mr-1" />
            Ready
          </Badge>
        )}
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[hsl(217,14%,13%)]">
          <div className="pt-3 space-y-3">
            {def.fields.map((field) => (
              <div key={field.key}>
                <Label className="text-[11px] text-muted-foreground mb-1 block">
                  {field.label}
                </Label>
                {/* Plain text for non-secret fields; SecureInput for API keys */}
                {field.key === "orgId" || field.key === "providerName" ? (
                  <Input
                    type="text"
                    value={(config as any)[field.key] || ""}
                    onChange={(e) => onUpdate({ [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
                    data-testid={`input-model-${def.key}-${field.key}`}
                  />
                ) : field.key === "endpointUrl" ? (
                  <Input
                    type="url"
                    value={(config as any)[field.key] || ""}
                    onChange={(e) => onUpdate({ [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
                    data-testid={`input-model-${def.key}-${field.key}`}
                  />
                ) : (
                  <SecureInput
                    value={(config as any)[field.key] || ""}
                    onChange={(v) => onUpdate({ [field.key]: v })}
                    placeholder={field.placeholder}
                    testId={`input-model-${def.key}-${field.key}`}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={testModel}
              disabled={!hasValue || config.testStatus === "testing"}
              data-testid={`button-test-model-${def.key}`}
            >
              {config.testStatus === "testing" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  Test
                </>
              )}
            </Button>
            {config.testStatus === "success" && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Connection verified
              </span>
            )}
            {config.testStatus === "failed" && (
              <span className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Test failed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepModels({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  // Warm up HTTPS connection so first API test click is fast (no cold SSL negotiation)
  useEffect(() => {
    fetch("/api/setup/server-info", { method: "HEAD" }).catch(() => {});
  }, []);

  const updateModel = (key: string, update: Partial<ModelConfig>) => {
    onChange({
      models: {
        ...data.models,
        [key]: { ...data.models[key], ...update },
      },
    });
  };

  return (
    <div className="space-y-6" data-testid="step-models">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          Connect AI Models
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Connect at least one AI model to power your agents
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODEL_DEFS.map((def) => (
          <ModelCard
            key={def.key}
            def={def}
            config={data.models[def.key]}
            onUpdate={(u) => updateModel(def.key, u)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 4: Chat Providers ────────────────────────────────

function ChatProviderCard({
  def,
  config,
  onUpdate,
}: {
  def: (typeof CHAT_PROVIDER_DEFS)[0];
  config: ChatProviderConfig;
  onUpdate: (fields: Record<string, string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = def.icon;

  const hasAnyValue = Object.values(config.fields).some((v) => v.trim().length > 0);

  return (
    <div
      className={`rounded-lg border transition-all duration-200 overflow-hidden ${
        hasAnyValue
          ? "border-primary/30 bg-primary/[0.03]"
          : "border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80"
      }`}
      data-testid={`chat-card-${def.key}`}
    >
      <button
        className="flex items-center gap-3 w-full px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
        data-testid={`toggle-chat-${def.key}`}
      >
        <span
          className="w-6 h-6 flex items-center justify-center shrink-0"
          style={{ color: def.iconColor }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <span className="text-sm font-medium flex-1">{def.name}</span>
        {hasAnyValue && (
          <Badge className="text-[10px] bg-primary/15 text-primary border-primary/25 mr-2">
            Configured
          </Badge>
        )}
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[hsl(217,14%,13%)] pt-3">
          {def.fields.map((field) => (
            <div key={field.key}>
              <Label className="text-[11px] text-muted-foreground mb-1 block">
                {field.label}
              </Label>
              {field.secret ? (
                <SecureInput
                  value={config.fields[field.key] || ""}
                  onChange={(v) =>
                    onUpdate({ ...config.fields, [field.key]: v })
                  }
                  placeholder={field.placeholder}
                  testId={`input-chat-${def.key}-${field.key}`}
                />
              ) : (
                <Input
                  type="text"
                  value={config.fields[field.key] || ""}
                  onChange={(e) =>
                    onUpdate({ ...config.fields, [field.key]: e.target.value })
                  }
                  placeholder={field.placeholder}
                  className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
                  data-testid={`input-chat-${def.key}-${field.key}`}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepChat({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  const updateProvider = (key: string, fields: Record<string, string>) => {
    const configured = Object.values(fields).some((v) => v.trim().length > 0);
    onChange({
      chatProviders: {
        ...data.chatProviders,
        [key]: { fields, configured },
      },
    });
  };

  return (
    <div className="space-y-6" data-testid="step-chat">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          Chat Providers
          <Badge variant="secondary" className="text-[10px] ml-1">
            Optional
          </Badge>
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Connect messaging platforms for agent notifications
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {CHAT_PROVIDER_DEFS.map((def) => (
          <ChatProviderCard
            key={def.key}
            def={def}
            config={data.chatProviders[def.key]}
            onUpdate={(fields) => updateProvider(def.key, fields)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 5: Agent Configuration ───────────────────────────

function StepAgents({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  return (
    <div className="space-y-6" data-testid="step-agents">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Configure Your Agents
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose a preset team or customize your own
        </p>
      </div>

      <div className="space-y-3">
        {(Object.entries(AGENT_PRESETS) as [keyof typeof AGENT_PRESETS, (typeof AGENT_PRESETS)[keyof typeof AGENT_PRESETS]][]).map(
          ([key, preset]) => {
            const Icon = preset.icon;
            const isSelected = data.agentPreset === key;
            return (
              <button
                key={key}
                className={`w-full text-left rounded-lg border p-4 transition-all duration-200 ${
                  isSelected
                    ? "border-primary/40 bg-primary/[0.05] ring-1 ring-primary/20"
                    : "border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80 hover:bg-white/[0.02]"
                }`}
                onClick={() => onChange({ agentPreset: key as WizardData["agentPreset"] })}
                data-testid={`button-preset-${key}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-lg transition-colors ${
                      isSelected
                        ? "bg-primary/15 text-primary"
                        : "bg-[hsl(217,14%,14%)] text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{preset.label}</span>
                      {key === "business" && (
                        <Badge className="text-[9px] bg-primary/15 text-primary border-primary/25">
                          Recommended
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                    {preset.agents.length > 0 && isSelected && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {preset.agents.map((agent) => (
                          <Badge
                            key={agent}
                            variant="secondary"
                            className="text-[10px] bg-[hsl(217,14%,14%)] text-foreground/80 border-[hsl(217,14%,18%)]"
                          >
                            {agent}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-[hsl(217,14%,25%)]"
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                  </div>
                </div>
              </button>
            );
          }
        )}
      </div>
    </div>
  );
}

// ── Step 6: Domain & SSL ──────────────────────────────────

function StepDomain({
  data,
  onChange,
}: {
  data: WizardData;
  onChange: (d: Partial<WizardData>) => void;
}) {
  // Fetch server info on mount + auto-fill domain from current URL
  useEffect(() => {
    // Auto-fill domain from the browser's current hostname
    if (!data.domain && window.location.hostname && window.location.hostname !== "localhost") {
      onChange({ domain: window.location.hostname });
    }
    async function fetchServerInfo() {
      try {
        const res = await apiRequest("GET", "/api/setup/server-info");
        const json = await res.json();
        onChange({ serverIp: json.ip || "", serverHostname: json.hostname || "" });
      } catch {
        // silently fail
      }
    }
    fetchServerInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6" data-testid="step-domain">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          Domain & SSL Setup
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure how users will access your Mission Control
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Domain Name
          </Label>
          <Input
            type="text"
            value={data.domain}
            onChange={(e) => onChange({ domain: e.target.value })}
            placeholder="control.yourdomain.com"
            className="text-sm font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
            data-testid="input-domain"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80 p-4">
          <div className="flex items-center gap-3">
            <Lock className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Auto-provision SSL</p>
              <p className="text-[10px] text-muted-foreground">
                Let's Encrypt will be used for certificate provisioning
              </p>
            </div>
          </div>
          <Switch
            checked={data.autoSsl}
            onCheckedChange={(checked) => onChange({ autoSsl: checked })}
            data-testid="switch-auto-ssl"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              HTTP Port
            </Label>
            <Input
              type="number"
              value={data.httpPort}
              onChange={(e) => onChange({ httpPort: parseInt(e.target.value) || 80 })}
              placeholder="80"
              className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
              data-testid="input-http-port"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              HTTPS Port
            </Label>
            <Input
              type="number"
              value={data.httpsPort}
              onChange={(e) => onChange({ httpsPort: parseInt(e.target.value) || 443 })}
              placeholder="443"
              className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
              data-testid="input-https-port"
            />
          </div>
        </div>

        {/* Server info & DNS note */}
        <div className="rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,16%,5%)]/40 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              DNS must be pointed to this server's IP before SSL can be provisioned.
            </p>
          </div>
          {data.serverIp && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Server IP:</span>
              <code className="font-mono text-foreground bg-[hsl(217,14%,14%)] px-2 py-0.5 rounded" data-testid="text-server-ip">
                {data.serverIp}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 7: Final Verification ────────────────────────────

function SummaryRow({
  icon: Icon,
  label,
  value,
  status,
  onEdit,
  testId,
}: {
  icon: any;
  label: string;
  value: string;
  status: "complete" | "partial" | "skipped";
  onEdit: () => void;
  testId: string;
}) {
  return (
    <div
      className="flex items-center gap-3 py-3 border-b border-[hsl(217,14%,13%)] last:border-0"
      data-testid={testId}
    >
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          status === "complete"
            ? "bg-emerald-500/15 text-emerald-400"
            : status === "partial"
              ? "bg-primary/15 text-primary"
              : "bg-[hsl(217,14%,16%)] text-muted-foreground"
        }`}
      >
        {status === "complete" ? (
          <CheckCircle2 className="w-3.5 h-3.5" />
        ) : status === "partial" ? (
          <Icon className="w-3 h-3" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground truncate">{value}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onEdit}
        className="text-xs text-primary hover:text-primary/80"
        data-testid={`button-edit-${testId}`}
      >
        Edit
      </Button>
    </div>
  );
}

function StepReview({
  data,
  onGoToStep,
  onLaunch,
  isLaunching,
}: {
  data: WizardData;
  onGoToStep: (s: number) => void;
  onLaunch: () => void;
  isLaunching: boolean;
}) {
  const configuredModels = Object.entries(data.models)
    .filter(([, c]) => c.configured)
    .map(([k]) => MODEL_DEFS.find((d) => d.key === k)?.name || k);

  const configuredProviders = Object.entries(data.chatProviders)
    .filter(([, c]) => c.configured)
    .map(([k]) => CHAT_PROVIDER_DEFS.find((d) => d.key === k)?.name || k);

  const presetInfo = AGENT_PRESETS[data.agentPreset];

  return (
    <div className="space-y-6" data-testid="step-review">
      <div className="text-center">
        <h2 className="text-xl font-semibold flex items-center gap-2 justify-center">
          <Rocket className="w-5 h-5 text-primary" />
          Ready to Launch
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Review your configuration before launching Mission Control
        </p>
      </div>

      <div className="rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,14%,9%)]/80 overflow-hidden">
        <div className="px-5 py-2">
          {data.dbTestStatus === "success" && (
            <SummaryRow
              icon={Database}
              label="Database"
              value={data.dbType === "sqlite" ? "SQLite (Built-in)" : `${data.dbName} @ ${data.dbHost} (${data.dbDetectedType ?? data.dbType})`}
              status="complete"
              onEdit={() => onGoToStep(1)}
              testId="summary-database"
            />
          )}
          <SummaryRow
            icon={Shield}
            label="Admin Account"
            value={`${data.adminName} — ${data.adminEmail}`}
            status="complete"
            onEdit={() => onGoToStep(2)}
            testId="summary-admin"
          />
          <SummaryRow
            icon={Bot}
            label="AI Models"
            value={
              configuredModels.length > 0
                ? configuredModels.join(", ")
                : "No models configured"
            }
            status={configuredModels.length > 0 ? "complete" : "skipped"}
            onEdit={() => onGoToStep(3)}
            testId="summary-models"
          />
          <SummaryRow
            icon={MessageCircle}
            label="Chat Providers"
            value={
              configuredProviders.length > 0
                ? configuredProviders.join(", ")
                : "None configured"
            }
            status={configuredProviders.length > 0 ? "partial" : "skipped"}
            onEdit={() => onGoToStep(4)}
            testId="summary-chat"
          />
          <SummaryRow
            icon={Users}
            label="Agent Team"
            value={`${presetInfo.label}${presetInfo.agents.length > 0 ? ` — ${presetInfo.agents.length} agents` : ""}`}
            status="complete"
            onEdit={() => onGoToStep(5)}
            testId="summary-agents"
          />
          <SummaryRow
            icon={Globe}
            label="Domain & SSL"
            value={data.domain || "Not configured"}
            status={data.domain ? "complete" : "skipped"}
            onEdit={() => onGoToStep(6)}
            testId="summary-domain"
          />
        </div>
      </div>

      {/* Launch button */}
      <div className="text-center pt-2">
        <Button
          size="lg"
          onClick={onLaunch}
          disabled={isLaunching}
          className="px-10 py-3 text-base font-semibold gap-2 relative overflow-hidden"
          data-testid="button-launch"
        >
          {isLaunching ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Launching...
            </>
          ) : (
            <>
              <Rocket className="w-5 h-5" />
              Launch Mission Control
            </>
          )}
        </Button>
        {isLaunching && (
          <div className="mt-4 max-w-xs mx-auto">
            <div className="h-1.5 rounded-full bg-[hsl(217,14%,15%)] overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: "90%", animation: "launch-progress 3s ease-out forwards" }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Setting up your environment...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Confetti Effect ───────────────────────────────────────

function LaunchProgressScreen() {
  const [messages, setMessages] = useState<string[]>(["Initializing Mission Control..."]);
  const [statusData, setStatusData] = useState<any>(null);
  const [elapsed, setElapsed] = useState(0);

  const funMessages = [
    "Warming up the AI engines...",
    "Teaching agents their new roles...",
    "Organizing the task board...",
    "Setting up your command center...",
    "Calibrating the skill library...",
    "Configuring security policies...",
    "Tuning the memory systems...",
    "Preparing your dashboard...",
    "Brewing coffee for the CEO agent...",
    "Training the marketing department...",
    "Sharpening the analytics tools...",
    "Polishing the approval queue...",
    "Loading the schedule planner...",
    "Wiring up the integrations...",
    "Almost there — final checks...",
    "Connecting to OpenClaw gateway...",
    "Your AI team is getting ready...",
  ];

  useEffect(() => {
    // Elapsed timer
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);

    // Fun rotating messages every 3 seconds
    let msgIdx = 0;
    const msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % funMessages.length;
      setMessages(prev => [...prev.slice(-15), funMessages[msgIdx]]);
    }, 3000);

    // Poll real status every 2 seconds
    const statusTimer = setInterval(async () => {
      try {
        const res = await fetch("/api/setup/launch-status");
        const data = await res.json();
        setStatusData(data);
        // Add real step completions to the log
        if (data.steps) {
          for (const step of data.steps) {
            if (step.done) {
              setMessages(prev => {
                const msg = `✅ ${step.name} (${step.count})`;
                if (prev.includes(msg)) return prev;
                return [...prev.slice(-15), msg];
              });
            }
          }
        }
      } catch { /* keep polling */ }
    }, 2000);

    return () => { clearInterval(timer); clearInterval(msgTimer); clearInterval(statusTimer); };
  }, []);

  // Time-based progress: +5% every 5 seconds, capped at 90% until truly done.
  // The backend steps complete almost instantly but the actual build takes 60+s.
  const [timedProgress, setTimedProgress] = useState(0);
  const allDone = statusData?.allDone === true;

  useEffect(() => {
    const progressTimer = setInterval(() => {
      setTimedProgress(prev => {
        if (prev >= 90) return 90; // cap at 90% until app is actually ready
        return prev + 5;
      });
    }, 5000);
    return () => clearInterval(progressTimer);
  }, []);

  // When backend signals allDone, jump to 100%
  const progressPercent = allDone ? 100 : timedProgress;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Zap className="w-8 h-8 text-primary animate-pulse" />
          </div>
          <h1 className="text-xl font-bold">Launching Mission Control</h1>
          <p className="text-sm text-muted-foreground mt-1">Setting up your AI team — this takes a moment</p>
        </div>

        {/* Spinner + status */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground">{statusData?.summary || "Starting..."}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{elapsed}s</span>
        </div>

        {/* Log output — scrolling messages like the PHP installer */}
        <div className="bg-[hsl(220,16%,6%)] border border-border rounded-lg p-4 h-[250px] overflow-y-auto font-mono text-xs">
          {messages.map((msg, i) => (
            <div key={i} className={`py-0.5 ${msg.startsWith("✅") ? "text-emerald-400" : "text-muted-foreground"}`}>
              <span className="text-zinc-600 mr-2">[{String(Math.floor((elapsed - (messages.length - i) * 3) / 60)).padStart(2, "0")}:{String(Math.abs((elapsed - (messages.length - i) * 3) % 60)).padStart(2, "0")}]</span>
              {msg}
            </div>
          ))}
          <div className="py-0.5 text-teal-400 animate-pulse">▌</div>
        </div>

        {/* Status checklist */}
        {statusData?.steps && (
          <div className="mt-4 space-y-1">
            {statusData.steps.map((step: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {step.done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-zinc-600" />
                )}
                <span className={step.done ? "text-foreground" : "text-muted-foreground"}>{step.name}</span>
                {step.done && <span className="text-[9px] text-muted-foreground ml-auto">{step.count}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Confetti() {
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden" data-testid="confetti">
      {Array.from({ length: 60 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.8;
        const duration = 1.5 + Math.random() * 2;
        const size = 4 + Math.random() * 6;
        const colors = [
          "hsl(173, 58%, 44%)",
          "hsl(262, 83%, 68%)",
          "hsl(43, 74%, 60%)",
          "hsl(340, 75%, 60%)",
          "hsl(221, 83%, 65%)",
        ];
        const color = colors[i % colors.length];
        const rotation = Math.random() * 360;
        return (
          <div
            key={i}
            className="absolute -top-2"
            style={{
              left: `${left}%`,
              width: size,
              height: size * 1.5,
              backgroundColor: color,
              borderRadius: "2px",
              animation: `confetti-fall ${duration}s ease-in ${delay}s forwards`,
              transform: `rotate(${rotation}deg)`,
              opacity: 0,
            }}
          />
        );
      })}
      <style>{`
        @keyframes confetti-fall {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          100% { opacity: 0; transform: translateY(100vh) rotate(720deg); }
        }
      `}</style>
    </div>
  );
}

// ── Main Wizard Component ─────────────────────────────────

export default function SetupWizard() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(defaultWizardData);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showLaunchProgress, setShowLaunchProgress] = useState(false);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // When coming from the PHP installer (?installer=1), skip Welcome (0)
  // and Database (1) — PHP already configured the DB — start at Admin (2).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("installer") === "1") {
      setCurrentStep(2);
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
  }, []);

  const updateData = useCallback(
    (partial: Partial<WizardData>) => {
      setWizardData((prev) => ({ ...prev, ...partial }));
    },
    []
  );

  // ── Validation per step ────────────────────────────────

  const canContinue = useCallback((): boolean => {
    switch (currentStep) {
      case 0: // Welcome — no required input
        return true;
      case 1: // Database — must pass test connection
        return wizardData.dbTestStatus === "success";
      case 2: { // Admin
        const pw = wizardData.adminPassword;
        return (
          wizardData.adminName.trim().length > 0 &&
          wizardData.adminEmail.trim().length > 0 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wizardData.adminEmail) &&
          pw.length >= 8 &&
          wizardData.adminConfirmPassword === pw
        );
      }
      case 3: // AI Models — at least one configured
        return Object.values(wizardData.models).some((m) => m.configured);
      case 4: // Chat — always optional
        return true;
      case 5: // Agents — always has a selection
        return true;
      case 6: // Domain — optional
        return true;
      case 7: // Review
        return true;
      default:
        return false;
    }
  }, [currentStep, wizardData]);

  const goToStep = useCallback((step: number) => {
    setDirection(step > currentStep ? "forward" : "back");
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentStep(step);
      setIsTransitioning(false);
      // Scroll to top of content
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const nextStep = useCallback(() => {
    if (currentStep < STEPS.length - 1 && canContinue()) {
      // Pre-seed agents when leaving the Agents step (step 5)
      // This creates agents in DB while user fills Domain + Review steps
      if (currentStep === 5 && wizardData.agentPreset !== "custom") {
        fetch("/api/setup/pre-seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset: wizardData.agentPreset }),
        }).catch(() => {}); // fire-and-forget
      }
      goToStep(currentStep + 1);
    }
  }, [currentStep, canContinue, goToStep, wizardData.agentPreset]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      goToStep(currentStep - 1);
    }
  }, [currentStep, goToStep]);

  const handleLaunch = useCallback(async () => {
    setIsLaunching(true);
    try {
      // Include DB config only if the user configured it in the wizard
      // (direct install). When coming from PHP installer, dbTestStatus is
      // "idle" and DB is already in .env — skip to avoid overwriting it.
      const payload: Record<string, unknown> = {
        admin: {
          fullName: wizardData.adminName,
          email: wizardData.adminEmail,
          password: wizardData.adminPassword,
        },
        models: wizardData.models,
        chatProviders: wizardData.chatProviders,
        agentPreset: wizardData.agentPreset,
        domain: {
          domainName: wizardData.domain,
          autoSsl: wizardData.autoSsl,
          httpPort: wizardData.httpPort,
          httpsPort: wizardData.httpsPort,
        },
      };
      // Only send DB config if the wizard collected it (direct install path)
      if (wizardData.dbTestStatus === "success") {
        payload.database = {
          host: wizardData.dbHost,
          port: wizardData.dbPort,
          name: wizardData.dbName,
          user: wizardData.dbUser,
          password: wizardData.dbPassword,
          type: wizardData.dbType,
        };
      }
      console.log("[launch] starting setup/complete...");
      const t0 = Date.now();

      // Direct fetch — no apiRequest wrapper, no body read wait
      const setupRes = await fetch("/api/setup/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log(`[launch] setup/complete: ${Date.now() - t0}ms (${setupRes.status})`);

      // Show launch progress screen — replaces the wizard
      setShowLaunchProgress(true);

      // Auto-login in background
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: wizardData.adminEmail, password: wizardData.adminPassword }),
      }).then(() => {
        queryClient.setQueryData(["/api/auth/me"], { authenticated: true, email: wizardData.adminEmail });
      }).catch(() => {});

      // Poll launch status until everything is seeded, then transfer
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch("/api/setup/launch-status");
          const data = await res.json();
          if (data.allDone) {
            clearInterval(pollInterval);
            // Add completion message to log
            setMessages(prev => [...prev, "🎉 All systems ready — launching dashboard!"]);
            setShowConfetti(true);
            // Hold confetti for 4 seconds so user sees it
            setTimeout(() => {
              window.location.href = window.location.origin + window.location.pathname + "#/";
              window.location.reload();
            }, 4000);
          }
        } catch { /* keep polling */ }
      }, 2000);

      // Safety: force transfer after 120 seconds — skip confetti on timeout
      setTimeout(() => {
        clearInterval(pollInterval);
        window.location.href = window.location.origin + window.location.pathname + "#/";
        window.location.reload();
      }, 120000);
    } catch (err: any) {
      toast({
        title: "Setup failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsLaunching(false);
    }
  }, [wizardData, toast]);

  // ── Render step content ────────────────────────────────

  const renderStep = () => {
    // Show launch progress inside the wizard frame
    if (showLaunchProgress) return <LaunchProgressScreen />;

    switch (currentStep) {
      case 0:
        return <StepWelcome data={wizardData} onChange={updateData} />;
      case 1:
        return <StepDatabase data={wizardData} onChange={updateData} />;
      case 2:
        return <StepAdmin data={wizardData} onChange={updateData} />;
      case 3:
        return <StepModels data={wizardData} onChange={updateData} />;
      case 4:
        return <StepChat data={wizardData} onChange={updateData} />;
      case 5:
        return <StepAgents data={wizardData} onChange={updateData} />;
      case 6:
        return <StepDomain data={wizardData} onChange={updateData} />;
      case 7:
        return (
          <StepReview
            data={wizardData}
            onGoToStep={goToStep}
            onLaunch={handleLaunch}
            isLaunching={isLaunching}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="min-h-screen bg-background flex flex-col"
      data-testid="page-setup-wizard"
    >
      {showConfetti && <Confetti />}

      {/* Step progress bar — show full (step 7) when launching */}
      <StepProgressBar currentStep={showLaunchProgress ? STEPS.length - 1 : currentStep} />

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center px-4 pb-32" ref={contentRef}>
        <div
          className={`w-full max-w-2xl transition-all duration-300 ${
            isTransitioning
              ? direction === "forward"
                ? "opacity-0 translate-x-4"
                : "opacity-0 -translate-x-4"
              : "opacity-100 translate-x-0"
          }`}
        >
          <div className="rounded-xl border border-[hsl(217,14%,13%)] bg-[hsl(220,14%,9%)] p-6 sm:p-8">
            {renderStep()}
          </div>
        </div>
      </div>

      {/* Bottom navigation bar — hidden during launch */}
      {currentStep < 7 && !showLaunchProgress && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[hsl(217,14%,13%)] bg-background z-40">
          <div className="max-w-2xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between">
            <div>
              {currentStep > 0 && (
                <Button
                  variant="ghost"
                  onClick={prevStep}
                  className="gap-2"
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Skip button for optional steps */}
              {(currentStep === 4 || currentStep === 6) && (
                <Button
                  variant="ghost"
                  onClick={nextStep}
                  className="text-muted-foreground"
                  data-testid="button-skip"
                >
                  Skip for now
                </Button>
              )}
              <Button
                onClick={nextStep}
                disabled={!canContinue()}
                className="gap-2 min-w-[140px]"
                data-testid="button-continue"
              >
                {currentStep === 0 ? (
                  <>
                    Get Started
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
