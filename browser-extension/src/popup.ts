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
  $("pause").hidden = status.settings.paused;
  $<HTMLInputElement>("cursor").checked = status.settings.cursor;
}

$("pause").addEventListener("click", async () => render(await send({ type: "pause" })));
$("resume").addEventListener("click", async () => render(await send({ type: "resume" })));
$<HTMLInputElement>("cursor").addEventListener("change", async (event) => {
  render(await send({ type: "cursor", enabled: (event.target as HTMLInputElement).checked }));
});
$("reconnect").addEventListener("click", async () => render(await send({ type: "reconnect" })));

void send({ type: "status" }).then(render);
