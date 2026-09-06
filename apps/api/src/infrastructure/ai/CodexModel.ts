import type { AiModel } from "../../domain/ai/AiModel.js";
import type { AiModelInfo } from "../../types.js";
import { CliAiModel, type CliAiModelOptions } from "./CliAiModel.js";
import { getAiHarnessBinaryConfig } from "./aiBinary.js";
import { extractFinalResponse } from "./aiEvents.js";

export class CodexModel extends CliAiModel implements AiModel {
  constructor(options: CliAiModelOptions = {}) {
    const config = getAiHarnessBinaryConfig("codex");
    super(
      { ...config, command: options.binary ?? config.command },
      {
        ...options,
        timeoutMs: Number(
          options.timeoutMs ??
            process.env.CODEX_TIMEOUT_MS ??
            process.env.TRAEX_TIMEOUT_MS ??
            10 * 60 * 1000,
        ),
      },
    );
  }

  async listModels(): Promise<AiModelInfo[]> {
    // The Codex exec integration uses configured model IDs; it has no model-list command.
    return [];
  }

  protected get permissionArgs(): string[] {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  protected resolveResponseContent(content: string, rawEvents: unknown[]): string {
    const response = content.trim() || extractFinalResponse(rawEvents)?.trim() || "";
    if (!response) {
      throw new Error("Codex did not return an assistant message");
    }
    return response;
  }
}
