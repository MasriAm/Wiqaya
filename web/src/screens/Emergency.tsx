import { useState } from "react";
import { triggerName } from "../i18n.ts";
import type { Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Icon, Initial, Top } from "../ui.tsx";

/** The emergency screen: call 911, text the family what was eaten and where, show the doctor's plan. Wiqaya never
 * decides whether a reaction is happening. Everything here is composed on this phone; the location goes only into
 * the text message, sent by the phone's own messaging app. */
export function Emergency({ id }: { id?: string }) {
  const { t, back, state, go } = useApp();
  const [full, setFull] = useState<"en" | "ar" | null>(null);
  const [locating, setLocating] = useState(false);
  const lang = state.lang;
  const member = state.members.find((m) => m.id === id) ?? (state.members.length === 1 ? state.members[0] : undefined);

  if (!member) {
    return (
      <div className="emergency-page" style={{ minHeight: "100dvh" }}>
        <Top title={t("emergencyTitle")} onBack={back} backLabel={t("back")} />
        <main className="page">
          <h2 className="big">{t("emergencyWho")}</h2>
          {state.members.map((m) => (
            <button key={m.id} className="btn big block" onClick={() => go({ name: "emergency", id: m.id }, true)}>
              <Initial name={m.name} />
              {m.name}
            </button>
          ))}
          <a className="btn danger big block" href="tel:911">
            <Icon name="phone" />
            {t("emergencyCall")}
          </a>
        </main>
      </div>
    );
  }

  // the last product scanned in the past 12 hours, by anyone in the family
  const recent = [
    ...state.scans.map((s) => ({ at: s.at, name: s.facts.name, level: s.verdicts.find((v) => v.member_id === member.id)?.level })),
    ...state.feed.map((f) => ({ at: f.at, name: f.name, level: f.levels[member.id] })),
  ]
    .filter((x) => Date.now() - x.at < 12 * 3600_000)
    .sort((a, b) => b.at - a.at)[0];
  const time = (at: number) => new Date(at).toLocaleTimeString(lang === "ar" ? "ar-JO" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const levelWord = (l?: string) => t(l === "red" ? "levelRedShort" : l === "amber" ? "levelAmberShort" : "levelGreenShort");

  const textFamily = async () => {
    setLocating(true);
    const where = await new Promise<string>((resolve) => {
      if (!navigator.geolocation) return resolve("");
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(t("emergencySmsWhere", { url: `https://maps.google.com/?q=${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}` })),
        () => resolve(""),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    });
    setLocating(false);
    const ate = recent ? t("emergencySmsAte", { product: recent.name ?? t("unnamedProduct"), level: levelWord(recent.level), time: time(recent.at) }) : "";
    const body = t("emergencySms", { name: member.name, ate, where });
    const to = member.emergency.contacts.map((c) => c.phone.replace(/[^\d+]/g, "")).filter(Boolean).join(",");
    // iOS wants "&body=", Android "?body="
    const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? "&" : "?";
    location.href = `sms:${to}${sep}body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="emergency-page" style={{ minHeight: "100dvh" }}>
      <Top title={t("emergencyTitle")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <a className="btn danger big block" href="tel:911">
          <Icon name="phone" />
          {t("emergencyCall")}
        </a>
        <button className="btn big block" onClick={textFamily} disabled={locating}>
          <Icon name="message" />
          {locating ? t("emergencyLocating") : t("emergencyText")}
        </button>
        <p className="small muted">{t("emergencyNote")}</p>
        <Card member={member} lang={lang} recent={recent ? `${recent.name ?? t("unnamedProduct")} · ${levelWord(recent.level)} · ${time(recent.at)}` : null} />
        <div className="row">
          <button className="btn grow" onClick={() => setFull("ar")}>
            {t("showArabic")}
          </button>
          <button className="btn grow" onClick={() => setFull("en")}>
            {t("showEnglish")}
          </button>
        </div>
      </main>
      {full && (
        <div className="fullscreen-card" lang={full} dir={full === "ar" ? "rtl" : "ltr"} role="dialog" aria-modal="true" onClick={() => setFull(null)}>
          <FullCard member={member} lang={full} />
          <p style={{ fontSize: 16, color: "#555" }}>{full === "ar" ? "اضغط للإغلاق" : "Tap to close"}</p>
        </div>
      )}
    </div>
  );
}

function Card({ member, lang, recent }: { member: Profile; lang: "en" | "ar"; recent: string | null }) {
  const { t } = useApp();
  const e = member.emergency;
  return (
    <section className="em-card">
      <h2>{member.name}</h2>
      <dl style={{ margin: 0 }}>
        <dt>{t("emergencyAllergies")}</dt>
        <dd>{[...member.avoid, ...member.diets].map((a) => triggerName(lang, a, true)).join(lang === "ar" ? "، " : ", ")}</dd>
        {e.meds && (
          <>
            <dt>{t("emergencyMeds")}</dt>
            <dd>{e.meds}</dd>
          </>
        )}
        <dt>{t("emergencyPlan")}</dt>
        <dd>{e.plan || <span className="muted small">{t("emergencyNoPlan")}</span>}</dd>
        {recent && (
          <>
            <dt>{t("emergencyAte")}</dt>
            <dd>{recent}</dd>
          </>
        )}
        {e.contacts.length > 0 && (
          <>
            <dt>{t("emergencyContacts")}</dt>
            <dd>
              {e.contacts.map((c, i) => (
                <div key={i}>
                  {c.name} — <a href={`tel:${c.phone}`} dir="ltr">{c.phone}</a>
                </div>
              ))}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function FullCard({ member, lang }: { member: Profile; lang: "en" | "ar" }) {
  const e = member.emergency;
  const L = lang === "ar"
    ? { title: "حساسية غذائية", allergies: "الحساسيات", meds: "الأدوية", plan: "خطة الطبيب" }
    : { title: "Food allergy", allergies: "Allergies", meds: "Medicines", plan: "Doctor's action plan" };
  return (
    <>
      <h2>{L.title}: {member.name}</h2>
      <p><strong>{L.allergies}:</strong> {[...member.avoid, ...member.diets].map((a) => triggerName(lang, a, true)).join(lang === "ar" ? "، " : ", ")}</p>
      {e.meds && <p><strong>{L.meds}:</strong> {e.meds}</p>}
      {e.plan && <p style={{ whiteSpace: "pre-wrap" }}><strong>{L.plan}:</strong> {e.plan}</p>}
    </>
  );
}
