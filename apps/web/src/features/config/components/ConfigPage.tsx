import { Check, RotateCcw } from "lucide-react";
import {
  EXECUTION_TRACE_MESSAGE_TYPES,
  EXECUTION_TRACE_MESSAGE_TYPE_LABELS,
  MODEL_PURPOSES,
  MODEL_PURPOSE_LABELS,
  createDefaultAppConfig,
  type AppConfig,
  type ExecutionTraceMessageType,
  type ModelOption,
  type ModelPurpose,
} from "../model/appConfig";

type ConfigPageProps = {
  config: AppConfig;
  models: ModelOption[];
  modelsError?: string | null;
  onConfigChange: (config: AppConfig) => void;
};

export function ConfigPage({ config, models, modelsError, onConfigChange }: ConfigPageProps) {
  const modelOptions = createVisibleModelOptions(models, config);

  function setModel(purpose: ModelPurpose, model: string) {
    onConfigChange({
      ...config,
      models: {
        ...config.models,
        [purpose]: model,
      },
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
    onConfigChange(createDefaultAppConfig());
  }

  return (
    <div className="config-page">
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

        <div className="config-table" role="group" aria-label="Model choices">
          {MODEL_PURPOSES.map((purpose) => (
            <label className="config-select-row" key={purpose}>
              <span>
                <strong>{MODEL_PURPOSE_LABELS[purpose]}</strong>
              </span>
              <select
                value={config.models[purpose]}
                onChange={(event) => setModel(purpose, event.target.value)}
              >
                <option value="">TraeX default</option>
                {modelOptions.map((model) => (
                  <option value={model.name} key={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
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

function createVisibleModelOptions(models: ModelOption[], config: AppConfig): ModelOption[] {
  const modelByName = new Map(models.map((model) => [model.name, model]));

  for (const model of Object.values(config.models)) {
    if (model && !modelByName.has(model)) {
      modelByName.set(model, { name: model });
    }
  }

  return [...modelByName.values()];
}
