import type { ApiMessage } from "../../../types";

export function getMessageTitle(message: ApiMessage, fallbackModel?: string): string {
  const model = message.model ?? fallbackModel;
  const modelSuffix = model ? ` (${model})` : "";

  if (message.kind === "trace") {
    return `Execution Trace${modelSuffix}`;
  }

  return message.role === "assistant" ? `Assistant${modelSuffix}` : "You";
}
