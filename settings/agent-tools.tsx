import { Disclosure, Hint, SectionState, SectionTooltips } from "./shared";
import { useComputerUseState } from "./use-rpc-resource";
import type { State } from "../server";

type Exposure = State["tools"][number]["exposure"];
type ToolView = State["tools"][number];

const EXPOSURE_LABELS: Record<Exposure, string> = {
  tool: "Dedicated tool",
  call: "cua_call only",
  off: "Off",
};

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
