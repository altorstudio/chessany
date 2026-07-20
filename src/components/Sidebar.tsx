import type { ReactNode } from "react";
import { NAV_ITEMS, useNav } from "../nav";
import { tapHaptic } from "../feedback";

const NAV_ICONS: Record<string, ReactNode> = {
  play: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5 L19 12 L7 19.5 Z" /></svg>
  ),
  analyzeGame: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,16 9,10 13,14 21,5" /><polyline points="15,5 21,5 21,11" /></svg>
  ),
  boardEditor: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4 L20 8 L9 19 L4 20 L5 15 Z" /><line x1="14" y1="6" x2="18" y2="10" /></svg>
  ),
  archive: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="5" rx="1.3" /><path d="M5 10 V18 a1 1 0 0 0 1 1 H18 a1 1 0 0 0 1 -1 V10" /><line x1="10" y1="14" x2="14" y2="14" strokeLinecap="round" /></svg>
  ),
  openings: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M12 6 C9 4 5 4 3.5 4.5 V18 C5 17.5 9 17.5 12 19 C15 17.5 19 17.5 20.5 18 V4.5 C19 4 15 4 12 6 Z" /><line x1="12" y1="6" x2="12" y2="19" /></svg>
  ),
};

export function Sidebar({ open, onClose, onOpenSettings }: { open: boolean; onClose: () => void; onOpenSettings: () => void }) {
  const view = useNav((s) => s.view);
  const setView = useNav((s) => s.setView);

  return (
    <>
      <div className={`rail-backdrop${open ? " open" : ""}`} onClick={onClose} />
      <nav className="rail">
        <div className="rail-brand">
          <div className="rail-logo">&#9822;</div>
          <div className="rail-brand-text">
            <div className="rail-name">Chessany</div>
            <div className="rail-tag">Play &middot; Analyze</div>
          </div>
          <button className="rail-collapse" onClick={onClose} aria-label="Collapse menu" title="Collapse">&#171;</button>
        </div>

        <div className="rail-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              className={`rail-item${view === item.view ? " active" : ""}`}
              onClick={() => { tapHaptic(); setView(item.view); onClose(); }}
            >
              <span className="rail-item-bar" />
              <span className="rail-item-icon">{NAV_ICONS[item.view]}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="rail-foot">
          <button className="rail-item" onClick={() => { tapHaptic(); onOpenSettings(); }}>
            <span className="rail-item-bar" />
            <span className="rail-item-icon">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </span>
            <span>Settings</span>
          </button>
        </div>
      </nav>
    </>
  );
}
