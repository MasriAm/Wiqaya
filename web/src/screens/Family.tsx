import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import allergens from "../engine/data/allergens.json" with { type: "json" };
import jordan from "../engine/data/jordan.json" with { type: "json" };
import { triggerName } from "../i18n.ts";
import { inviteLink, newId } from "../lib/circle.ts";
import { randomId } from "../lib/crypto.ts";
import { blankProfile, type Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Icon, Initial, Top } from "../ui.tsx";
import { ProfileEditor, summary } from "./ProfileEditor.tsx";

export function Family() {
  const { t, go, state, isParent, share } = useApp();
  const lang = state.lang;
  const productName = (barcode: string) => state.scans.find((s) => s.facts.barcode === barcode)?.facts.name ?? barcode;
  return (
    <>
      <Top title={t("family")} />
      <main className="page">
        <section className="card">
          <h2>{t("membersTitle")}</h2>
          <ul className="list">
            {state.members.map((m) => (
              <li key={m.id}>
                <Initial name={m.name} />
                <span className="grow">
                  <strong>{m.name}</strong>
                  <br />
                  <span className="small muted">{summary(lang, m)}</span>
                </span>
                <button className="icon-btn" aria-label={`${t("cookCard")}: ${m.name}`} onClick={() => go({ name: "cook", id: m.id })}>
                  <Icon name="card" />
                </button>
                {isParent && (
                  <button className="btn ghost" onClick={() => go({ name: "member", id: m.id })}>
                    {t("edit")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isParent && (
            <button className="btn ghost" onClick={() => go({ name: "member", id: "new" })}>
              <Icon name="plus" />
              {t("addPerson")}
            </button>
          )}
        </section>

        <section className="card">
          <h2>{t("peopleInFamily")}</h2>
          <ul className="list">
            {state.people.map((p) => (
              <li key={p.id}>
                <Initial name={p.name} />
                <span className="grow">
                  {p.name} {p.id === state.me?.id ? <span className="muted">({t("you")})</span> : null}
                </span>
                <span className="chip static">{t(p.role === "parent" ? "rolesParent" : "rolesCaregiver")}</span>
              </li>
            ))}
          </ul>
          {isParent && (
            <div className="stack" style={{ marginTop: 8 }}>
              <button className="btn block" onClick={() => go({ name: "invite", role: "caregiver" })}>
                <Icon name="qr" />
                {t("inviteCaregiver")}
              </button>
              <button className="btn ghost" onClick={() => go({ name: "invite", role: "parent" })}>
                {t("inviteParent")}
              </button>
            </div>
          )}
        </section>

        <section className="card">
          <h2>{t("safeList")}</h2>
          {state.safe.length === 0 ? (
            <p className="small muted">{t("safeEmpty")}</p>
          ) : (
            <ul className="list">
              {state.safe.map((e) => (
                <li key={e.barcode + e.member_id}>
                  <span className="dot green" />
                  <span className="grow">
                    <strong>{productName(e.barcode)}</strong>
                    <br />
                    <span className="small muted">
                      {t("approvedFor", { name: state.members.find((m) => m.id === e.member_id)?.name ?? "" })} · {e.approved_by}
                    </span>
                  </span>
                  {isParent && (
                    <button className="btn ghost" onClick={() => share({ t: "unsafe", id: newId(), barcode: e.barcode, member_id: e.member_id })}>
                      {t("remove")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

export function MemberEdit({ id }: { id: string }) {
  const { t, back, state, share, isParent } = useApp();
  const existing = state.members.find((m) => m.id === id);
  const [p, setP] = useState<Profile>(existing ?? blankProfile(randomId(6)));
  if (!isParent) {
    return (
      <>
        <Top title={t("edit")} onBack={back} backLabel={t("back")} />
        <main className="page"><p>{t("notParent")}</p></main>
      </>
    );
  }
  const publish = async (members: Profile[]) => {
    await share({ t: "profiles", id: newId(), v: state.profilesVersion + 1, members, safe: state.safe.filter((e) => members.some((m) => m.id === e.member_id)) });
    back();
  };
  const valid = p.name.trim() && p.avoid.length + p.diets.length > 0;
  return (
    <>
      <Top title={existing ? existing.name : t("addPerson")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <ProfileEditor value={p} onChange={setP} emergency />
        {!valid && <p className="muted small">{t("noAllergiesYet")}</p>}
        <button className="btn primary block" disabled={!valid} onClick={() => publish([...state.members.filter((m) => m.id !== p.id), { ...p, name: p.name.trim() }])}>
          {t("save")}
        </button>
        {existing && (
          <button className="btn ghost" style={{ color: "var(--red)" }} onClick={() => publish(state.members.filter((m) => m.id !== p.id))}>
            {t("removePerson")}
          </button>
        )}
      </main>
    </>
  );
}

export function InviteScreen({ role }: { role: "parent" | "caregiver" }) {
  const { t, back, state } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const link = state.circle ? inviteLink(state.circle, role) : "";
  useEffect(() => {
    if (canvas.current && link) QRCode.toCanvas(canvas.current, link, { errorCorrectionLevel: "M", margin: 1, width: 300 });
  }, [link]);
  return (
    <>
      <Top title={t(role === "parent" ? "inviteParent" : "inviteCaregiver")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <p className="lead">{t("inviteLead")}</p>
        <div className="qr">
          <canvas ref={canvas} aria-label="QR" />
        </div>
        <p className="small">{t(role === "parent" ? "inviteParentNote" : "inviteCaregiverNote")}</p>
        <label className="field small">
          {t("inviteLinkLabel")}
          <input readOnly value={link} dir="ltr" onFocus={(e) => e.target.select()} />
        </label>
        <div className="row">
          <button className="btn grow" onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => undefined);
            setCopied(true);
          }}>
            {copied ? t("inviteCopied") : t("inviteCopy")}
          </button>
          {"share" in navigator && (
            <button className="btn grow" onClick={() => navigator.share({ title: "Wiqaya", url: link }).catch(() => undefined)}>
              <Icon name="share" />
              {t("inviteShare")}
            </button>
          )}
        </div>
        <p className="small muted">{t("invitePrivate")}</p>
      </main>
    </>
  );
}

type Entry = { id: string; terms: Record<string, string[]> };
const ENTRIES = [...allergens.allergens, ...allergens.diets] as Entry[];

/** Every name that means this allergen, in one language: what a cook should look for. */
function hiddenNames(id: string, lang: "en" | "ar"): string[] {
  const base = ENTRIES.find((e) => e.id === id)?.terms[lang] ?? [];
  const pack = jordan.entries.filter((e) => e.allergen === id && e.lang === lang).map((e) => e.term);
  return [...new Set([...base, ...pack].filter((x) => !x.startsWith("~")).map((x) => x.replace(/\*$/, "")))].slice(0, 14);
}

export function CookCard({ id }: { id: string }) {
  const { t, back, state } = useApp();
  const m = state.members.find((x) => x.id === id);
  if (!m) return null;
  const block = (lang: "en" | "ar") => (
    <section className="em-card" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <h2 style={{ fontSize: 22 }}>{lang === "ar" ? `ممنوع على ${m.name}:` : `${m.name} must not eat:`}</h2>
      {[...m.avoid, ...m.diets].map((a) => (
        <div key={a}>
          <strong style={{ fontSize: 20 }}>{triggerName(lang, a, true)}</strong>
          <div className="small muted">{hiddenNames(a, lang).join(lang === "ar" ? "، " : ", ")}</div>
        </div>
      ))}
      <p style={{ margin: 0 }}>{lang === "ar" ? "يُرجى التحقق من كل المكونات والصلصات والزيوت. شكرًا." : "Please check every ingredient, sauce and oil. Thank you."}</p>
    </section>
  );
  return (
    <>
      <Top title={t("cookCard")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <p className="lead">{t("cookCardLead")}</p>
        {block("ar")}
        {block("en")}
      </main>
    </>
  );
}
