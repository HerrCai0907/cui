import { useEffect, useState } from "react";
import { Activity, Check, KeyRound, RotateCcw, Server } from "lucide-react";
import { resolveApiUrl } from "../../../shared/api/apiBaseUrl";
import {
  AI_HARNESSES,
  AI_HARNESS_LABELS,
  DEFAULT_SSH_TUNNEL_CONFIG,
  EXECUTION_TRACE_MESSAGE_TYPES,
  EXECUTION_TRACE_MESSAGE_TYPE_LABELS,
  MODEL_PURPOSES,
  MODEL_PURPOSE_LABELS,
  REASONING_EFFORTS,
  REASONING_EFFORT_LABELS,
  createDefaultAppConfig,
  type AiHarness,
  type AppConfig,
  type ExecutionTraceMessageType,
  type ModelOption,
  type ModelPurpose,
  type ReasoningEffort,
  type SshTunnelConfig,
  type VscodeConfig,
} from "../model/appConfig";
import {
  getAndroidSshTunnelStatus,
  isAndroidSshTunnelAvailable,
  loadAndroidSshTunnelConfig,
  saveAndroidSshTunnelConfig,
  type AndroidSshTunnelStatus,
} from "../model/androidSshTunnel";

type ConfigPageProps = {
  config: AppConfig;
  models: ModelOption[];
  modelsError?: string | null;
  onConfigChange: (config: AppConfig) => void;
};

type ServerLatencyState = {
  latencyMs: number | null;
  status: "checking" | "connected" | "unavailable";
};

const LATENCY_CHECK_INTERVAL_MS = 5_000;
const LATENCY_CHECK_TIMEOUT_MS = 4_000;
const DEFAULT_VISIBLE_REASONING_EFFORTS: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function ConfigPage({ config, models, modelsError, onConfigChange }: ConfigPageProps) {
  const modelOptions = createVisibleModelOptions(models, config);
  const sshBridgeAvailable = isAndroidSshTunnelAvailable();
  const [sshTunnelDraft, setSshTunnelDraft] = useState(config.sshTunnel);
  const [sshTunnelStatus, setSshTunnelStatus] = useState<AndroidSshTunnelStatus | null>(null);
  const [sshTunnelError, setSshTunnelError] = useState<string | null>(null);
  const [serverLatency, setServerLatency] = useState<ServerLatencyState>({
    latencyMs: null,
    status: "checking",
  });

  useEffect(() => {
    const androidConfig = loadAndroidSshTunnelConfig();

    if (!androidConfig) {
      setSshTunnelDraft(config.sshTunnel);
      return;
    }

    setSshTunnelDraft(androidConfig);
    setSshTunnelStatus(getAndroidSshTunnelStatus());
  }, [config.sshTunnel]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let intervalId: number | undefined;
    let abortController: AbortController | null = null;

    const measureLatency = async () => {
      abortController?.abort();
      abortController = new AbortController();

      const startedAt = performance.now();
      timeoutId = window.setTimeout(() => abortController?.abort(), LATENCY_CHECK_TIMEOUT_MS);

      setServerLatency((current) => ({
        ...current,
        status: current.latencyMs === null ? "checking" : current.status,
      }));

      try {
        const response = await fetch(resolveApiUrl("/api/v1/health"), {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));

        if (!cancelled) {
          setServerLatency({ latencyMs, status: "connected" });
        }
      } catch {
        if (!cancelled) {
          setServerLatency({ latencyMs: null, status: "unavailable" });
        }
      } finally {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    };

    void measureLatency();
    intervalId = window.setInterval(measureLatency, LATENCY_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      abortController?.abort();
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  function saveSshTunnel() {
    try {
      const sshTunnel = sanitizeSshTunnelDraft(sshTunnelDraft);

      setSshTunnelError(null);
      onConfigChange({
        ...config,
        sshTunnel,
      });
      setSshTunnelDraft(sshTunnel);

      if (sshBridgeAvailable) {
        setSshTunnelStatus(saveAndroidSshTunnelConfig(sshTunnel));
        window.setTimeout(refreshSshTunnelStatus, 800);
        window.setTimeout(refreshSshTunnelStatus, 2_500);
      }
    } catch (reason) {
      setSshTunnelError(reason instanceof Error ? reason.message : "Invalid SSH tunnel settings");
    }
  }

  function refreshSshTunnelStatus() {
    const status = getAndroidSshTunnelStatus();

    setSshTunnelStatus(status);
    if (status.connected) {
      window.location.reload();
    }
  }

  function setModel(purpose: ModelPurpose, model: string) {
    const reasoningOptions = createVisibleReasoningEffortOptions(model, modelOptions);
    const currentReasoningEffort = config.reasoningEfforts[purpose];
    const nextReasoningEffort = reasoningOptions.includes(currentReasoningEffort)
      ? currentReasoningEffort
      : (findModelOption(model, modelOptions)?.defaultReasoningEffort ?? reasoningOptions[0]);

    onConfigChange({
      ...config,
      models: {
        ...config.models,
        [purpose]: model,
      },
      reasoningEfforts: {
        ...config.reasoningEfforts,
        [purpose]: nextReasoningEffort,
      },
    });
  }

  function setReasoningEffort(purpose: ModelPurpose, reasoningEffort: ReasoningEffort) {
    onConfigChange({
      ...config,
      reasoningEfforts: {
        ...config.reasoningEfforts,
        [purpose]: reasoningEffort,
      },
    });
  }

  function setHarness(harness: AiHarness) {
    onConfigChange({
      ...config,
      harness,
      models:
        harness === "codex"
          ? { normal: "", summary: "", atomicReview: "" }
          : createDefaultAppConfig().models,
    });
  }

  function setTraceMessageTypeVisible(type: ExecutionTraceMessageType, visible: boolean) {
    onConfigChange({
      ...config,
      executionTrace: {
        ...config.executionTrace,
        visibleMessageTypes: {
          ...config.executionTrace.visibleMessageTypes,
          [type]: visible,
        },
      },
    });
  }

  function resetConfig() {
    onConfigChange({
      ...createDefaultAppConfig(),
      sshTunnel: config.sshTunnel,
      vscode: config.vscode,
    });
  }

  function setSshTunnelField<K extends keyof SshTunnelConfig>(field: K, value: SshTunnelConfig[K]) {
    setSshTunnelDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function setVscodeRemoteSshField<K extends keyof VscodeConfig["remoteSsh"]>(
    field: K,
    value: VscodeConfig["remoteSsh"][K],
  ) {
    onConfigChange({
      ...config,
      vscode: {
        ...config.vscode,
        remoteSsh: {
          ...config.vscode.remoteSsh,
          [field]: value,
        },
      },
    });
  }

  return (
    <div className="config-page">
      <div
        className={`server-latency-floating is-${serverLatency.status}`}
        role="status"
        aria-live="polite"
      >
        <Activity size={16} aria-hidden="true" />
        <span>
          <strong>Server latency</strong>
          <span>
            {serverLatency.status === "connected" && serverLatency.latencyMs !== null
              ? `${serverLatency.latencyMs} ms`
              : serverLatency.status === "checking"
                ? "Checking"
                : "Unavailable"}
          </span>
        </span>
      </div>

      <section className="config-section" aria-labelledby="vscode-config-heading">
        <div className="config-section-header">
          <div>
            <span className="section-label">Editor</span>
            <h2 id="vscode-config-heading">VSCode</h2>
          </div>
        </div>

        <div className="vscode-config-card">
          <label className="config-toggle-row vscode-config-toggle">
            <span>
              <strong>Open workspaces over Remote SSH</strong>
            </span>
            <input
              type="checkbox"
              checked={config.vscode.remoteSsh.enabled}
              onChange={(event) => setVscodeRemoteSshField("enabled", event.target.checked)}
            />
            <span
              className={`config-switch ${config.vscode.remoteSsh.enabled ? "is-on" : ""}`}
              aria-hidden="true"
            >
              <span>{config.vscode.remoteSsh.enabled && <Check size={13} />}</span>
            </span>
          </label>

          <div className="vscode-config-grid">
            <label>
              <span>SSH host alias</span>
              <span className="api-server-input">
                <Server size={17} aria-hidden="true" />
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Host from ~/.ssh/config"
                  value={config.vscode.remoteSsh.host}
                  onChange={(event) => setVscodeRemoteSshField("host", event.target.value)}
                />
              </span>
            </label>
            <label>
              <span>Local workspace prefix</span>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="/Users/me/mapped"
                value={config.vscode.remoteSsh.localPathPrefix}
                onChange={(event) => setVscodeRemoteSshField("localPathPrefix", event.target.value)}
              />
            </label>
            <label>
              <span>Remote workspace prefix</span>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="/home/me"
                value={config.vscode.remoteSsh.remotePathPrefix}
                onChange={(event) =>
                  setVscodeRemoteSshField("remotePathPrefix", event.target.value)
                }
              />
            </label>
          </div>

          <p className="config-help">
            Workspace buttons use VSCode URL handlers. With Remote SSH enabled, the local prefix is
            rewritten to the remote prefix before opening the SSH host.
          </p>
        </div>
      </section>

      <section className="config-section" aria-labelledby="ssh-tunnel-heading">
        <div className="config-section-header">
          <div>
            <span className="section-label">Advanced</span>
            <h2 id="ssh-tunnel-heading">SSH Tunnel</h2>
          </div>
        </div>

        <div className="ssh-tunnel-card">
          <label className="config-toggle-row ssh-tunnel-toggle">
            <span>
              <strong>Use SSH tunnel</strong>
            </span>
            <input
              type="checkbox"
              checked={sshTunnelDraft.enabled}
              onChange={(event) => setSshTunnelField("enabled", event.target.checked)}
            />
            <span
              className={`config-switch ${sshTunnelDraft.enabled ? "is-on" : ""}`}
              aria-hidden="true"
            >
              <span>{sshTunnelDraft.enabled && <Check size={13} />}</span>
            </span>
          </label>

          <div className="ssh-tunnel-grid">
            <label>
              <span>SSH host</span>
              <span className="api-server-input">
                <Server size={17} aria-hidden="true" />
                <input
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="SSH server host"
                  value={sshTunnelDraft.host}
                  onChange={(event) => setSshTunnelField("host", event.target.value)}
                />
              </span>
            </label>
            <label>
              <span>SSH port</span>
              <input
                type="number"
                min={1}
                max={65535}
                placeholder="SSH port"
                value={sshTunnelDraft.port || ""}
                onChange={(event) => setSshTunnelField("port", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Username</span>
              <input
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="SSH username"
                value={sshTunnelDraft.username}
                onChange={(event) => setSshTunnelField("username", event.target.value)}
              />
            </label>
            <label>
              <span>Password</span>
              <span className="api-server-input">
                <KeyRound size={17} aria-hidden="true" />
                <input
                  type="password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="SSH password"
                  value={sshTunnelDraft.password}
                  onChange={(event) => setSshTunnelField("password", event.target.value)}
                />
              </span>
            </label>
            <label>
              <span>Local port</span>
              <input
                type="number"
                min={1}
                max={65535}
                placeholder="Local port"
                value={sshTunnelDraft.localPort || ""}
                onChange={(event) => setSshTunnelField("localPort", Number(event.target.value))}
              />
            </label>
            <label>
              <span>Remote host</span>
              <input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Remote loopback or host"
                value={sshTunnelDraft.remoteHost}
                onChange={(event) => setSshTunnelField("remoteHost", event.target.value)}
              />
            </label>
            <label>
              <span>Remote port</span>
              <input
                type="number"
                min={1}
                max={65535}
                placeholder="Remote port"
                value={sshTunnelDraft.remotePort || ""}
                onChange={(event) => setSshTunnelField("remotePort", Number(event.target.value))}
              />
            </label>
          </div>

          <p className="config-help">
            Android sends API requests to the local port you configure here, then forwards them over
            SSH to the remote host and port.
          </p>
          {!sshBridgeAvailable && <p className="config-help">Preview only in the browser.</p>}
          {sshTunnelStatus && (
            <p className={`config-status ${sshTunnelStatus.connected ? "is-connected" : ""}`}>
              {sshTunnelStatus.message}
            </p>
          )}
          {sshTunnelError && <p className="config-error">{sshTunnelError}</p>}
          <button className="secondary-button" type="button" onClick={saveSshTunnel}>
            Apply
          </button>
        </div>
      </section>

      <section className="config-section" aria-labelledby="model-config-heading">
        <div className="config-section-header">
          <div>
            <span className="section-label">Configuration</span>
            <h2 id="model-config-heading">Model Selection</h2>
          </div>
          <button className="secondary-button" type="button" onClick={resetConfig}>
            <RotateCcw size={15} />
            Reset
          </button>
        </div>

        <div className="config-table" role="group" aria-label="AI harness selection">
          <label className="config-select-row">
            <span>
              <strong>AI Harness</strong>
            </span>
            <span className="config-select-controls">
              <select
                aria-label="AI harness"
                value={config.harness}
                onChange={(event) => setHarness(event.target.value as AiHarness)}
              >
                {AI_HARNESSES.map((harness) => (
                  <option value={harness} key={harness}>
                    {AI_HARNESS_LABELS[harness]}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div className="config-table" role="group" aria-label="Model choices">
          {MODEL_PURPOSES.map((purpose) => (
            <label className="config-select-row" key={purpose}>
              <span>
                <strong>{MODEL_PURPOSE_LABELS[purpose]}</strong>
              </span>
              <span className="config-select-controls">
                <select
                  aria-label={`${MODEL_PURPOSE_LABELS[purpose]} model`}
                  value={config.models[purpose]}
                  onChange={(event) => setModel(purpose, event.target.value)}
                >
                  <option value="">Harness default</option>
                  {modelOptions.map((model) => (
                    <option value={model.name} key={model.name}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`${MODEL_PURPOSE_LABELS[purpose]} reasoning effort`}
                  value={config.reasoningEfforts[purpose]}
                  onChange={(event) =>
                    setReasoningEffort(purpose, event.target.value as ReasoningEffort)
                  }
                >
                  {createVisibleReasoningEffortOptions(config.models[purpose], modelOptions).map(
                    (reasoningEffort) => (
                      <option value={reasoningEffort} key={reasoningEffort}>
                        {REASONING_EFFORT_LABELS[reasoningEffort]}
                      </option>
                    ),
                  )}
                </select>
              </span>
            </label>
          ))}
        </div>
        {modelsError && <p className="config-error">{modelsError}</p>}
      </section>

      <section className="config-section" aria-labelledby="execution-trace-config-heading">
        <div className="config-section-header">
          <div>
            <span className="section-label">Configuration</span>
            <h2 id="execution-trace-config-heading">Execution Trace</h2>
          </div>
        </div>

        <div className="config-table" role="group" aria-label="Execution trace message types">
          {EXECUTION_TRACE_MESSAGE_TYPES.map((type) => {
            const visible = config.executionTrace.visibleMessageTypes[type];

            return (
              <label className="config-toggle-row" key={type}>
                <span>
                  <strong>{EXECUTION_TRACE_MESSAGE_TYPE_LABELS[type]}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => setTraceMessageTypeVisible(type, event.target.checked)}
                />
                <span className={`config-switch ${visible ? "is-on" : ""}`} aria-hidden="true">
                  <span>{visible && <Check size={13} />}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function sanitizeSshTunnelDraft(config: SshTunnelConfig): SshTunnelConfig {
  return {
    enabled: config.enabled,
    host: requireText(config.host, "SSH host is required."),
    port: requirePort(config.port, "SSH port"),
    username: config.username.trim(),
    password: config.password,
    localPort: requirePort(config.localPort, "Local port"),
    remoteHost: requireText(config.remoteHost, "Remote host is required."),
    remotePort: requirePort(config.remotePort, "Remote port"),
  };
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(message);
  }

  return trimmed;
}

function requirePort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be between 1 and 65535.`);
  }

  return value;
}

function createVisibleModelOptions(models: ModelOption[], config: AppConfig): ModelOption[] {
  const modelByName = new Map(models.map((model) => [model.name, model]));

  for (const model of Object.values(config.models)) {
    if (model && !modelByName.has(model)) {
      modelByName.set(model, { name: model });
    }
  }

  return [...modelByName.values()];
}

function createVisibleReasoningEffortOptions(
  selectedModelName: string,
  modelOptions: ModelOption[],
): ReasoningEffort[] {
  const selectedModel = findModelOption(selectedModelName, modelOptions);

  if (selectedModel?.supportedReasoningEfforts?.length) {
    return uniqueReasoningEfforts(selectedModel.supportedReasoningEfforts);
  }

  const catalogReasoningEfforts = uniqueReasoningEfforts(
    modelOptions.flatMap((model) => model.supportedReasoningEfforts ?? []),
  );

  return catalogReasoningEfforts.length
    ? catalogReasoningEfforts
    : DEFAULT_VISIBLE_REASONING_EFFORTS;
}

function findModelOption(modelName: string, modelOptions: ModelOption[]): ModelOption | undefined {
  return modelOptions.find((model) => model.name === modelName);
}

function uniqueReasoningEfforts(reasoningEfforts: ReasoningEffort[]): ReasoningEffort[] {
  return REASONING_EFFORTS.filter((reasoningEffort) => reasoningEfforts.includes(reasoningEffort));
}
