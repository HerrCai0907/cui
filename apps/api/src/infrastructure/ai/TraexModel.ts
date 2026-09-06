import { execFile } from "node:child_process";
import type { AiModel } from "../../domain/ai/AiModel.js";
import type { AiModelInfo } from "../../types.js";
import { CliAiModel, type CliAiModelOptions } from "./CliAiModel.js";
import {
  createAiProcessEnv,
  createTraexNotFoundError,
  getAiHarnessBinaryConfig,
} from "./aiBinary.js";

type TraexModelOptions = CliAiModelOptions & {
  modelListRunner?: () => Promise<unknown>;
  permissionMode?: string;
};

export class TraexModel extends CliAiModel implements AiModel {
  private readonly modelListRunner: () => Promise<unknown>;
  private readonly permissionMode: string;

  constructor(options: TraexModelOptions = {}) {
    const config = getAiHarnessBinaryConfig("traex");
    super(
      { ...config, command: options.binary ?? config.command },
      {
        ...options,
        timeoutMs: Number(options.timeoutMs ?? process.env.TRAEX_TIMEOUT_MS ?? 10 * 60 * 1000),
      },
    );
    this.permissionMode =
      options.permissionMode ?? process.env.TRAEX_PERMISSION_MODE ?? "bypass_permissions";
    this.modelListRunner =
      options.modelListRunner ??
      (() => execFileJson(this.binaryConfig.command, ["models", "--json"]));
  }

  async listModels(): Promise<AiModelInfo[]> {
    const rawModels = await this.modelListRunner();
    if (!Array.isArray(rawModels)) {
      throw new Error("TraeX models output was not an array");
    }
    return rawModels.map(parseTraexModelInfo).filter((model) => model.name);
  }

  protected get permissionArgs(): string[] {
    return ["--permission-mode", this.permissionMode];
  }

  protected resolveResponseContent(content: string): string {
    return content.trim();
  }
}

function execFileJson(command: string, args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: createAiProcessEnv() }, (error, stdout, stderr) => {
      if (error) {
        reject(createTraexModelsError(command, stderr, error));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(
          new Error(
            `TraeX models command returned invalid JSON: ${
              parseError instanceof Error ? parseError.message : "parse failed"
            }`,
          ),
        );
      }
    });
  });
}

function createTraexModelsError(command: string, stderr: string, error: Error): Error {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return createTraexNotFoundError(command);
  }

  return new Error(`TraeX models command failed: ${stderr.trim() || error.message}`);
}

function parseTraexModelInfo(value: unknown): AiModelInfo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "" };
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const provider = typeof record.provider === "string" ? record.provider.trim() : undefined;
  const description =
    typeof record.description === "string" ? record.description.trim() : undefined;
  const contextWindow =
    typeof record.context_window === "number" && Number.isFinite(record.context_window)
      ? record.context_window
      : undefined;

  return {
    name,
    ...(provider ? { provider } : {}),
    ...(description ? { description } : {}),
    ...(contextWindow ? { contextWindow } : {}),
  };
}
