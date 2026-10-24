import { useMemo, useRef, useState } from "react";
import { dishVerdicts, worstDish, type Dish, type DishLevel, type DishReason } from "../engine/menu.ts";
import { ago, joinNames, triggerName } from "../i18n.ts";
import { api, ApiError } from "../lib/api.ts";
import { newId } from "../lib/circle.ts";
import { checked, type MenuRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { allergenGlyph, Avatar, Heading, Icon, Spinner } from "../ui.tsx";

const ORDER: DishLevel[] = ["options", "ask", "avoid"];

/** Eating out: a restaurant's menu (a link, photos or a PDF) → which dishes each person can ask for. */
export function Menu({ id }: { id?: string }) {
  const { state } = useApp();
  const record = id ? state.menus.find((m) => m.id === id) : undefined;
  return record ? <MenuResult record={record} /> : <MenuInput />;
}

function MenuInput() {
  const { t, go, state, update, health } = useApp();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const people = checked(state);
  const ready = files.length > 0 && !busy;
  const gemmaReady = health?.gemma.available !== false;

  const run = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const facts = await api.menu("", files);
      const rec: MenuRecord = { id: newId(), at: Date.now(), source: files.map((f) => f.name).join(", "), facts };
      update((s) => ({ ...s, menus: [rec, ...s.menus.filter((m) => m.source !== rec.source)] }));
      go({ name: "menu", id: rec.id }, true);
    } catch (e) {
      const code = (e as ApiError).message;
      const known = ["url_blocked", "url_failed", "too_large", "unreadable", "nothing_to_read", "no_dishes", "gemma_unavailable", "offline"];
      setError(known.includes(code) ? t(`menuErr_${code}` as never) : t("errorGeneric", { msg: code }));
      setBusy(false);
    }
  };

  return (
    <>
      <Heading eyebrow={t("menuEyebrow")} title={t("menuTitle")} lead={t("menuLead")} />
      <div className="content stack menu-screen">
        <section className="big-card menu-input">
          <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => {
            setFiles([...(e.target.files ?? [])].slice(0, 4));
            if (picker.current) picker.current.value = "";
          }} />
          <button className="secondary wide" disabled={busy} onClick={() => picker.current?.click()}>
            <Icon name="camera" /> {t("menuAddFiles")}
          </button>
          {files.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              {files.map((f) => (
                <span key={f.name} className="chip file-chip">
                  🖼️ {f.name}
                  <button className="chip-x" aria-label={t("remove")} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
                </span>
              ))}
            </div>
          )}
          {!gemmaReady && <div className="warning" role="alert" style={{ marginTop: 14 }}>{t("gemmaDown")}</div>}
          {error && <div className="danger-box" role="alert" style={{ marginTop: 14 }}>{error}</div>}
          <button className="primary wide" style={{ marginTop: 18 }} disabled={!ready || !gemmaReady} onClick={run}>
            {busy ? <Spinner /> : <Icon name="check" />} {t(busy ? "menuReading" : "menuCheck")}
          </button>
          {busy && <p className="small-note center">{t("menuSlow", { names: joinNames(state.lang, people.map((p) => p.name)) })}</p>}
          <p className="small-note privacy-line"><Icon name="lock" /> {t("menuPrivacy")}</p>
        </section>

        {state.menus.length > 0 && (
          <section className="panel">
            <h3>{t("menuRecent")}</h3>
            {state.menus.map((m) => (
              <button key={m.id} className="activity wide item" onClick={() => go({ name: "menu", id: m.id })}>
                <span className="product" aria-hidden="true">🍽️</span>
                <div>
                  <h4>{m.facts.restaurant ?? m.source}</h4>
                  <p>{t("menuDishes", { n: m.facts.dishes.length })} · {ago(state.lang, m.at)}</p>
                </div>
                <Icon name="arrow" />
              </button>
            ))}
          </section>
        )}
      </div>
    </>
  );
}

function MenuResult({ record }: { record: MenuRecord }) {
  const { t, go, state } = useApp();
  const lang = state.lang;
  const people = checked(state);
  const [who, setWho] = useState<string>("*");
  const chosen = who === "*" ? people : people.filter((p) => p.id === who);
  const facts = record.facts;

  const rows = useMemo(
    () =>
      facts.dishes.map((dish) => {
        const v = dishVerdicts(dish, facts.language, chosen);
        return { dish, v, level: worstDish(v.map((x) => x.level)) };
      }),
    [facts, chosen],
  );
  const groups = ORDER.map((level) => ({ level, rows: rows.filter((r) => r.level === level) }));
  const count = (l: DishLevel) => rows.filter((r) => r.level === l).length;
  const unset = chosen.filter((p) => !p.avoid.length && !p.diets.length);

  return (
    <>
      <Heading eyebrow={t("menuEyebrow")} title={facts.restaurant ?? t("menuUnnamed")} lead={`${record.source} · ${t("menuDishes", { n: facts.dishes.length })}`}
        extra={<button className="secondary" onClick={() => go({ name: "menu" })}><Icon name="plus" /> {t("menuAnother")}</button>} />
      <div className="content stack menu-screen">
        {people.length > 1 && (
          <div className="who-row" role="group" aria-label={t("whoNeedsHelp")}>
            <button className={`select-chip person ${who === "*" ? "selected" : ""}`} aria-pressed={who === "*"} onClick={() => setWho("*")}>
              {t("everyone")}
            </button>
            {people.map((p, i) => (
              <button key={p.id} className={`select-chip person ${who === p.id ? "selected" : ""}`} aria-pressed={who === p.id} onClick={() => setWho(p.id)}>
                <Avatar name={p.name} emoji={p.avatar} i={i} size={26} /> {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="menu-summary">
          {ORDER.map((l) => (
            <button key={l} className={`sum ${l}`} disabled={!count(l)} onClick={() => document.getElementById(`group-${l}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <b>{count(l)}</b>
              <span>{t(`menuGroup_${l}` as never)}</span>
            </button>
          ))}
        </div>

        {unset.length > 0 && <div className="warning">{t("menuUnset", { names: joinNames(lang, unset.map((p) => p.name)) })}</div>}

        {groups.map(({ level, rows: list }) =>
          list.length ? (
            <section key={level} id={`group-${level}`} className={`dish-group ${level}`}>
              <h2>
                <span className="group-dot" aria-hidden="true">{level === "avoid" ? "✕" : level === "ask" ? "?" : "✓"}</span>
                {t(`menuGroup_${level}` as never)} <span className="muted">{list.length}</span>
              </h2>
              <p className="group-lead">{t(`menuGroupLead_${level}` as never)}</p>
              <div className="dishes">
                {list.map(({ dish, v }) => (
                  <DishCard key={dish.name} dish={dish} verdicts={v} names={Object.fromEntries(people.map((p) => [p.id, p.name]))} showWho={chosen.length > 1} />
                ))}
              </div>
            </section>
          ) : null,
        )}

        <section className="big-card tell-staff">
          <span className="tell-emoji" aria-hidden="true">🧑‍🍳</span>
          <div>
            <h3>{t("menuStaffTitle")}</h3>
            <p>{t("menuStaffText")}</p>
          </div>
          <button className="primary" onClick={() => go({ name: "care", tab: "cook", id: who === "*" ? "*" : who })}>
            <Icon name="cook" /> {t("menuShowCook")}
          </button>
        </section>
        <p className="center small-note">{t("checkNotGuarantee")}</p>
      </div>
    </>
  );
}

function DishCard({ dish, verdicts, names, showWho }: { dish: Dish; verdicts: ReturnType<typeof dishVerdicts>; names: Record<string, string>; showWho: boolean }) {
  const { t, state } = useApp();
  const lang = state.lang;
  // the allergens behind this dish's level, once each, with who they matter to
  const reasons = new Map<string, { r: DishReason; who: string[] }>();
  for (const v of verdicts) {
    for (const r of v.reasons) {
      const k = r.trigger;
      const e = reasons.get(k) ?? { r, who: [] };
      e.who.push(names[v.member_id] ?? "");
      if (r.how === "named" && e.r.how !== "named") e.r = r;
      reasons.set(k, e);
    }
  }
  // the English name, for a dish printed in Arabic only
  const arabic = /[؀-ۿ]/;
  const other = dish.en && arabic.test(dish.name) && !arabic.test(dish.en) ? dish.en : null;
  return (
    <article className="dish">
      <div className="dish-head">
        <div style={{ minWidth: 0 }}>
          <h3 dir="auto">{dish.name}</h3>
          {other && <p className="dish-en">{other}</p>}
        </div>
        {showWho && (
          <div className="dish-who">
            {verdicts.map((v) => (
              <span key={v.member_id} className={`who ${v.level}`} title={names[v.member_id]}>
                {(names[v.member_id] ?? "?").slice(0, 1)}
              </span>
            ))}
          </div>
        )}
      </div>
      {dish.description && <p className="dish-desc" dir="auto">{dish.description}</p>}
      {reasons.size > 0 && (
        <div className="dish-chips">
          {[...reasons.values()].map(({ r, who }) => (
            <span key={r.trigger} className={`dish-chip ${r.how}`} title={r.why ?? r.quote}>
              <span aria-hidden="true">{allergenGlyph(r.trigger)}</span> {triggerName(lang, r.trigger)}
              <small>{t(`menuHow_${r.how}` as never)}{showWho ? ` · ${joinNames(lang, who)}` : ""}</small>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
