import type { Level } from "../engine/types.ts";
import { ago } from "../i18n.ts";
import { useApp } from "../App.tsx";
import { Icon, Initial } from "../ui.tsx";
import { summary } from "./ProfileEditor.tsx";

export function Home() {
  const { t, go, state, isParent, me } = useApp();
  const lang = state.lang;
  const waiting = state.requests.filter((r) => r.status === "waiting" && (isParent || r.from.id === me?.id));
  const answered = state.requests.filter((r) => r.status !== "waiting" && r.from.id === me?.id && Date.now() - r.at < 36 * 3600_000);
  const soon = state.members.filter((m) => {
    const d = m.emergency.epi_expiry ? Date.parse(m.emergency.epi_expiry) : NaN;
    return !Number.isNaN(d) && d - Date.now() < 30 * 86400_000;
  });
  type Row = { id: string; at: number; by: string; name: string | null; levels: Record<string, Level>; own: boolean };
  const rows: Row[] = [
    ...state.scans.map((s) => ({ id: s.id, at: s.at, by: s.by.name, name: s.facts.name, levels: Object.fromEntries(s.verdicts.map((v) => [v.member_id, v.level])), own: true })),
    ...state.feed.map((f) => ({ id: f.id, at: f.at, by: f.by.name, name: f.name, levels: f.levels, own: false })),
  ].sort((a, b) => b.at - a.at).slice(0, 12);

  return (
    <>
      <header className="top">
        <span className="wordmark" style={{ flex: 1 }}>
          {lang === "ar" ? "وقاية" : "Wiqaya"} <small lang={lang === "ar" ? "en" : "ar"}>{lang === "ar" ? "Wiqaya" : "وقاية"}</small>
        </span>
        <button className="sos" onClick={() => go({ name: "emergency" })}>
          <Icon name="cross" />
          {t("emergency")}
        </button>
        <button className="icon-btn" onClick={() => go({ name: "settings" })} aria-label={t("settings")}>
          <Icon name="settings" />
        </button>
      </header>
      <main className="page">
        {soon.map((m) => (
          <div key={m.id} className="card request" role="status">
            {t("epiSoon", { name: m.name, date: new Date(m.emergency.epi_expiry).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB") })}
          </div>
        ))}

        {waiting.map((r) => (
          <button key={r.id} className="card request row" style={{ textAlign: "start", cursor: "pointer" }} onClick={() => go(isParent ? { name: "request", id: r.id } : { name: "result", id: r.scan.id })}>
            <Initial name={r.from.name} />
            <span className="grow">
              <strong>{t("requestFrom", { name: r.from.name, product: r.scan.facts.name ?? t("unnamedProduct") })}</strong>
              <br />
              <span className="small muted">{isParent ? t("requestOpen") : t("askWaiting")} · {ago(lang, r.at)}</span>
            </span>
          </button>
        ))}
        {answered.map((r) => (
          <button key={r.id} className="card row" style={{ textAlign: "start", cursor: "pointer" }} onClick={() => go({ name: "result", id: r.scan.id })}>
            <span className={`dot ${r.status === "approved" ? "green" : "red"}`} />
            <span className="grow">
              {t("requestAnswered", { by: r.answeredBy ?? "", answer: t(r.status === "approved" ? "answerApproved" : "answerRefused") })}
              {" — "}
              <strong>{r.scan.facts.name ?? t("unnamedProduct")}</strong>
              {r.note && <><br /><span className="small">“{r.note}”</span></>}
            </span>
          </button>
        ))}

        <button className="btn primary big block" onClick={() => go({ name: "scan" })}>
          <Icon name="scan" />
          {t("scan")}
        </button>

        <section className="card">
          <h2>{t("membersTitle")}</h2>
          {state.members.length === 0 ? (
            <p className="muted small">{t("updateWaiting")}</p>
          ) : (
            <ul className="list">
              {state.members.map((m) => (
                <li key={m.id}>
                  <Initial name={m.name} />
                  <span className="grow">
                    <strong>{m.name}</strong>
                    <br />
                    <span className="small muted">{summary(lang, m)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>{t("recent")}</h2>
          {rows.length === 0 ? (
            <p className="muted small">{t("recentEmpty")}</p>
          ) : (
            <ul className="list">
              {rows.map((r) => (
                <li key={r.id}>
                  <button className="item" disabled={!r.own} onClick={() => r.own && go({ name: "result", id: r.id })} style={{ cursor: r.own ? "pointer" : "default" }}>
                    <span className="row" style={{ gap: 4 }} aria-hidden="true">
                      {state.members.map((m) => (
                        <span key={m.id} className={`dot ${r.levels[m.id] ?? ""}`} title={m.name} />
                      ))}
                    </span>
                    <span className="grow">
                      <strong>{r.name ?? t("unnamedProduct")}</strong>
                      <br />
                      <span className="small muted">
                        {state.members
                          .map((m) => (r.levels[m.id] ? `${m.name}: ${t(r.levels[m.id] === "red" ? "levelRedShort" : r.levels[m.id] === "amber" ? "levelAmberShort" : "levelGreenShort")}` : null))
                          .filter(Boolean)
                          .join(" · ")}
                        {" · "}
                        {t("scannedBy", { name: r.by })} · {ago(lang, r.at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
