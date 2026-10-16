import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CUA_INSTALL_DOCS_URL } from "@/src/links";
import { Disclosure, installPhase, TextLink, type Host, type InstallState } from "./shared";

type InstallTarget = "tested" | "latest";

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

export function installPresentation(install: InstallState): { label: string; percent: number } {
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
      meta={host.install.tail.length > 0 ? `${host.install.tail.length} line${host.install.tail.length === 1 ? "" : "s"}` : undefined}
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

function installTarget(install: InstallState, testedVersion: string): InstallTarget {
  return install.target === undefined || install.target === testedVersion ? "tested" : "latest";
}

export function InstallDialog({
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
              {current !== null ? <> and this machine runs {current === testedVersion ? "it" : `v${current}`}</> : null}. A newer release can add or change tools; Desktop & Browser Agent then keeps new tools that are not read-only off until you allow them.
            </p>
            {installed ? (
              <p>The running driver is stopped first and restarted afterwards.</p>
            ) : (
              <p>On macOS, you will still approve Accessibility and Screen Recording after installation.</p>
            )}
            <TextLink href={CUA_INSTALL_DOCS_URL}>Review Cua Driver installation docs</TextLink>
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
