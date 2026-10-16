import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CUA_INSTALL_DOCS_URL, manualInstallCommands } from "@/src/links";
import { Disclosure, Hint, installPhase, SectionState, SectionTooltips, TextLink, type Host } from "./shared";
import { installPresentation, InstallDialog } from "./install-dialog";
import { useComputerUseState } from "./use-rpc-resource";

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
  busy,
  refreshing,
  granting,
  onRefresh,
  onOpenInstall,
  onGrant,
}: {
  host: Host;
  testedVersion: string;
  /** Any operation is running, so the actions that would overlap it wait. */
  busy: boolean;
  refreshing: boolean;
  granting: boolean;
  onRefresh: () => void;
  onOpenInstall: () => void;
  onGrant: () => void;
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
                  disabled={busy && !install.running}
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
                <Button className="min-h-10 w-full rounded-full" disabled={busy} onClick={onGrant}>
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
  const commands = manualInstallCommands(testedVersion);
  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <Disclosure label="Troubleshooting and manual commands">
        <div className="space-y-3 px-2 pt-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Diagnose the driver with <code className="text-foreground">cua-driver doctor</code>. macOS/Linux install of the tested release: <code className="break-all text-foreground">{commands.posix}</code>. Windows: <code className="break-all text-foreground">{commands.windows}</code>. Leave the variable out for the newest release.
          </p>
          <p>
            macOS permissions: <code className="text-foreground">cua-driver permissions grant</code>. Approve every prompt for CuaDriver.app, then fully relaunch it if macOS asks.
          </p>
          <TextLink href={CUA_INSTALL_DOCS_URL}>Open Cua Driver installation docs</TextLink>
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
              busy={busy !== null}
              refreshing={busy === `status:${host.id}`}
              granting={busy === `grant:${host.id}`}
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
