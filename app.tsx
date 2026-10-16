import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc, type PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EASE_BOUNCE_CLASS, EASE_OUT_CLASS } from "@/components/ui/motion";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { rpcContract } from "./server";

type State = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer R
  ? Extract<R, { providers: unknown }>
  : never;

type Mode = State["mode"];
type Override = State["providers"][number]["override"];
type Host = State["hosts"][number];
type InstallState = Host["install"];
type ToolView = State["tools"][number];
type Exposure = ToolView["exposure"];
type InstallTarget = "tested" | "latest";
type BrowserView = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> extends infer R
  ? Extract<R, { extensionId: unknown }>
  : never;

const CUA_DOCS_URL = "https://cua.ai/docs";
const EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/aaidacbpcgjigclcoffjlcpnkmpnpgcc";
const CUA_INSTALL_URL = "https://cua.ai/docs/how-to-guides/driver/install";
const CUA_SOURCE_URL = "https://github.com/trycua/cua";

const MODES: Array<{ value: Mode; title: string; detail: string }> = [
  {
    value: "prefer-native",
    title: "Prefer provider tools",
    detail: "Use a provider's own computer use when available. Otherwise, use Cua Driver.",
  },
  {
    value: "cua-everywhere",
    title: "Always use Cua Driver",
    detail: "Use Cua Driver for every provider.",
  },
  { value: "off", title: "Off", detail: "Do not add Cua Driver tools. Provider tools still work." },
];

const OVERRIDES: Array<{ value: Override; label: string }> = [
  { value: "inherit", label: "Follow mode" },
  { value: "cua", label: "Cua Driver" },
  { value: "native", label: "Harness-native" },
  { value: "off", label: "Off" },
];

const EXPOSURE_LABELS: Record<Exposure, string> = {
  tool: "Dedicated tool",
  call: "cua_call only",
  off: "Off",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isState(value: unknown): value is State {
  return typeof value === "object" && value !== null && "providers" in value && "hosts" in value;
}

function useComputerUseState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await rpc.call("getState");
      setState(next);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("state-changed", () => {
    void load();
  });

  async function run(label: string, operation: () => Promise<unknown>): Promise<void> {
    setBusy(label);
    try {
      const result = await operation();
      if (isState(result)) setState(result);
      else await load();
    } catch (runError) {
      toast.error(errorMessage(runError));
    } finally {
      setBusy(null);
    }
  }

  return { rpc, state, error, busy, run };
}

function SectionState({ error }: { error: string | null }) {
  return (
    <p className={error === null ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role={error === null ? "status" : "alert"}>
      {error ?? "Loading…"}
    </p>
  );
}

const LINK_CLASS = "rounded-sm text-foreground underline underline-offset-4 hover:text-foreground/80";

/** Link to a Cua or store page: opens in a new tab with a visible keyboard focus ring. */
function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={`inline-flex ${LINK_CLASS} focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** One tooltip provider per settings section, so skipDelayDuration lets a pointer sweeping across the "?" hints open each one without waiting again. */
function SectionTooltips({ children }: { children: ReactNode }) {
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
function Hint({ label, children }: { label: string; children: string }) {
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

function Disclosure({
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

function decisionTone(decision: State["providers"][number]["decision"]): string {
  if (decision === "cua") return "text-foreground";
  if (decision === "native") return "text-muted-foreground";
  return "text-muted-foreground line-through";
}

export function RoutingSettings() {
  const { rpc, state, error, busy, run } = useComputerUseState();
  if (state === null) return <SectionState error={error} />;

  return (
    <SectionTooltips>
      <div role="radiogroup" aria-label="Routing mode" className="space-y-1">
        {MODES.map((mode) => (
          <label key={mode.value} className="group/row flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-state-hover">
            <input
              type="radio"
              name="cua-mode"
              value={mode.value}
              checked={state.mode === mode.value}
              disabled={busy !== null}
              onChange={() => void run("mode", () => rpc.call("setMode", { mode: mode.value }))}
            />
            <span className="text-sm font-medium">{mode.title}</span>
            <Hint label={mode.title}>{mode.detail}</Hint>
          </label>
        ))}
      </div>
    </SectionTooltips>
  );
}

export function ProviderOverridesSettings() {
  const { rpc, state, error, busy, run } = useComputerUseState();
  if (state === null) return <SectionState error={error} />;

  return (
    <SectionTooltips>
      <Disclosure label="Override routing for individual providers" meta={`${state.providers.length} providers`}>
        <div data-provider-list className="mt-2 divide-y divide-border/60">
          {state.providers.map((provider) => (
            <div key={provider.id} className="flex min-h-12 items-center gap-3 px-3 py-3">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-sm font-medium">{provider.displayName}</span>
                <span className={`truncate text-xs ${decisionTone(provider.decision)}`}>{provider.decisionLabel}</span>
              </div>
              <select
                aria-label={`${provider.displayName} override`}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                value={provider.override}
                disabled={busy !== null}
                onChange={(event) =>
                  void run(provider.id, () =>
                    rpc.call("setOverride", { providerId: provider.id, override: event.target.value as Override }),
                  )
                }
              >
                {OVERRIDES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {state.providers.length === 0 ? <p className="px-2 py-4 text-sm text-muted-foreground">No providers available.</p> : null}
        </div>
      </Disclosure>
    </SectionTooltips>
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

type InstallPhase = "idle" | "running" | "done" | "failed";

/** The install lifecycle that the progress copy, the dialog and the setup summary all read. */
function installPhase(install: InstallState): InstallPhase {
  if (install.running) return "running";
  if (install.ok === false) return "failed";
  if (install.ok === true) return "done";
  return "idle";
}

function installPresentation(install: InstallState): { label: string; percent: number } {
  const phase = installPhase(install);
  if (phase === "done") return { label: "Installation complete", percent: 100 };
  if (phase === "failed") return { label: "Installation failed", percent: 100 };
  if (install.step === "download") return { label: "Downloading Cua Driver", percent: 20 };
  if (install.step === "install") return { label: "Installing Cua Driver", percent: 60 };
  if (install.step === "autostart" || install.step === "start-service") return { label: "Starting the driver service", percent: 88 };
  return { label: "Preparing installation", percent: 8 };
}

function InstallerProgress({ install }: { install: InstallState }) {
  const presentation = installPresentation(install);
  const failed = install.ok === false;

  return (
    <div className="space-y-2.5">
      <div className={`flex items-center gap-2 text-sm font-medium ${failed ? "text-destructive" : "text-foreground"}`} role="status" aria-live="polite">
        {install.running ? <Spinner /> : null}
        <span>{presentation.label}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Estimated installation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={presentation.percent}
        aria-valuetext={`${presentation.label}, approximately ${presentation.percent}%`}
        className={`h-2 w-full overflow-hidden rounded-full ${failed ? "bg-destructive/15" : "bg-muted"}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${failed ? "bg-destructive" : "bg-foreground"}`}
          style={{ width: `${presentation.percent}%` }}
        />
      </div>
      {install.running ? <p className="text-xs text-muted-foreground">Progress is estimated from the installer phase. You can close this dialog and reopen it from the machine row.</p> : null}
    </div>
  );
}

function InstallerOutput({ host }: { host: Host }) {
  return (
    <Disclosure
      key={`${host.id}:${host.install.startedAt ?? "idle"}`}
      label="Installation details"
      meta={host.install.tail.length > 0 ? `${host.install.tail.length} lines` : undefined}
      forceOpen={host.install.ok === false}
    >
      <pre
        className="mt-2 max-h-52 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground"
        aria-label={`Installer output for ${host.name}`}
      >
        {host.install.tail.length > 0 ? host.install.tail.join("\n") : "Waiting for installer output…"}
      </pre>
    </Disclosure>
  );
}

function InstallDialog({
  host,
  testedVersion,
  open,
  onOpenChange,
  onInstall,
  installing,
}: {
  host: Host;
  testedVersion: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (target: InstallTarget) => Promise<void>;
  installing: boolean;
}) {
  const installed = host.driver?.installed === true;
  const current = installed ? host.driver?.version ?? null : null;
  const latest = host.driver?.latestVersion ?? null;
  const retryTarget: InstallTarget = installTarget(host.install, testedVersion);
  const install = host.install;
  const phase = installPhase(install);
  const idle = phase === "idle";
  const failed = phase === "failed";
  const completed = phase === "done";
  const title = phase === "running"
    ? "Installing Cua Driver"
    : failed
      ? "Cua Driver installation failed"
      : completed
        ? "Cua Driver installed"
        : installed
          ? `Change Cua Driver on ${host.name}`
          : `Install Cua Driver on ${host.name}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {idle
              ? `This runs Cua's official ${host.driver?.platform === "win32" ? "install.ps1" : "install.sh"} installer on ${host.name} as your user. The tested release's installer comes from its GitHub release and runs only if every file matches the checksum recorded in this plugin; the newest release uses Cua's unpinned script. It does not request administrator access.`
              : phase === "running"
                ? `The official Cua installer is running on ${host.name}${install.target ? ` (v${install.target})` : " (newest release)"}.`
                : failed
                  ? "The installer stopped before Desktop & Browser Agent was ready. Review the details below, then retry."
                  : "Desktop & Browser Agent can now connect to this machine through Cua Driver."}
          </DialogDescription>
        </DialogHeader>

        {idle ? (
          <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              This plugin release was tested with <strong className="font-medium text-foreground">v{testedVersion}</strong>
              {current !== null ? <> and this machine runs v{current}</> : null}. A newer release can add or change tools; Desktop & Browser Agent then keeps tools it has not reviewed off until you allow them.
            </p>
            {installed ? (
              <p>The running driver is stopped first and restarted afterwards.</p>
            ) : (
              <p>On macOS, you will still approve Accessibility and Screen Recording after installation.</p>
            )}
            <TextLink href={CUA_INSTALL_URL}>Review Cua Driver installation docs</TextLink>
          </div>
        ) : (
          <>
            <InstallerProgress install={install} />
            <InstallerOutput host={host} />
          </>
        )}

        <DialogFooter>
          {idle ? (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button variant="outline" disabled={installing} onClick={() => void onInstall("latest")}>
                {latest !== null && latest !== testedVersion ? `Newest v${latest} (untested)` : "Newest release"}
              </Button>
              <Button disabled={installing || current === testedVersion} onClick={() => void onInstall("tested")}>
                {installing ? "Starting…" : current === testedVersion ? `v${testedVersion} installed` : `Install v${testedVersion}`}
              </Button>
            </>
          ) : phase === "running" ? (
            <DialogClose asChild>
              <Button variant="outline">Continue in background</Button>
            </DialogClose>
          ) : failed ? (
            <>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button disabled={installing} onClick={() => void onInstall(retryTarget)}>
                {installing ? "Starting…" : "Retry installation"}
              </Button>
            </>
          ) : (
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function installTarget(install: InstallState, testedVersion: string): InstallTarget {
  return install.target === undefined || install.target === testedVersion ? "tested" : "latest";
}

type SetupCheckState = "complete" | "required" | "waiting" | "automatic";

interface SetupCheck {
  label: string;
  detail?: string;
  meta?: string;
  state: SetupCheckState;
}

/** Badge copy and text tone per state. A complete check renders as a bare tick, so it has no entry. */
const SETUP_STATES: Record<Exclude<SetupCheckState, "complete">, { label: string; tone: string }> = {
  required: { label: "Action required", tone: "text-foreground" },
  automatic: { label: "Automatic", tone: "text-muted-foreground" },
  waiting: { label: "Not checked", tone: "text-muted-foreground" },
};

/** A macOS screen-capture consent that was refused or is blocked, as the driver reports it. */
function directCaptureDenied(directCapture: string | null | undefined): boolean {
  return /denied|blocked|missing|error/i.test(directCapture ?? "");
}

function permissionCheck(label: string, value: boolean | null | undefined): SetupCheck {
  if (value === true) return { label, state: "complete" };
  if (value === false) return { label, detail: "Grant this permission to continue", state: "required" };
  return { label, detail: "Check again after approving this permission", state: "waiting" };
}

function setupChecks(host: Host, testedVersion: string): SetupCheck[] {
  const driver = host.driver;
  const checks: SetupCheck[] = [
    {
      label: "Machine connection",
      detail: host.status === "connected" ? undefined : "Bring this machine online in bb",
      state: host.status === "connected" ? "complete" : "required",
    },
    {
      label: "Cua Driver",
      meta:
        driver?.installed && driver.version !== null
          ? driver.version === testedVersion
            ? `v${driver.version} · tested`
            : `v${driver.version} · untested`
          : undefined,
      detail:
        driver === null
          ? "Check setup to inspect this machine"
          : driver.installed && driver.version !== testedVersion
            ? `This plugin was tested with v${testedVersion}`
            : undefined,
      state: driver === null ? "waiting" : driver.installed ? "complete" : "required",
    },
  ];
  if (driver?.installed) {
    checks.push({
      label: "Driver service",
      detail:
        driver.connected || driver.daemonRunning === true
          ? undefined
          : driver.daemonRunning === false
            ? "Starts automatically on the first tool call"
            : "Checked automatically when a tool runs",
      state: driver.connected || driver.daemonRunning === true ? "complete" : "automatic",
    });
  }
  if (driver?.platform === "darwin" && driver.installed) {
    checks.push(
      permissionCheck("Accessibility", driver.permissions?.accessibility),
      permissionCheck("Screen Recording", driver.permissions?.screenRecording),
    );
    const directCapture = driver.permissions?.directCapture ?? null;
    const denied = directCaptureDenied(directCapture);
    const directCaptureReady = directCapture !== null && /granted|ready|available|authorized|capturable|ok/i.test(directCapture);
    checks.push({
      label: "Direct screen capture",
      detail: denied
        ? "Consent was denied; run the permission guide again"
        : directCaptureReady
          ? undefined
          : "macOS may ask once when the first screenshot is taken",
      state: denied ? "required" : directCaptureReady ? "complete" : "automatic",
    });
  }
  return checks;
}

function CheckIcon({ state }: { state: "required" | "waiting" }) {
  if (state === "required") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-destructive">
        <circle cx="10" cy="10" r="8" fill="currentColor" opacity="0.12" />
        <path d="M10 5.8v5.1m0 3v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-muted-foreground">
      <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

function SetupStateBadge({ state }: { state: SetupCheckState }) {
  if (state === "complete") {
    return (
      <span aria-label="Ready" data-setup-state={state} className="grid size-6 shrink-0 place-items-center">
        <span className="grid size-4 place-items-center rounded-full border border-border/60 bg-background">
          <svg aria-hidden="true" viewBox="0 0 12 12" className="size-2.5 text-success/60">
            <path d="m2.5 6.2 2.1 2.1 4.9-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          </svg>
        </span>
      </span>
    );
  }

  const { label, tone } = SETUP_STATES[state];
  return (
    <span
      data-setup-state={state}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted/60 px-2 py-1 text-xs font-medium ${tone}`}
    >
      {state === "required" ? (
        <span className="grid size-4 place-items-center rounded-full border border-border/60 bg-background text-destructive/70">
          <svg aria-hidden="true" viewBox="0 0 12 12" className="size-2.5">
            <path d="M6 2.5v4.2m0 2.3v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
          </svg>
        </span>
      ) : (
        <span className="grid size-4 place-items-center rounded-full border border-border bg-background">
          <span className="size-1 rounded-full bg-muted-foreground" />
        </span>
      )}
      {label}
    </span>
  );
}

function MachineConnectionDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-machine-connection={online ? "online" : "offline"}
      className="relative grid size-5 shrink-0 place-items-center"
    >
      {online ? (
        <>
          <span className="absolute size-2.5 rounded-full bg-success/25 motion-safe:animate-pulse" />
          <span className="relative size-1.5 rounded-full bg-success shadow-[0_0_6px_var(--success)]" />
        </>
      ) : (
        <span className="size-1.5 rounded-full border border-muted-foreground/70 bg-muted/50" />
      )}
    </span>
  );
}

function MachineSetupPanel({
  host,
  testedVersion,
  onRefresh,
  onOpenInstall,
  onGrant,
  busy,
}: {
  host: Host;
  testedVersion: string;
  onRefresh: () => void;
  onOpenInstall: () => void;
  onGrant: () => void;
  busy: string | null;
}) {
  const driver = host.driver;
  const install = host.install;
  const online = host.status === "connected";

  if (!online) {
    return (
      <div role="listitem" data-machine-row>
        <div className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-3 text-sm text-foreground">
          <span className="flex min-w-0 items-center gap-3">
            <MachineConnectionDot online={false} />
            <span className="truncate font-medium">{host.name}</span>
          </span>
          <span className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">Offline</span>
        </div>
      </div>
    );
  }

  const refreshing = busy === `status:${host.id}`;
  const granting = busy === `grant:${host.id}`;
  const canInstall = driver !== null && !driver.installed;
  // Changing versions reuses the installer flow: it stops the driver, installs the chosen release and restarts it.
  const offTested = driver !== null && driver.installed && driver.version !== testedVersion;
  const newerUntested = driver !== null && driver.installed && !offTested && driver.updateAvailable === true;
  const canUpdate = offTested || newerUntested;
  const canGrant =
    driver?.platform === "darwin" &&
    driver.installed &&
    (driver.permissions?.accessibility !== true ||
      driver.permissions?.screenRecording !== true ||
      directCaptureDenied(driver.permissions?.directCapture));
  const checks = setupChecks(host, testedVersion);
  const drift = host.drift?.drifted === true ? host.drift : null;
  const requiredChecks = checks.filter((check) => check.state !== "automatic");
  const completeCount = requiredChecks.filter((check) => check.state === "complete").length;
  const needsAction = requiredChecks.some((check) => check.state === "required" || check.state === "waiting");
  const phase = installPhase(install);
  let summary = needsAction ? "Setup needs attention" : "Ready";
  if (phase === "running") {
    summary = installPresentation(install).label;
  } else if (phase === "failed") {
    summary = "Installation failed";
  }
  const summaryTone = phase === "failed" ? "text-destructive-text" : needsAction || phase === "running" ? "text-warning-text" : "text-success-foreground";
  const showRefresh = needsAction && phase !== "running";
  const showActions = canInstall || canUpdate || canGrant || showRefresh;

  return (
    <div role="listitem" data-machine-row>
      <Disclosure
        ariaLabel={`${host.name} setup, online, ${summary}, ${completeCount} of ${requiredChecks.length}`}
        defaultOpen={needsAction || install.running}
        forceOpen={install.ok === false}
        label={
          <span className="flex min-w-0 items-center gap-3">
            <MachineConnectionDot online />
            <span className="truncate">{host.name}</span>
          </span>
        }
        meta={
          !needsAction && !install.running && install.ok !== false ? (
            <span data-machine-summary className={summaryTone}>Ready</span>
          ) : (
            <span>
              <span className={summaryTone}>{summary}</span>
              <span className="text-muted-foreground"> · {completeCount}/{requiredChecks.length}</span>
            </span>
          )
        }
      >
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <ol className="divide-y divide-border/50" aria-label={`Setup checklist for ${host.name}`}>
            {checks.map((check) => (
              <li key={check.label} className="group/row flex items-center justify-between gap-4 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{check.label}</span>
                  {check.meta ? <span className="shrink-0 text-xs text-muted-foreground">{check.meta}</span> : null}
                  {check.detail ? <Hint label={check.label}>{check.detail}</Hint> : null}
                </span>
                <SetupStateBadge state={check.state} />
              </li>
            ))}
          </ol>

          {drift !== null ? (
            <div className="mt-2 flex gap-3 py-2" data-driver-drift>
              <CheckIcon state="waiting" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {drift.summary} New tools that are not read-only stay off until you allow them under Agent tools.
              </p>
            </div>
          ) : null}

          {driver?.error ? (
            <div className="mt-2 flex gap-3 py-2" role="alert">
              <CheckIcon state="required" />
              <p className="text-xs leading-relaxed text-muted-foreground">{driver.error}</p>
            </div>
          ) : null}

          {showActions ? (
            <div className="mt-3 grid gap-2">
              {canInstall || canUpdate ? (
                <Button
                  className="min-h-10 w-full rounded-full"
                  variant={newerUntested && !install.running && install.ok !== false ? "outline" : "default"}
                  disabled={busy !== null && !install.running}
                  onClick={onOpenInstall}
                >
                  {phase === "running"
                    ? "View progress"
                    : phase === "failed"
                      ? "Retry install…"
                      : offTested
                        ? `Switch to tested v${testedVersion}…`
                        : newerUntested
                          ? `v${driver?.latestVersion ?? "newer"} available (untested)…`
                          : "Install Cua Driver…"}
                </Button>
              ) : null}
              {canGrant ? (
                <Button className="min-h-10 w-full rounded-full" disabled={busy !== null} onClick={onGrant}>
                  {granting ? "Opening permission guide…" : "Grant macOS permissions"}
                </Button>
              ) : null}
              {showRefresh ? (
                <Button className="min-h-10 w-full rounded-full" variant="outline" disabled={refreshing} onClick={onRefresh}>
                  {refreshing ? "Checking setup…" : "Check setup"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}

function ManualInstallHelp({ testedVersion }: { testedVersion: string }) {
  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <Disclosure label="Troubleshooting and manual commands">
        <div className="space-y-3 px-2 pt-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Diagnose the driver with <code className="text-foreground">cua-driver doctor</code>. macOS/Linux install of the tested release: <code className="break-all text-foreground">CUA_DRIVER_RS_VERSION={testedVersion} /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"</code>. Windows: <code className="break-all text-foreground">$env:CUA_DRIVER_RS_VERSION="{testedVersion}"; irm https://cua.ai/driver/install.ps1 | iex</code>. Leave the variable out for the newest release.
          </p>
          <p>
            macOS permissions: <code className="text-foreground">cua-driver permissions grant</code>. Approve every prompt for CuaDriver.app, then fully relaunch it if macOS asks.
          </p>
          <TextLink href={CUA_INSTALL_URL}>Open Cua Driver installation docs</TextLink>
        </div>
      </Disclosure>
    </div>
  );
}

export function DriverMachinesSettings() {
  const { rpc, state, error, busy, run } = useComputerUseState();
  const [installHostId, setInstallHostId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  if (state === null) return <SectionState error={error} />;

  const installHost = state.hosts.find((host) => host.id === installHostId) ?? null;

  return (
    <SectionTooltips>
      {state.hosts.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">No machines enrolled.</p>
      ) : (
        <div
          role="list"
          aria-label="Machines"
          data-machine-list
          className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-background"
        >
          {state.hosts.map((host) => (
            <MachineSetupPanel
              key={host.id}
              host={host}
              testedVersion={state.testedVersion}
              busy={busy}
              onRefresh={() => void run(`status:${host.id}`, () => rpc.call("refreshStatus", { hostId: host.id }))}
              onOpenInstall={() => {
                setInstallHostId(host.id);
                setDialogOpen(true);
              }}
              onGrant={() =>
                void run(`grant:${host.id}`, async () => {
                  const result = await rpc.call("grantPermissions", { hostId: host.id });
                  if (result.ok) toast.success(result.output);
                  else toast.error(result.output);
                })
              }
            />
          ))}
        </div>
      )}
      <ManualInstallHelp testedVersion={state.testedVersion} />
      {installHost === null ? null : (
        <InstallDialog
          host={installHost}
          testedVersion={state.testedVersion}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          installing={busy === `install:${installHost.id}`}
          onInstall={(target) =>
            run(`install:${installHost.id}`, () => rpc.call("installDriver", { hostId: installHost.id, target }))
          }
        />
      )}
    </SectionTooltips>
  );
}

function ToolRow({ tool, busy, onChange }: { tool: ToolView; busy: boolean; onChange: (value: Exposure | "default") => void }) {
  return (
    <div className="group/row flex min-h-11 items-center gap-3 px-3 py-2" data-tool-row={tool.name}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <code className="truncate text-sm text-foreground">{tool.name}</code>
        {tool.source === "unreviewed" ? (
          <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">new</span>
        ) : null}
        {!tool.groupEnabled ? (
          <span className="shrink-0 text-xs text-muted-foreground">{tool.group} tools off</span>
        ) : null}
        {tool.asksFirst && tool.exposure !== "off" ? (
          <span className="shrink-0 rounded-full bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground">asks first</span>
        ) : null}
        <Hint label={tool.name}>{tool.summary || "No description."}</Hint>
      </span>
      <select
        aria-label={`${tool.name} exposure`}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
        value={tool.override ?? "default"}
        disabled={busy}
        onChange={(event) => onChange(event.target.value as Exposure | "default")}
      >
        <option value="default">Default ({EXPOSURE_LABELS[tool.defaultExposure]})</option>
        {(["tool", "call", "off"] as const).map((value) => (
          <option key={value} value={value}>
            {EXPOSURE_LABELS[value]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AgentToolsSettings() {
  const { rpc, state, error, busy, run } = useComputerUseState();
  if (state === null) return <SectionState error={error} />;

  const count = (exposure: Exposure) => state.tools.filter((tool) => tool.exposure === exposure).length;
  const unreviewed = state.tools.filter((tool) => tool.source === "unreviewed" && tool.override === null);
  const sections: Array<{ exposure: Exposure; title: string }> = [
    { exposure: "tool", title: "Dedicated tools" },
    { exposure: "call", title: "Reachable through cua_call" },
    { exposure: "off", title: "Off" },
  ];

  return (
    <SectionTooltips>
      <div className="space-y-2">
        <p className="px-3 text-xs leading-relaxed text-muted-foreground">
          Dedicated tools are offered in every session. Tools reachable through cua_call cost no prompt space until an agent asks for them. Off tools are refused everywhere, cua_call and <code>bb cua call</code> included. This decides what agents are offered; it is not a sandbox for agents that can run a shell.
        </p>
        {unreviewed.length > 0 ? (
          <p className="px-3 text-xs leading-relaxed text-muted-foreground" data-unreviewed-tools>
            {unreviewed.length} tool{unreviewed.length === 1 ? "" : "s"} from a newer Cua Driver {unreviewed.length === 1 ? "has" : "have"} not been reviewed: read-only ones are reachable through cua_call, the rest stay off.
          </p>
        ) : null}
        <Disclosure
          label="Customize individual tools"
          meta={`${count("tool")} dedicated · ${count("call")} via cua_call · ${count("off")} off`}
        >
          <div className="mt-2 space-y-3">
            {sections.map((section) => {
              const tools = state.tools.filter((tool) => tool.exposure === section.exposure);
              if (tools.length === 0) return null;
              return (
                <div key={section.exposure} role="group" aria-label={section.title}>
                  <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{section.title}</p>
                  <div className="divide-y divide-border/60">
                    {tools.map((tool) => (
                      <ToolRow
                        key={tool.name}
                        tool={tool}
                        busy={busy !== null}
                        onChange={(exposure) => void run(`tool:${tool.name}`, () => rpc.call("setExposure", { tool: tool.name, exposure }))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Disclosure>
      </div>
    </SectionTooltips>
  );
}

function useBrowserView() {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<BrowserView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await rpc.call("browserState"));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("state-changed", () => {
    void load();
  });

  async function run(label: string, operation: () => Promise<BrowserView>): Promise<void> {
    setBusy(label);
    try {
      setView(await operation());
    } catch (runError) {
      toast.error(errorMessage(runError));
    } finally {
      setBusy(null);
    }
  }

  return { rpc, view, error, busy, run, load };
}

function CopyPath({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all text-foreground">{value}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => toast.success("Copied"),
            () => toast.error("Could not copy"),
          )
        }
      >
        Copy
      </Button>
    </span>
  );
}

/** The optional Browser Bridge for bb: off until the user turns it on here. */
export function BrowserExtensionSettings() {
  const { rpc, view, error, busy, run, load } = useBrowserView();
  if (view === null) return <SectionState error={error} />;

  const connected = view.hosts.flatMap((host) => host.bridge?.connections ?? []);

  return (
    <SectionTooltips>
      <div className="space-y-3">
        <label className="group/row flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-state-hover">
          <input
            type="checkbox"
            checked={view.enabled}
            disabled={busy !== null}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run("toggle", () => rpc.call("setBrowserExtension", { enabled }));
            }}
          />
          <span className="text-sm font-medium">Offer browser_* tools (extension)</span>
          <Hint label="browser tools">
            Agents work in the tabs of your everyday browser, in the background, while you use other tabs. Tabs they open go into a purple Agent group. The browser shows a debugging bar while an agent is attached. Optional: nothing changes until you turn it on.
          </Hint>
          <span className="ml-auto text-xs text-muted-foreground">
            {connected.length > 0 ? `Connected: ${connected.map((entry) => entry.browser).join(", ")}` : "No browser connected"}
          </span>
        </label>

        {view.enabled ? (
          <div className="space-y-3 px-3 text-xs leading-relaxed text-muted-foreground" data-browser-setup>
            {view.hosts.length === 0 ? <p>No machine is online.</p> : null}
            {view.hosts.map((host) => {
              const bridge = host.bridge;
              const detected = bridge?.browsers.filter((entry) => entry.detected) ?? [];
              return (
                <div key={host.id} className="space-y-2 rounded-lg border border-border/70 bg-background p-3" data-browser-host={host.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{host.name}</span>
                    {bridge === null ? null : !bridge.supported ? (
                      <span>Not supported on this system</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={bridge.installed ? "outline" : "default"}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`bridge:${host.id}`, () =>
                            rpc.call("browserSetup", { hostId: host.id, action: bridge.installed ? "uninstall" : "install" }),
                          )
                        }
                      >
                        {busy === `bridge:${host.id}` ? "Working…" : bridge.installed ? "Remove bridge" : "Install bridge"}
                      </Button>
                    )}
                  </div>
                  {host.error !== null ? <p className="text-destructive">{host.error}</p> : null}
                  {bridge !== null && bridge.supported ? (
                    <p>
                      {detected.length === 0
                        ? "No Chromium browser found (Brave, Chrome, Edge, Chromium)."
                        : detected.map((entry) => `${entry.name}: ${entry.registered ? "ready" : "not set up"}`).join(" · ")}
                      {bridge.connections.length > 0
                        ? ` · connected: ${bridge.connections.map((entry) => `${entry.browser} (extension ${entry.extension})`).join(", ")}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Install the bridge above. It lets the extension talk to bb on this machine; Remove bridge undoes it.</li>
              <li>
                Add{" "}
                <a className={LINK_CLASS} href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
                  Browser Bridge for bb from the Chrome Web Store
                </a>
                . To run a local build instead, open <code className="text-foreground">brave://extensions</code> or <code className="text-foreground">chrome://extensions</code>, turn on Developer mode, choose Load unpacked, and pick
                {view.extensionDir === null ? (
                  <> the <code className="text-foreground">browser-extension/dist</code> folder of this plugin (build it with <code className="text-foreground">npm run build:extension</code>).</>
                ) : (
                  <> this folder (build it first with <code className="text-foreground">npm run build:extension</code>):<CopyPath value={view.extensionDir} /></>
                )}
              </li>
              <li>
                Agents can use any tab. Tabs they open go into a purple <strong className="font-medium text-foreground">Agent</strong> group. Pause them from the extension's toolbar button, or by closing the debugging bar.
              </li>
            </ol>
            <p>
              Extension id <code className="text-foreground">{view.extensionId}</code>. Browser Bridge for bb ships with this plugin; it is not an official bb or Cua AI product.{" "}
              <button type="button" className={LINK_CLASS} onClick={() => void load()}>
                Check again
              </button>
            </p>
          </div>
        ) : null}
      </div>
    </SectionTooltips>
  );
}

interface ApprovalRequest {
  tool: string;
  shownName: string;
  reason: string;
  arguments: string;
}

function readApproval(payload: unknown): ApprovalRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { tool, shownName, reason, arguments: args } = payload as Record<string, unknown>;
  if (typeof tool !== "string" || typeof reason !== "string") return null;
  return {
    tool,
    shownName: typeof shownName === "string" ? shownName : `cua_${tool}`,
    reason,
    arguments: typeof args === "string" ? args : "{}",
  };
}

/** Asks the user to allow one sensitive driver call (Ask before sensitive actions). */
export function ApproveToolCard({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const [answering, setAnswering] = useState(false);
  const request = readApproval(interaction.payload);
  const answer = (action: () => Promise<void>) => {
    setAnswering(true);
    void action().catch((error: unknown) => {
      toast.error(errorMessage(error));
      setAnswering(false);
    });
  };

  return (
    <div className="space-y-3 p-3" data-approval-request={request?.tool}>
      <p className="text-sm font-medium text-foreground">{interaction.title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {request === null ? (
          "The agent wants to use a sensitive Cua Driver tool."
        ) : (
          <>
            The agent wants to {request.reason} with <code className="text-foreground">{request.shownName}</code>.
          </>
        )}
      </p>
      {request !== null && request.arguments !== "{}" ? (
        <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-foreground">{request.arguments}</pre>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={answering} onClick={() => answer(cancel)}>
          Don't allow
        </Button>
        <Button variant="outline" size="sm" disabled={answering} onClick={() => answer(() => submit({ allow: "thread" }))}>
          Allow for this thread
        </Button>
        <Button size="sm" disabled={answering} onClick={() => answer(() => submit({ allow: "once" }))}>
          Allow once
        </Button>
      </div>
    </div>
  );
}

export function AboutComputerUse() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      <p>
        Desktop & Browser Agent is an independent bb integration powered by <strong className="font-medium text-foreground">Cua Driver</strong>, the open-source desktop and browser automation runtime from Cua AI, Inc.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <TextLink href={CUA_DOCS_URL}>Learn about Cua Driver</TextLink>
        <TextLink href={CUA_SOURCE_URL}>View Cua on GitHub</TextLink>
      </div>
      <p className="text-xs">This community plugin is not affiliated with or endorsed by Cua AI, Inc.</p>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "routing",
    title: "Routing mode",
    description: "Choose which computer-use tools agents receive. Changes apply to the next session.",
    component: RoutingSettings,
  });
  app.slots.settingsSection({
    id: "provider-overrides",
    title: "Provider overrides",
    component: ProviderOverridesSettings,
  });
  app.slots.settingsSection({
    id: "agent-tools",
    title: "Agent tools",
    description: "Choose how agents reach each Cua Driver tool. Changes apply to the next session.",
    component: AgentToolsSettings,
  });
  app.slots.settingsSection({
    id: "driver-machines",
    title: "Cua Driver on your machines",
    description: "Manage Cua Driver on the machines running your threads.",
    component: DriverMachinesSettings,
  });
  app.slots.settingsSection({
    id: "browser-extension",
    title: "Browser extension",
    description:
      "Optional, recommended for web pages. Agents work in any tab of your signed-in browser without extra grants or bringing it to the front, and you can pause them from the toolbar. Without it they use Cua Driver's browser window tools.",
    component: BrowserExtensionSettings,
  });
  app.slots.settingsSection({
    id: "about",
    title: "About Desktop & Browser Agent",
    component: AboutComputerUse,
  });
  // The id must match APPROVAL_RENDERER in server.ts.
  app.slots.pendingInteraction({ id: "approve-tool", component: ApproveToolCard });
});
