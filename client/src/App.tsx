import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect, useRef, useState } from "react";
import { queryClient, apiRequest, prefetchCoreData } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import CalendarPage from "@/pages/CalendarPage";
import Reports from "@/pages/Reports";
import Analytics from "@/pages/Analytics";
import ActivityFeed from "@/pages/ActivityFeed";
import SettingsPage from "@/pages/SettingsPage";
import AgentProfile from "@/pages/AgentProfile";
import Approvals from "@/pages/Approvals";
import ProfilePage from "@/pages/ProfilePage";
import SetupWizard from "@/pages/SetupWizard";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";

function AppRouter() {
  // ── Step 1: Is setup complete? ───────────────────────
  const { data: setupStatus, isLoading: setupLoading } = useQuery<{ isSetupComplete: boolean }>({
    queryKey: ["/api/setup/status"],
    staleTime: 30000,
  });

  // ── Step 2: Is the user authenticated? ──────────────
  const isSetupComplete = setupStatus?.isSetupComplete ?? false;

  const { data: authData, isLoading: authLoading } = useQuery<{ authenticated: boolean; email?: string }>({
    queryKey: ["/api/auth/me"],
    enabled: isSetupComplete,
    staleTime: 60000,
    retry: false,
  });

  // Don't show spinner for more than 2 seconds — fall through to login/wizard
  const [spinnerTimeout, setSpinnerTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpinnerTimeout(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const [location] = useHashLocation();

  // Prefetch core data as soon as auth confirms logged in
  // Fire-and-forget — NEVER blocks rendering
  const prefetched = useRef(false);
  useEffect(() => {
    if (authData?.authenticated && !prefetched.current) {
      prefetched.current = true;
      prefetchCoreData().catch(() => {});
    }
  }, [authData?.authenticated]);

  // ── Loading spinner (max 2 seconds) ──────────────────
  if (!spinnerTimeout && (setupLoading || (isSetupComplete && authLoading))) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading Mission Control...</p>
        </div>
      </div>
    );
  }

  // ── Setup not complete → wizard ──────────────────────
  if (!isSetupComplete) {
    return <SetupWizard />;
  }

  // ── Setup complete but not logged in → login ─────────
  if (!authData?.authenticated) {
    return <LoginPage />;
  }

  // ── Redirect /setup away once done ──────────────────
  if (location === "/setup") {
    return <Redirect to="/" />;
  }

  // ── Full app ─────────────────────────────────────────
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/reports" component={Reports} />
        <Route path="/reports/:id" component={Reports} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/activity" component={ActivityFeed} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/agents/:id">{(params) => <AgentProfile id={params.id} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
