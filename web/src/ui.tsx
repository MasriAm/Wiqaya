// Small shared pieces: icons, headings, avatars, status pills, the modal, toasts.
import { useEffect, useRef, type ReactNode } from "react";
import type { Level } from "./engine/types.ts";

const paths: Record<string, ReactNode> = {
  shield: (
    <>
      <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  home: <path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z" />,
  scan: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8v8m3-8v8m4-8v8m3-8v8" />,
  family: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-4a5 5 0 0 0-2-4" />,
  list: (
    <>
      <path d="M5 3h14v18l-7-4-7 4Z" />
      <path d="m8 10 3 3 5-5" />
    </>
  ),
  cook: (
    <>
      <path d="M6 14a5 5 0 0 1-2-9 4 4 0 0 1 7-1 5 5 0 0 1 9 4 4 4 0 0 1-2 6v7H6Z" />
      <path d="M6 17h12" />
    </>
  ),
  heart: (
    <>
      <path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 8 15 8 15S25 10 20 5Z" />
      <path d="M5 11h4l2-3 2 6 2-3h4" />
    </>
  ),
  lock: <path d="M5 10h14v11H5Zm3 0V7a4 4 0 0 1 8 0v3m-4 5v2" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 4v16M4 12h16" />,
  bell: <path d="M5 17h14l-2-4V8a5 5 0 0 0-10 0v5Zm5 4h4" />,
  sound: <path d="m10 4-6 5H1v6h3l6 5Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
  phone: <path d="m7 3 3 5-3 3a16 16 0 0 0 6 6l3-3 5 3c0 5-5 6-10 3S2 12 3 7Z" />,
  qr: <path d="M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h3v3h3v3h-6Zm6-3h-3m-6 0v3" />,
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
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h1M11 10h1M15 10h2M7 14h10" />
    </>
  ),
  message: <path d="M4 5h16v11H9l-5 4z" />,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <path d="M12 4 2.5 20h19zM12 10v4m0 3v.5" />,
  share: <path d="M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm12-6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.2 10.9l7.6-3.8m-7.6 6 7.6 3.8" />,
  face: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3-11h.01M15 10h.01M8.5 15a4.5 4.5 0 0 0 7 0" />,
  menu: (
    <>
      <path d="M6 3h12v18H6z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />,
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {paths[name] ?? paths.shield}
    </svg>
  );
}

/** Eyebrow, title, one line under it, and an optional action on the side. */
export function Heading({ eyebrow, title, lead, extra }: { eyebrow: string; title: ReactNode; lead?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {extra}
    </div>
  );
}

const TINTS = ["", "purple", "teal", "sky"];

/** A profile's picture: the emoji a parent chose, or the first letter of the name. */
export function Avatar({ name, emoji, i = 0, size }: { name: string; emoji?: string; i?: number; size?: number }) {
  return (
    <span className={`avatar ${TINTS[i % TINTS.length]}`} aria-hidden="true" style={size ? { width: size, height: size, fontSize: size * 0.55 } : undefined}>
      {emoji || (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function Pill({ level, children, big = false }: { level: Level; children: ReactNode; big?: boolean }) {
  return <span className={`status ${level}${big ? " big" : ""}`}>{children}</span>;
}

export function Modal({ label, onClose, closeLabel, children }: { label: string; onClose: () => void; closeLabel: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (box.current?.querySelector<HTMLElement>("input:not([readonly])") ?? box.current?.querySelector<HTMLElement>(".close"))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,a[href],textarea")];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)!.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} ref={box} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
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

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/** Lines separated by "|" in a string, as separate lines. */
export function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split("|").map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {l}
        </span>
      ))}
    </>
  );
}

export const HeroArt = () => (
  <svg className="hero-art" viewBox="0 0 300 260" fill="none" aria-hidden="true">
    <circle cx="175" cy="143" r="108" fill="#d9e9d6" />
    <ellipse cx="172" cy="237" rx="102" ry="12" fill="#c6dcc7" />
    <path d="M76 125h176l-24 105H101Z" fill="#c69c6c" />
    <path d="M91 147h145m-139 24h133m-127 24h121m-114 23h109M119 134l13 92m16-93 5 96m20-96-2 96m28-96-10 94m32-92-14 90" stroke="#e2bf92" strokeWidth="5" />
    <path d="M113 132c-8-36 2-81 22-92 16 24 23 60 12 90" fill="#ebbd75" />
    <path d="m124 66 14 7m-18 13 20 9m-20 10 19 10" stroke="#cc944e" strokeWidth="4" />
    <path d="M204 134c-5-24-3-45 12-56 19-13 27-34 39-33 10 14 3 34-6 46 16-8 28-7 34 0-3 19-31 41-57 45" fill="#70a77f" />
    <path d="m220 131 29-66" stroke="#39755b" strokeWidth="3" />
    <rect x="153" y="81" width="43" height="62" rx="6" fill="#f7faf3" transform="rotate(9 153 81)" />
    <path d="m153 82 11-14 31 5 1 14" fill="#80b0a0" />
    <rect x="162" y="103" width="21" height="22" rx="3" fill="#b8d5c6" />
    <circle cx="95" cy="129" r="23" fill="#dc7e5c" />
    <path d="m94 106 3-12m0 6c-13-8-15-2-15-2" stroke="#5a8054" strokeWidth="3" />
    <circle cx="197" cy="141" r="20" fill="#e6b755" />
    <path d="M63 154c-12-24-24-25-24-25 0 20 10 34 24 34m1-17c-5-32 1-41 1-41 17 23 13 40-1 50" fill="#84b398" />
    <circle cx="235" cy="187" r="30" fill="#fff" />
    <path d="m234 165-16 6v14c0 14 16 23 16 23s17-9 17-23v-14Z" fill="#0d9488" />
    <path d="m226 185 6 6 11-13" stroke="white" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const GLYPHS: [RegExp, string][] = [
  [/nutella|choco|cocoa|cacao|شوكولا|كاكاو/i, "🍫"],
  [/wafer|biscuit|biscotti|cookie|kek|بسكويت|ويفر|كعك/i, "🍪"],
  [/cracker|rice cake|كراكر/i, "🍘"],
  [/milk|laban|yogh?urt|drink|حليب|لبن|مشروب/i, "🥛"],
  [/juice|عصير/i, "🧃"],
  [/bread|خبز|toast/i, "🍞"],
  [/rice|أرز|رز/i, "🍚"],
  [/oat|cereal|flake|شوفان|حبوب/i, "🌾"],
  [/chips|crisps|شيبس/i, "🥔"],
  [/cheese|جبن/i, "🧀"],
  [/hummus|tahini|halawa|حمص|طحينة|حلاوة/i, "🫘"],
  [/pasta|noodle|معكرونة/i, "🍝"],
  [/candy|sweet|gum|حلوى|سكاكر/i, "🍬"],
];

/** A friendly glyph for a product, from its name. */
export function productGlyph(name: string | null | undefined): string {
  for (const [re, g] of GLYPHS) if (name && re.test(name)) return g;
  return "🛒";
}

export function ProductThumb({ name, thumb, big = false }: { name: string | null | undefined; thumb?: string; big?: boolean }) {
  return <span className={`product${big ? " big" : ""}`} aria-hidden="true">{thumb ? <img src={thumb} alt="" /> : productGlyph(name)}</span>;
}

const ALLERGEN_GLYPHS: Record<string, string> = {
  gluten: "🌾", milk: "🥛", eggs: "🥚", peanuts: "🥜", tree_nuts: "🌰", pine_nuts: "🌲", sesame: "🥯", soy: "🫛",
  fish: "🐟", crustaceans: "🦐", molluscs: "🦑", celery: "🥬", mustard: "🌭", sulphites: "🍷", lupin: "🌼",
  halal: "🍖", vegetarian: "🥩",
};

/** A picture for an allergen or diet, next to its name (never instead of it). */
export function allergenGlyph(id: string): string {
  return ALLERGEN_GLYPHS[id] ?? "⚠️";
}
