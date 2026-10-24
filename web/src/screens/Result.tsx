import { useEffect, useMemo, useRef, useState } from "react";
import { recipeOf, stickerGaps, verdicts } from "../engine/verdict.ts";
import { findTerms, understood } from "../engine/match.ts";
import type { Level, Member, MemberVerdict, ProductFacts, Reason, SafeEntry, TriggerId } from "../engine/types.ts";
import { ago, describe, joinNames, languageName, levelWord, pillWord, t as tr, triggerName } from "../i18n.ts";
import { api } from "../lib/api.ts";
import { newId } from "../lib/circle.ts";
import type { Lang, ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Heading, Icon, Pill, ProductThumb, Spinner } from "../ui.tsx";

const ALL: TriggerId[] = ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "pine_nuts", "sesame", "soy", "fish", "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin", "halal", "vegetarian"];
/** A pretend member who avoids everything: used to ask Gemma about *all* of a product's findings, so the request
 * never reveals which allergy this family has. */
const EVERYONE: Member = { id: "*", name: "*", avoid: ALL.filter((x) => x !== "halal" && x !== "vegetarian") as Member["avoid"], diets: ["halal", "vegetarian"], traces: "avoid" };
const ORDER = { red: 0, amber: 1, green: 2 } as const;

export function findScan(scans: ScanRecord[], requests: { scan: ScanRecord }[], id: string): ScanRecord | undefined {
  return scans.find((s) => s.id === id) ?? requests.find((r) => r.scan.id === id)?.scan;
}

export function worst(levels: Level[]): Level {
  return levels.includes("red") ? "red" : levels.includes("amber") ? "amber" : "green";
}

/** A safe-list entry for this exact recipe. */
export function safeEntry(facts: ProductFacts, member_id: string, by: string): SafeEntry {
  return { barcode: facts.barcode!, recipe: recipeOf(facts), member_id, approved_by: by, at: Date.now(), name: facts.name, ingredients: facts.label?.ingredients.map((i) => i.text) ?? [] };
}

/** One finding, as the family sees it: what the label says, and what it means for each member. */
interface Finding {
  key: string;
  reason: Reason;
  levels: { member_id: string; name: string; level: Level }[];
}

export function findings(results: MemberVerdict[], members: Member[]): Finding[] {
  const out = new Map<string, Finding>();
  for (const v of results) {
    const name = members.find((m) => m.id === v.member_id)?.name ?? "";
    for (const r of v.reasons) {
      if (r.level === "green") continue;
      const key = [r.kind, r.trigger ?? "", r.quote ?? "", r.source].join("|");
      const f = out.get(key) ?? { key, reason: r, levels: [] };
      if (!f.levels.some((l) => l.member_id === v.member_id)) f.levels.push({ member_id: v.member_id, name, level: r.level });
      out.set(key, f);
    }
  }
  return [...out.values()].sort((a, b) => ORDER[worst(a.levels.map((l) => l.level))] - ORDER[worst(b.levels.map((l) => l.level))]);
}

/** What the result means, in plain sentences, for reading aloud and for "What this means". */
export function meaning(lang: Lang, results: MemberVerdict[], members: Member[], productName: string | null): string[] {
  const lines = results.map((r) => {
    const name = members.find((m) => m.id === r.member_id)?.name ?? "";
    const head = tr(lang, r.level === "red" ? "resTitleOneRed" : "memberPill", { name, level: levelWord(lang, r.level) });
    const first = r.reasons.find((x) => x.level === r.level);
    return first ? `${head}. ${describe(lang, first, name)}` : `${head}.`;
  });
  return [productName ?? "", ...lines].filter(Boolean);
}

export function Result({ id }: { id: string }) {
  const { t, go, state, update, share, me, isParent, health } = useApp();
  const scan = findScan(state.scans, state.requests, id);
  const [researching, setResearching] = useState(false);
  const [explained, setExplained] = useState<{ trigger: TriggerId; quote: string; text: string }[] | null>(null);
  const [explaining, setExplaining] = useState(false);
  const started = useRef(false);
  const lang = state.lang;
  const other: Lang = lang === "ar" ? "en" : "ar";

  const facts = scan?.facts;
  // most serious first
  const results = useMemo(
    () => (facts ? verdicts(facts, state.members, state.safe).sort((a, b) => ORDER[a.level] - ORDER[b.level]) : []),
    [facts, state.members, state.safe],
  );

  // ingredients no list knows: Gemma looks them up (with web search and Open Food Facts) in the background
  const unknowns = useMemo(() => {
    if (!facts) return [];
    const all = verdicts(facts, [EVERYONE]);
    return [...new Set(all[0].reasons.filter((r) => r.kind === "unknown_ingredient").map((r) => r.quote!))];
  }, [facts]);
  useEffect(() => {
    if (!scan || started.current || !unknowns.length || scan.facts.suspicions.length || health?.gemma.available === false) return;
    if (scan.researched || !state.scans.some((s) => s.id === scan.id)) return;
    started.current = true;
    setResearching(true);
    api
      .research(unknowns, scan.facts.name)
      .then(({ suspicions }) => {
        update((s) => ({
          ...s,
          scans: s.scans.map((x) => (x.id === scan.id ? { ...x, researched: true, facts: { ...x.facts, suspicions }, verdicts: verdicts({ ...x.facts, suspicions }, s.members, s.safe) } : x)),
        }));
      })
      .catch(() => undefined)
      .finally(() => setResearching(false));
  }, [scan, unknowns, update, health, state.scans]);

  if (!scan || !facts) {
    return (
      <>
        <Heading eyebrow={t("resEyebrowFlag")} title={t("resultMissing")} />
        <button className="secondary" onClick={() => go({ name: "home" }, true)}>{t("navHome")}</button>
      </>
    );
  }

  const overall = worst(results.map((r) => r.level));
  const memberName = (mid: string) => state.members.find((m) => m.id === mid)?.name ?? "";
  const request = state.requests.find((r) => r.scan.id === scan.id);
  const gaps = stickerGaps(facts);
  const found = findings(results, state.members);
  const greens = results.filter((r) => r.level === "green");
  const reds = results.filter((r) => r.level === "red");
  const ambers = results.filter((r) => r.level === "amber");
  const cutOff = facts.label && (!facts.label.complete || !facts.label.legible);
  const parents = state.people.filter((p) => p.role === "parent");

  const title =
    overall === "green" ? t("resTitleClear") : results.filter((r) => r.level !== "green").length === 1 && reds.length === 1 ? t("resTitleOneRed", { name: memberName(reds[0].member_id) }) : t("resTitleSecondLook");
  const source = facts.sticker
    ? t("resSubBoth", { lang: languageName(lang, facts.label?.language) })
    : facts.off && !scan.thumb
      ? t("resSubOff", { code: facts.barcode ?? "" })
      : t("resSubLabel", { lang: languageName(lang, facts.label?.language) });

  const explain = async () => {
    setExplaining(true);
    const all = verdicts(facts, [EVERYONE])[0].reasons.filter((r) => r.trigger && r.quote && ["contains", "likely", "may_contain", "sticker_gap"].includes(r.kind));
    const items = all.map((r) => ({ trigger: r.trigger!, quote: r.quote! })).filter((f, i, a) => a.findIndex((x) => x.trigger === f.trigger && x.quote === f.quote) === i);
    try {
      setExplained((await api.explain(items, lang)).items);
    } catch {
      setExplained([]);
    } finally {
      setExplaining(false);
    }
  };

  const ask = () => {
    share({ t: "ask", id: newId(), from: me!, at: Date.now(), scan, member_ids: results.filter((r) => r.level !== "green").map((r) => r.member_id) });
  };

  const approve = (mid: string) => {
    if (!facts.barcode) return;
    share({ t: "answer", id: newId(), ask: "", by: me!.name, at: Date.now(), decision: "approved", note: "", safe: [safeEntry(facts, mid, me!.name)] });
  };

  const speak = () => {
    const u = new SpeechSynthesisUtterance([...meaning(lang, results, state.members, facts.name), t("checkNotGuarantee")].join(". "));
    u.lang = lang === "ar" ? "ar-JO" : "en-GB";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  return (
    <>
      <Heading eyebrow={overall === "green" ? t("resEyebrowClear") : t("resEyebrowFlag")} title={title} lead={source} />
      <div className="content stack">
        {cutOff && (
          <div className="warning row spread" role="alert">
            <span>⚠ {facts.label!.complete ? t("unreadableWarn") : t("incompleteWarn")}</span>
            <button className="secondary" onClick={() => go({ name: "scan", barcode: facts.barcode ?? undefined })}>
              <Icon name="camera" /> {t("photographAgain")}
            </button>
          </div>
        )}

        <section className="big-card">
          <div className="row">
            <ProductThumb name={facts.name} thumb={scan.thumb} big />
            <div>
              <h2 className="product-name">{facts.name ?? t("unnamedProduct")}</h2>
              <p>
                {[facts.brand, t("scannedByAgo", { name: scan.by.id === me?.id ? t("you") : scan.by.name, ago: ago(lang, scan.at) })].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
          <div className="row summary-banner" role="status">
            {results.map((r) => (
              <Pill key={r.member_id} level={r.level} big>
                ● {t("memberPill", { name: memberName(r.member_id), level: levelWord(lang, r.level) })}
              </Pill>
            ))}
          </div>
          {request && request.status !== "waiting" && (
            <div className={`decision ${request.status === "approved" ? "ok" : "no"}`}>
              <b>{t(request.status === "approved" ? "decisionApproved" : "decisionRefused", { by: request.answeredBy ?? "" })}</b>
              {request.note && <span> · “{request.note}”</span>}
              {request.status === "approved" && <p>{t("decisionStill")}</p>}
            </div>
          )}
        </section>

        {facts.sticker &&
          (gaps.ingredients.length || gaps.statements.length ? (
            <section className="danger-box">
              <h3>⚠ {t("stickerAlertTitle")}</h3>
              <p>{t("stickerAlertLead")}</p>
              <div className="compare">
                <div>
                  <small>{t("originalLabel", { lang: languageName(lang, facts.label?.language) })}</small>
                  {gaps.statements.map((s) => {
                    const q = (s === "may_contain" ? facts.label?.may_contain : facts.label?.contains) ?? "";
                    return (
                      <div key={s}>
                        “{q}”
                        <br />
                        <b>{findTerms(q, facts.label?.language).map((m) => triggerName(lang, m.trigger)).join(", ")}</b>
                      </div>
                    );
                  })}
                  {gaps.ingredients.map((i) => (
                    <div key={i.text}>
                      “{i.text}”{i.en && i.en.toLowerCase() !== i.text.toLowerCase() ? <b> · {i.en}</b> : null}
                    </div>
                  ))}
                </div>
                <div>
                  <small>{t("arabicSticker")}</small>
                  <b className="missing">{t("missingFromSticker")}</b>
                  <br />
                  <span lang="ar" dir="rtl">غير موجود في الملصق العربي</span>
                </div>
              </div>
            </section>
          ) : (
            <section className="big-card">
              <h3>{t("stickerMatchTitle")}</h3>
              <p>{t("stickerMatch")}</p>
            </section>
          ))}

        <section className="big-card">
          <h2>{t("findingsTitle")}</h2>
          {found.map((f) => (
            <FindingRow key={f.key} f={f} />
          ))}
          {results
            .filter((r) => r.reasons.some((x) => x.kind === "approved"))
            .map((r) => (
              <div className="activity" key={`ok-${r.member_id}`}>
                <div>
                  <h4>{describe(lang, r.reasons.find((x) => x.kind === "approved")!, memberName(r.member_id))}</h4>
                  <p>{t("src_safe_list")} · {memberName(r.member_id)}</p>
                </div>
                <Pill level="green">{pillWord(lang, "green")}</Pill>
              </div>
            ))}
          {greens.filter((r) => !r.reasons.some((x) => x.kind === "approved")).length > 0 && (
            <div className="activity">
              <div>
                <h4>{t("allClearFor", { names: joinNames(lang, greens.filter((r) => !r.reasons.some((x) => x.kind === "approved")).map((r) => memberName(r.member_id))) })}</h4>
                <p>{t("src_wiqaya")}</p>
              </div>
              <Pill level="green">{pillWord(lang, "green")}</Pill>
            </div>
          )}
          {researching && (
            <p className="row small-note" role="status" style={{ marginTop: 12 }}>
              <Spinner /> {t("researching", { n: unknowns.length })}
            </p>
          )}
        </section>

        <section className="big-card">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{t("meansTitle")}</h2>
            <button className="secondary" onClick={speak}>
              <Icon name="sound" /> {t("readAloud")}
            </button>
          </div>
          <p style={{ marginTop: 12 }}>{meaning(lang, results, state.members, null).join(" ")}</p>
          <p lang={other} dir={other === "ar" ? "rtl" : "ltr"} style={{ marginTop: 12 }}>
            {meaning(other, results, state.members, null).join(" ")}
          </p>
          {explained === null && !explaining && found.some((f) => f.reason.trigger && f.reason.quote) && (
            <button className="text-button" onClick={explain} style={{ marginTop: 8 }}>
              {t("explainBtn")} ↗
            </button>
          )}
          {explaining && (
            <p className="row small-note">
              <Spinner /> {t("whyLoading")}
            </p>
          )}
          {explained && (
            <ul className="explained">
              {explained.length === 0 && <li>{t("explainNone")}</li>}
              {explained.map((e, i) => (
                <li key={i}>
                  <b>{triggerName(lang, e.trigger)}</b> · {e.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Ingredients facts={facts} />

        {reds.length > 0 && <div className="warning">{t("redRule")}</div>}

        {!isParent && ambers.length > 0 && !request && (
          <button className="primary amber-btn wide" onClick={ask}>
            <Icon name="message" /> {parents.length === 1 ? t("askParent", { name: parents[0].name }) : t("askAnyParent")} <Icon name="arrow" />
          </button>
        )}
        {request?.status === "waiting" && <div className="warning" role="status">{request.from.id === me?.id ? t("askSent") : t("askWaiting")}</div>}
        {isParent && facts.barcode && ambers.length > 0 && (
          <div className="row">
            {ambers.map((r) => (
              <button key={r.member_id} className="secondary" onClick={() => approve(r.member_id)}>
                <Icon name="check" /> {t("approveFor", { name: memberName(r.member_id) })}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          {facts.off && !facts.sticker && !scan.thumb && (
            <button className="secondary" onClick={() => go({ name: "scan", barcode: facts.barcode ?? undefined })}>
              <Icon name="camera" /> {t("addLabelPhoto")}
            </button>
          )}
          <button className="secondary" onClick={() => go({ name: "scan" }, true)}>
            <Icon name="scan" /> {t("scanAnother")}
          </button>
        </div>
        <p className="center small-note">
          {t("checkNotGuarantee")} · <span lang={other}>{tr(other, "checkNotGuarantee")}</span>
        </p>
      </div>
    </>
  );
}

export function FindingRow({ f }: { f: Finding }) {
  const { t, state } = useApp();
  const lang = state.lang;
  const r = f.reason;
  return (
    <div className="activity finding">
      <div>
        <h4>{describe(lang, r, joinNames(lang, f.levels.map((l) => l.name)))}</h4>
        <p>
          <span className="src">
            {t((r.source === "gemma" && !r.urls?.length ? "src_gemma_unsourced" : `src_${r.source}`) as never)}
            {r.why ? ` · ${r.why}` : ""}
          </span>
          {r.urls?.length ? (
            <span className="urls">
              {" · "}
              {r.urls.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer noopener">
                  [{i + 1}] {hostOf(u)}
                </a>
              ))}
            </span>
          ) : null}
        </p>
        <p className="matters">{t("findingMatters", { names: joinNames(lang, f.levels.map((l) => l.name)) })}</p>
      </div>
      <div className="pills">
        {f.levels.map((l) => (
          <Pill key={l.member_id} level={l.level}>
            {f.levels.length > 1 ? `${l.name} · ` : ""}
            {pillWord(lang, l.level)}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** The ingredient list as read, set like a label: avoided-allergen words highlighted, unknown ones marked. */
export function Ingredients({ facts, open = true }: { facts: ProductFacts; open?: boolean }) {
  const { t, state } = useApp();
  const l = facts.label;
  if (!l || !l.ingredients.length) return null;
  // only what this family avoids is highlighted: red when certain, yellow when likely or unknown
  const family = new Set<string>(state.members.flatMap((m) => [...m.avoid, ...m.diets]));
  const ours = (text: string | null | undefined, language: string | null) => findTerms(text, language).filter((m) => family.has(m.trigger));
  return (
    <details className="big-card" open={open}>
      <summary>
        <h3 style={{ display: "inline" }}>{t("ingredientsTitle")} ({l.ingredients.length})</h3>
      </summary>
      <div className="label-photo" dir="auto" lang={l.language ?? undefined}>
        {l.ingredients.map((i, k) => {
          const hits = [...ours(i.text, l.language), ...ours(i.en, "en")];
          const certain = hits.some((h) => h.certainty === "certain");
          const known = understood(i.text, i.en, l.language, i.known_by_off);
          const text = i.en && i.en.toLowerCase() !== i.text.toLowerCase() ? `${i.text} (${i.en})` : i.text;
          return (
            <span key={k}>
              {k > 0 && ", "}
              {certain ? <strong>{text}</strong> : hits.length || !known ? <mark>{text}</mark> : text}
            </span>
          );
        })}
        .
        {l.contains && (
          <>
            <br />
            {ours(l.contains, l.language).length ? <strong>{l.contains}</strong> : <b>{l.contains}</b>}
          </>
        )}
        {l.may_contain && (
          <>
            <br />
            {ours(l.may_contain, l.language).length ? <strong>{l.may_contain}</strong> : <b>{l.may_contain}</b>}
          </>
        )}
      </div>
    </details>
  );
}
