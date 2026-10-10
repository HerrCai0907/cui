import type { ApiMessage } from "../../../types";

const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

export function getMessageTitle(message: ApiMessage, fallbackModel?: string): string {
  const model = message.model ?? fallbackModel;
  const modelSuffix = model ? ` (${model})` : "";

  if (message.kind === "trace") {
    return `Execution Trace${modelSuffix}`;
  }

  return message.role === "assistant" ? `Assistant${modelSuffix}` : "You";
}

export function formatModelLabel(
  model: string | undefined,
  reasoningEffort: string | undefined,
): string | undefined {
  const trimmedModel = model?.trim();
  const reasoningEffortLabel = reasoningEffort
    ? (REASONING_EFFORT_LABELS[reasoningEffort] ?? reasoningEffort)
    : "";

  if (!trimmedModel && !reasoningEffortLabel) {
    return undefined;
  }

  return [trimmedModel || "Harness default", reasoningEffortLabel].filter(Boolean).join(" / ");
}
