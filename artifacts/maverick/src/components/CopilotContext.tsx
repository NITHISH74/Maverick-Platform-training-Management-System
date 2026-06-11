/**
 * Single-surface Copilot wiring.
 *
 * The Coordinator Copilot has one canonical UI — the slide-over panel
 * mounted at Layout level. Both the header "Copilot" button and the
 * sidebar entry call `openCopilot()` from this context to open it.
 *
 * We deliberately removed the standalone /copilot full-page route — having
 * two surfaces for the same feature is a UX smell (it duplicated state,
 * confused users about where to start, and caused the slide-over to render
 * on top of the page version when both were triggered).
 */

import { createContext, useContext } from "react";

interface CopilotContextValue {
  open: boolean;
  openCopilot: () => void;
  closeCopilot: () => void;
}

export const CopilotContext = createContext<CopilotContextValue>({
  open: false,
  openCopilot: () => {},
  closeCopilot: () => {},
});

export function useCopilot(): CopilotContextValue {
  return useContext(CopilotContext);
}
