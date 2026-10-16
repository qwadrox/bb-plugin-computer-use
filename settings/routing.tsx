import { Hint, SectionState, SectionTooltips } from "./shared";
import { useComputerUseState } from "./use-rpc-resource";
import type { State } from "../server";

type Mode = State["mode"];

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
