import { useMemo, useState } from "react";
import { recipeOf, verdicts } from "../engine/verdict.ts";
import type { Reason } from "../engine/types.ts";
import { ago, describe } from "../i18n.ts";
import { newId } from "../lib/circle.ts";
import { useApp } from "../App.tsx";
import { Icon, Top } from "../ui.tsx";
import { VerdictCard } from "./Result.tsx";

/** A parent answers a caregiver's question: approve the product for the flagged members, or not. */
export function RequestScreen({ id }: { id: string }) {
  const { t, back, state, share, me, isParent } = useApp();
  const req = state.requests.find((r) => r.id === id);
  const [note, setNote] = useState("");
  const lang = state.lang;
  const results = useMemo(() => (req ? verdicts(req.scan.facts, state.members, state.safe) : []), [req, state.members, state.safe]);
  if (!req) return null;
  const facts = req.scan.facts;
  const flagged = results.filter((r) => req.member_ids.includes(r.member_id) || r.level !== "green");
  const names = flagged.map((r) => state.members.find((m) => m.id === r.member_id)?.name ?? "").join(lang === "ar" ? " و" : " & ");
  const reasonText = (r: Reason, name: string) => describe(lang, r, name);

  const answer = (decision: "approved" | "refused") => {
    const safe =
      decision === "approved" && facts.barcode
        ? flagged.map((r) => ({ barcode: facts.barcode!, recipe: recipeOf(facts), member_id: r.member_id, approved_by: me!.name, at: Date.now() }))
        : [];
    share({ t: "answer", id: newId(), ask: req.id, by: me!.name, at: Date.now(), decision, note: note.trim(), safe });
    back();
  };

  return (
    <>
      <Top title={t("requestsTitle")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <p className="lead">
          {t("requestFrom", { name: req.from.name, product: facts.name ?? t("unnamedProduct") })} · {ago(lang, req.at)}
        </p>
        {req.scan.thumb && <img src={req.scan.thumb} alt="" style={{ width: "100%", maxWidth: 360, borderRadius: 12, border: "1px solid var(--line)" }} />}
        {flagged.map((r) => (
          <VerdictCard key={r.member_id} v={r} name={state.members.find((m) => m.id === r.member_id)?.name ?? ""} reasonText={reasonText} />
        ))}
        {req.status === "waiting" && isParent ? (
          <>
            <label className="field">
              {t("noteForCaregiver")}
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="btn primary block" disabled={!facts.barcode} onClick={() => answer("approved")}>
              <Icon name="check" />
              {t("approveFor", { name: names })}
            </button>
            <button className="btn block" onClick={() => answer("refused")}>
              {t("refuse")}
            </button>
          </>
        ) : (
          <p className="card">{t("requestAnswered", { by: req.answeredBy ?? "", answer: t(req.status === "approved" ? "answerApproved" : "answerRefused") })}</p>
        )}
        <p className="small muted">{t("disclaimer")}</p>
      </main>
    </>
  );
}
