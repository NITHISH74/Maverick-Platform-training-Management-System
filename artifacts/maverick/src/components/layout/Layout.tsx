import { ReactNode, useCallback, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { CopilotContext } from "@/components/CopilotContext";
import { CopilotPanel } from "@/components/CopilotPanel";

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Single source of truth for the Copilot panel — both Header (button) and
  // Sidebar (nav item) call openCopilot() via context. The panel itself is
  // mounted once, here, so opening it from anywhere just toggles a boolean.
  const [copilotOpen, setCopilotOpen] = useState(false);
  const openCopilot = useCallback(() => setCopilotOpen(true), []);
  const closeCopilot = useCallback(() => setCopilotOpen(false), []);
  const ctx = useMemo(
    () => ({ open: copilotOpen, openCopilot, closeCopilot }),
    [copilotOpen, openCopilot, closeCopilot],
  );

  return (
    <CopilotContext.Provider value={ctx}>
      <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-auto bg-muted/20 p-6">
            {children}
          </main>
        </div>
      </div>
      <CopilotPanel open={copilotOpen} onClose={closeCopilot} />
    </CopilotContext.Provider>
  );
}
