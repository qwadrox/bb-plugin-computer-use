import { useEffect, useId, useState, type ReactNode } from "react";
import { EASE_BOUNCE_CLASS, EASE_OUT_CLASS } from "@/components/ui/motion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { State } from "../server";

export type Host = State["hosts"][number];
export type InstallState = Host["install"];
export type InstallPhase = "idle" | "running" | "done" | "failed";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The install lifecycle that the progress copy, the dialog and the setup summary all read. */
export function installPhase(install: InstallState): InstallPhase {
  if (install.running) return "running";
  if (install.ok === false) return "failed";
  if (install.ok === true) return "done";
  return "idle";
}

export function SectionState({ error }: { error: string | null }) {
  return (
    <p className={error === null ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role={error === null ? "status" : "alert"}>
      {error ?? "Loading…"}
    </p>
  );
}

export const LINK_CLASS = "rounded-sm text-foreground underline underline-offset-4 hover:text-foreground/80";

/** Link to a Cua or store page: opens in a new tab with a visible keyboard focus ring. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={`inline-flex ${LINK_CLASS} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** One tooltip provider per settings section, so skipDelayDuration lets a pointer sweeping across the "?" hints open each one without waiting again. */
export function SectionTooltips({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={120} skipDelayDuration={300}>
      {children}
    </TooltipProvider>
  );
}

/**
 * Hover-revealed "?" that keeps a row to one line. The row opts in with
 * `group/row`: hovering it slides the icon in, and hovering or focusing the
 * icon opens the detail in a portaled tooltip, so collapsible panels (which
 * clip overflow while animating) can never cut it off. Needs a SectionTooltips
 * above it.
 */
export function Hint({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          data-row-hint
          className={`grid size-5 shrink-0 -translate-x-1 place-items-center rounded-full text-muted-foreground opacity-0 transition-[opacity,transform,color] duration-[140ms] motion-reduce:transition-none ${EASE_OUT_CLASS} group-hover/row:translate-x-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:translate-x-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=delayed-open]:translate-x-0 data-[state=delayed-open]:opacity-100 data-[state=instant-open]:translate-x-0 data-[state=instant-open]:opacity-100`}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6.4 6.4c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6c0 1.1-1.6 1.2-1.6 2.4M8 11.1v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

export function Disclosure({
  label,
  meta,
  children,
  defaultOpen = false,
  forceOpen = false,
  ariaLabel,
}: {
  label: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const triggerId = useId();

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <div>
      <button
        id={triggerId}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {meta}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`size-4 transition-transform duration-[180ms] motion-reduce:transition-none ${EASE_BOUNCE_CLASS} ${open ? "rotate-180" : ""}`}
          >
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          </svg>
        </span>
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        inert={!open}
        data-state={open ? "open" : "closed"}
        className={`grid overflow-hidden transition-[grid-template-rows] duration-[180ms] motion-reduce:transition-none ${EASE_OUT_CLASS} ${open ? "grid-rows-[1fr]" : "pointer-events-none grid-rows-[0fr]"}`}
      >
        <div
          className={`min-h-0 overflow-hidden transition-[opacity,transform] duration-[140ms] motion-reduce:transition-none ${open ? `translate-y-0 opacity-100 ${EASE_BOUNCE_CLASS}` : `-translate-y-1 opacity-0 ${EASE_OUT_CLASS}`}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
