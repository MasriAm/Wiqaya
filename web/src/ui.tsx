// Small shared pieces: icons, the top bar, verdict badges, sheets, toasts.
import { useEffect, type ReactNode } from "react";
import type { Level } from "./engine/types.ts";

const paths: Record<string, ReactNode> = {
  scan: (
    <>
      <path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" />
      <path d="M8 8v8M11 8v8M14 8v8M17 8v8" />
    </>
  ),
  home: <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  family: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.3A5 5 0 0 1 21 19" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m4 16 5-5 4 4 3-3 4 4" />
      <circle cx="15.5" cy="9" r="1.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h1M11 10h1M15 10h2M7 14h10" />
    </>
  ),
  phone: <path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" />,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  cross: <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />,
  speaker: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M7 7l10 10M17 7 7 17" />,
  alert: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.9 7.6-3.8M8.2 13.1l7.6 3.8" />
    </>
  ),
  qr: (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
      <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h6M7 14h10" />
    </>
  ),
  shield: <path d="M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6z" />,
};

export function Icon({ name, flip = false }: { name: keyof typeof paths | string; flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={flip ? "flip" : undefined}>
      {paths[name]}
    </svg>
  );
}

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`badge ${level}`} aria-hidden="true">
      <Icon name={level === "red" ? "x" : level === "amber" ? "alert" : "check"} />
    </span>
  );
}

export function Top({ title, onBack, backLabel, right }: { title?: ReactNode; onBack?: () => void; backLabel?: string; right?: ReactNode }) {
  return (
    <header className="top">
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label={backLabel ?? "Back"}>
          <Icon name="back" flip />
        </button>
      )}
      <h1>{title}</h1>
      {right}
    </header>
  );
}

export function Sheet({ title, onClose, closeLabel, children }: { title: string; onClose: () => void; closeLabel: string; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 4200);
    return () => clearTimeout(id);
  }, [text, onDone]);
  return (
    <div className="toast" role="status" aria-live="polite">
      {text}
    </div>
  );
}

export function Initial({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
