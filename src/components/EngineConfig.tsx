import { useState, useEffect, useRef } from "react";
import { useStore } from "../store";
import { useSettings } from "../settings";
import { ENGINE_METAS, availableEngineMetas, isNativeEngine } from "../engines/registry";

/**
 * Engine bar for analysis screens: on/off toggle, engine name, a gear that
 * expands the configuration (engine, search time, multiple lines, memory).
 */
export function EngineConfig() {
  const engineId = useStore((s) => s.engineId);
  const engineReady = useStore((s) => s.engineReady);
  const selectEngine = useStore((s) => s.selectEngine);

  const on = useSettings((s) => s.on);
  const toggle = useSettings((s) => s.toggle);
  const searchTimeMs = useSettings((s) => s.searchTimeMs);
  const setSearchTimeMs = useSettings((s) => s.setSearchTimeMs);
  const multipv = useSettings((s) => s.multipv);
  const setMultipv = useSettings((s) => s.setMultipv);
  const hashMb = useSettings((s) => s.hashMb);
  const setHashMb = useSettings((s) => s.setHashMb);

  const [open, setOpen] = useState(false);
  const engines = availableEngineMetas();
  const active = ENGINE_METAS.find((m) => m.id === engineId);
  const native = isNativeEngine(engineId);
  const threads = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const backend = native ? `native · ${threads} threads` : "in browser (WASM)";

  return (
    <div className="engine-bar-wrap">
      <div className="engine-bar">
        <button
          className={`switch${on ? " on" : ""}`}
          onClick={toggle}
          aria-label="Toggle analysis"
          title={on ? "Analysis on" : "Analysis off"}
        >
          <span className="switch-knob" />
        </button>
        <div className="engine-bar-label">
          <span className="engine-bar-name">{active?.name ?? "Engine"}</span>
          <span className="engine-bar-sub">
            {on ? (engineReady ? backend : "loading…") : "analysis off"}
          </span>
        </div>
        <button
          className={`gear${open ? " active" : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-label="Engine settings"
        >
          ⚙
        </button>
      </div>

      {open && (
        <div className="engine-config">
          {engines.length > 1 && (
            <label className="cfg-row cfg-engine">
              <span>Engine</span>
              <select value={engineId} onChange={(e) => selectEngine(e.target.value)}>
                {engines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <Slider
            label="Search time"
            value={searchTimeMs / 1000}
            min={1}
            max={30}
            step={1}
            format={(v) => `${v}s`}
            onChange={(v) => setSearchTimeMs(v * 1000)}
          />
          <Slider
            label="Multiple lines"
            value={multipv}
            min={1}
            max={5}
            step={1}
            format={(v) => `${v} / 5`}
            onChange={setMultipv}
          />
          <Slider
            label="Memory"
            value={hashMb}
            min={16}
            max={256}
            step={16}
            format={(v) => `${v}MB`}
            onChange={setHashMb}
          />

          <div className="cfg-note">
            Native engines on iOS/Android run multi-threaded; on the web they run
            single-threaded in your browser.
          </div>
        </div>
      )}
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  // Track the value locally for live display, but only COMMIT to the store after
  // the drag settles. Committing on every tick restarts the engine / reallocates
  // hash repeatedly — which froze the device when dragging the Memory slider.
  const [local, setLocal] = useState(props.value);
  useEffect(() => setLocal(props.value), [props.value]);
  const commit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const change = (v: number) => {
    setLocal(v);
    clearTimeout(commit.current);
    commit.current = setTimeout(() => props.onChange(v), 300);
  };
  const flush = () => {
    clearTimeout(commit.current);
    props.onChange(local);
  };

  return (
    <label className="cfg-row">
      <span className="cfg-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={local}
        onChange={(e) => change(Number(e.target.value))}
        onPointerUp={flush}
        onKeyUp={flush}
      />
      <span className="cfg-value">{props.format(local)}</span>
    </label>
  );
}
