import { useEffect, useMemo, useRef, useState } from "react";
import { recipeOf, stickerGaps, verdicts } from "../engine/verdict.ts";
import { findTerms, understood } from "../engine/match.ts";
import type { Level, Member, MemberVerdict, ProductFacts, Reason, SafeEntry, TriggerId } from "../engine/types.ts";
import { ago, describe, joinNames, languageName, levelWord, pillWord, shortDate, t as tr, triggerName } from "../i18n.ts";
import { api } from "../lib/api.ts";
import { newId } from "../lib/circle.ts";
import { checked, type Lang, type ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { allergenGlyph, Avatar, Heading, Icon, Pill, ProductThumb, Spinner } from "../ui.tsx";

const ALL: TriggerId[] = ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "pine_nuts", "sesame", "soy", "fish", "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin", "halal", "vegetarian"];
/** A pretend member who avoids everything: used to show *all* of a product's allergens, and to ask Gemma about all of
 * its findings, so the request never reveals which allergy this family has. */
const EVERYONE: Member = { id: "*", name: "*", avoid: ALL.filter((x) => x !== "halal" && x !== "vegetarian") as Member["avoid"], diets: ["halal", "vegetarian"], traces: "avoid" };
const ORDER = { red: 0, amber: 1, green: 2 } as const;
/** How a label names an allergen, strongest first. */
const KINDS = ["contains", "sticker_gap", "likely", "may_contain", "gemma_suspects"] as const;
type Kind = (typeof KINDS)[number];

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
      const key = [r.kind, r.trigger ?? "", r.kind === "unknown_ingredient" ? "" : r.quote ?? "", r.source].join("|");
      const f = out.get(key) ?? { key, reason: r, levels: [] };
      if (!f.levels.some((l) => l.member_id === v.member_id)) f.levels.push({ member_id: v.member_id, name, level: r.level });
      out.set(key, f);
    }
  }
  return [...out.values()].sort((a, b) => ORDER[worst(a.levels.map((l) => l.level))] - ORDER[worst(b.levels.map((l) => l.level))]);
}

/** Every allergen the label names, whoever it matters to: the strongest way it is named, and the words. */
interface Named {
  trigger: TriggerId;
  kind: Kind;
  quote: string;
  urls?: string[];
}

function named(facts: ProductFacts): Named[] {
  const out = new Map<TriggerId, Named>();
  for (const r of verdicts(facts, [EVERYONE])[0].reasons) {
    if (!r.trigger || !(KINDS as readonly string[]).includes(r.kind)) continue;
    const k = r.kind as Kind;
    const prev = out.get(r.trigger);
    if (!prev || KINDS.indexOf(k) < KINDS.indexOf(prev.kind)) out.set(r.trigger, { trigger: r.trigger, kind: k, quote: r.quote ?? "", urls: r.urls });
  }
  return [...out.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
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
  const members = checked(state);

  const facts = scan?.facts;
  // most serious first
  const results = useMemo(
    () => (facts ? verdicts(facts, members, state.safe).sort((a, b) => ORDER[a.level] - ORDER[b.level]) : []),
    [facts, members, state.safe],
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
          scans: s.scans.map((x) => (x.id === scan.id ? { ...x, researched: true, facts: { ...x.facts, suspicions }, verdicts: verdicts({ ...x.facts, suspicions }, checked(s), s.safe) } : x)),
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
  const member = (mid: string) => members.find((m) => m.id === mid);
  const memberName = (mid: string) => member(mid)?.name ?? "";
  const request = state.requests.find((r) => r.scan.id === scan.id);
  const gaps = stickerGaps(facts);
  const reds = results.filter((r) => r.level === "red");
  const ambers = results.filter((r) => r.level === "amber" && !r.reasons.some((x) => x.kind === "no_allergies"));
  const cutOff = facts.label && (!facts.label.complete || !facts.label.legible);
  const parents = state.people.filter((p) => p.role === "parent");
  const onLabel = named(facts);
  const avoided = new Set<string>(members.flatMap((m) => [...m.avoid, ...m.diets]));

  const flagged = results.filter((r) => r.level !== "green");
  const title =
    overall === "green"
      ? t("resTitleClear")
      : flagged.every((r) => r.level === "red")
        ? t("resTitleOneRed", { name: joinNames(lang, flagged.map((r) => memberName(r.member_id))) })
        : flagged.length === 1
          ? t("resTitleCheckFor", { name: memberName(flagged[0].member_id) })
          : t("resTitleSecondLook");
  const source = facts.read_from_photo && !scan.thumb
    ? t("resSubSaved", { date: shortDate(lang, facts.read_from_photo) })
    : facts.sticker
    ? t("resSubBoth", { lang: languageName(lang, facts.label?.language) })
    : facts.off && !scan.thumb
      ? t("resSubOff", { code: facts.barcode ?? "" })
      : t("resSubLabel", { lang: languageName(lang, facts.label?.language) });

  const explain = async () => {
    setExplaining(true);
    const items = onLabel.filter((n) => n.quote).map((n) => ({ trigger: n.trigger, quote: n.quote }));
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

  return (
    <>
      <Heading eyebrow={overall === "green" ? t("resEyebrowClear") : t("resEyebrowFlag")} title={title} lead={source} />
      <div className="content stack">
        <section className="big-card product-card">
          <div className="row">
            <ProductThumb name={facts.name} thumb={scan.thumb} big />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 className="product-name">{facts.name ?? t("unnamedProduct")}</h2>
              <p>
                {[facts.brand, t("scannedByAgo", { name: scan.by.id === me?.id ? t("you") : scan.by.name, ago: ago(lang, scan.at) })].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </section>

        <div className="verdicts" role="status">
          {results.map((r, i) => (
            <VerdictCard key={r.member_id} v={r} name={memberName(r.member_id)} avatar={member(r.member_id)?.avatar} i={i} />
          ))}
        </div>

        {request && request.status !== "waiting" && (
          <div className={`decision ${request.status === "approved" ? "ok" : "no"}`}>
            <b>{t(request.status === "approved" ? "decisionApproved" : "decisionRefused", { by: request.answeredBy ?? "" })}</b>
            {request.note && <span> · “{request.note}”</span>}
            {request.status === "approved" && <p>{t("decisionStill")}</p>}
          </div>
        )}

        {cutOff && (
          <div className="warning row spread" role="alert">
            <span>⚠ {facts.label!.complete ? t("unreadableWarn") : t("incompleteWarn")}</span>
            <button className="secondary" onClick={() => go({ name: "scan", barcode: facts.barcode ?? undefined })}>
              <Icon name="camera" /> {t("photographAgain")}
            </button>
          </div>
        )}

        {facts.sticker && (gaps.ingredients.length || gaps.statements.length) ? (
          <section className="danger-box sticker-alert">
            <h3>⚠ {t("stickerAlertTitle")}</h3>
            <p>{t("stickerAlertLead")}</p>
            <div className="tiles">
              {[...new Set([...gaps.statements.flatMap((s) => s.missing), ...gaps.ingredients.flatMap((i) => i.missing)])].map((tr) => (
                <span key={tr} className="tile hit">
                  <span className="glyph">{allergenGlyph(tr)}</span>
                  <b>{triggerName(lang, tr)}</b>
                  <small>{t("missingFromSticker")}</small>
                </span>
              ))}
            </div>
          </section>
        ) : facts.sticker ? (
          <p className="notice-line">✓ {t("stickerMatch")}</p>
        ) : null}

        <section className="big-card">
          <h2>{t("onLabelTitle")}</h2>
          {onLabel.length === 0 ? (
            <p className="small-note">{t("onLabelNone")}</p>
          ) : (
            <div className="tiles">
              {onLabel.map((n) => (
                <span key={n.trigger} className={`tile ${avoided.has(n.trigger) ? "hit" : ""} ${n.kind}`} title={n.quote}>
                  <span className="glyph" aria-hidden="true">{allergenGlyph(n.trigger)}</span>
                  <b>{triggerName(lang, n.trigger)}</b>
                  <small>{t(`kind_${n.kind}` as never)}</small>
                  {n.quote && <span className="quote" dir="auto">“{n.quote}”</span>}
                  {n.urls?.length ? (
                    <span className="urls">
                      {n.urls.map((u, i) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer noopener">
                          [{i + 1}] {hostOf(u)}
                        </a>
                      ))}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          )}
          {onLabel.some((n) => avoided.has(n.trigger)) && <p className="legend"><span className="dot-hit" /> {t("onLabelLegend")}</p>}

          {unknowns.length > 0 && (
            <div className="warning unknowns" role="note">
              {t("unknownNote")} {researching && <Spinner />}
            </div>
          )}

          {explained === null && !explaining && onLabel.length > 0 && (
            <button className="text-button" onClick={explain} style={{ marginTop: 12 }}>
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

        <Ingredients facts={facts} open={false} />

        <div className="row">
          <button className="primary" onClick={() => go({ name: "scan" }, true)}>
            <Icon name="scan" /> {t("scanAnother")}
          </button>
          {(facts.off || facts.read_from_photo) && !facts.sticker && !scan.thumb && (
            <button className="secondary" onClick={() => go({ name: "scan", barcode: facts.barcode ?? undefined })}>
              <Icon name="camera" /> {t("addLabelPhoto")}
            </button>
          )}
        </div>
        <p className="center small-note">
          {t("checkNotGuarantee")} · <span lang={other}>{tr(other, "checkNotGuarantee")}</span>
        </p>
      </div>
    </>
  );
}

/** One person's verdict: a big colour, a plain word, and the allergens that caused it. */
function VerdictCard({ v, name, avatar, i }: { v: MemberVerdict; name: string; avatar?: string; i: number }) {
  const { t, state } = useApp();
  const lang = state.lang;
  const why = v.reasons.filter((r) => r.level === v.level);
  // one chip per allergen, for the strongest way the label names it
  const rank = (k: string) => ((KINDS as readonly string[]).includes(k) ? KINDS.indexOf(k as Kind) : KINDS.length);
  const strongest = new Map<TriggerId, Reason>();
  for (const r of why) if (r.trigger && (!strongest.has(r.trigger) || rank(r.kind) < rank(strongest.get(r.trigger)!.kind))) strongest.set(r.trigger, r);
  const triggers = [...strongest.values()];
  const other = why.find((r) => !r.trigger);
  const word = levelWord(lang, v.level);
  return (
    <div className={`verdict-card ${v.level}`}>
      <div className="verdict-head">
        <Avatar name={name} emoji={avatar} i={i} size={44} />
        <div>
          <div className="verdict-name">{name}</div>
          <div className="verdict-word">
            <span className="verdict-icon" aria-hidden="true">{v.level === "red" ? "✕" : v.level === "amber" ? "!" : "✓"}</span>
            {word}
          </div>
        </div>
      </div>
      {triggers.length > 0 && (
        <div className="verdict-chips">
          {triggers.map((r) => (
            <span key={r.trigger} className="verdict-chip">
              <span aria-hidden="true">{allergenGlyph(r.trigger!)}</span> {triggerName(lang, r.trigger!)}
              <small>{t(`kind_${r.kind}` as never)}</small>
            </span>
          ))}
        </div>
      )}
      {(other || !triggers.length) && why[0] && <p className="verdict-why">{describe(lang, other ?? why[0], name)}</p>}
    </div>
  );
}

export function FindingRow({ f }: { f: Finding }) {
  const { t, state } = useApp();
  const lang = state.lang;
  const r = f.reason;
  return (
    <div className="activity finding">
      <div>
        <h4>
          {r.trigger && <span aria-hidden="true">{allergenGlyph(r.trigger)} </span>}
          {describe(lang, r, joinNames(lang, f.levels.map((l) => l.name)))}
        </h4>
        <p>
          <span className="src">
            {t((r.source === "gemma" && !r.urls?.length ? "src_gemma_unsourced" : `src_${r.source}`) as never)}
            {r.why ? ` · ${r.why}` : ""}
          </span>
        </p>
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
  const family = new Set<string>(checked(state).flatMap((m) => [...m.avoid, ...m.diets]));
  const ours = (text: string | null | undefined, language: string | null) => findTerms(text, language).filter((m) => family.has(m.trigger));
  return (
    <details className="big-card ingredients" open={open}>
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
