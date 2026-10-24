import { useEffect, useMemo, useRef, useState } from "react";
import { recipeOf, stickerGaps, verdicts } from "../engine/verdict.ts";
import { findTerms, understood } from "../engine/match.ts";
import type { Level, Member, MemberVerdict, ProductFacts, Reason, TriggerId } from "../engine/types.ts";
import { describe, triggerName } from "../i18n.ts";
import { api } from "../lib/api.ts";
import { newId } from "../lib/circle.ts";
import type { ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Icon, LevelBadge, Spinner, Top } from "../ui.tsx";

const ALL: TriggerId[] = ["gluten", "milk", "eggs", "peanuts", "tree_nuts", "pine_nuts", "sesame", "soy", "fish", "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin", "halal", "vegetarian"];
/** A pretend member who avoids everything: used to ask Gemma about *all* of a product's findings, so the request
 * never reveals which allergy this family has. */
const EVERYONE: Member = { id: "*", name: "*", avoid: ALL.filter((x) => x !== "halal" && x !== "vegetarian") as Member["avoid"], diets: ["halal", "vegetarian"], traces: "avoid" };

export function findScan(scans: ScanRecord[], requests: { scan: ScanRecord }[], id: string): ScanRecord | undefined {
  return scans.find((s) => s.id === id) ?? requests.find((r) => r.scan.id === id)?.scan;
}

export function worst(levels: Level[]): Level {
  return levels.includes("red") ? "red" : levels.includes("amber") ? "amber" : "green";
}

export function Result({ id }: { id: string }) {
  const { t, go, back, state, update, share, me, isParent, health } = useApp();
  const scan = findScan(state.scans, state.requests, id);
  const [researching, setResearching] = useState(false);
  const [explained, setExplained] = useState<{ trigger: TriggerId; quote: string; text: string }[] | null>(null);
  const [explaining, setExplaining] = useState(false);
  const started = useRef(false);
  const lang = state.lang;

  const facts = scan?.facts;
  // most serious first
  const order = { red: 0, amber: 1, green: 2 } as const;
  const results = useMemo(
    () => (facts ? verdicts(facts, state.members, state.safe).sort((a, b) => order[a.level] - order[b.level]) : []),
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
    if (scan.researched) return;
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
  }, [scan, unknowns, update, health]);

  if (!scan || !facts) {
    return (
      <>
        <Top title={t("resultFor")} onBack={back} backLabel={t("back")} />
        <main className="page"><p className="muted">{t("recentEmpty")}</p></main>
      </>
    );
  }

  const overall = worst(results.map((r) => r.level));
  const member = (mid: string) => state.members.find((m) => m.id === mid);
  const request = state.requests.find((r) => r.scan.id === scan.id);
  const gaps = stickerGaps(facts);

  const explain = async () => {
    setExplaining(true);
    const all = verdicts(facts, [EVERYONE])[0].reasons.filter((r) => r.trigger && r.quote && ["contains", "likely", "may_contain", "sticker_gap"].includes(r.kind));
    const findings = all.map((r) => ({ trigger: r.trigger!, quote: r.quote! })).filter((f, i, a) => a.findIndex((x) => x.trigger === f.trigger && x.quote === f.quote) === i);
    try {
      const { items } = await api.explain(findings, lang);
      setExplained(items);
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
    share({ t: "answer", id: newId(), ask: "", by: me!.name, at: Date.now(), decision: "approved", note: "", safe: [{ barcode: facts.barcode, recipe: recipeOf(facts), member_id: mid, approved_by: me!.name, at: Date.now() }] });
  };

  const speak = () => {
    const text = [
      facts.name ?? "",
      ...results.map((r) => {
        const m = member(r.member_id);
        const head = t(r.level === "red" ? "levelRed" : r.level === "amber" ? "levelAmber" : "levelGreen", { name: m?.name ?? "" });
        const first = r.reasons.find((x) => x.level === r.level);
        return first ? `${head}. ${reasonText(first, m?.name ?? "")}` : head;
      }),
    ].join(". ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "ar" ? "ar-JO" : "en-GB";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };

  const reasonText = (r: Reason, name: string) => describe(lang, r, name);

  return (
    <>
      <Top title={facts.name ?? t("unnamedProduct")} onBack={() => go({ name: "home" }, true)} backLabel={t("home")} />
      <main className="page">
        <div className={`summary-banner ${overall}`} role="status">
          <LevelBadge level={overall} />
          <span className="stack" style={{ gap: 2 }}>
            {overall === "green" ? (
              <strong>{t("everyoneFine")}</strong>
            ) : (
              results.map((r) => (
                <span key={r.member_id} className="row" style={{ gap: 8 }}>
                  <span className={`dot ${r.level}`} />
                  <strong>{member(r.member_id)?.name}</strong>
                  {t(r.level === "red" ? "levelRedShort" : r.level === "amber" ? "levelAmberShort" : "levelGreenShort")}
                </span>
              ))
            )}
          </span>
        </div>

        {(facts.brand || facts.barcode) && (
          <p className="small muted" style={{ margin: 0 }}>
            {[facts.brand, facts.barcode].filter(Boolean).join(" · ")} · {facts.off && !scan.thumb ? t("fromOff") : t("fromLabel")}
          </p>
        )}

        {results.map((r) => (
          <VerdictCard key={r.member_id} v={r} name={member(r.member_id)?.name ?? ""} reasonText={reasonText} canApprove={isParent && r.level !== "green" && !!facts.barcode} onApprove={() => approve(r.member_id)} />
        ))}

        {researching && (
          <p className="card row small" role="status">
            <Spinner />
            {t("stepResearch", { n: unknowns.length })}
          </p>
        )}

        {facts.sticker && (
          <section className="card stack">
            <h2>{t("stickerTitle")}</h2>
            {gaps.ingredients.length === 0 && gaps.statements.length === 0 ? (
              <p className="small" style={{ margin: 0 }}>{t("stickerMatch")}</p>
            ) : (
              <>
                <p className="small" style={{ margin: 0 }}>{t("stickerMissing")}</p>
                <ul className="ingredients">
                  {gaps.ingredients.map((i) => (
                    <li key={i.text} className={findTerms(i.text, facts.label?.language).length ? "hit" : ""}>
                      “{i.text}”{i.en && i.en !== i.text ? ` (${i.en})` : ""}
                    </li>
                  ))}
                  {gaps.statements.map((s) => (
                    <li key={s} className="hit">
                      {t(s === "may_contain" ? "stickerMissingMay" : "stickerMissingContains", { quote: `“${(s === "may_contain" ? facts.label?.may_contain : facts.label?.contains) ?? ""}”` })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        <section className="card stack">
          <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={explain} disabled={explaining || explained !== null}>
            {t("whyMore")}
          </button>
          {explaining && <p className="row small muted"><Spinner />{t("whyLoading")}</p>}
          {explained && explained.length > 0 && (
            <ul className="reasons">
              {explained.map((e, i) => (
                <li key={i}>
                  <span className="quote">{triggerName(lang, e.trigger)}</span> — {e.text}
                </li>
              ))}
            </ul>
          )}
          <Ingredients facts={facts} />
        </section>

        {scan.thumb && <img src={scan.thumb} alt="" style={{ width: 120, borderRadius: 10, border: "1px solid var(--line)" }} />}

        <div className="stack">
          {overall !== "green" && !isParent && (
            request ? (
              <p className="card small" role="status">
                {request.status === "waiting" ? t("askWaiting") : t("requestAnswered", { by: request.answeredBy ?? "", answer: t(request.status === "approved" ? "answerApproved" : "answerRefused") })}
                {request.note ? ` — “${request.note}”` : ""}
              </p>
            ) : (
              <button className="btn primary block" onClick={ask}>
                <Icon name="message" />
                {t("askAnyParent")}
              </button>
            )
          )}
          {facts.off && !facts.sticker && !scan.thumb && (
            <button className="btn block" onClick={() => go({ name: "scan", barcode: facts.barcode ?? undefined })}>
              <Icon name="camera" />
              {t("addLabelPhoto")}
            </button>
          )}
          <div className="row">
            <button className="btn grow" onClick={speak}>
              <Icon name="speaker" />
              {t("readAloud")}
            </button>
            <button className="btn grow" onClick={() => go({ name: "scan" }, true)}>
              <Icon name="scan" />
              {t("scanAnother")}
            </button>
          </div>
          <p className="small muted">{t("disclaimer")}</p>
        </div>
      </main>
    </>
  );
}

export function VerdictCard({ v, name, reasonText, canApprove, onApprove }: { v: MemberVerdict; name: string; reasonText: (r: Reason, name: string) => string; canApprove?: boolean; onApprove?: () => void }) {
  const { t } = useApp();
  const shown = v.reasons.filter((r) => r.level === v.level || r.kind === "approved").slice(0, 4);
  const rest = v.reasons.filter((r) => !shown.includes(r));
  return (
    <article className={`verdict ${v.level}`}>
      <div className="head">
        <LevelBadge level={v.level} />
        <h3>{t(v.level === "red" ? "levelRed" : v.level === "amber" ? "levelAmber" : "levelGreen", { name })}</h3>
      </div>
      <ul className="reasons">
        {shown.map((r, i) => (
          <ReasonLine key={i} r={r} text={reasonText(r, name)} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="more">
          <summary>{t("why")} (+{rest.length})</summary>
          <ul className="reasons">
            {rest.map((r, i) => (
              <ReasonLine key={i} r={r} text={reasonText(r, name)} />
            ))}
          </ul>
        </details>
      )}
      {canApprove && (
        <button className="btn ghost" onClick={onApprove}>
          <Icon name="check" />
          {t("approveFor", { name })}
        </button>
      )}
    </article>
  );
}

function ReasonLine({ r, text }: { r: Reason; text: string }) {
  const { t } = useApp();
  return (
    <li>
      {text}
      <div className="src">
        {t((r.source === "gemma" && !r.urls?.length ? "src_gemma_unsourced" : `src_${r.source}`) as never)}
        {r.why ? ` — ${r.why}` : ""}
        {r.urls?.length ? (
          <>
            {" — "}
            {r.urls.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noreferrer noopener" style={{ marginInlineEnd: 6 }}>
                [{i + 1}] {hostOf(u)}
              </a>
            ))}
          </>
        ) : null}
      </div>
    </li>
  );
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function Ingredients({ facts }: { facts: ProductFacts }) {
  const { t } = useApp();
  const l = facts.label;
  if (!l) return null;
  return (
    <details className="more">
      <summary>{t("ingredientsTitle")} ({l.ingredients.length})</summary>
      <ul className="ingredients">
        {l.ingredients.map((i, k) => {
          const hit = findTerms(i.text, l.language).length > 0 || findTerms(i.en, "en").length > 0;
          const known = understood(i.text, i.en, l.language, i.known_by_off);
          return (
            <li key={k} className={hit ? "hit" : known ? "" : "unknown"}>
              {i.text}
              {i.en && i.en.toLowerCase() !== i.text.toLowerCase() ? <span className="muted"> ({i.en})</span> : null}
            </li>
          );
        })}
      </ul>
      {l.may_contain && <p className="small"><strong>{l.may_contain}</strong></p>}
      {l.contains && <p className="small"><strong>{l.contains}</strong></p>}
    </details>
  );
}
