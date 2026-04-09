import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Setting } from "@shared/schema";
import {
  User, Mail, Phone, MessageCircle, Save, Lock, Bell,
  Smartphone, MessageSquare,
} from "lucide-react";

export default function ProfilePage() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Setting[]>({ queryKey: ["/api/settings"] });

  // Extract current values from settings
  const getSetting = (key: string, fallback = "") => {
    const raw = settings?.find(s => s.setting_key === key)?.setting_value;
    if (!raw) return fallback;
    return typeof raw === "string" ? raw.replace(/^"|"$/g, "") : String(raw);
  };

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [chatChoice, setChatChoice] = useState("web");
  const [ccEmail, setCcEmail] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  useEffect(() => {
    if (settings && !initialized) {
      setName(getSetting("admin_name"));
      setEmail(getSetting("admin_email"));
      setPhone(getSetting("admin_phone"));
      setChatChoice(getSetting("admin_chat_preference", "web"));
      setCcEmail(getSetting("admin_cc_email"));
      setInitialized(true);
    }
  }, [settings, initialized]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/settings/admin_name", { value: name });
      await apiRequest("PATCH", "/api/settings/admin_email", { value: email });
      await apiRequest("PATCH", "/api/settings/admin_phone", { value: phone });
      await apiRequest("PATCH", "/api/settings/admin_chat_preference", { value: chatChoice });
      await apiRequest("PATCH", "/api/settings/admin_cc_email", { value: ccEmail });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Profile updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/change-password", { current: currentPw, new: newPw });
    },
    onSuccess: () => {
      toast({ title: "Password changed" });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-2xl" data-testid="page-profile">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Profile</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Manage your account details and preferences</p>
          </div>
        </div>
      </div>

      {/* Personal Info */}
      <div className="rounded-lg border border-[hsl(217,14%,13%)] bg-[hsl(220,14%,9%)]/80 p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <User className="w-4 h-4 text-primary" /> Personal Information
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Full Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 h-8 text-xs" />
          </div>
        </div>
      </div>

      {/* Contact & Notifications */}
      <div className="rounded-lg border border-[hsl(217,14%,13%)] bg-[hsl(220,14%,9%)]/80 p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" /> Contact & Notifications
        </h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-xs">Phone Number</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555-000-0000" className="mt-1 h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">CC Email (notifications)</Label>
            <Input type="email" value={ccEmail} onChange={e => setCcEmail(e.target.value)} placeholder="backup@company.com" className="mt-1 h-8 text-xs" />
          </div>
        </div>
        <div className="mb-3">
          <Label className="text-xs">Preferred Chat Channel</Label>
          <Select value={chatChoice} onValueChange={setChatChoice}>
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="web">Web Chat (built-in)</SelectItem>
              <SelectItem value="discord">Discord</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* SMS Failover — Plugin placeholder */}
        <div className="rounded-md border border-dashed border-[hsl(217,14%,18%)] bg-[hsl(220,16%,7%)]/40 p-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">SMS Failover Notifications</span>
                <Badge variant="outline" className="text-[8px] text-amber-400 border-amber-400/30">Coming Soon</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                Get SMS alerts when you have unchecked emails, chats, or agent alerts. Available as a Pro plugin.
              </p>
            </div>
          </div>
        </div>
        {/* TODO: SMS failover plugin — when activated:
          - Phone number field above feeds into SMS provider (Twilio/Vonage)
          - Toggle: "Send SMS when notifications are unread for X minutes"
          - Configure alert threshold (5min, 15min, 30min, 1hr)
          - Alert types: unread emails, unread chats, agent errors, approval requests
          - Delivered via Resyncs Pro plugin system
        */}
      </div>

      {/* Save Profile */}
      <div className="flex justify-end mb-6">
        <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Saving..." : <><Save className="w-3 h-3 mr-1" /> Save Profile</>}
        </Button>
      </div>

      {/* Change Password */}
      <div className="rounded-lg border border-[hsl(217,14%,13%)] bg-[hsl(220,14%,9%)]/80 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-primary" /> Change Password
        </h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Current Password</Label>
            <Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} className="mt-1 h-8 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">New Password</Label>
              <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Confirm New Password</Label>
              <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className="mt-1 h-8 text-xs" />
            </div>
          </div>
          {newPw && confirmPw && newPw !== confirmPw && (
            <p className="text-[10px] text-red-400">Passwords don't match</p>
          )}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={!currentPw || !newPw || newPw !== confirmPw || passwordMutation.isPending}
              onClick={() => passwordMutation.mutate()}>
              {passwordMutation.isPending ? "Changing..." : <><Lock className="w-3 h-3 mr-1" /> Change Password</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
