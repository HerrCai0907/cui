import type { AiModel } from "../../domain/ai/AiModel.js";
import type { AiModelInfo } from "../../types.js";
import { CliAiModel, type CliAiModelOptions } from "./CliAiModel.js";
import { getAiHarnessBinaryConfig } from "./aiBinary.js";
import { extractFinalResponse } from "./aiEvents.js";

const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const EXTENDED_CODEX_REASONING_EFFORTS = [...CODEX_REASONING_EFFORTS, "max"] as const;
const FULL_CODEX_REASONING_EFFORTS = [...EXTENDED_CODEX_REASONING_EFFORTS, "ultra"] as const;

export const CODEX_MODELS: AiModelInfo[] = [
  {
    name: "gpt-6-astra",
    provider: "openai",
    description: "GPT-6-Astra: most capable model for complex, demanding work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...FULL_CODEX_REASONING_EFFORTS],
  },
  {
    name: "gpt-5.6-sol",
    provider: "openai",
    description: "GPT-5.6-Sol: reliable agentic workhorse for everyday tasks.",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [...FULL_CODEX_REASONING_EFFORTS],
  },
  {
    name: "gpt-5.6-terra",
    provider: "openai",
    description: "GPT-5.6-Terra: balanced agentic coding model for everyday work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...FULL_CODEX_REASONING_EFFORTS],
  },
  {
    name: "gpt-5.6-luna",
    provider: "openai",
    description: "GPT-5.6-Luna: fast and affordable agentic coding model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...EXTENDED_CODEX_REASONING_EFFORTS],
  },
  {
    name: "gpt-5.5",
    provider: "openai",
    description: "GPT-5.5: proven previous-generation model for coding and general work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...CODEX_REASONING_EFFORTS],
  },
];

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
    return CODEX_MODELS;
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
