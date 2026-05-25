import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Sparkles, User } from "lucide-react";
import { useLogout } from "@workspace/api-client-react";
import { useCopilot } from "@/components/CopilotContext";

export function Header() {
  const { user, logout } = useAuth();
  const logoutMutation = useLogout();
  const { openCopilot } = useCopilot();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        logout();
      }
    });
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="font-semibold text-lg tracking-tight">
        Execution Platform
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={openCopilot}
          data-testid="copilot-open"
        >
          <Sparkles className="h-4 w-4 mr-2 text-primary" />
          Copilot
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-4 w-4" />
          <span>{user?.name}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary capitalize">
            {user?.role}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </header>
  );
}
