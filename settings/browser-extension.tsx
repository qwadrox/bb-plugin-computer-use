import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EXTENSION_STORE_URL, STORE_EXTENSION_ID, UNPACKED_EXTENSION_ID } from "@/src/links";
import { Hint, LINK_CLASS, SectionState, SectionTooltips } from "./shared";
import { useBrowserView } from "./use-rpc-resource";

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
                        ? ` · connected: ${bridge.connections.map((entry) => `${entry.browser} (extension v${entry.extension})`).join(", ")}`
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
              Web Store id <code className="text-foreground">{STORE_EXTENSION_ID}</code>. Unpacked build id <code className="text-foreground">{UNPACKED_EXTENSION_ID}</code>. Browser Bridge for bb ships with this plugin; it is not an official bb or Cua AI product.{" "}
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
