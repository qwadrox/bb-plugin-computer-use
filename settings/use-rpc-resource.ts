import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { BrowserView, State, rpcContract } from "../server";
import { errorMessage } from "./shared";

type ComputerUseRpc = PluginRpcClient<typeof rpcContract>;

/**
 * Loads one settings resource, reloads it on every `state-changed` signal, and
 * runs mutations against it. A mutation that answers with the resource itself
 * replaces it; any other answer triggers a reload.
 */
export function useRpcResource<T>(read: (rpc: ComputerUseRpc) => Promise<T>, isValue: (value: unknown) => value is T) {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setValue(await read(rpc));
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [read, rpc]);

  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("state-changed", () => {
    void load();
  });

  async function run(label: string, operation: () => Promise<unknown>): Promise<void> {
    setBusy(label);
    try {
      const result = await operation();
      if (isValue(result)) setValue(result);
      else await load();
    } catch (runError) {
      toast.error(errorMessage(runError));
    } finally {
      setBusy(null);
    }
  }

  return { rpc, value, error, busy, run, load };
}

function isState(value: unknown): value is State {
  return typeof value === "object" && value !== null && "providers" in value && "hosts" in value;
}

function isBrowserView(value: unknown): value is BrowserView {
  return typeof value === "object" && value !== null && "enabled" in value && "hosts" in value;
}

const readState = (rpc: ComputerUseRpc): Promise<State> => rpc.call("getState");
const readBrowserView = (rpc: ComputerUseRpc): Promise<BrowserView> => rpc.call("browserState");

export function useComputerUseState() {
  const { value, ...resource } = useRpcResource(readState, isState);
  return { ...resource, state: value };
}

export function useBrowserView() {
  const { value, ...resource } = useRpcResource(readBrowserView, isBrowserView);
  return { ...resource, view: value };
}
