import { useState } from "react";
import type { Level } from "../engine/types.ts";
import { ago, pillWord, shortDate } from "../i18n.ts";
import { useApp } from "../App.tsx";
import { Avatar, Heading, HeroArt, Icon, Lines, Pill, ProductThumb } from "../ui.tsx";
import { MemberCard } from "./ProfileEditor.tsx";
import { checked } from "../lib/state.ts";
import { worst } from "./Result.tsx";

const DAY = 86400_000;

/** Days until each member's epinephrine pen expires, for the ones within 30 days (or past). */
export function penReminders(members: { id: string; name: string; emergency: { epi_expiry: string } }[]) {
  return members
    .map((m) => ({ m, at: m.emergency.epi_expiry ? Date.parse(m.emergency.epi_expiry) : NaN }))
    .filter((x) => !Number.isNaN(x.at) && x.at - Date.now() < 30 * DAY)
    .map((x) => ({ ...x, days: Math.ceil((x.at - Date.now()) / DAY) }));
}

export function Home() {
  const { t, go, state, isParent, me, invite } = useApp();
  const lang = state.lang;
  const [all, setAll] = useState(false);
  const waiting = state.requests.filter((r) => r.status === "waiting" && (isParent ? r.from.id !== me?.id : r.from.id === me?.id));
  const answered = state.requests.filter((r) => r.status !== "waiting" && r.from.id === me?.id && Date.now() - r.at < 36 * 3600_000);
  const members = checked(state);
  const pens = penReminders(members);

  type Row = { id: string; at: number; by: string; name: string | null; level: Level; own: boolean; thumb?: string };
  const rows: Row[] = [
    ...state.scans.map((s) => ({ id: s.id, at: s.at, by: s.by.id === me?.id ? t("you") : s.by.name, name: s.facts.name, level: worst(s.verdicts.map((v) => v.level)), own: true, thumb: s.thumb })),
    ...state.feed.map((f) => ({ id: f.id, at: f.at, by: f.by.name, name: f.name, level: worst(Object.values(f.levels)), own: false })),
  ].sort((a, b) => b.at - a.at);
  const shown = all ? rows.slice(0, 30) : rows.slice(0, 4);

  const hour = new Date().getHours();
  const greet = t(hour < 12 ? "greetMorning" : hour < 18 ? "greetAfternoon" : "greetEvening", { name: me?.name ?? "" });
  const today = new Date().toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <Heading eyebrow={t("homeEyebrow")} title={`${greet} 👋`} lead={t("homeLead")} extra={<span className="date">{today}</span>} />

      {waiting.map((r) => (
        <button key={r.id} className="warning request-card" onClick={() => go(isParent ? { name: "request", id: r.id } : { name: "result", id: r.scan.id })}>
          <Avatar name={r.from.name} i={2} />
          <span>
            <b>{t("requestFrom", { name: r.from.name, product: r.scan.facts.name ?? t("unnamedProduct") })}</b>
            <br />
            <small>{isParent ? t("requestOpen") : t("askWaiting")} · {ago(lang, r.at)}</small>
          </span>
          <Icon name="arrow" />
        </button>
      ))}
      {answered.map((r) => (
        <button key={r.id} className={`answer-card ${r.status === "approved" ? "ok" : "no"}`} onClick={() => go({ name: "result", id: r.scan.id })}>
          <Pill level={r.status === "approved" ? "green" : "red"}>{t(r.status === "approved" ? "answerApproved" : "answerRefused")}</Pill>
          <span>
            {t("requestAnswered", { by: r.answeredBy ?? "", answer: t(r.status === "approved" ? "answerApproved" : "answerRefused") })} · <b>{r.scan.facts.name ?? t("unnamedProduct")}</b>
            {r.note && (
              <>
                <br />
                <small>“{r.note}”</small>
              </>
            )}
          </span>
        </button>
      ))}

      <div className="dashboard">
        <div>
          <section className="hero">
            <div className="hero-text">
              <h2>
                <Lines text={t("heroTitle")} />
              </h2>
              <p>
                <Lines text={t("heroText")} />
              </p>
              <button className="primary" onClick={() => go({ name: "scan" })}>
                <Icon name="scan" /> {t("navScan")} <Icon name="arrow" />
              </button>
              <div className="hero-hint">{t("heroHint")}</div>
            </div>
            <HeroArt />
          </section>

          <div className="section-title">
            <h2>
              {t("circleTitle")} {state.familyName && <span className="muted-title">/ {state.familyName}</span>}
            </h2>
            <button className="text-button" onClick={() => go({ name: "family" })}>
              {t("manageFamily")} ↗
            </button>
          </div>
          {members.length === 0 ? (
            <p className="big-card small-note">{t("waitingProfiles")}</p>
          ) : (
            <div className="family-row">
              {members.map((m, i) => (
                <MemberCard key={m.id} p={m} i={i} onClick={() => go(isParent ? { name: "member", id: m.id } : me?.role === "child" ? { name: "family" } : { name: "care", tab: "emergency", id: m.id })} />
              ))}
            </div>
          )}

          <div className="section-title">
            <h2>{t("helpTitle")}</h2>
          </div>
          <div className="quick-grid">
            <button className="quick" onClick={() => go({ name: "safe" })}>
              <span className="icon-box">
                <Icon name="list" />
              </span>
              <h3>{t("quickSafe")} ↗</h3>
              <p>{t("quickSafeSub")}</p>
            </button>
            <button className="quick" onClick={() => go({ name: "care", tab: "cook" })}>
              <span className="icon-box">
                <Icon name="cook" />
              </span>
              <h3>{t("quickCook")} ↗</h3>
              <p>{t("quickCookSub")}</p>
            </button>
            {isParent ? (
              <button className="quick" onClick={() => invite("grandparent")}>
                <span className="icon-box">
                  <Icon name="qr" />
                </span>
                <h3>{t("quickInvite")} ↗</h3>
                <p>{t("quickInviteSub")}</p>
              </button>
            ) : (
              <button className="quick" onClick={() => go({ name: "care", tab: "child" })}>
                <span className="icon-box">
                  <Icon name="face" />
                </span>
                <h3>{t("quickChild")} ↗</h3>
                <p>{t("quickChildSub")}</p>
              </button>
            )}
          </div>
        </div>

        <aside className="side-column">
          <section className="panel">
            <div className="row spread">
              <h3>{t("recentTitle")}</h3>
              {rows.length > 4 && (
                <button className="text-button" onClick={() => setAll(!all)}>
                  {all ? t("showLess") : t("showAll")}
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="small-note" style={{ marginTop: 12 }}>{t("recentEmpty")}</p>
            ) : (
              shown.map((r) => (
                <button key={r.id} className="activity wide item" disabled={!r.own} onClick={() => r.own && go({ name: "result", id: r.id })}>
                  <ProductThumb name={r.name} thumb={r.thumb} />
                  <div>
                    <h4>{r.name ?? t("unnamedProduct")}</h4>
                    <p>
                      {ago(lang, r.at)} · {r.by}
                    </p>
                  </div>
                  <Pill level={r.level}>{pillWord(lang, r.level)}</Pill>
                </button>
              ))
            )}
          </section>

          {pens.map(({ m, days, at }) => (
            <section className="notice" key={m.id}>
              <h3>
                <Icon name="bell" /> {t("reminderTitle")}
              </h3>
              <p>{days > 0 ? t("epiSoon", { name: m.name, days }) : days === 0 ? t("epiToday", { name: m.name }) : t("epiExpired", { name: m.name, date: shortDate(lang, at) })}</p>
              <button onClick={() => go({ name: "care", tab: "emergency", id: m.id })}>{t("viewEmergencyPlan")} →</button>
            </section>
          ))}

          <section className="privacy-card">
            <Icon name="shield" />
            <h3>{t("privacyCardTitle")}</h3>
            <p>{t("privacyCardText")}</p>
            <button className="text-button" onClick={() => go({ name: "privacy" })}>
              {t("privacyPromise")} ↗
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
