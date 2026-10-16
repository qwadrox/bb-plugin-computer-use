import { Disclosure, SectionState } from "./shared";
import { useComputerUseState } from "./use-rpc-resource";
import type { State } from "../server";

type Override = State["providers"][number]["override"];

const OVERRIDES: Array<{ value: Override; label: string }> = [
  { value: "inherit", label: "Follow mode" },
  { value: "cua", label: "Cua Driver" },
  { value: "native", label: "Harness-native" },
  { value: "off", label: "Off" },
];

function decisionTone(decision: State["providers"][number]["decision"]): string {
  if (decision === "cua") return "text-foreground";
  if (decision === "native") return "text-muted-foreground";
  return "text-muted-foreground line-through";
}

export function ProviderOverridesSettings() {
  const { rpc, state, error, busy, run } = useComputerUseState();
  if (state === null) return <SectionState error={error} />;

  return (
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
  );
}
