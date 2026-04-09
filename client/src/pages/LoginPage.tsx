import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, prefetchCoreData } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Eye, EyeOff, AlertCircle, ArrowRight, UserPlus, CheckCircle } from "lucide-react";

type LoginState = "email" | "login" | "setup" | "not_found";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<LoginState>("email");
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [setupDone, setSetupDone] = useState(false);

  // Branding from settings
  const { data: brandSettings } = useQuery<any[]>({ queryKey: ["/api/settings"] });
  const appName = (brandSettings?.find((s: any) => s.setting_key === "app_name")?.setting_value as string) || "Mission Control";
  const appLogo = (brandSettings?.find((s: any) => s.setting_key === "app_logo_url")?.setting_value as string) || "";

  // Step 1: Check email status
  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.status === "has_password") {
        setState("login");
        setUserName(data.name);
        setUserRole(data.role);
      } else if (data.status === "needs_setup") {
        setState("setup");
        setUserName(data.name);
        setUserRole(data.role);
      } else {
        setState("not_found");
      }
    },
  });

  // Step 2a: Normal login
  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Invalid password");
      }
      return res.json();
    },
    onSuccess: () => {
      prefetchCoreData().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  // Step 2b: Set password (first-time setup)
  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Setup failed");
      return data;
    },
    onSuccess: () => {
      setSetupDone(true);
      // Auto-login after 1.5s
      setTimeout(() => {
        loginMutation.mutate();
      }, 1500);
    },
  });

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    checkMutation.mutate();
  }

  function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    loginMutation.mutate();
  }

  function handleSetupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || password.length < 8 || password !== confirmPassword) return;
    setupMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            {appLogo ? (
              <img src={appLogo} alt={appName} className="w-5 h-5 object-contain" />
            ) : (
              <Zap className="w-5 h-5 text-primary-foreground" />
            )}
          </div>
          <span className="text-xl font-semibold">{appName}</span>
        </div>

        <Card className="p-6 border-card-border">

          {/* ── Step 1: Enter Email ── */}
          {state === "email" && (
            <>
              <div className="mb-5">
                <h1 className="text-base font-semibold">Welcome</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enter your email to sign in or set up your account
                </p>
              </div>
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com" className="mt-1" autoComplete="email" autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={!email.trim() || checkMutation.isPending}>
                  {checkMutation.isPending ? "Checking..." : <>Continue <ArrowRight className="w-4 h-4 ml-1" /></>}
                </Button>
              </form>
            </>
          )}

          {/* ── Step 2a: Login (has password) ── */}
          {state === "login" && (
            <>
              <div className="mb-5">
                <h1 className="text-base font-semibold">Welcome back, {userName}</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enter your password to sign in
                </p>
              </div>
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/50 text-xs">
                  <span className="text-muted-foreground">{email}</span>
                  <button type="button" onClick={() => { setState("email"); setPassword(""); }} className="ml-auto text-primary text-[10px] hover:underline">Change</button>
                </div>
                <div>
                  <Label className="text-xs">Password</Label>
                  <div className="relative mt-1">
                    <Input
                      type={showPassword ? "text" : "password"} value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                      className="pr-9" autoComplete="current-password" autoFocus
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {loginMutation.isError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {loginMutation.error?.message || "Invalid password"}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={!password || loginMutation.isPending}>
                  {loginMutation.isPending ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </>
          )}

          {/* ── Step 2b: First-time password setup ── */}
          {state === "setup" && !setupDone && (
            <>
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <UserPlus className="w-5 h-5 text-primary" />
                  <h1 className="text-base font-semibold">Welcome, {userName}!</h1>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your admin has added you as <strong className="text-foreground">{userRole}</strong>. Set your password to get started.
                </p>
              </div>
              <form onSubmit={handleSetupSubmit} className="space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/50 text-xs">
                  <span className="text-muted-foreground">{email}</span>
                </div>
                <div>
                  <Label className="text-xs">Create Password (min 8 characters)</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Choose a strong password" className="mt-1" autoFocus />
                </div>
                <div>
                  <Label className="text-xs">Confirm Password</Label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password" className="mt-1" />
                </div>
                {password && confirmPassword && password !== confirmPassword && (
                  <p className="text-[11px] text-destructive">Passwords don't match</p>
                )}
                {setupMutation.isError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {setupMutation.error?.message || "Setup failed"}
                  </div>
                )}
                <Button type="submit" className="w-full"
                  disabled={!password || password.length < 8 || password !== confirmPassword || setupMutation.isPending}>
                  {setupMutation.isPending ? "Setting up..." : "Set Password & Sign In"}
                </Button>
              </form>
            </>
          )}

          {/* ── Setup success → auto-login ── */}
          {state === "setup" && setupDone && (
            <div className="text-center py-4">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <h2 className="text-base font-semibold">You're all set!</h2>
              <p className="text-xs text-muted-foreground mt-1">Signing you in...</p>
            </div>
          )}

          {/* ── Email not found ── */}
          {state === "not_found" && (
            <>
              <div className="mb-5">
                <h1 className="text-base font-semibold">Access Required</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <strong>{email}</strong> isn't registered on this system.
                </p>
              </div>
              <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 mb-4">
                Contact your admin to be added as a team member.
              </div>
              <Button variant="outline" className="w-full" onClick={() => { setState("email"); setEmail(""); }}>
                Try a different email
              </Button>
            </>
          )}

        </Card>

        <p className="text-center text-[10px] text-muted-foreground mt-4">
          {appName} — AI Agent Command Center
        </p>
      </div>
    </div>
  );
}
