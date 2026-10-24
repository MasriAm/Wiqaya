import { useApp } from "../App.tsx";
import { wipe } from "../lib/state.ts";
import { Icon, Top } from "../ui.tsx";

export function Settings() {
  const { t, back, state, update, health } = useApp();
  const g = health?.gemma;
  return (
    <>
      <Top title={t("settings")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <section className="card">
          <h2>{t("settingsLang")}</h2>
          <div className="seg">
            <button aria-pressed={state.lang === "en"} onClick={() => update((s) => ({ ...s, lang: "en" }))} lang="en">
              English
            </button>
            <button aria-pressed={state.lang === "ar"} onClick={() => update((s) => ({ ...s, lang: "ar" }))} lang="ar">
              العربية
            </button>
          </div>
        </section>

        <section className="card">
          <h2>{t("settingsGemma")}</h2>
          <p className="row" style={{ margin: 0 }}>
            <span className={`dot ${g?.available ? "green" : "red"}`} />
            {g?.available ? t("gemmaReady", { model: g.model }) : t("gemmaNotReady")}
          </p>
        </section>

        <section className="card">
          <h2 className="row">
            <Icon name="shield" />
            {t("settingsPrivacy")}
          </h2>
          <ul className="points small">
            {t("privacyPoints").split("|").map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>

        <section className="stack">
          <button className="btn block" onClick={() => {
            if (!confirm(t("settingsWipeConfirm"))) return;
            update((s) => ({ ...s, me: null, circle: null, members: [], people: [], scans: [], feed: [], safe: [], requests: [], cursor: 0, seen: [], profilesVersion: 0 }));
            wipe().then(() => location.replace("/"));
          }} style={{ color: "var(--red)" }}>
            {t("settingsWipe")}
          </button>
          <p className="small muted">{t("settingsAbout")}</p>
        </section>
      </main>
    </>
  );
}
