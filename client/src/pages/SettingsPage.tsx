import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { Setting, Integration } from "@shared/schema";
import {
  ChevronDown, ChevronRight, ExternalLink, Save, Eye, EyeOff, Key, Loader2, Zap,
  MessageCircle, Bot, Briefcase, Wrench, Palette, Users, Home,
  Music, Database, Monitor, Terminal, Link2, Unlink, Settings2,
  RefreshCw, AlertTriangle, CheckCircle2, Cpu, Mic, Brain, Calendar,
  MapPin, Globe, CreditCard, Code2, Server,
} from "lucide-react";
import {
  SiWhatsapp, SiTelegram, SiDiscord, SiSlack, SiSignal, SiImessage,
  SiAnthropic, SiOpenai, SiGoogle, SiMistralai, SiHuggingface,
  SiNotion, SiObsidian, SiTrello, SiGithub, SiApple,
  SiGmail, SiGooglechrome, Si1Password,
  SiVercel, SiOllama,
  SiSpotify, SiSonos, SiShazam,
  SiGoogledrive, SiDropbox, SiAirtable,
  SiHomeassistant, SiPhilipshue,
  SiLinux, SiAndroid, SiMacos, SiIos,
} from "react-icons/si";
import { FaXTwitter, FaWindows, FaAws, FaMicrosoft } from "react-icons/fa6";

// ── Field Definition Types ───────────────────────────────
interface FieldDef {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "email";
  placeholder: string;
  storeKey?: string; // camelCase key name in settings.ai_models JSON (overrides snakeToCamel)
}

interface IntegrationDef {
  name: string;
  icon: any;
  iconColor?: string;
  fields: FieldDef[];
  docsUrl: string;
  docsLabel: string;
  cliNote?: string; // For system-level integrations with no config fields
  providerKey?: string; // key within the settings JSON object — when set, reads/writes settings not integrations table
  settingsKey?: string; // which settings row to use — defaults to "ai_models"
  testKey?: string; // key sent to /api/integrations/test — when set, enables Test Connection for non-providerKey integrations
  pairingChannel?: string; // openclaw channel name — when set, shows pairing requests inside the card
}

// Convert snake_case field keys to camelCase for settings.ai_models JSON lookup
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

interface CategoryDef {
  key: string;
  label: string;
  description: string;
  icon: any;
  integrations: IntegrationDef[];
}

// ── All OpenClaw Integration Definitions ─────────────────

const CATEGORIES: CategoryDef[] = [
  {
    key: "chat",
    label: "Chat Providers",
    description: "Messaging platforms your agents communicate through",
    icon: MessageCircle,
    integrations: [
      {
        name: "WhatsApp",
        icon: SiWhatsapp,
        iconColor: "#25D366",
        testKey: "whatsapp",
        pairingChannel: "whatsapp",
        fields: [
          { key: "phone_number_id", label: "Phone Number ID", type: "text", placeholder: "1xxxxxxxxxx" },
          { key: "business_account_id", label: "Business Account ID", type: "text", placeholder: "1xxxxxxxxxx" },
          { key: "access_token", label: "Access Token", type: "password", placeholder: "EAAxxxxxxxxx..." },
        ],
        docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
        docsLabel: "WhatsApp Cloud API Docs",
      },
      {
        name: "Telegram",
        icon: SiTelegram,
        iconColor: "#26A5E4",
        testKey: "telegram",
        pairingChannel: "telegram",
        fields: [
          { key: "bot_token", label: "Bot Token", type: "password", placeholder: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz" },
          { key: "chat_id", label: "Chat ID", type: "text", placeholder: "-1001234567890" },
        ],
        docsUrl: "https://core.telegram.org/bots/api",
        docsLabel: "Telegram Bot API Docs",
      },
      {
        name: "Discord",
        icon: SiDiscord,
        iconColor: "#5865F2",
        testKey: "discord",
        pairingChannel: "discord",
        fields: [
          { key: "bot_token", label: "Bot Token", type: "password", placeholder: "MTxxxxxxxxxxxxxxxxxxxxxxxx.GxxxxX.xxxxxxxx" },
          { key: "webhook_url", label: "Webhook URL", type: "url", placeholder: "https://discord.com/api/webhooks/..." },
          { key: "guild_id", label: "Guild ID (optional)", type: "text", placeholder: "123456789012345678" },
        ],
        docsUrl: "https://discord.com/developers/docs/intro",
        docsLabel: "Discord Developer Docs",
      },
      {
        name: "Slack",
        icon: SiSlack,
        iconColor: "#4A154B",
        testKey: "slack",
        pairingChannel: "slack",
        fields: [
          { key: "bot_token", label: "Bot Token", type: "password", placeholder: "xoxb-xxxxxxxxxxxx-xxxxxxxx" },
          { key: "signing_secret", label: "Signing Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "app_id", label: "App ID", type: "text", placeholder: "A0XXXXXXXXX" },
        ],
        docsUrl: "https://api.slack.com/docs",
        docsLabel: "Slack API Docs",
      },
      {
        name: "Signal",
        icon: SiSignal,
        iconColor: "#3A76F0",
        fields: [],
        docsUrl: "https://github.com/AsamK/signal-cli",
        docsLabel: "Signal CLI Docs",
        cliNote: "Configured via OpenClaw CLI — requires signal-cli daemon on host",
      },
      {
        name: "iMessage",
        icon: SiImessage,
        iconColor: "#34C759",
        fields: [],
        docsUrl: "https://openclaw.ai/docs/integrations/imessage",
        docsLabel: "OpenClaw iMessage Docs",
        cliNote: "Configured via OpenClaw CLI — requires macOS host with Messages.app",
      },
    ],
  },
  {
    key: "ai_models",
    label: "AI Models",
    description: "LLM providers and model routing",
    icon: Bot,
    integrations: [
      {
        name: "Anthropic (Claude)",
        icon: SiAnthropic,
        iconColor: "#D4A574",
        providerKey: "anthropic",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "sk-ant-api03-...", storeKey: "apiKey" },
        ],
        docsUrl: "https://docs.anthropic.com/en/docs/get-started",
        docsLabel: "Anthropic API Docs",
      },
      {
        name: "OpenAI (GPT-4/5)",
        icon: SiOpenai,
        iconColor: "#ffffff",
        providerKey: "openai",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "sk-proj-...", storeKey: "apiKey" },
          { key: "org_id", label: "Organization ID (optional)", type: "text", placeholder: "org-xxxxxxxxxxxxxxxxxxxxxxxx", storeKey: "orgId" },
        ],
        docsUrl: "https://platform.openai.com/docs/api-reference",
        docsLabel: "OpenAI API Docs",
      },
      {
        name: "Google (Gemini)",
        icon: SiGoogle,
        iconColor: "#4285F4",
        providerKey: "google",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "AIzaSy...", storeKey: "apiKey" },
        ],
        docsUrl: "https://ai.google.dev/docs",
        docsLabel: "Google AI Studio Docs",
      },
      {
        name: "xAI (Grok)",
        icon: FaXTwitter,
        iconColor: "#ffffff",
        providerKey: "xai",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xai-...", storeKey: "apiKey" },
        ],
        docsUrl: "https://docs.x.ai/docs",
        docsLabel: "xAI API Docs",
      },
      {
        name: "Mistral",
        icon: SiMistralai,
        iconColor: "#F7D046",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://docs.mistral.ai/",
        docsLabel: "Mistral API Docs",
      },
      {
        name: "DeepSeek",
        icon: Bot,
        iconColor: "#4D6BFE",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "sk-..." },
        ],
        docsUrl: "https://platform.deepseek.com/docs",
        docsLabel: "DeepSeek API Docs",
      },
      {
        name: "Perplexity",
        icon: Bot,
        iconColor: "#20B8CD",
        providerKey: "perplexity",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "pplx-...", storeKey: "apiKey" },
        ],
        docsUrl: "https://docs.perplexity.ai/",
        docsLabel: "Perplexity API Docs",
      },
      {
        name: "Hugging Face",
        icon: SiHuggingface,
        iconColor: "#FFD21E",
        fields: [
          { key: "api_key", label: "Access Token", type: "password", placeholder: "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://huggingface.co/docs/api-inference",
        docsLabel: "Hugging Face Docs",
      },
      {
        name: "OpenRouter",
        icon: Bot,
        iconColor: "#6366F1",
        providerKey: "openrouter",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "sk-or-v1-...", storeKey: "apiKey" },
          { key: "endpoint_url", label: "Endpoint URL", type: "url", placeholder: "https://openrouter.ai/api/v1", storeKey: "endpointUrl" },
        ],
        docsUrl: "https://openrouter.ai/docs",
        docsLabel: "OpenRouter Docs",
      },
      {
        name: "Vercel AI Gateway",
        icon: SiVercel,
        iconColor: "#ffffff",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "gateway_url", label: "Gateway URL", type: "url", placeholder: "https://gateway.ai.vercel.sh/v1" },
        ],
        docsUrl: "https://sdk.vercel.ai/docs",
        docsLabel: "Vercel AI SDK Docs",
      },
    ],
  },
  {
    key: "productivity",
    label: "Productivity",
    description: "Notes, tasks, knowledge bases, and code",
    icon: Briefcase,
    integrations: [
      {
        name: "Notion",
        icon: SiNotion,
        iconColor: "#ffffff",
        testKey: "notion",
        fields: [
          { key: "api_key", label: "Integration Token", type: "password", placeholder: "ntn_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "workspace_id", label: "Workspace ID (optional)", type: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        ],
        docsUrl: "https://developers.notion.com/docs/getting-started",
        docsLabel: "Notion API Docs",
      },
      {
        name: "Obsidian",
        icon: SiObsidian,
        iconColor: "#7C3AED",
        fields: [
          { key: "vault_path", label: "Vault Path", type: "text", placeholder: "/path/to/vault" },
          { key: "api_key", label: "Local REST API Key (optional)", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://github.com/coddingtonbear/obsidian-local-rest-api",
        docsLabel: "Obsidian REST API Docs",
      },
      {
        name: "Trello",
        icon: SiTrello,
        iconColor: "#0052CC",
        testKey: "trello",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "token", label: "Token", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developer.atlassian.com/cloud/trello/rest/",
        docsLabel: "Trello API Docs",
      },
      {
        name: "GitHub",
        icon: SiGithub,
        iconColor: "#ffffff",
        testKey: "github",
        fields: [
          { key: "pat", label: "Personal Access Token", type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "owner", label: "Owner / Org", type: "text", placeholder: "your-org" },
        ],
        docsUrl: "https://docs.github.com/en/rest",
        docsLabel: "GitHub API Docs",
      },
      {
        name: "Apple Notes",
        icon: SiApple,
        iconColor: "#FBBC04",
        fields: [],
        docsUrl: "https://openclaw.ai/docs/integrations/apple-notes",
        docsLabel: "OpenClaw Apple Notes Docs",
        cliNote: "Configured via OpenClaw CLI — requires macOS host",
      },
      {
        name: "Apple Reminders",
        icon: SiApple,
        iconColor: "#4ECDC4",
        fields: [],
        docsUrl: "https://openclaw.ai/docs/integrations/apple-reminders",
        docsLabel: "OpenClaw Apple Reminders Docs",
        cliNote: "Configured via OpenClaw CLI — requires macOS host",
      },
      {
        name: "Things 3",
        icon: Briefcase,
        iconColor: "#3078F2",
        fields: [
          { key: "auth_token", label: "Auth Token", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://culturedcode.com/things/support/articles/2803573/",
        docsLabel: "Things URL Scheme Docs",
      },
      {
        name: "Bear Notes",
        icon: Briefcase,
        iconColor: "#DD4C4F",
        fields: [
          { key: "api_token", label: "API Token", type: "password", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        ],
        docsUrl: "https://bear.app/faq/x-callback-url-scheme-documentation/",
        docsLabel: "Bear Notes Docs",
      },
    ],
  },
  {
    key: "search",
    label: "Search & Web",
    description: "Web search providers used by your agents for research tasks",
    icon: Cpu,
    integrations: [
      {
        name: "Brave Search",
        icon: Cpu,
        iconColor: "#FB542B",
        providerKey: "brave",
        settingsKey: "search_providers",
        testKey: "brave",
        fields: [
          {
            key: "api_key",
            label: "Brave Search API Key",
            type: "password",
            placeholder: "BSA...",
            storeKey: "apiKey",
          },
        ],
        docsUrl: "https://brave.com/search/api/",
        docsLabel: "Brave Search API Docs",
      },
      {
        name: "SerpAPI (Google fallback)",
        icon: Cpu,
        iconColor: "#4285F4",
        providerKey: "serp",
        settingsKey: "search_providers",
        testKey: "serp",
        fields: [
          {
            key: "api_key",
            label: "SerpAPI Key",
            type: "password",
            placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            storeKey: "apiKey",
          },
        ],
        docsUrl: "https://serpapi.com/",
        docsLabel: "SerpAPI Docs",
      },
    ],
  },
  {
    key: "tools",
    label: "Tools & Automation",
    description: "Browser control, email triggers, scheduling, and security",
    icon: Wrench,
    integrations: [
      {
        name: "Gmail",
        icon: SiGmail,
        iconColor: "#EA4335",
        testKey: "gmail",
        fields: [
          { key: "client_id", label: "Client ID", type: "text", placeholder: "your-app.apps.googleusercontent.com" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "GOCSPX-..." },
          { key: "refresh_token", label: "Refresh Token", type: "password", placeholder: "1//0..." },
        ],
        docsUrl: "https://developers.google.com/gmail/api/quickstart/nodejs",
        docsLabel: "Gmail API Docs",
      },
      {
        name: "Browser (Chromium)",
        icon: SiGooglechrome,
        iconColor: "#4285F4",
        fields: [
          { key: "executable_path", label: "Chromium Path (optional)", type: "text", placeholder: "/usr/bin/chromium" },
          { key: "user_data_dir", label: "User Data Directory (optional)", type: "text", placeholder: "~/.config/chromium" },
        ],
        docsUrl: "https://playwright.dev/docs/api/class-browsertype",
        docsLabel: "Playwright Browser Docs",
      },
      {
        name: "Cron (Scheduled Tasks)",
        icon: Wrench,
        iconColor: "#10B981",
        fields: [
          { key: "timezone", label: "Timezone", type: "text", placeholder: "America/Chicago" },
        ],
        docsUrl: "https://openclaw.ai/docs/integrations/cron",
        docsLabel: "OpenClaw Cron Docs",
      },
      {
        name: "Webhooks",
        icon: Wrench,
        iconColor: "#F59E0B",
        fields: [
          { key: "endpoint_url", label: "Endpoint URL", type: "url", placeholder: "https://your-server.com/webhooks/openclaw" },
          { key: "secret", label: "Signing Secret", type: "password", placeholder: "whsec_xxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://openclaw.ai/docs/integrations/webhooks",
        docsLabel: "OpenClaw Webhooks Docs",
      },
      {
        name: "1Password",
        icon: Si1Password,
        iconColor: "#0572EC",
        fields: [
          { key: "service_account_token", label: "Service Account Token", type: "password", placeholder: "ops_xxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "vault_id", label: "Vault ID (optional)", type: "text", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developer.1password.com/docs/connect/",
        docsLabel: "1Password Connect Docs",
      },
      {
        name: "Weather",
        icon: Wrench,
        iconColor: "#38BDF8",
        testKey: "weather",
        fields: [
          { key: "api_key", label: "API Key (OpenWeatherMap)", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "default_location", label: "Default Location", type: "text", placeholder: "Austin, TX" },
        ],
        docsUrl: "https://openweathermap.org/api",
        docsLabel: "OpenWeatherMap API Docs",
      },
    ],
  },
  {
    key: "media",
    label: "Media & Creative",
    description: "Image generation, screen capture, and visual tools",
    icon: Palette,
    integrations: [
      {
        name: "Image Gen (DALL-E/Flux)",
        icon: Palette,
        iconColor: "#EC4899",
        fields: [
          { key: "openai_api_key", label: "OpenAI API Key (DALL-E)", type: "password", placeholder: "sk-..." },
          { key: "flux_api_key", label: "Flux API Key (optional)", type: "password", placeholder: "flx-..." },
        ],
        docsUrl: "https://platform.openai.com/docs/api-reference/images",
        docsLabel: "OpenAI Images API Docs",
      },
      {
        name: "GIF Search",
        icon: Palette,
        iconColor: "#00FF99",
        testKey: "giphy",
        fields: [
          { key: "giphy_api_key", label: "Giphy API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developers.giphy.com/docs/api/",
        docsLabel: "Giphy API Docs",
      },
      {
        name: "Peekaboo (Screen Capture)",
        icon: Monitor,
        iconColor: "#A78BFA",
        fields: [],
        docsUrl: "https://openclaw.ai/docs/integrations/peekaboo",
        docsLabel: "OpenClaw Peekaboo Docs",
        cliNote: "Configured via OpenClaw CLI — uses native screen capture APIs",
      },
      {
        name: "Camera",
        icon: Monitor,
        iconColor: "#F472B6",
        fields: [],
        docsUrl: "https://openclaw.ai/docs/integrations/camera",
        docsLabel: "OpenClaw Camera Docs",
        cliNote: "Configured via OpenClaw CLI — uses native camera APIs",
      },
    ],
  },
  {
    key: "social",
    label: "Social",
    description: "Social media posting and monitoring",
    icon: Users,
    integrations: [
      {
        name: "Twitter/X",
        icon: FaXTwitter,
        iconColor: "#ffffff",
        testKey: "twitter",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "api_secret", label: "API Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "access_token", label: "Access Token", type: "password", placeholder: "xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "access_secret", label: "Access Token Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "bearer_token", label: "Bearer Token", type: "password", placeholder: "AAAAAAAAAA..." },
        ],
        docsUrl: "https://developer.x.com/en/docs/twitter-api",
        docsLabel: "X API Docs",
      },
      {
        name: "Email (SMTP/IMAP)",
        icon: MessageCircle,
        iconColor: "#6366F1",
        fields: [
          { key: "smtp_host", label: "SMTP Host", type: "text", placeholder: "smtp.gmail.com" },
          { key: "smtp_port", label: "SMTP Port", type: "text", placeholder: "587" },
          { key: "imap_host", label: "IMAP Host", type: "text", placeholder: "imap.gmail.com" },
          { key: "username", label: "Username", type: "email", placeholder: "you@example.com" },
          { key: "password", label: "Password", type: "password", placeholder: "app-specific-password" },
        ],
        docsUrl: "https://openclaw.ai/docs/integrations/email",
        docsLabel: "OpenClaw Email Docs",
      },
    ],
  },
  {
    key: "smart_home",
    label: "Smart Home",
    description: "Home automation and IoT devices",
    icon: Home,
    integrations: [
      {
        name: "Home Assistant",
        icon: SiHomeassistant,
        iconColor: "#41BDF5",
        testKey: "home_assistant",
        fields: [
          { key: "url", label: "Home Assistant URL", type: "url", placeholder: "http://homeassistant.local:8123" },
          { key: "access_token", label: "Long-Lived Access Token", type: "password", placeholder: "eyJ0eXAiOiJKV1QiLCJhbGciOi..." },
        ],
        docsUrl: "https://developers.home-assistant.io/docs/api/rest/",
        docsLabel: "Home Assistant API Docs",
      },
      {
        name: "Philips Hue",
        icon: SiPhilipshue,
        iconColor: "#FFB800",
        fields: [
          { key: "bridge_ip", label: "Bridge IP", type: "text", placeholder: "192.168.1.x" },
          { key: "username", label: "API Username", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developers.meethue.com/develop/get-started-2/",
        docsLabel: "Hue Developer Docs",
      },
      {
        name: "8Sleep",
        icon: Home,
        iconColor: "#1E90FF",
        fields: [
          { key: "email", label: "Account Email", type: "email", placeholder: "you@example.com" },
          { key: "password", label: "Password", type: "password", placeholder: "your-password" },
        ],
        docsUrl: "https://openclaw.ai/docs/integrations/8sleep",
        docsLabel: "OpenClaw 8Sleep Docs",
      },
    ],
  },
  {
    key: "music",
    label: "Music & Audio",
    description: "Playback control and audio recognition",
    icon: Music,
    integrations: [
      {
        name: "Spotify",
        icon: SiSpotify,
        iconColor: "#1DB954",
        testKey: "spotify",
        fields: [
          { key: "client_id", label: "Client ID", type: "text", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "refresh_token", label: "Refresh Token", type: "password", placeholder: "AQDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developer.spotify.com/documentation/web-api",
        docsLabel: "Spotify Web API Docs",
      },
      {
        name: "Sonos",
        icon: SiSonos,
        iconColor: "#ffffff",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "household_id", label: "Household ID", type: "text", placeholder: "Sonos_xxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developer.sonos.com/reference/",
        docsLabel: "Sonos Developer Docs",
      },
      {
        name: "Shazam",
        icon: SiShazam,
        iconColor: "#0088FF",
        fields: [
          { key: "api_key", label: "RapidAPI Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://rapidapi.com/apidojo/api/shazam",
        docsLabel: "Shazam API Docs",
      },
    ],
  },
  {
    key: "data_storage",
    label: "Data Storage",
    description: "Cloud storage and databases",
    icon: Database,
    integrations: [
      {
        name: "Google Drive",
        icon: SiGoogledrive,
        iconColor: "#4285F4",
        testKey: "google_drive",
        fields: [
          { key: "client_id", label: "Client ID", type: "text", placeholder: "your-app.apps.googleusercontent.com" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "GOCSPX-..." },
          { key: "refresh_token", label: "Refresh Token", type: "password", placeholder: "1//0..." },
        ],
        docsUrl: "https://developers.google.com/drive/api/quickstart/nodejs",
        docsLabel: "Drive API Docs",
      },
      {
        name: "OneDrive",
        icon: FaMicrosoft,
        iconColor: "#0078D4",
        fields: [
          { key: "client_id", label: "Application (Client) ID", type: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "~xxxxx..." },
          { key: "tenant_id", label: "Tenant ID", type: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        ],
        docsUrl: "https://learn.microsoft.com/en-us/onedrive/developer/rest-api/",
        docsLabel: "OneDrive API Docs",
      },
      {
        name: "Dropbox",
        icon: SiDropbox,
        iconColor: "#0061FF",
        testKey: "dropbox",
        fields: [
          { key: "app_key", label: "App Key", type: "text", placeholder: "xxxxxxxxxxxxxxx" },
          { key: "app_secret", label: "App Secret", type: "password", placeholder: "xxxxxxxxxxxxxxx" },
          { key: "access_token", label: "Access Token", type: "password", placeholder: "sl.B..." },
        ],
        docsUrl: "https://www.dropbox.com/developers/documentation/http/documentation",
        docsLabel: "Dropbox API Docs",
      },
      {
        name: "AWS S3",
        icon: FaAws,
        iconColor: "#FF9900",
        fields: [
          { key: "access_key_id", label: "Access Key ID", type: "password", placeholder: "AKIAIOSFODNN7EXAMPLE" },
          { key: "secret_access_key", label: "Secret Access Key", type: "password", placeholder: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
          { key: "bucket", label: "Bucket Name", type: "text", placeholder: "my-bucket" },
          { key: "region", label: "Region", type: "text", placeholder: "us-east-1" },
        ],
        docsUrl: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html",
        docsLabel: "AWS S3 Docs",
      },
      {
        name: "Supabase",
        icon: Database,
        iconColor: "#3ECF8E",
        testKey: "supabase",
        fields: [
          { key: "url", label: "Project URL", type: "url", placeholder: "https://xxxxxxxxxxx.supabase.co" },
          { key: "anon_key", label: "Anon/Public Key", type: "password", placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
          { key: "service_role_key", label: "Service Role Key", type: "password", placeholder: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
        ],
        docsUrl: "https://supabase.com/docs/guides/api",
        docsLabel: "Supabase API Docs",
      },
      {
        name: "Airtable",
        icon: SiAirtable,
        iconColor: "#18BFFF",
        testKey: "airtable",
        fields: [
          { key: "api_key", label: "Personal Access Token", type: "password", placeholder: "pat..." },
          { key: "base_id", label: "Base ID", type: "text", placeholder: "appXXXXXXXXXXXXXX" },
        ],
        docsUrl: "https://airtable.com/developers/web/api/introduction",
        docsLabel: "Airtable API Docs",
      },
    ],
  },
  {
    key: "voice",
    label: "Voice & Speech",
    description: "Text-to-speech, speech recognition, and voice interaction",
    icon: Mic,
    integrations: [
      {
        name: "ElevenLabs TTS",
        icon: Mic,
        iconColor: "#7C3AED",
        testKey: "elevenlabs",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "voice_id", label: "Default Voice ID", type: "text", placeholder: "21m00Tcm4TlvDq8ikWAM" },
          { key: "model_id", label: "Model ID (optional)", type: "text", placeholder: "eleven_multilingual_v2" },
        ],
        docsUrl: "https://elevenlabs.io/docs/api-reference/get-models",
        docsLabel: "ElevenLabs API Docs",
      },
      {
        name: "OpenAI TTS",
        icon: SiOpenai,
        iconColor: "#ffffff",
        fields: [
          { key: "voice", label: "Voice", type: "text", placeholder: "alloy — (alloy, echo, fable, onyx, nova, shimmer)" },
          { key: "model", label: "Model", type: "text", placeholder: "tts-1-hd" },
          { key: "speed", label: "Speed (0.25–4.0)", type: "text", placeholder: "1.0" },
        ],
        docsUrl: "https://platform.openai.com/docs/api-reference/audio/createSpeech",
        docsLabel: "OpenAI TTS Docs",
      },
      {
        name: "Piper TTS (Local)",
        icon: Mic,
        iconColor: "#10B981",
        fields: [
          { key: "piper_path", label: "Piper Executable Path", type: "text", placeholder: "/usr/local/bin/piper" },
          { key: "model_path", label: "Voice Model Path", type: "text", placeholder: "/opt/piper/models/en_US-ryan-high.onnx" },
        ],
        docsUrl: "https://github.com/rhasspy/piper",
        docsLabel: "Piper TTS Docs",
        cliNote: "Configured via OpenClaw CLI — requires Piper binary on host",
      },
      {
        name: "Whisper STT (OpenAI)",
        icon: Mic,
        iconColor: "#F59E0B",
        fields: [
          { key: "model", label: "Model", type: "text", placeholder: "whisper-1" },
          { key: "language", label: "Language (optional)", type: "text", placeholder: "en" },
        ],
        docsUrl: "https://platform.openai.com/docs/api-reference/audio/createTranscription",
        docsLabel: "Whisper API Docs",
      },
      {
        name: "Whisper STT (Local)",
        icon: Mic,
        iconColor: "#6366F1",
        fields: [
          { key: "model_path", label: "Whisper.cpp Model Path", type: "text", placeholder: "/opt/whisper/models/ggml-large-v3.bin" },
          { key: "executable_path", label: "whisper.cpp Path (optional)", type: "text", placeholder: "/usr/local/bin/whisper" },
        ],
        docsUrl: "https://github.com/ggml-org/whisper.cpp",
        docsLabel: "Whisper.cpp Docs",
        cliNote: "Configured via OpenClaw CLI — uses local whisper.cpp binary",
      },
    ],
  },
  {
    key: "memory",
    label: "Memory & Knowledge",
    description: "Agent memory storage — local markdown, vector databases, and knowledge bases",
    icon: Brain,
    integrations: [
      {
        name: "Local Markdown Vault",
        icon: Brain,
        iconColor: "#F59E0B",
        fields: [
          { key: "vault_path", label: "Vault Directory Path", type: "text", placeholder: "/home/user/.openclaw/memory" },
          { key: "max_memory_files", label: "Max Memory Files", type: "text", placeholder: "500" },
        ],
        docsUrl: "https://openclaw.ai/docs/memory/local-vault",
        docsLabel: "OpenClaw Memory Docs",
      },
      {
        name: "Qdrant (Vector DB)",
        icon: Database,
        iconColor: "#DC2626",
        testKey: "qdrant",
        fields: [
          { key: "url", label: "Qdrant URL", type: "url", placeholder: "http://localhost:6333" },
          { key: "api_key", label: "API Key (cloud only)", type: "password", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          { key: "collection", label: "Collection Name", type: "text", placeholder: "openclaw_memory" },
        ],
        docsUrl: "https://qdrant.tech/documentation/",
        docsLabel: "Qdrant Docs",
      },
      {
        name: "Chroma (Local Vector DB)",
        icon: Database,
        iconColor: "#EF4444",
        testKey: "chroma",
        fields: [
          { key: "host", label: "Chroma Host", type: "text", placeholder: "localhost" },
          { key: "port", label: "Port", type: "text", placeholder: "8000" },
          { key: "collection", label: "Collection Name", type: "text", placeholder: "openclaw_memory" },
        ],
        docsUrl: "https://docs.trychroma.com/",
        docsLabel: "Chroma Docs",
      },
      {
        name: "Pinecone",
        icon: Database,
        iconColor: "#00C2A8",
        testKey: "pinecone",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          { key: "index_name", label: "Index Name", type: "text", placeholder: "openclaw-memory" },
          { key: "environment", label: "Environment", type: "text", placeholder: "gcp-starter" },
        ],
        docsUrl: "https://docs.pinecone.io/",
        docsLabel: "Pinecone Docs",
      },
      {
        name: "HuggingFace Embeddings",
        icon: SiHuggingface,
        iconColor: "#FFD21E",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "model_id", label: "Embedding Model", type: "text", placeholder: "sentence-transformers/all-MiniLM-L6-v2" },
        ],
        docsUrl: "https://huggingface.co/docs/api-inference/index",
        docsLabel: "HuggingFace Inference API",
      },
    ],
  },
  {
    key: "calendar",
    label: "Calendar & Scheduling",
    description: "Calendar access for scheduling and time-awareness",
    icon: Calendar,
    integrations: [
      {
        name: "Google Calendar",
        icon: SiGoogle,
        iconColor: "#4285F4",
        testKey: "google_calendar",
        fields: [
          { key: "client_id", label: "Client ID", type: "text", placeholder: "your-app.apps.googleusercontent.com" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "GOCSPX-..." },
          { key: "refresh_token", label: "Refresh Token", type: "password", placeholder: "1//0..." },
          { key: "calendar_id", label: "Calendar ID (optional)", type: "email", placeholder: "primary" },
        ],
        docsUrl: "https://developers.google.com/calendar/api/guides/overview",
        docsLabel: "Google Calendar API Docs",
      },
      {
        name: "Outlook Calendar",
        icon: FaMicrosoft,
        iconColor: "#0078D4",
        fields: [
          { key: "client_id", label: "Application (Client) ID", type: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
          { key: "client_secret", label: "Client Secret", type: "password", placeholder: "~xxxxx..." },
          { key: "tenant_id", label: "Tenant ID", type: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
        ],
        docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/calendar",
        docsLabel: "Microsoft Graph Calendar Docs",
      },
      {
        name: "CalDAV (Nextcloud/Fastmail)",
        icon: Calendar,
        iconColor: "#0082C9",
        fields: [
          { key: "url", label: "CalDAV URL", type: "url", placeholder: "https://nextcloud.example.com/remote.php/dav" },
          { key: "username", label: "Username", type: "text", placeholder: "your-username" },
          { key: "password", label: "Password / App Password", type: "password", placeholder: "xxxx-xxxx-xxxx-xxxx" },
        ],
        docsUrl: "https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_osx.html",
        docsLabel: "CalDAV Docs",
      },
    ],
  },
  {
    key: "maps_location",
    label: "Maps & Location",
    description: "Geolocation, directions, and place search",
    icon: MapPin,
    integrations: [
      {
        name: "Google Maps",
        icon: SiGoogle,
        iconColor: "#4285F4",
        testKey: "google_maps",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://developers.google.com/maps/documentation",
        docsLabel: "Google Maps API Docs",
      },
      {
        name: "Mapbox",
        icon: MapPin,
        iconColor: "#4264FB",
        fields: [
          { key: "access_token", label: "Access Token", type: "password", placeholder: "pk.eyJ1Ijoixxxxxxxx..." },
        ],
        docsUrl: "https://docs.mapbox.com/",
        docsLabel: "Mapbox Docs",
      },
    ],
  },
  {
    key: "finance",
    label: "Finance & Data",
    description: "Market data, banking, and financial APIs",
    icon: CreditCard,
    integrations: [
      {
        name: "Alpha Vantage (Stocks)",
        icon: CreditCard,
        iconColor: "#00B4D8",
        testKey: "alpha_vantage",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://www.alphavantage.co/documentation/",
        docsLabel: "Alpha Vantage Docs",
      },
      {
        name: "Coinbase (Crypto)",
        icon: CreditCard,
        iconColor: "#0052FF",
        fields: [
          { key: "api_key", label: "API Key", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "api_secret", label: "API Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://docs.cdp.coinbase.com/",
        docsLabel: "Coinbase API Docs",
      },
      {
        name: "Plaid (Banking)",
        icon: CreditCard,
        iconColor: "#00CA5E",
        fields: [
          { key: "client_id", label: "Client ID", type: "text", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "secret", label: "Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "environment", label: "Environment", type: "text", placeholder: "sandbox — or development, production" },
        ],
        docsUrl: "https://plaid.com/docs/",
        docsLabel: "Plaid API Docs",
      },
    ],
  },
  {
    key: "dev_tools",
    label: "Dev Tools & Deployment",
    description: "CI/CD, deployments, container orchestration, and monitoring",
    icon: Code2,
    integrations: [
      {
        name: "Vercel",
        icon: SiVercel,
        iconColor: "#ffffff",
        testKey: "vercel",
        fields: [
          { key: "access_token", label: "Access Token", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "team_id", label: "Team ID (optional)", type: "text", placeholder: "team_xxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://vercel.com/docs/rest-api",
        docsLabel: "Vercel API Docs",
      },
      {
        name: "GitHub Actions",
        icon: SiGithub,
        iconColor: "#ffffff",
        testKey: "github_actions",
        fields: [
          { key: "pat", label: "Personal Access Token", type: "password", placeholder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "webhook_secret", label: "Webhook Secret", type: "password", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://docs.github.com/en/rest/actions",
        docsLabel: "GitHub Actions API Docs",
      },
      {
        name: "Grafana",
        icon: Server,
        iconColor: "#F46800",
        testKey: "grafana",
        fields: [
          { key: "url", label: "Grafana URL", type: "url", placeholder: "https://grafana.example.com" },
          { key: "api_key", label: "Service Account Token", type: "password", placeholder: "glsa_xxxxxxxxxxxxxxxxxxxxxxxx" },
        ],
        docsUrl: "https://grafana.com/docs/grafana/latest/developers/http_api/",
        docsLabel: "Grafana HTTP API Docs",
      },
      {
        name: "Docker / Portainer",
        icon: Server,
        iconColor: "#2496ED",
        testKey: "portainer",
        fields: [
          { key: "portainer_url", label: "Portainer URL", type: "url", placeholder: "https://portainer.example.com" },
          { key: "api_key", label: "Portainer API Key", type: "password", placeholder: "ptr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
          { key: "docker_host", label: "Docker Socket (local)", type: "text", placeholder: "/var/run/docker.sock" },
        ],
        docsUrl: "https://docs.portainer.io/api/api-documentation",
        docsLabel: "Portainer API Docs",
      },
      {
        name: "WordPress",
        icon: Globe,
        iconColor: "#21759B",
        testKey: "wordpress",
        fields: [
          { key: "site_url", label: "WordPress Site URL", type: "url", placeholder: "https://your-site.com" },
          { key: "username", label: "Username", type: "text", placeholder: "your-wp-username" },
          { key: "app_password", label: "Application Password", type: "password", placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx" },
        ],
        docsUrl: "https://developer.wordpress.org/rest-api/",
        docsLabel: "WordPress REST API Docs",
      },
    ],
  },
  {
    key: "local_llm",
    label: "Local LLM Servers",
    description: "Self-hosted language model servers — no API key needed",
    icon: Cpu,
    integrations: [
      {
        name: "Ollama",
        icon: SiOllama,
        iconColor: "#ffffff",
        providerKey: "ollama",
        fields: [
          { key: "endpoint_url", label: "Base URL", type: "url", placeholder: "http://localhost:11434/v1", storeKey: "endpointUrl" },
        ],
        docsUrl: "https://ollama.com/",
        docsLabel: "Ollama Docs",
      },
      {
        name: "LM Studio",
        icon: Cpu,
        iconColor: "#A855F7",
        fields: [
          { key: "base_url", label: "LM Studio URL", type: "url", placeholder: "http://localhost:1234/v1" },
          { key: "model_name", label: "Loaded Model Name", type: "text", placeholder: "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF" },
        ],
        docsUrl: "https://lmstudio.ai/docs/app/api",
        docsLabel: "LM Studio API Docs",
      },
      {
        name: "llama.cpp Server",
        icon: Cpu,
        iconColor: "#10B981",
        fields: [
          { key: "host", label: "Host", type: "text", placeholder: "localhost" },
          { key: "port", label: "Port", type: "text", placeholder: "8080" },
          { key: "model_path", label: "Model Path", type: "text", placeholder: "/opt/models/llama-3-8b.gguf" },
        ],
        docsUrl: "https://github.com/ggml-org/llama.cpp/blob/master/examples/server/README.md",
        docsLabel: "llama.cpp Server Docs",
      },
      {
        name: "vLLM",
        icon: Server,
        iconColor: "#6366F1",
        fields: [
          { key: "base_url", label: "vLLM API URL", type: "url", placeholder: "http://localhost:8000/v1" },
          { key: "model", label: "Model Name", type: "text", placeholder: "meta-llama/Meta-Llama-3-8B-Instruct" },
          { key: "api_key", label: "API Key (optional)", type: "password", placeholder: "token-xxxxxxxx" },
        ],
        docsUrl: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
        docsLabel: "vLLM Docs",
      },
    ],
  },
];

const PLATFORMS = [
  { name: "macOS", icon: SiMacos },
  { name: "iOS", icon: SiIos },
  { name: "Android", icon: SiAndroid },
  { name: "Windows (WSL2)", icon: FaWindows },
  { name: "Linux", icon: SiLinux },
];

// ── Secure password input with show/hide ─────────────────
function SecureInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-xs pr-8 font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? (
          <EyeOff className="w-3.5 h-3.5" />
        ) : (
          <Eye className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

// ── Single integration row ───────────────────────────────
interface PairingRequest {
  code: string;
  sender: string;
  channel: string;
  timestamp?: string;
}

function IntegrationRow({
  def,
  dbRecord,
  aiModels,
  pairingRequests,
  onApprovePairing,
  isPairingApproving,
}: {
  def: IntegrationDef;
  dbRecord?: Integration;
  aiModels?: Record<string, any>; // parsed settings.ai_models — used when def.providerKey is set
  pairingRequests?: PairingRequest[];
  onApprovePairing?: (channel: string, code: string) => void;
  isPairingApproving?: boolean;
}) {
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState<Record<string, string>>({});
  const [localConfigured, setLocalConfigured] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");

  // isConnected: for ai_models providers use configured flag; otherwise integrations table
  const isConnected = def.providerKey && aiModels
    ? aiModels[def.providerKey]?.configured === true
    : dbRecord?.is_connected ?? false;

  const hasFields = def.fields.length > 0;
  const hasCli = !!def.cliNote;
  const isExpandable = hasFields || hasCli;

  // Hydrate: ai_models providers read from settings.ai_models JSON; others from integrations table
  useEffect(() => {
    if (def.providerKey && aiModels?.[def.providerKey]) {
      const stored = aiModels[def.providerKey];
      const fieldValues: Record<string, string> = {};
      for (const field of def.fields) {
        const sk = field.storeKey || snakeToCamel(field.key);
        fieldValues[field.key] = stored[sk] || "";
      }
      setLocalConfig(fieldValues);
      setLocalConfigured(null); // reset to server state
      setDirty(false);
    } else if (dbRecord?.config && typeof dbRecord.config === "object") {
      setLocalConfig(dbRecord.config as Record<string, string>);
      setDirty(false);
    }
  }, [dbRecord?.config, def.providerKey, aiModels]);

  const updateField = (key: string, val: string) => {
    setLocalConfig((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
    setTestStatus("idle");
  };

  const testConnection = async () => {
    if (!def.providerKey && !def.testKey) return;
    setTestStatus("testing");
    setTestMsg("");
    try {
      let json: any;
      if (def.testKey) {
        // Integrations with a testKey — use /api/integrations/test endpoint
        const res = await apiRequest("POST", "/api/setup/test-integration", {
          integration: def.testKey,
          config: localConfig,
        });
        json = await res.json();
      } else if (def.providerKey) {
        // AI model providers — use existing test-model endpoint
        const apiKey = localConfig["api_key"] || "";
        const endpoint = localConfig["endpoint_url"] || localConfig["base_url"] || "";
        const res = await apiRequest("POST", "/api/setup/test-model", {
          provider: def.providerKey,
          apiKey,
          endpoint,
        });
        json = await res.json();
      } else {
        return;
      }
      if (json.success) {
        setTestStatus("ok");
        setTestMsg(json.message || "Connected");
        setDirty(true);
      } else {
        setTestStatus("fail");
        setTestMsg(json.message || "Connection failed");
      }
    } catch (err: any) {
      setTestStatus("fail");
      setTestMsg(err.message || "Connection failed");
    }
  };

  const handleToggle = (connected: boolean) => {
    if (def.providerKey && aiModels !== undefined) {
      const settingsKey = def.settingsKey ?? "ai_models";
      const updated = { ...aiModels, [def.providerKey]: { ...(aiModels[def.providerKey] || {}), configured: connected } };
      apiRequest("PATCH", `/api/settings/${settingsKey}`, { value: updated })
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }));
    } else if (dbRecord) {
      apiRequest("PATCH", `/api/integrations/${dbRecord.id}`, { is_connected: connected })
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/integrations"] }));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (def.providerKey && aiModels !== undefined) {
        // Settings-backed provider — merge changes back into the target settings JSON
        const settingsKey = def.settingsKey ?? "ai_models";
        const storeConfig: Record<string, any> = {};
        for (const field of def.fields) {
          const sk = field.storeKey || snakeToCamel(field.key);
          storeConfig[sk] = localConfig[field.key] || "";
        }
        // Save preserves the existing configured flag — toggle handles that separately
        const configured = aiModels[def.providerKey]?.configured ?? false;
        const updated = {
          ...aiModels,
          [def.providerKey]: {
            ...(aiModels[def.providerKey] || {}),
            ...storeConfig,
            configured,
          },
        };
        await apiRequest("PATCH", `/api/settings/${settingsKey}`, { value: updated });
      } else if (dbRecord) {
        await apiRequest("PATCH", `/api/integrations/${dbRecord.id}`, {
          config: localConfig,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
      if (def.pairingChannel) {
        toast({
          title: `${def.name} credentials saved — bot registered with OpenClaw`,
          description: `Next: send a message to your ${def.name} bot, then come back here to approve the pairing request.`,
          duration: 12000,
        });
      } else {
        toast({ title: `${def.name} configuration saved` });
      }
      setDirty(false);
    },
  });

  const filledFields = hasFields
    ? def.fields.filter((f) => localConfig[f.key]?.trim()).length
    : 0;
  const totalFields = def.fields.length;

  const Icon = def.icon;

  return (
    <div
      className={`border-b border-[hsl(217,14%,13%)] last:border-0 transition-colors ${
        isConnected
          ? "bg-[hsl(173,58%,44%)]/[0.03]"
          : ""
      }`}
      data-testid={`integration-${def.name.replace(/[\s\/()]/g, "-").toLowerCase()}`}
    >
      {/* Header row */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 ${
          isExpandable
            ? "cursor-pointer hover:bg-white/[0.02] transition-colors"
            : ""
        }`}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isExpandable ? (
            <span className="text-muted-foreground shrink-0 w-4">
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          ) : (
            <span className="w-4" />
          )}
          <span
            className="w-5 h-5 flex items-center justify-center shrink-0"
            style={{ color: def.iconColor || "currentColor" }}
          >
            <Icon className="w-4 h-4" />
          </span>
          <span className="text-sm font-medium">{def.name}</span>
          {hasFields && filledFields > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {filledFields}/{totalFields} fields
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          {(dbRecord || def.providerKey) ? (
            isConnected ? (
              <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-[0_0_8px_hsl(160,60%,40%,0.15)]">
                <Link2 className="w-2.5 h-2.5 mr-1" /> Connected
              </Badge>
            ) : (
              <Badge
                variant="secondary"
                className="text-[10px] bg-[hsl(217,14%,14%)] text-muted-foreground border-[hsl(217,14%,18%)]"
              >
                <Unlink className="w-2.5 h-2.5 mr-1" /> Not Configured
              </Badge>
            )
          ) : (
            <Badge
              variant="secondary"
              className="text-[10px] bg-[hsl(217,14%,12%)] text-muted-foreground/60 border-[hsl(217,14%,16%)]"
            >
              Not Configured
            </Badge>
          )}
          <Switch
            checked={isConnected}
            onCheckedChange={handleToggle}
            disabled={!dbRecord && !def.providerKey}
            data-testid={`switch-${def.name.replace(/[\s\/()]/g, "-").toLowerCase()}`}
          />
        </div>
      </div>

      {/* Expanded config panel */}
      {expanded && isExpandable && (
        <div className="px-4 pb-4 pt-1 ml-7 mr-2">
          <div className="rounded-lg border border-[hsl(217,14%,15%)] bg-[hsl(220,16%,5%)]/80 p-4 space-y-3 border-l-2 border-l-[hsl(173,58%,44%)]/40">
            {hasCli && !hasFields ? (
              // CLI-only integration
              <div className="flex items-center gap-3 py-2">
                <Terminal className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">{def.cliNote}</p>
                </div>
                <a
                  href={def.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  {def.docsLabel}
                </a>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      API Configuration
                    </span>
                  </div>
                  <a
                    href={def.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    data-testid={`docs-link-${def.name.replace(/[\s\/()]/g, "-").toLowerCase()}`}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    {def.docsLabel}
                  </a>
                </div>

                {def.fields.map((field) => (
                  <div key={field.key}>
                    <Label className="text-[11px] text-muted-foreground mb-1 block">
                      {field.label}
                    </Label>
                    {field.type === "password" ? (
                      <SecureInput
                        value={localConfig[field.key] || ""}
                        onChange={(v) => updateField(field.key, v)}
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <Input
                        type={field.type}
                        value={localConfig[field.key] || ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="text-xs font-mono bg-[hsl(220,16%,5%)]/60 border-[hsl(217,14%,18%)] focus:border-[hsl(173,58%,44%)] focus:ring-1 focus:ring-[hsl(173,58%,44%)]/30 transition-all"
                      />
                    )}
                  </div>
                ))}

                <div className="flex items-center justify-between pt-2 flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {(def.providerKey || def.testKey) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={testConnection}
                        disabled={testStatus === "testing"}
                        className="gap-1.5"
                      >
                        {testStatus === "testing"
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Zap className="w-3 h-3" />}
                        {testStatus === "testing" ? "Testing…" : "Test Connection"}
                      </Button>
                    )}
                    {testStatus === "ok" && (
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />{testMsg}
                      </span>
                    )}
                    {testStatus === "fail" && (
                      <span className="text-[11px] text-red-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />{testMsg}
                      </span>
                    )}
                    {testStatus === "idle" && (
                      <p className="text-[10px] text-muted-foreground">
                        Credentials stored encrypted in your database
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => saveMutation.mutate()}
                    disabled={!dirty || saveMutation.isPending || (!dbRecord && !def.providerKey)}
                    className="gap-1.5"
                    data-testid={`save-${def.name.replace(/[\s\/()]/g, "-").toLowerCase()}`}
                  >
                    <Save className="w-3 h-3" />
                    {saveMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>

                {/* Pairing requests — shown inline for chat channels */}
                {pairingRequests && pairingRequests.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-amber-300">
                        Pairing request{pairingRequests.length > 1 ? "s" : ""} waiting for approval
                      </span>
                    </div>
                    <p className="text-[10px] text-amber-200/70 mb-2">
                      A user messaged your {def.name} bot and needs to be approved before the bot will respond.
                    </p>
                    <div className="space-y-1.5">
                      {pairingRequests.map((pr) => (
                        <div
                          key={pr.code}
                          className="flex items-center justify-between bg-[hsl(220,16%,7%)] rounded px-2.5 py-1.5"
                        >
                          <div className="text-[11px] flex items-center gap-2">
                            <span className="font-mono text-amber-300">{pr.code}</span>
                            {pr.sender && (
                              <span className="text-muted-foreground">User: {pr.sender}</span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => onApprovePairing?.(pr.channel, pr.code)}
                            disabled={isPairingApproving}
                            className="h-6 px-2 text-[11px] gap-1 bg-amber-600 hover:bg-amber-500 text-white"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {isPairingApproving ? "Approving…" : "Approve"}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Post-save hint for chat channels with no pairing requests yet */}
                {def.pairingChannel && isConnected && (!pairingRequests || pairingRequests.length === 0) && (
                  <div className="mt-3 rounded-md border border-[hsl(217,14%,18%)] bg-[hsl(220,16%,7%)]/50 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">
                      <span className="text-primary font-medium">Next step:</span> Send a message to your {def.name} bot, then come back here to approve the pairing request that will appear above.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category Section ─────────────────────────────────────
function CategorySection({
  category,
  dbIntegrations,
  settingsBlob, // the settings object to hydrate providerKey integrations in this category
  isOpen,
  onToggle,
  pairingRequests,
  onApprovePairing,
  isPairingApproving,
}: {
  category: CategoryDef;
  dbIntegrations: Integration[];
  settingsBlob?: Record<string, any>;
  isOpen: boolean;
  onToggle: () => void;
  pairingRequests?: PairingRequest[];
  onApprovePairing?: (channel: string, code: string) => void;
  isPairingApproving?: boolean;
}) {
  const Icon = category.icon;

  // Build a map of DB records by name
  const dbByName = useMemo(() => {
    const map: Record<string, Integration> = {};
    for (const rec of dbIntegrations) {
      map[rec.name] = rec;
    }
    return map;
  }, [dbIntegrations]);

  // connectedCount: settings-backed providers use configured flag; others use integrations table
  const connectedCount = category.integrations.filter((def) => {
    if (def.providerKey && settingsBlob) return settingsBlob[def.providerKey]?.configured === true;
    return dbByName[def.name]?.is_connected;
  }).length;
  const totalCount = category.integrations.length;

  return (
    <div
      className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80"
      data-testid={`category-${category.key}`}
    >
      {/* Category header */}
      <button
        className="flex items-center gap-3 w-full px-4 py-3.5 hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
        data-testid={`toggle-section-${category.key}`}
      >
        <div className="p-2 rounded-lg bg-[hsl(173,58%,44%)]/10 text-primary border border-[hsl(173,58%,44%)]/20">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{category.label}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[hsl(217,14%,14%)] text-muted-foreground border border-[hsl(217,14%,18%)]">
              {connectedCount}/{totalCount}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {category.description}
          </p>
        </div>
        <span className="text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
      </button>

      {/* Integration rows */}
      {isOpen && (
        <div className="border-t border-[hsl(217,14%,13%)]">
          {category.integrations.map((def) => (
            <IntegrationRow
              key={def.name}
              def={def}
              dbRecord={dbByName[def.name]}
              aiModels={def.providerKey ? settingsBlob : undefined}
              pairingRequests={def.pairingChannel ? pairingRequests?.filter(r => r.channel === def.pairingChannel) : undefined}
              onApprovePairing={onApprovePairing}
              isPairingApproving={isPairingApproving}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ───────────────────────────────────
export default function SettingsPage() {
  const { data: integrations } = useQuery<Integration[]>({
    queryKey: ["/api/integrations"],
    refetchInterval: 30000,
  });
  const { data: settings } = useQuery<Setting[]>({
    queryKey: ["/api/settings"],
    refetchInterval: 30000,
  });

  // Parse settings blobs so IntegrationRow can hydrate API key fields
  const aiModels = useMemo<Record<string, any> | undefined>(() => {
    const entry = settings?.find((s) => s.setting_key === "ai_models");
    if (!entry?.setting_value || typeof entry.setting_value !== "object") return undefined;
    return entry.setting_value as Record<string, any>;
  }, [settings]);

  const searchProviders = useMemo<Record<string, any> | undefined>(() => {
    const entry = settings?.find((s) => s.setting_key === "search_providers");
    if (!entry?.setting_value) return {};
    if (typeof entry.setting_value === "object") return entry.setting_value as Record<string, any>;
    try { return JSON.parse(entry.setting_value as string); } catch { return {}; }
  }, [settings]);

  // Resyncs Pro collapsible (pre-collapsed)
  const [proExpanded, setProExpanded] = useState(false);
  const rawAdminName = settings?.find(s => s.setting_key === "admin_name")?.setting_value;
  const adminName = typeof rawAdminName === "string" ? rawAdminName.replace(/^"|"$/g, "") : String(rawAdminName || "");

  // Single-open accordion — only one section open at a time
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  const [expandedAll, setExpandedAll] = useState<string[]>([]);

  const toggleSection = (key: string) => {
    if (allExpanded) {
      // In expand-all mode, clicking toggles individually
      setExpandedAll(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    } else {
      setOpenSection(prev => prev === key ? null : key);
    }
  };
  const isSectionOpen = (key: string) => allExpanded ? expandedAll.includes(key) : openSection === key;

  const handleExpandAll = () => {
    if (allExpanded) {
      setAllExpanded(false);
      setExpandedAll([]);
    } else {
      setAllExpanded(true);
      setExpandedAll(CATEGORIES.map(c => c.key));
    }
  };

  // ── Pairing Requests ────────────────────────────────────
  const { data: pairingData } = useQuery<{ channel: string; requests: Array<{ code: string; sender: string; channel: string; timestamp?: string }> }>({
    queryKey: ["/api/system/openclaw/pairing"],
    refetchInterval: 60000, // poll every 60s for new pairing requests
  });
  const pendingPairings = pairingData?.requests || [];

  const approvePairing = useMutation({
    mutationFn: async ({ channel, code }: { channel: string; code: string }) => {
      const res = await apiRequest("POST", "/api/system/openclaw/pairing/approve", { channel, code });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/openclaw/pairing"] });
      toast({ title: "Pairing approved — user can now chat with your bot" });
    },
    onError: (err: any) => {
      toast({ title: "Pairing failed", description: err.message, variant: "destructive" });
    },
  });

  // Map category key → the settings blob its providerKey integrations read from
  const settingsBlobForCategory: Record<string, Record<string, any> | undefined> = {
    ai_models: aiModels,
    search:    searchProviders,
    local_llm: aiModels, // Ollama providerKey lives in ai_models
  };

  return (
    <div className="p-6 max-w-3xl" data-testid="page-settings">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[hsl(173,58%,44%)]/10 border border-[hsl(173,58%,44%)]/20">
              <Settings2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Settings & Integrations</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Powered by{" "}
                <a href="https://openclaw.ai/integrations" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  OpenClaw
                </a>{" "}
                — configure your AI agent's connections
              </p>
            </div>
          </div>
          <button
            onClick={handleExpandAll}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors shrink-0"
          >
            {allExpanded ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      {/* Resyncs Pro */}
      <div className="mb-4">
        <div className="rounded-lg border border-primary/30 overflow-hidden bg-primary/5">
          <button
            onClick={() => setProExpanded(!proExpanded)}
            className="w-full px-4 py-4 flex items-center gap-3 hover:bg-primary/10 transition-colors"
          >
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-left">
              <span className="text-sm font-semibold">Resyncs Pro</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Unlock team collaboration, self-learning AI, security policies, and more
              </p>
            </div>
            <Badge variant="outline" className="ml-auto text-[9px] text-primary border-primary/30 shrink-0">Core Edition</Badge>
            {proExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          </button>
          {proExpanded && (
            <div className="px-4 pb-4">
              {adminName && (
                <p className="text-xs text-muted-foreground mb-3">
                  Welcome back,{" "}
                  <a href="#/profile" className="text-primary hover:underline font-medium">{adminName}</a>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 mb-4 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5"><Users className="w-3 h-3 text-primary/60" /> Team collaboration &amp; roles</div>
                <div className="flex items-center gap-1.5"><Brain className="w-3 h-3 text-primary/60" /> Self-learning AI agents</div>
                <div className="flex items-center gap-1.5"><Key className="w-3 h-3 text-primary/60" /> Security policies &amp; audit</div>
                <div className="flex items-center gap-1.5"><Cpu className="w-3 h-3 text-primary/60" /> Advanced model routing</div>
                <div className="flex items-center gap-1.5"><Terminal className="w-3 h-3 text-primary/60" /> SSH terminal &amp; projects</div>
                <div className="flex items-center gap-1.5"><CreditCard className="w-3 h-3 text-primary/60" /> Plugin marketplace</div>
              </div>
              <div className="flex items-center gap-2">
                <Input placeholder="your@email.com" className="h-8 text-xs flex-1" />
                <Button size="sm" className="h-8 text-xs">
                  <Zap className="w-3 h-3 mr-1" /> Connect Account
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Connect your{" "}
                <a href="https://resyncs.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  resyncs.com
                </a>
                {" "}account to unlock Pro features and plugins you've purchased.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* White Label / Branding */}
      <WhiteLabelSection />

      {/* Integration categories */}
      <div className="space-y-2">
        {CATEGORIES.map((cat) => (
          <CategorySection
            key={cat.key}
            category={cat}
            dbIntegrations={integrations || []}
            settingsBlob={settingsBlobForCategory[cat.key]}
            isOpen={isSectionOpen(cat.key)}
            onToggle={() => toggleSection(cat.key)}
            pairingRequests={pendingPairings}
            onApprovePairing={(channel, code) => approvePairing.mutate({ channel, code })}
            isPairingApproving={approvePairing.isPending}
          />
        ))}
      </div>
      <div className="mt-2 text-center">
        <button
          onClick={handleExpandAll}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>


      {/* Platforms section */}
      <div className="mt-8 mb-4">
        <div className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80">
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-[hsl(262,83%,58%)]/10 text-[hsl(262,83%,68%)] border border-[hsl(262,83%,58%)]/20">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold">Platforms</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  OpenClaw native clients — configured per-device, not via API
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const PIcon = p.icon;
                return (
                  <div
                    key={p.name}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[hsl(217,14%,16%)] bg-[hsl(220,16%,7%)]/60"
                    data-testid={`platform-${p.name.replace(/[\s()]/g, "-").toLowerCase()}`}
                  >
                    <PIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs font-medium">{p.name}</span>
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    >
                      Supported
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* System panel */}
      <SystemPanel />

    </div>
  );
}

// ── System Version Panel ─────────────────────────────────
function WhiteLabelSection() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Setting[]>({ queryKey: ["/api/settings"] });
  const appName = (settings?.find(s => s.setting_key === "app_name")?.setting_value as string) || "Mission Control";
  const appLogo = (settings?.find(s => s.setting_key === "app_logo_url")?.setting_value as string) || "";
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (settings && !initialized) {
      setName(appName);
      setLogo(appLogo);
      setInitialized(true);
    }
  }, [settings, initialized, appName, appLogo]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/settings/app_name", { value: name });
      await apiRequest("PATCH", "/api/settings/app_logo_url", { value: logo });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Branding updated" });
    },
  });

  return (
    <div className="mb-4">
      <div className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80">
        <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-[hsl(220,14%,12%)]/50 transition-colors">
          <div className="p-2 rounded-lg bg-[hsl(262,83%,58%)]/10 text-[hsl(262,83%,68%)] border border-[hsl(262,83%,58%)]/20">
            <Palette className="w-4 h-4" />
          </div>
          <div className="text-left">
            <span className="text-sm font-semibold">Branding / White Label</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Customize the app name and logo shown in the sidebar and browser tab
            </p>
          </div>
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto shrink-0" />}
        </button>
        {expanded && (
        <div className="px-4 pb-3.5">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs">App Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Mission Control" className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Logo URL</Label>
              <Input value={logo} onChange={e => setLogo(e.target.value)} placeholder="https://example.com/logo.png" className="mt-1 h-8 text-xs" />
            </div>
          </div>
          {logo && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded bg-[hsl(220,16%,7%)]/60 border border-[hsl(217,14%,16%)]">
              <img src={logo} alt="Logo preview" className="w-8 h-8 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <span className="text-[10px] text-muted-foreground">Logo preview</span>
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" className="h-7 text-xs" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving..." : <><Save className="w-3 h-3 mr-1" /> Save Branding</>}
            </Button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function SystemPanel() {
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);
  const [updatingOpenclaw, setUpdatingOpenclaw] = useState(false);

  const { data: versionInfo, isLoading, refetch } = useQuery<{
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    gitCommit: string;
    releaseUrl: string | null;
    nodeVersion: string;
    platform: string;
    openclawVersion: string | null;
    openclawLatest: string | null;
    openclawUpdateAvailable: boolean;
    versionCheckNote: string | null;
    hasGit: boolean;
  }>({
    queryKey: ["/api/system/version"],
    staleTime: 60000,
  });

  const { data: settings } = useQuery<any[]>({ queryKey: ["/api/settings"] });

  const handleOpenclawUpdate = async () => {
    setUpdatingOpenclaw(true);
    try {
      const res = await apiRequest("POST", "/api/system/update-openclaw", {});
      const json = await res.json();
      if (json.success) {
        toast({ title: "OpenClaw update started", description: json.message });
        setTimeout(() => { refetch(); setUpdatingOpenclaw(false); }, 35000);
      } else {
        toast({ title: "Update failed", description: json.message, variant: "destructive" });
        setUpdatingOpenclaw(false);
      }
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
      setUpdatingOpenclaw(false);
    }
  };

  const handleUpdate = async () => {
    // Use stored admin_password_hash as a confirmation token so only the
    // admin who knows their own password can trigger a production update.
    const tokenEntry = settings?.find((s: any) => s.setting_key === "admin_password_hash");
    if (!tokenEntry?.setting_value) {
      toast({ title: "Cannot verify identity", description: "Admin password hash not found.", variant: "destructive" });
      return;
    }
    setUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/system/update", { confirmToken: tokenEntry.setting_value });
      const json = await res.json();
      if (json.success) {
        toast({ title: "Update started", description: json.message });
        // Re-check version after 40s — app will have restarted by then
        setTimeout(() => { refetch(); setUpdating(false); }, 40000);
      } else {
        toast({ title: "Update failed", description: json.message, variant: "destructive" });
        setUpdating(false);
      }
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
      setUpdating(false);
    }
  };

  return (
    <div className="mt-6">
      <div className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80">
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[hsl(173,58%,44%)]/10 text-primary border border-[hsl(173,58%,44%)]/20">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-semibold">System</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Mission Control version &amp; updates — pulls from GitHub, runs migrations, rebuilds
              </p>
            </div>
            <button
              onClick={() => refetch()}
              className="ml-auto p-1.5 rounded hover:bg-white/5 text-muted-foreground transition-colors"
              title="Refresh version info"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {isLoading ? (
            <p className="text-xs text-muted-foreground">Checking version...</p>
          ) : versionInfo ? (
            <div className="space-y-3">
              {/* Version cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[hsl(220,16%,6%)] border border-[hsl(217,14%,14%)] px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground mb-1">Installed Version</p>
                  <p className="text-sm font-mono font-semibold">v{versionInfo.currentVersion}</p>
                  {versionInfo.gitCommit && versionInfo.gitCommit !== "unknown" && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">#{versionInfo.gitCommit}</p>
                  )}
                </div>
                <div className="rounded-lg bg-[hsl(220,16%,6%)] border border-[hsl(217,14%,14%)] px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground mb-1">Latest Release</p>
                  {versionInfo.latestVersion ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-mono font-semibold">v{versionInfo.latestVersion}</p>
                      {versionInfo.updateAvailable ? (
                        <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/25">
                          <AlertTriangle className="w-2.5 h-2.5 mr-1" />Update available
                        </Badge>
                      ) : (
                        <Badge className="text-[9px] bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Up to date
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {versionInfo.versionCheckNote || "Unable to reach GitHub"}
                    </p>
                  )}
                  {versionInfo.releaseUrl && (
                    <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-primary hover:underline mt-0.5 inline-flex items-center gap-1">
                      Release notes <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* OpenClaw version row */}
              <div className="rounded-lg bg-[hsl(220,16%,6%)] border border-[hsl(217,14%,14%)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">OpenClaw Version</p>
                    {versionInfo.openclawVersion ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-mono font-semibold">{versionInfo.openclawVersion}</p>
                        {versionInfo.openclawUpdateAvailable ? (
                          <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/25">
                            <AlertTriangle className="w-2.5 h-2.5 mr-1" />{versionInfo.openclawLatest} available
                          </Badge>
                        ) : (
                          <Badge className="text-[9px] bg-emerald-500/15 text-emerald-400 border-emerald-500/25">
                            <CheckCircle2 className="w-2.5 h-2.5 mr-1" />Up to date
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-amber-400/80">Not detected — install OpenClaw or check PATH</p>
                    )}
                  </div>
                  {versionInfo.openclawUpdateAvailable && (
                    <Button size="sm" onClick={handleOpenclawUpdate} disabled={updatingOpenclaw} className="gap-1.5 shrink-0">
                      {updatingOpenclaw
                        ? <><RefreshCw className="w-3 h-3 animate-spin" />Updating...</>
                        : <><RefreshCw className="w-3 h-3" />Update OpenClaw</>
                      }
                    </Button>
                  )}
                </div>
              </div>

              {/* Server info */}
              <div className="flex gap-4 text-[10px] text-muted-foreground font-mono px-1 flex-wrap">
                <span>Node {versionInfo.nodeVersion}</span>
                <span>{versionInfo.platform}</span>
              </div>

              {/* Update button — pulls code, runs migrations, rebuilds, restarts */}
              {versionInfo.updateAvailable && (
                <div className="pt-1 border-t border-[hsl(217,14%,13%)] flex items-center gap-3">
                  {versionInfo.hasGit ? (
                    <>
                      <Button size="sm" onClick={handleUpdate} disabled={updating} className="gap-1.5 mt-3">
                        {updating
                          ? <><RefreshCw className="w-3 h-3 animate-spin" />Updating...</>
                          : <><RefreshCw className="w-3 h-3" />Update to v{versionInfo.latestVersion}</>
                        }
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-3">
                        Pulls latest from GitHub, runs <code className="font-mono">npm run migrate</code> for any new DB changes, rebuilds, and restarts.
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-amber-400/80 mt-3">
                      v{versionInfo.latestVersion} available — this install was deployed from a zip. To enable one-click updates, redeploy using <code className="font-mono">git clone</code>.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Version info unavailable</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Channel Connection Monitor ──────────────────────────

interface ChannelStatus {
  name: string;
  configured: boolean;
  connected: boolean;
  lastMessage?: string;
  error?: string;
}

const channelIcons: Record<string, any> = {
  Discord: SiDiscord,
  WhatsApp: SiWhatsapp,
  Telegram: SiTelegram,
  Slack: SiSlack,
  Signal: SiSignal,
};

const channelColors: Record<string, string> = {
  Discord: "#5865F2",
  WhatsApp: "#25D366",
  Telegram: "#2AABEE",
  Slack: "#4A154B",
  Signal: "#3A76F0",
};

function ChannelMonitor() {
  const { data, isLoading } = useQuery<{ channels: ChannelStatus[]; gatewayRunning: boolean }>({
    queryKey: ["/api/channels/status"],
    refetchInterval: 60000,
  });

  // Don't render at all until first load completes — prevents layout jump
  if (isLoading || !data) return null;

  const channels = data?.channels || [];
  if (channels.length === 0) return null;

  const configuredCount = channels.filter(c => c.configured).length;
  const connectedCount = channels.filter(c => c.connected).length;

  return (
    <div className="mt-8 mb-4">
      <div className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80">
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-[hsl(173,58%,44%)]/10 text-[hsl(173,58%,44%)] border border-[hsl(173,58%,44%)]/20">
              <MessageCircle className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold">Channel Connections</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Real-time status of messaging platform connections
              </p>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {connectedCount}/{configuredCount} connected
            </div>
          </div>

          <div className="space-y-2">
            {channels.map((ch) => {
              const Icon = channelIcons[ch.name] || MessageCircle;
              const color = channelColors[ch.name] || "#888";
              return (
                <div key={ch.name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[hsl(220,16%,7%)] border border-[hsl(217,14%,14%)]">
                  <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                  <span className="text-sm flex-1">{ch.name}</span>
                  {!ch.configured ? (
                    <Badge variant="outline" className="text-[9px] text-zinc-500 bg-zinc-500/10">
                      <Unlink className="w-2.5 h-2.5 mr-1" />Not Configured
                    </Badge>
                  ) : ch.connected ? (
                    <Badge variant="outline" className="text-[9px] text-emerald-400 bg-emerald-500/10">
                      <Link2 className="w-2.5 h-2.5 mr-1" />Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] text-amber-400 bg-amber-500/10">
                      <AlertTriangle className="w-2.5 h-2.5 mr-1" />Configured
                    </Badge>
                  )}
                  {ch.error && (
                    <span className="text-[9px] text-red-400 truncate max-w-[150px]" title={ch.error}>{ch.error}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── API Connections Section ──────────────────────────────

interface ApiConn {
  id: number;
  name: string;
  description: string | null;
  category: string;
  base_url: string;
  auth_type: string;
  is_connected: boolean;
  last_tested: string | null;
  last_error: string | null;
  icon: string | null;
  color: string | null;
}

const API_CATEGORIES = [
  "custom", "crm", "real_estate", "signing", "marketing", "analytics",
  "payments", "communication", "storage", "productivity", "ai", "other",
];

const AUTH_TYPES = [
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth (User/Pass)" },
  { value: "custom_header", label: "Custom Header" },
  { value: "oauth2", label: "OAuth 2.0" },
  { value: "none", label: "No Auth" },
];

function ApiConnectionsSection() {
  const [createOpen, setCreateOpen] = useState(false);
  const { toast } = useToast();

  const { data: connections } = useQuery<ApiConn[]>({
    queryKey: ["/api/api-connections"],
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => { await apiRequest("DELETE", `/api/api-connections/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/api-connections"] }); toast({ title: "Connection deleted" }); },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/api-connections/${id}/test`);
      return res.json();
    },
    onSuccess: (data: any, id: number) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-connections"] });
      if (data.error) {
        toast({ title: "Test failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Connection successful", description: `${data.status} ${data.statusText} (${data.duration_ms}ms)` });
      }
    },
  });

  const conns = connections || [];

  return (
    <div className="mt-8 mb-4">
      <div className="rounded-lg border border-[hsl(217,14%,13%)] overflow-hidden bg-[hsl(220,14%,9%)]/80">
        <div className="px-4 py-3.5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,60%)] border border-[hsl(38,92%,50%)]/20">
              <Globe className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-semibold">API Connections</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Connect unlimited 3rd-party APIs — credentials encrypted with AES-256-GCM
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground mr-2">
              {conns.filter(c => c.is_connected).length}/{conns.length} connected
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreateOpen(true)}>
              <ExternalLink className="w-3 h-3 mr-1" /> Add API
            </Button>
          </div>

          {conns.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-muted-foreground">No custom API connections yet.</p>
              <p className="text-[10px] text-muted-foreground mt-1">Add connections to CRM, signing, real estate, or any REST API. The CEO agent can also create these via chat.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conns.map(conn => (
                <div key={conn.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[hsl(220,16%,7%)] border border-[hsl(217,14%,14%)]">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: (conn.color || "#f59e0b") + "20" }}>
                    <Globe className="w-4 h-4" style={{ color: conn.color || "#f59e0b" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{conn.name}</span>
                      <span className="text-[9px] bg-accent px-1.5 py-0.5 rounded">{conn.category}</span>
                      <span className="text-[9px] text-muted-foreground">{conn.auth_type}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{conn.base_url}</p>
                    {conn.last_error && <p className="text-[9px] text-red-400 truncate">{conn.last_error}</p>}
                  </div>
                  {conn.is_connected ? (
                    <Badge variant="outline" className="text-[9px] text-emerald-400 bg-emerald-500/10 shrink-0">
                      <Link2 className="w-2.5 h-2.5 mr-1" />Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] text-zinc-400 bg-zinc-500/10 shrink-0">
                      <Unlink className="w-2.5 h-2.5 mr-1" />Not Tested
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={() => testMutation.mutate(conn.id)} disabled={testMutation.isPending}>
                    {testMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Test"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 shrink-0" onClick={() => { if (confirm(`Delete "${conn.name}"?`)) deleteMutation.mutate(conn.id); }}>
                    <AlertTriangle className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      {createOpen && <CreateApiDialog onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

function CreateApiDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState("api_key");
  const [category, setCategory] = useState("custom");
  const [description, setDescription] = useState("");
  const [testEndpoint, setTestEndpoint] = useState("");
  const [credKey, setCredKey] = useState("");    // api_key or token
  const [credUser, setCredUser] = useState("");   // basic auth username
  const [credPass, setCredPass] = useState("");   // basic auth password
  const [headerName, setHeaderName] = useState("X-API-Key"); // custom header name
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/api-connections", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-connections"] });
      toast({ title: "API connection created" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const buildCredentials = (): Record<string, string> => {
    switch (authType) {
      case "api_key": return { api_key: credKey, header_name: headerName };
      case "bearer": return { token: credKey };
      case "basic": return { username: credUser, password: credPass };
      case "custom_header": return { [headerName]: credKey };
      default: return {};
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[hsl(220,16%,10%)] border border-border rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Add API Connection</h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., FollowUp Boss" className="mt-1 h-8" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs">
                {API_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Base URL</Label>
            <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="mt-1 h-8" />
          </div>

          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this API is for" className="mt-1 h-8" />
          </div>

          <div>
            <Label className="text-xs">Auth Type</Label>
            <select value={authType} onChange={e => setAuthType(e.target.value)} className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs">
              {AUTH_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Credential fields based on auth type */}
          {authType === "api_key" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Header Name</Label>
                <Input value={headerName} onChange={e => setHeaderName(e.target.value)} placeholder="X-API-Key" className="mt-1 h-8" />
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input type="password" value={credKey} onChange={e => setCredKey(e.target.value)} placeholder="Your API key" className="mt-1 h-8" />
              </div>
            </div>
          )}
          {authType === "bearer" && (
            <div>
              <Label className="text-xs">Bearer Token</Label>
              <Input type="password" value={credKey} onChange={e => setCredKey(e.target.value)} placeholder="Your bearer token" className="mt-1 h-8" />
            </div>
          )}
          {authType === "basic" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Username</Label>
                <Input value={credUser} onChange={e => setCredUser(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <Label className="text-xs">Password</Label>
                <Input type="password" value={credPass} onChange={e => setCredPass(e.target.value)} className="mt-1 h-8" />
              </div>
            </div>
          )}
          {authType === "custom_header" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Header Name</Label>
                <Input value={headerName} onChange={e => setHeaderName(e.target.value)} className="mt-1 h-8" />
              </div>
              <div>
                <Label className="text-xs">Header Value</Label>
                <Input type="password" value={credKey} onChange={e => setCredKey(e.target.value)} className="mt-1 h-8" />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Test Endpoint (optional)</Label>
            <Input value={testEndpoint} onChange={e => setTestEndpoint(e.target.value)} placeholder="/me or /ping" className="mt-1 h-8" />
          </div>

          <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-500/5 border border-emerald-500/20">
            <Key className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] text-emerald-400">Credentials are encrypted with AES-256-GCM before storage. They are never exposed in API responses.</span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!name.trim() || !baseUrl.trim() || createMutation.isPending} onClick={() => createMutation.mutate({
              name: name.trim(),
              base_url: baseUrl.trim(),
              auth_type: authType,
              category,
              description: description.trim() || null,
              test_endpoint: testEndpoint.trim() || null,
              credentials: buildCredentials(),
            })}>
              {createMutation.isPending ? "Creating..." : "Create Connection"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
