import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "@/lib/query-client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";

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
import Notifications from "@/pages/Notifications";
import Users from "@/pages/Users";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";
import Reports from "@/pages/Reports";

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
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
