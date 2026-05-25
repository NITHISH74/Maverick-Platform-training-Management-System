import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/useAuth";

// Pages
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Batches from "@/pages/Batches";
import BatchDetail from "@/pages/BatchDetail";
import Candidates from "@/pages/Candidates";
import CandidateDetail from "@/pages/CandidateDetail";
import Assessments from "@/pages/Assessments";
import Attendance from "@/pages/Attendance";
import Toppers from "@/pages/Toppers";
import Feedback from "@/pages/Feedback";
// The Coordinator Copilot is intentionally NOT a routed page — it's a
// slide-over panel mounted at Layout level and opened from the header
// button or the sidebar entry. See components/CopilotContext.tsx.
import Notifications from "@/pages/Notifications";
import Users from "@/pages/Users";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";
import Reports from "@/pages/Reports";

// Root path handler. When Auth0 redirects back from a login, the URL is
// `/?code=...&state=...` — if we blindly <Redirect to="/dashboard">, wouter
// strips the query string before the Auth0 SDK can read it, so login never
// completes and we end up in a Sign-in → Accept loop. Instead, show a spinner
// while Auth0 finishes, then route based on auth state.
function RootGate() {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }
  return <Redirect to={isAuthenticated ? "/dashboard" : "/login"} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={RootGate} />
      <Route path="/login" component={Login} />
      
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/batches" component={Batches} />
      <ProtectedRoute path="/batches/:id" component={BatchDetail} />
      <ProtectedRoute path="/candidates" component={Candidates} />
      <ProtectedRoute path="/candidates/:id" component={CandidateDetail} />
      <ProtectedRoute path="/assessments" component={Assessments} />
      <ProtectedRoute path="/attendance" component={Attendance} />
      <ProtectedRoute path="/toppers" component={Toppers} />
      <ProtectedRoute path="/feedback" component={Feedback} />
      {/* /copilot and /chatbot intentionally have no routes. The Copilot
          is a slide-over panel — see Layout.tsx + CopilotContext.tsx.
          Stale bookmarks fall through to the NotFound route below, which
          is the right signal (the URL never represented real state). */}
      <ProtectedRoute path="/notifications" component={Notifications} />
      <ProtectedRoute path="/users" component={Users} allowedRoles={["admin"]} />
      <ProtectedRoute path="/audit" component={AuditLog} allowedRoles={["admin", "coordinator"]} />
      <ProtectedRoute path="/settings" component={Settings} allowedRoles={["admin", "coordinator"]} />
      <ProtectedRoute path="/reports" component={Reports} allowedRoles={["admin", "coordinator"]} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
