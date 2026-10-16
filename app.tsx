import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AboutComputerUse } from "./settings/about";
import { AgentToolsSettings } from "./settings/agent-tools";
import { ApproveToolCard } from "./settings/approval";
import { BrowserExtensionSettings } from "./settings/browser-extension";
import { DriverMachinesSettings } from "./settings/machines";
import { ProviderOverridesSettings } from "./settings/provider-overrides";
import { RoutingSettings } from "./settings/routing";

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
    id: "browser-extension",
    title: "Browser extension",
    description:
      "Optional, recommended for web pages. Agents work in any tab of your signed-in browser without extra grants or bringing it to the front, and you can pause them from the toolbar. Without it they use Cua Driver's browser window tools.",
    component: BrowserExtensionSettings,
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
    id: "about",
    title: "About Desktop & Browser Agent",
    component: AboutComputerUse,
  });
  // The id must match APPROVAL_RENDERER in server.ts.
  app.slots.pendingInteraction({ id: "approve-tool", component: ApproveToolCard });
});
