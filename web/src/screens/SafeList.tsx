import { useMemo, useState } from "react";
import { findTerms } from "../engine/match.ts";
import { norm } from "../engine/normalize.ts";
import { recipeOf } from "../engine/verdict.ts";
import type { SafeEntry } from "../engine/types.ts";
import { joinNames, shortDate, triggerName } from "../i18n.ts";
import { newId } from "../lib/circle.ts";
import type { ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Heading, Pill, ProductThumb } from "../ui.tsx";

interface Group {
  barcode: string;
  name: string;
  entries: SafeEntry[];
  latest?: ScanRecord;
  changed: boolean;
  added: string[];
  removed: string[];
}

/** The family's approved products, tied to the recipe a parent approved; a changed recipe raises an alert. */
export function SafeList() {
  const { t, go, state, isParent, share, toast } = useApp();
  const lang = state.lang;
  const [q, setQ] = useState("");
  const [who, setWho] = useState<string>("*");

  const groups = useMemo(() => {
    const by = new Map<string, SafeEntry[]>();
    for (const e of state.safe) by.set(e.barcode, [...(by.get(e.barcode) ?? []), e]);
    return [...by.entries()].map(([barcode, entries]): Group => {
      const latest = state.scans.filter((s) => s.facts.barcode === barcode && s.facts.label).sort((a, b) => b.at - a.at)[0];
      const approved = entries[0].ingredients ?? [];
      const now = latest?.facts.label?.ingredients.map((i) => i.text) ?? [];
      const changed = !!latest && entries.some((e) => e.recipe !== recipeOf(latest.facts));
      const has = (list: string[], x: string) => list.some((y) => norm(y) === norm(x));
      return {
        barcode,
        name: latest?.facts.name ?? entries.find((e) => e.name)?.name ?? barcode,
        entries,
        latest,
        changed,
        added: changed ? now.filter((x) => !has(approved, x)) : [],
        removed: changed ? approved.filter((x) => !has(now, x)) : [],
      };
    });
  }, [state.safe, state.scans]);

  const memberName = (id: string) => state.members.find((m) => m.id === id)?.name ?? "";
  const shown = groups.filter((g) => norm(g.name).includes(norm(q)) && (who === "*" || g.entries.some((e) => e.member_id === who)));
  const alerts = shown.filter((g) => g.changed);
  const fine = shown.filter((g) => !g.changed);

  const removeAll = (g: Group) => {
    for (const e of g.entries) share({ t: "unsafe", id: newId(), barcode: e.barcode, member_id: e.member_id });
    toast(t("removedFromSafe", { product: g.name }));
  };
  const tag = (x: string, lang2: string | null | undefined) => {
    const hits = findTerms(x, lang2);
    return hits.length ? ` (${hits.map((h) => triggerName(lang, h.trigger)).join(", ")})` : "";
  };

  return (
    <>
      <Heading eyebrow={t("safeEyebrow")} title={t("safeTitle")} lead={t("safeLead")} />
      <div className="content stack">
        <input type="search" placeholder={t("safeSearch")} aria-label={t("safeSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          {[{ id: "*", name: t("everyone") }, ...state.members.map((m) => ({ id: m.id, name: m.name }))].map((m) => (
            <button key={m.id} className={`select-chip ${who === m.id ? "selected" : ""}`} aria-pressed={who === m.id} onClick={() => setWho(m.id)}>
              {m.name}
            </button>
          ))}
        </div>

        {alerts.map((g) => (
          <section className="warning recipe-alert" key={g.barcode}>
            <Pill level="amber">{t("recipeAlert")}</Pill>
            <h2>{g.name}</h2>
            <p>{t("recipeAlertText", { by: g.entries[0].approved_by, date: shortDate(lang, g.entries[0].at) })}</p>
            <div className="chips">
              {g.added.map((x) => (
                <span key={`+${x}`} className="chip rose">+ {x}{tag(x, g.latest?.facts.label?.language)}</span>
              ))}
              {g.removed.map((x) => (
                <span key={`-${x}`} className="chip">− {x}</span>
              ))}
            </div>
            <div className="row">
              {g.latest && (
                <button className="secondary" onClick={() => go({ name: "result", id: g.latest!.id })}>
                  {t("reviewChanges")}
                </button>
              )}
              {isParent && (
                <button className="danger-btn" onClick={() => removeAll(g)}>
                  {t("removeFromSafe")}
                </button>
              )}
            </div>
          </section>
        ))}

        <section className="big-card">
          {groups.length === 0 ? (
            <p className="empty">{t("safeEmpty")}</p>
          ) : fine.length === 0 && alerts.length === 0 ? (
            <p className="empty">{t("safeNoMatch")}</p>
          ) : (
            fine.map((g) => (
              <div className="activity" key={g.barcode}>
                <ProductThumb name={g.name} thumb={g.latest?.thumb} />
                <div>
                  <h4>
                    {g.latest ? (
                      <button className="link" onClick={() => go({ name: "result", id: g.latest!.id })}>{g.name}</button>
                    ) : (
                      g.name
                    )}
                  </h4>
                  <p>{t("approvedLine", { names: joinNames(lang, g.entries.map((e) => memberName(e.member_id))), by: g.entries[0].approved_by, date: shortDate(lang, g.entries[0].at) })}</p>
                </div>
                <div className="pills">
                  <Pill level="green">✓ {t("statusApproved")}</Pill>
                  {isParent && (
                    <button className="text-button danger-text" onClick={() => removeAll(g)}>
                      {t("remove")}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
        <p className="small-note">{t("safeNote")}</p>
      </div>
    </>
  );
}
