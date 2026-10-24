import { useState } from "react";
import allergens from "../engine/data/allergens.json" with { type: "json" };
import jordan from "../engine/data/jordan.json" with { type: "json" };
import type { Level, TriggerId } from "../engine/types.ts";
import { joinNames, levelWord, shortDate, t as tr, triggerName } from "../i18n.ts";
import { checked, type Lang, type Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Avatar, Heading, Icon } from "../ui.tsx";
import { penReminders } from "./Home.tsx";

export type CareTab = "emergency" | "cook";

/** Emergency mode, the card for the cook and child mode: one place for when it matters. Everything here is
 * composed on this phone. Wiqaya never decides whether a reaction is happening and never gives treatment advice. */
export function Care({ tab, id }: { tab: CareTab; id?: string }) {
  const { t, go, state } = useApp();
  const members = checked(state);
  // the cook card can cover everyone; the other tabs are about one person
  const chosen = id === "*" ? undefined : members.find((m) => m.id === id) ?? (members.length === 1 ? members[0] : undefined);
  const lead = chosen ? t("careLead", { name: chosen.name }) : t("careLeadAll");
  const tabs: [CareTab, string, string][] = [
    ["emergency", "🚨", t("tabEmergency")],
    ["cook", "🍽", t("tabCook")],
  ];
  return (
    <>
      <Heading eyebrow={t("careEyebrow")} title={t("careTitle")} lead={lead} />
      <div className="content">
        <div className="segmented" role="tablist">
          {tabs.map(([k, icon, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => go({ name: "care", tab: k, id: chosen?.id }, true)}>
              <span aria-hidden="true">{icon}</span> {label}
            </button>
          ))}
        </div>
        {members.length > 1 && (
          <div className="row member-switch" role="group" aria-label={t("whoNeedsHelp")}>
            {tab === "cook" && (
              <button className={`select-chip ${!chosen ? "selected" : ""}`} aria-pressed={!chosen} onClick={() => go({ name: "care", tab, id: "*" }, true)}>
                {t("everyone")}
              </button>
            )}
            {members.map((m, i) => (
              <button key={m.id} className={`select-chip person ${chosen?.id === m.id ? "selected" : ""}`} aria-pressed={chosen?.id === m.id} onClick={() => go({ name: "care", tab, id: m.id }, true)}>
                <Avatar name={m.name} emoji={m.avatar} i={i} size={26} />
                {m.name}
              </button>
            ))}
          </div>
        )}
        {tab === "emergency" && <EmergencyMode member={chosen} />}
        {tab === "cook" && <CookCard members={chosen ? [chosen] : members} />}
      </div>
    </>
  );
}

function lastScan(state: ReturnType<typeof useApp>["state"], memberId: string) {
  return [
    ...state.scans.map((s) => ({ id: s.id as string | null, at: s.at, name: s.facts.name, level: s.verdicts.find((v) => v.member_id === memberId)?.level })),
    ...state.feed.map((f) => ({ id: null, at: f.at, name: f.name, level: f.levels[memberId] as Level | undefined })),
  ]
    .filter((x) => x.level && Date.now() - x.at < 12 * 3600_000)
    .sort((a, b) => b.at - a.at)[0];
}

function EmergencyMode({ member }: { member?: Profile }) {
  const { t, state, go, isParent } = useApp();
  const [locating, setLocating] = useState(false);
  const [full, setFull] = useState<Lang | null>(null);
  const lang = state.lang;
  const other: Lang = lang === "ar" ? "en" : "ar";
  const recent = member ? lastScan(state, member.id) : undefined;
  const time = (at: number) => new Date(at).toLocaleTimeString(lang === "ar" ? "ar-JO" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  const pen = member ? penReminders([member])[0] : undefined;

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
    const ate = recent ? t("emergencySmsAte", { product: recent.name ?? t("unnamedProduct"), level: levelWord(lang, recent.level), time: time(recent.at) }) : "";
    const name = member?.name ?? joinNames(lang, state.members.map((m) => m.name));
    const body = t("emergencySms", { name, ate, where });
    const to = (member?.emergency.contacts ?? []).map((c) => c.phone.replace(/[^\d+]/g, "")).filter(Boolean).join(",");
    // iOS wants "&body=", Android "?body="
    const sep = /iPhone|iPad|iPod/.test(navigator.userAgent) ? "&" : "?";
    location.href = `sms:${to}${sep}body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="stack">
      <a className="danger-btn call" href="tel:911">
        <Icon name="phone" /> {t("emergencyCall")}
        <span className="call-other" lang={other}>{tr(other, "emergencyCall")}</span>
      </a>
      <button className="secondary wide" onClick={textFamily} disabled={locating}>
        <Icon name="message" /> {locating ? t("emergencyLocating") : t("emergencyText")}
      </button>
      <p className="small-note">{t("emergencyTextNote")} {t("emergencyNote")}</p>

      {member && (
        <>
          <section className="big-card">
            <h2>{t("planTitle")}</h2>
            <h3 lang={other} dir={other === "ar" ? "rtl" : "ltr"} className="other-lang">{tr(other, "planTitle")}</h3>
            {member.emergency.plan ? (
              <p className="plan">{member.emergency.plan}</p>
            ) : (
              <>
                <div className="warning" style={{ margin: "18px 0" }}>{t("noPlan")}</div>
                {isParent && (
                  <button className="primary" onClick={() => go({ name: "member", id: member.id })}>
                    {t("addPlan")}
                  </button>
                )}
              </>
            )}
            <dl className="em-facts">
              <dt>{t("emergencyAllergies")}</dt>
              <dd>{allNames(member, lang)}</dd>
              {member.emergency.meds && (
                <>
                  <dt>{t("emergencyMeds")}</dt>
                  <dd>{member.emergency.meds}</dd>
                </>
              )}
              {recent && (
                <>
                  <dt>{t("emergencyAte")}</dt>
                  <dd>
                    {recent.name ?? t("unnamedProduct")} · {levelWord(lang, recent.level)} · {time(recent.at)}
                  </dd>
                </>
              )}
              {member.emergency.contacts.length > 0 && (
                <>
                  <dt>{t("emergencyContacts")}</dt>
                  <dd>
                    {member.emergency.contacts.map((c, i) => (
                      <div key={i}>
                        {c.name} · <a href={`tel:${c.phone}`} dir="ltr">{c.phone}</a>
                      </div>
                    ))}
                  </dd>
                </>
              )}
            </dl>
            <div className="row" style={{ marginTop: 16 }}>
              <span className="small-note">{t("showParamedics")}:</span>
              <button className="secondary" onClick={() => setFull("ar")}>{t("showArabic")}</button>
              <button className="secondary" onClick={() => setFull("en")}>{t("showEnglish")}</button>
            </div>
          </section>
          {pen && (
            <section className="notice" style={{ margin: 0 }}>
              <h3>
                <Icon name="bell" /> {t("epiNotice", { days: Math.max(0, pen.days) })}
              </h3>
              <p>{t("epiNoticeDate", { date: shortDate(lang, pen.at) })}</p>
            </section>
          )}
        </>
      )}
      {full && member && (
        <div className="fullscreen-card" lang={full} dir={full === "ar" ? "rtl" : "ltr"} role="dialog" aria-modal="true" onClick={() => setFull(null)}>
          <h2>
            {full === "ar" ? "حساسية غذائية" : "Food allergy"}: {member.name}
          </h2>
          <p>
            <b>{tr(full, "emergencyAllergies")}:</b> {allNames(member, full)}
          </p>
          {member.emergency.meds && (
            <p>
              <b>{tr(full, "emergencyMeds")}:</b> {member.emergency.meds}
            </p>
          )}
          {member.emergency.plan && (
            <p style={{ whiteSpace: "pre-wrap" }}>
              <b>{tr(full, "planTitle")}:</b> {member.emergency.plan}
            </p>
          )}
          <small>{tr(full, "tapToClose")}</small>
        </div>
      )}
    </div>
  );
}

function allNames(m: Profile, lang: Lang): string {
  return [...m.avoid, ...m.diets].map((a) => triggerName(lang, a, true)).join(lang === "ar" ? "، " : ", ");
}

type Entry = { id: string; terms: Record<string, string[]> };
const ENTRIES = [...allergens.allergens, ...allergens.diets] as Entry[];

/** Other names for this allergen in one language: what a cook should look for. */
export function hiddenNames(id: string, lang: Lang, n = 3): string[] {
  const pack = jordan.entries.filter((e) => e.allergen === id && e.lang === lang).map((e) => e.term);
  const base = ENTRIES.find((e) => e.id === id)?.terms[lang] ?? [];
  const names = [...new Set([...pack, ...base].filter((x) => !x.startsWith("~")).map((x) => x.replace(/\*$/, "")))];
  // "peanut" and "peanuts": keep one; skip the allergen's own name
  const own = triggerName(lang, id).toLowerCase();
  return names.filter((x) => !(x.endsWith("s") && names.includes(x.slice(0, -1))) && x.toLowerCase() !== own && `ال${x}` !== own).slice(0, n);
}

function CookCard({ members }: { members: Profile[] }) {
  const { t, state } = useApp();
  const triggers = [...new Set(members.flatMap((m) => [...m.avoid, ...m.diets]))] as TriggerId[];
  const names = joinNames(state.lang, members.map((m) => m.name));
  const line = (lang: Lang, id: TriggerId) => [triggerName(lang, id), ...hiddenNames(id, lang)].join(" · ");
  return (
    <section className="big-card cook-card">
      <div className="eyebrow">{t("cookEyebrow")}</div>
      <h2 lang="en" dir="ltr">Please help keep our meal safe.</h2>
      <h2 lang="ar" dir="rtl">يُرجى المساعدة في تحضير وجبة آمنة</h2>
      <p>{t("cookLead", { names })}</p>
      <div className="cook-list">
        {triggers.map((x) => (
          <div key={x}>
            <span lang="en" dir="ltr">{line("en", x)}</span>
            <span lang="ar" dir="rtl" className="ar">{line("ar", x)}</span>
          </div>
        ))}
      </div>
      <p lang="ar" dir="rtl">يُرجى التحقق من كل المكونات والصلصات والزيوت، وتجنّب التلامس مع مسببات الحساسية. شكرًا.</p>
      <p lang="en" dir="ltr">Please check every ingredient, sauce and oil, and avoid cross-contact. Thank you.</p>
    </section>
  );
}
