import { useState } from "react";
import { useApp } from "../App.tsx";
import { Heading, Icon } from "../ui.tsx";
import { DeleteModal } from "./Onboarding.tsx";

/** Privacy & your data: what is kept where, Gemma's status, the language, and deleting everything. */
export function Privacy() {
  const { t, state, update, health } = useApp();
  const [deleting, setDeleting] = useState(false);
  const g = health?.gemma;
  return (
    <>
      <Heading eyebrow={t("privEyebrow")} title={t("privTitle")} lead={t("privacyCardText")} />
      <div className="content stack">
        <section className="big-card">
          <h2 className="icon-title">
            <Icon name="shield" /> {t("privacyByDesign")}
          </h2>
          {t("privacyPoints").split("|").map((p, i) => (
            <div className="activity" key={p}>
              <div>
                <h4>0{i + 1}</h4>
                <p>{p}</p>
              </div>
            </div>
          ))}
        </section>
        <section className="big-card">
          <h3>{t("settingsLang")}</h3>
          <div className="segmented" style={{ marginTop: 12 }}>
            <button className={state.lang === "en" ? "active" : ""} aria-pressed={state.lang === "en"} onClick={() => update((s) => ({ ...s, lang: "en" }))} lang="en">
              English
            </button>
            <button className={state.lang === "ar" ? "active" : ""} aria-pressed={state.lang === "ar"} onClick={() => update((s) => ({ ...s, lang: "ar" }))} lang="ar">
              العربية
            </button>
          </div>
          <h3>{t("settingsGemma")}</h3>
          <p className="row" style={{ marginTop: 8 }}>
            <span className={`dot ${g?.available ? "" : "off"}`} />
            {g?.available ? t("gemmaReady", { model: g.model }) : t("gemmaNotReady")}
          </p>
        </section>
        <section className="big-card">
          <h3>{t("controlTitle")}</h3>
          <p style={{ margin: "10px 0" }}>{t("controlText")}</p>
          <button className="secondary danger-text" onClick={() => setDeleting(true)}>
            {t("deleteEverything")}
          </button>
          <p className="small-note" style={{ marginTop: 16 }}>{t("settingsAbout")}</p>
        </section>
      </div>
      {deleting && <DeleteModal onClose={() => setDeleting(false)} />}
    </>
  );
}
