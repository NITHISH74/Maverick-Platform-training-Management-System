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
        {/* Name + role stacked per F5 spec ("add role label below the user's
            name"). Keeps the existing pill style as the role indicator but
            moves it below the name on a second line for clearer hierarchy. */}
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-foreground">{user?.name}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground capitalize">
              {user?.role}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </header>
  );
}
