export const ROUTING_MODES = ["cua-everywhere", "prefer-native", "off"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export const PROVIDER_OVERRIDES = ["inherit", "cua", "native", "off"] as const;
export type ProviderOverride = (typeof PROVIDER_OVERRIDES)[number];

export type ProviderDecision = "cua" | "native" | "off";

export interface RoutingPolicy {
  mode: RoutingMode;
  overrides: Record<string, ProviderOverride>;
}

export const DEFAULT_POLICY: RoutingPolicy = {
  mode: "prefer-native",
  overrides: {},
};

/**
 * Providers whose harness ships its own desktop computer-use tools. In
 * `prefer-native` mode these providers keep their own tools and receive no
 * Cua tools. Users can override any entry per provider; a bb capability flag
 * (`supportsNativeComputerUse`) would replace this table once bb exposes one.
 */
export const NATIVE_COMPUTER_USE_PROVIDERS: ReadonlySet<string> = new Set([
  "codex",
]);

export function hasNativeComputerUse(providerId: string): boolean {
  return NATIVE_COMPUTER_USE_PROVIDERS.has(providerId);
}

export function resolveProviderDecision(
  policy: RoutingPolicy,
  providerId: string,
): ProviderDecision {
  const override = policy.overrides[providerId] ?? "inherit";
  if (override !== "inherit") return override;
  switch (policy.mode) {
    case "off":
      return "off";
    case "cua-everywhere":
      return "cua";
    case "prefer-native":
      return hasNativeComputerUse(providerId) ? "native" : "cua";
  }
}

export function describeDecision(decision: ProviderDecision): string {
  switch (decision) {
    case "cua":
      return "Cua Driver tools";
    case "native":
      return "Provider's own computer use";
    case "off":
      return "No Cua Driver tools";
  }
}

/** The routing mode a value names, or null. Stored values and CLI arguments are checked here. */
export function parseRoutingMode(value: unknown): RoutingMode | null {
  return ROUTING_MODES.includes(value as RoutingMode) ? (value as RoutingMode) : null;
}

/** Per-provider overrides from a stored value. Unknown values and `inherit` entries are dropped. */
export function normalizeProviderOverrides(input: unknown): Record<string, ProviderOverride> {
  const overrides: Record<string, ProviderOverride> = {};
  if (typeof input === "object" && input !== null) {
    for (const [providerId, value] of Object.entries(input)) {
      if (
        providerId.length > 0 &&
        PROVIDER_OVERRIDES.includes(value as ProviderOverride) &&
        value !== "inherit"
      ) {
        overrides[providerId] = value as ProviderOverride;
      }
    }
  }
  return overrides;
}

export function normalizePolicy(input: unknown): RoutingPolicy {
  if (typeof input !== "object" || input === null) return DEFAULT_POLICY;
  const candidate = input as { mode?: unknown; overrides?: unknown };
  return {
    mode: parseRoutingMode(candidate.mode) ?? DEFAULT_POLICY.mode,
    overrides: normalizeProviderOverrides(candidate.overrides),
  };
}
