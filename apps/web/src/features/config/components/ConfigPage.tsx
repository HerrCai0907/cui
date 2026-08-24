import { Check, RotateCcw } from "lucide-react";
import {
  EXECUTION_TRACE_MESSAGE_TYPES,
  EXECUTION_TRACE_MESSAGE_TYPE_LABELS,
  createDefaultAppConfig,
  type AppConfig,
  type ExecutionTraceMessageType,
} from "../model/appConfig";

type ConfigPageProps = {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
};

export function ConfigPage({ config, onConfigChange }: ConfigPageProps) {
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
      <section className="config-section" aria-labelledby="execution-trace-config-heading">
        <div className="config-section-header">
          <div>
            <span className="section-label">Configuration</span>
            <h2 id="execution-trace-config-heading">Execution Trace</h2>
          </div>
          <button className="secondary-button" type="button" onClick={resetConfig}>
            <RotateCcw size={15} />
            Reset
          </button>
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
