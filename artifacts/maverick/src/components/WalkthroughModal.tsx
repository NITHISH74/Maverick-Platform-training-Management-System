import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, Sparkles } from "lucide-react";
import {
  getWalkthroughSections,
  WALKTHROUGH_SEEN_KEY,
  type WalkthroughSection,
  type WalkthroughStep,
} from "@/data/walkthrough";

/**
 * Role-specific in-app walkthrough (F4).
 *
 * Structure:
 *   - Left sidebar lists every section the current role is allowed to see
 *     (admin sees all three; coordinators/trainers see only their own).
 *   - Main area shows one step at a time from the selected section, with
 *     Previous / Next navigation and a "Got it" close button on the last
 *     step of the last section.
 *
 * State / persistence:
 *   - Opens automatically on first login when `walkthrough_seen` is absent
 *     from localStorage (see <Header>'s effect, not here — this component
 *     is purely presentational and parent-controlled).
 *   - Closing always sets `walkthrough_seen=true` so it doesn't auto-open
 *     on subsequent logins. The Help button in the header reopens it.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  role: string | undefined;
}

export function WalkthroughModal({ open, onClose, role }: Props) {
  const [, navigate] = useLocation();
  const sections = useMemo(() => getWalkthroughSections(role), [role]);

  // Track which section + which step inside it we're on. Whenever the
  // modal opens fresh, jump back to the very first step so a re-open from
  // the Help button doesn't drop the user mid-section.
  const [sectionIdx, setSectionIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    if (open) {
      setSectionIdx(0);
      setStepIdx(0);
    }
  }, [open]);

  // Mark seen as soon as the modal is closed in any way (Got it button,
  // backdrop click, ESC). Idempotent — repeated writes are fine.
  function handleClose() {
    try {
      localStorage.setItem(WALKTHROUGH_SEEN_KEY, "true");
    } catch {
      // Storage may be unavailable (private mode, etc.). The Help button
      // still lets the user reopen later — we just lose the "don't show on
      // next login" guarantee, which is acceptable.
    }
    onClose();
  }

  if (!sections.length) return null;
  const currentSection = sections[Math.min(sectionIdx, sections.length - 1)];
  const currentStep: WalkthroughStep | undefined = currentSection?.steps[stepIdx];

  // Flattened position helps render "step N of M total".
  const totalSteps = sections.reduce((sum, s) => sum + s.steps.length, 0);
  const positionWithinAll =
    sections
      .slice(0, sectionIdx)
      .reduce((sum, s) => sum + s.steps.length, 0) +
    stepIdx +
    1;

  const isFirst = sectionIdx === 0 && stepIdx === 0;
  const isLast =
    sectionIdx === sections.length - 1 &&
    stepIdx === (currentSection?.steps.length ?? 1) - 1;

  function goNext() {
    if (!currentSection) return;
    if (stepIdx + 1 < currentSection.steps.length) {
      setStepIdx(stepIdx + 1);
    } else if (sectionIdx + 1 < sections.length) {
      setSectionIdx(sectionIdx + 1);
      setStepIdx(0);
    } else {
      handleClose();
    }
  }
  function goPrev() {
    if (stepIdx > 0) {
      setStepIdx(stepIdx - 1);
    } else if (sectionIdx > 0) {
      const prev = sections[sectionIdx - 1];
      setSectionIdx(sectionIdx - 1);
      setStepIdx(prev.steps.length - 1);
    }
  }

  function jumpTo(sIdx: number, stIdx: number) {
    setSectionIdx(sIdx);
    setStepIdx(stIdx);
  }

  function openLink(href: string) {
    handleClose();
    navigate(href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={openState => {
        if (!openState) handleClose();
      }}
    >
      <DialogContent
        className="max-w-5xl w-[95vw] h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        data-testid="walkthrough-modal"
      >
        <DialogTitle className="sr-only">
          Welcome — quick tour of the Maverick Execution Platform
        </DialogTitle>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — table of contents */}
          <aside className="w-64 border-r bg-muted/30 hidden md:flex md:flex-col">
            <div className="px-4 py-4 border-b">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                Welcome aboard
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Quick tour, tailored to your role.
              </p>
            </div>
            <ScrollArea className="flex-1">
              <nav className="p-2 space-y-1">
                {sections.map((section: WalkthroughSection, sIdx: number) => (
                  <div key={section.id} className="space-y-0.5">
                    <div className="px-2 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {section.title}
                    </div>
                    {section.steps.map((step: WalkthroughStep, stIdx: number) => {
                      const isCurrent = sIdx === sectionIdx && stIdx === stepIdx;
                      const isVisited =
                        sIdx < sectionIdx ||
                        (sIdx === sectionIdx && stIdx < stepIdx);
                      return (
                        <button
                          key={`${section.id}-${stIdx}`}
                          type="button"
                          onClick={() => jumpTo(sIdx, stIdx)}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors",
                            isCurrent
                              ? "bg-primary/10 text-primary font-medium"
                              : isVisited
                              ? "text-muted-foreground hover:bg-muted"
                              : "text-foreground hover:bg-muted",
                          )}
                        >
                          {isVisited && !isCurrent ? (
                            <Check className="h-3 w-3 shrink-0 text-primary" />
                          ) : (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full shrink-0",
                                isCurrent ? "bg-primary" : "bg-muted-foreground/40",
                              )}
                            />
                          )}
                          <span className="truncate">{step.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </ScrollArea>
          </aside>

          {/* Main content */}
          <section className="flex-1 flex flex-col overflow-hidden">
            <header className="border-b px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {currentSection.title}
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight mt-0.5">
                    {currentStep?.title}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {positionWithinAll} of {totalSteps}
                </span>
              </div>
            </header>

            <ScrollArea className="flex-1">
              <div className="px-6 py-6 max-w-2xl space-y-4">
                <div className="rounded-lg border bg-card p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <BookOpen className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm leading-relaxed text-foreground">
                      {currentStep?.body}
                    </p>
                  </div>
                  {currentStep?.link && (
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openLink(currentStep.link!.href)}
                      >
                        {currentStep.link.label}
                        <ArrowUpRight className="h-3.5 w-3.5 ml-2" />
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Tip — you can reopen this tour any time by clicking the help icon
                  in the top navigation.
                </p>
              </div>
            </ScrollArea>

            <footer className="border-t px-6 py-3 flex items-center justify-between bg-muted/20">
              <Button
                variant="ghost"
                size="sm"
                onClick={goPrev}
                disabled={isFirst}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleClose}>
                  {isLast ? "Got it" : "Skip"}
                </Button>
                {!isLast && (
                  <Button size="sm" onClick={goNext}>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
                {isLast && (
                  <Button size="sm" onClick={handleClose}>
                    Finish
                    <Check className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </div>
            </footer>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
