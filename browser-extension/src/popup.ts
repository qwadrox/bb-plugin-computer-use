import type { BridgeStatus, PopupRequest } from "./shared.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function send(request: PopupRequest): Promise<BridgeStatus> {
  return (await chrome.runtime.sendMessage(request)) as BridgeStatus;
}

function render(status: BridgeStatus): void {
  const connection = $("connection");
  connection.textContent = status.connected ? `Connected to bb (${status.browser})` : "Not connected to bb";
  connection.dataset.state = status.connected ? "ok" : "off";
  $("connection-help").hidden = status.connected;
  $("error").textContent = status.error ?? "";

  $("paused").hidden = !status.settings.paused;
  const share = $<HTMLButtonElement>("share");
  const tab = status.activeTab;
  share.hidden = tab === null || status.settings.scope === "all";
  if (tab !== null) {
    share.textContent = tab.shared ? "Stop sharing this tab" : "Share this tab with agents";
    share.onclick = async () => render(await send({ type: tab.shared ? "unshare" : "share", tabId: tab.id }));
  }
  const all = $<HTMLInputElement>("scope-all");
  all.checked = status.settings.scope === "all";
}

$<HTMLInputElement>("scope-all").addEventListener("change", async (event) => {
  const checked = (event.target as HTMLInputElement).checked;
  render(await send({ type: "scope", scope: checked ? "all" : "shared" }));
});
$("resume").addEventListener("click", async () => render(await send({ type: "resume" })));
$("reconnect").addEventListener("click", async () => render(await send({ type: "reconnect" })));

void send({ type: "status" }).then(render);
