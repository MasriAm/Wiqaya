import type { AllergenId, DietId } from "../engine/types.ts";
import { triggerName } from "../i18n.ts";
import type { Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Icon } from "../ui.tsx";

export const ALLERGENS: AllergenId[] = ["peanuts", "tree_nuts", "milk", "eggs", "gluten", "sesame", "soy", "fish", "crustaceans", "molluscs", "mustard", "celery", "sulphites", "lupin", "pine_nuts"];
export const DIETS: DietId[] = ["halal", "vegetarian"];

/** Name, allergies, diets, the "may contain" policy and (optionally) the emergency details. */
export function ProfileEditor({ value, onChange, emergency = false }: { value: Profile; onChange: (p: Profile) => void; emergency?: boolean }) {
  const { t, state } = useApp();
  const lang = state.lang;
  const toggle = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const em = value.emergency;
  const setEm = (patch: Partial<Profile["emergency"]>) => onChange({ ...value, emergency: { ...em, ...patch } });
  return (
    <div className="stack">
      <label className="field">
        {t("personName")}
        <input value={value.name} placeholder={t("personNamePh")} onChange={(e) => onChange({ ...value, name: e.target.value })} autoComplete="off" />
      </label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-title">{t("avoids")}</legend>
        <div className="chips">
          {ALLERGENS.map((a) => (
            <button key={a} type="button" className="chip" aria-pressed={value.avoid.includes(a)} onClick={() => onChange({ ...value, avoid: toggle(value.avoid, a) })}>
              {triggerName(lang, a)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-title">{t("diets")}</legend>
        <div className="chips">
          {DIETS.map((d) => (
            <button key={d} type="button" className="chip" aria-pressed={value.diets.includes(d)} onClick={() => onChange({ ...value, diets: toggle(value.diets, d) })}>
              {triggerName(lang, d)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-title">{t("traces")}</legend>
        <div className="seg">
          <button type="button" aria-pressed={value.traces === "avoid"} onClick={() => onChange({ ...value, traces: "avoid" })}>
            {t("tracesAvoid")}
          </button>
          <button type="button" aria-pressed={value.traces === "allow"} onClick={() => onChange({ ...value, traces: "allow" })}>
            {t("tracesAllow")}
          </button>
        </div>
      </fieldset>
      {emergency && (
        <div className="stack">
          <hr />
          <div className="section-title">{t("profileEmergency")}</div>
          <label className="field">
            {t("profilePlan")}
            <textarea value={em.plan} placeholder={t("profilePlanPh")} onChange={(e) => setEm({ plan: e.target.value })} />
          </label>
          <label className="field">
            {t("profileMeds")}
            <input value={em.meds} placeholder={t("profileMedsPh")} onChange={(e) => setEm({ meds: e.target.value })} />
          </label>
          <label className="field">
            {t("epiExpiry")}
            <input type="date" value={em.epi_expiry} onChange={(e) => setEm({ epi_expiry: e.target.value })} />
          </label>
          <div className="section-title">{t("emergencyContacts")}</div>
          {em.contacts.map((c, i) => (
            <div className="row" key={i}>
              <input className="grow" aria-label={t("contactName")} placeholder={t("contactName")} value={c.name} style={{ minHeight: 44, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }}
                onChange={(e) => setEm({ contacts: em.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input className="grow" aria-label={t("contactPhone")} placeholder={t("contactPhone")} type="tel" inputMode="tel" dir="ltr" value={c.phone} style={{ minHeight: 44, padding: 10, borderRadius: 10, border: "1px solid var(--line)" }}
                onChange={(e) => setEm({ contacts: em.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} />
              <button type="button" className="icon-btn" aria-label={t("remove")} onClick={() => setEm({ contacts: em.contacts.filter((_, j) => j !== i) })}>
                <Icon name="close" />
              </button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setEm({ contacts: [...em.contacts, { name: "", phone: "" }] })}>
            <Icon name="plus" />
            {t("addContact")}
          </button>
        </div>
      )}
    </div>
  );
}

export function summary(lang: "en" | "ar", p: Profile): string {
  return [...p.avoid, ...p.diets].map((id) => triggerName(lang, id)).join(lang === "ar" ? "، " : ", ");
}
