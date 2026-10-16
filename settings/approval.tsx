import { useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "./shared";

interface ApprovalRequest {
  tool: string;
  shownName: string;
  reason: string;
  arguments: string;
}

function readApproval(payload: unknown): ApprovalRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { tool, shownName, reason, arguments: args } = payload as Record<string, unknown>;
  if (typeof tool !== "string" || typeof reason !== "string") return null;
  return {
    tool,
    shownName: typeof shownName === "string" ? shownName : `cua_${tool}`,
    reason,
    arguments: typeof args === "string" ? args : "{}",
  };
}

/** Asks the user to allow one sensitive driver call (Ask before sensitive actions). */
export function ApproveToolCard({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const [answering, setAnswering] = useState(false);
  const request = readApproval(interaction.payload);
  const answer = (action: () => Promise<void>) => {
    setAnswering(true);
    void action().catch((error: unknown) => {
      toast.error(errorMessage(error));
      setAnswering(false);
    });
  };

  return (
    <div className="space-y-3 p-3" data-approval-request={request?.tool}>
      <p className="text-sm font-medium text-foreground">{interaction.title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {request === null ? (
          "The agent wants to use a sensitive Cua Driver tool."
        ) : (
          `The agent wants to ${request.reason}.`
        )}
      </p>
      {request !== null && request.arguments !== "{}" ? (
        <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 text-xs text-foreground">{request.arguments}</pre>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={answering} onClick={() => answer(cancel)}>
          Don't allow
        </Button>
        <Button variant="outline" size="sm" disabled={answering} onClick={() => answer(() => submit({ allow: "thread" }))}>
          Allow for this thread
        </Button>
        <Button size="sm" disabled={answering} onClick={() => answer(() => submit({ allow: "once" }))}>
          Allow once
        </Button>
      </div>
    </div>
  );
}
