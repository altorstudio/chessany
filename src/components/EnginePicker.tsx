import { useStore } from "../store";
import { ENGINE_METAS, availableEngineMetas } from "../engines/registry";

export function EnginePicker() {
  const engineId = useStore((s) => s.engineId);
  const engineReady = useStore((s) => s.engineReady);
  const selectEngine = useStore((s) => s.selectEngine);

  const engines = availableEngineMetas();
  const active = ENGINE_METAS.find((m) => m.id === engineId);

  // With a single engine there's nothing to choose — don't show the picker.
  if (engines.length <= 1) return null;

  return (
    <div className="panel">
      <div className="panel-title">Engine</div>
      <div className="engine-list">
        {engines.map((m) => {
          const selected = m.id === engineId;
          return (
            <button
              key={m.id}
              className={`engine-option${selected ? " selected" : ""}`}
              onClick={() => selectEngine(m.id)}
            >
              <span className="engine-name">{m.name}</span>
              <span className="engine-desc">{m.description}</span>
            </button>
          );
        })}
      </div>
      <div className="engine-status">
        {active && (engineReady ? `${active.name} ready` : `Loading ${active.name}…`)}
      </div>
    </div>
  );
}
