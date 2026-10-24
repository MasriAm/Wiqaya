import { useMemo, useState } from "react";
import { verdicts } from "../engine/verdict.ts";
import { ago, joinNames, levelWord } from "../i18n.ts";
import { newId } from "../lib/circle.ts";
import { useApp } from "../App.tsx";
import { Heading, Icon, Modal, Pill, ProductThumb } from "../ui.tsx";
import { FindingRow, findings, Ingredients, safeEntry } from "./Result.tsx";

/** A parent answers a child's or grandparent's question. Only amber results can be approved; red stays red. */
export function RequestScreen({ id }: { id: string }) {
  const { t, back, state, share, me, isParent } = useApp();
  const req = state.requests.find((r) => r.id === id);
  const [note, setNote] = useState("");
  const [keep, setKeep] = useState(true);
  const [sent, setSent] = useState<"approved" | "refused" | null>(null);
  const lang = state.lang;
  const results = useMemo(() => (req ? verdicts(req.scan.facts, state.members, state.safe) : []), [req, state.members, state.safe]);
  if (!req) return <Heading eyebrow={t("reqEyebrow")} title={t("resultMissing")} />;
  const facts = req.scan.facts;
  const asked = results.filter((r) => req.member_ids.includes(r.member_id) || r.level !== "green");
  const name = (mid: string) => state.members.find((m) => m.id === mid)?.name ?? "";
  const ambers = asked.filter((r) => r.level === "amber");
  const reds = asked.filter((r) => r.level === "red");

  const answer = (decision: "approved" | "refused") => {
    const safe = decision === "approved" && keep && facts.barcode ? ambers.map((r) => safeEntry(facts, r.member_id, me!.name)) : [];
    share({ t: "answer", id: newId(), ask: req.id, by: me!.name, at: Date.now(), decision, note: note.trim(), safe });
    setSent(decision);
  };

  return (
    <>
      <Heading eyebrow={t("reqEyebrow")} title={t("reqTitle", { name: req.from.name })} lead={`${t("reqLead", { name: req.from.name, product: facts.name ?? t("unnamedProduct"), members: joinNames(lang, asked.map((r) => name(r.member_id))) })} · ${ago(lang, req.at)}`} />
      <div className="content stack">
        <section className="big-card">
          <div className="row">
            <ProductThumb name={facts.name} thumb={req.scan.thumb} big />
            <div>
              <h2 className="product-name">{facts.name ?? t("unnamedProduct")}</h2>
              <p>{[facts.brand, facts.barcode].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="row summary-banner">
            {asked.map((r) => (
              <Pill key={r.member_id} level={r.level} big>
                ● {t("memberPill", { name: name(r.member_id), level: levelWord(lang, r.level) })}
              </Pill>
            ))}
          </div>
          {req.scan.thumb && <img className="request-photo" src={req.scan.thumb} alt="" />}
        </section>

        <section className="big-card">
          <h2>{t("findingsTitle")}</h2>
          {findings(asked, state.members).map((f) => (
            <FindingRow key={f.key} f={f} />
          ))}
        </section>

        <Ingredients facts={facts} />

        {req.status === "waiting" && isParent ? (
          <section className="big-card">
            {reds.length > 0 && <div className="warning" style={{ marginBottom: 14 }}>{ambers.length ? t("redRule") : t("reqRedOnly")}</div>}
            <label className="field first" htmlFor="note">{t("reqNote")}</label>
            <input id="note" type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            {ambers.length > 0 && facts.barcode && (
              <label className="check">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
                {t("reqSaveRecipe")}
              </label>
            )}
            {ambers.length > 0 && <p className="small-note">{t("reqApproveNote")}</p>}
            <div className="stack" style={{ marginTop: 14 }}>
              <button className="danger-btn" onClick={() => answer("refused")}>
                {t("refuse")}
              </button>
              {ambers.length > 0 && (
                <button className="primary green-btn" onClick={() => answer("approved")}>
                  <Icon name="check" /> {t("approveFor", { name: joinNames(lang, ambers.map((r) => name(r.member_id))) })}
                </button>
              )}
            </div>
          </section>
        ) : (
          <div className={`decision ${req.status === "approved" ? "ok" : "no"}`}>
            {req.status === "waiting" ? t("askWaiting") : t("requestAnswered", { by: req.answeredBy ?? "", answer: t(req.status === "approved" ? "answerApproved" : "answerRefused") })}
          </div>
        )}
      </div>
      {sent && (
        <Modal label={t("reqSentTitle")} onClose={back} closeLabel={t("close")}>
          <div className="eyebrow">{t("reqEyebrow")}</div>
          <h2>{t("reqSentTitle")}</h2>
          <Pill level={sent === "approved" ? "amber" : "red"}>{t(sent === "approved" ? "answerApproved" : "answerRefused")}</Pill>
          <p>{t(sent === "approved" ? "reqSentApproved" : "reqSentRefused", { name: req.from.name })}</p>
          {sent === "approved" && keep && facts.barcode && <p>{t("reqSavedSafe")}</p>}
          <button className="primary wide" onClick={back}>
            {t("done")}
          </button>
        </Modal>
      )}
    </>
  );
}
