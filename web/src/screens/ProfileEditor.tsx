import { useRef, useState } from "react";
import type { AllergenId, DietId } from "../engine/types.ts";
import { triggerName } from "../i18n.ts";
import { api } from "../lib/api.ts";
import type { Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { allergenGlyph, Avatar, Icon, Spinner } from "../ui.tsx";

export const ALLERGENS: AllergenId[] = ["peanuts", "milk", "eggs", "sesame", "gluten", "pine_nuts", "tree_nuts", "soy", "fish", "crustaceans", "molluscs", "celery", "mustard", "lupin", "sulphites"];
export const DIETS: DietId[] = ["halal", "vegetarian"];
const FACES = ["", "👧🏻", "👦🏻", "👶🏻", "👧🏽", "👦🏽", "🧒🏾", "👩🏻", "👨🏻", "👵🏻", "👴🏻"];

/** Name, picture, allergies, diets and conditions, the "may contain" policy and (optionally) the emergency details. */
export function ProfileEditor({ value, onChange, emergency = false }: { value: Profile; onChange: (p: Profile) => void; emergency?: boolean }) {
  const { t } = useApp();
  const em = value.emergency;
  const setEm = (patch: Partial<Profile["emergency"]>) => onChange({ ...value, emergency: { ...em, ...patch } });
  const [reading, setReading] = useState<"idle" | "busy" | string>("idle");
  const boxPhoto = useRef<HTMLInputElement>(null);

  const readExpiry = async (file: File | undefined) => {
    if (!file) return;
    setReading("busy");
    try {
      const r = await api.expiry(file);
      if (r.expiry) setEm({ epi_expiry: r.expiry });
      setReading(r.expiry ? t("expiryFound", { printed: r.printed ?? r.expiry }) : t("expiryNone"));
    } catch {
      setReading(t("expiryNone"));
    }
  };

  return (
    <div className="form">
      <label className="field" htmlFor="p-name">{t("personName")}</label>
      <input id="p-name" type="text" required maxLength={40} value={value.name} placeholder={t("personNamePh")} autoComplete="off" onChange={(e) => onChange({ ...value, name: e.target.value })} />

      <div className="field" id="p-face">{t("avatarLabel")}</div>
      <div className="faces" role="radiogroup" aria-labelledby="p-face">
        {FACES.map((f) => (
          <button key={f || "letter"} type="button" role="radio" aria-checked={(value.avatar ?? "") === f} className={(value.avatar ?? "") === f ? "selected" : ""} onClick={() => onChange({ ...value, avatar: f })}>
            <Avatar name={value.name || "?"} emoji={f} />
          </button>
        ))}
      </div>

      <AllergyPicker value={value} onChange={onChange} />

      <div className="field" id="p-traces">{t("traces")}</div>
      <div className="segmented" role="group" aria-labelledby="p-traces">
        <button type="button" className={value.traces === "avoid" ? "active" : ""} aria-pressed={value.traces === "avoid"} onClick={() => onChange({ ...value, traces: "avoid" })}>
          {t("tracesAvoid")}
        </button>
        <button type="button" className={value.traces === "allow" ? "active" : ""} aria-pressed={value.traces === "allow"} onClick={() => onChange({ ...value, traces: "allow" })}>
          {t("tracesAllow")}
        </button>
      </div>

      {emergency && (
        <details open={!!(em.plan || em.meds || em.epi_expiry || em.contacts.length)}>
          <summary>{t("emergencyDetails")}</summary>
          <p className="small-note">{t("profilePlanNote")}</p>
          <label className="field" htmlFor="p-plan">{t("profilePlan")}</label>
          <textarea id="p-plan" value={em.plan} placeholder={t("profilePlanPh")} onChange={(e) => setEm({ plan: e.target.value })} />
          <label className="field" htmlFor="p-meds">{t("profileMeds")}</label>
          <input id="p-meds" type="text" value={em.meds} placeholder={t("profileMedsPh")} onChange={(e) => setEm({ meds: e.target.value })} />
          <label className="field" htmlFor="p-expiry">{t("epiExpiry")}</label>
          <input id="p-expiry" type="date" value={em.epi_expiry} onChange={(e) => setEm({ epi_expiry: e.target.value })} />
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="secondary" disabled={reading === "busy"} onClick={() => boxPhoto.current?.click()}>
              <Icon name="camera" /> {t("scanExpiry")}
            </button>
            <input ref={boxPhoto} type="file" accept="image/*" capture="environment" hidden onChange={(e) => readExpiry(e.target.files?.[0])} />
            {reading === "busy" ? (
              <span className="row small-note"><Spinner /> {t("expiryReading")}</span>
            ) : reading !== "idle" ? (
              <span className="small-note" role="status">{reading}</span>
            ) : null}
          </div>
          <div className="field">{t("emergencyContacts")}</div>
          {em.contacts.map((c, i) => (
            <div className="contact-row" key={i}>
              <input type="text" aria-label={t("contactName")} placeholder={t("contactName")} value={c.name} onChange={(e) => setEm({ contacts: em.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="tel" inputMode="tel" dir="ltr" aria-label={t("contactPhone")} placeholder={t("contactPhone")} value={c.phone} onChange={(e) => setEm({ contacts: em.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} />
              <button type="button" className="icon-btn" aria-label={t("remove")} onClick={() => setEm({ contacts: em.contacts.filter((_, j) => j !== i) })}>
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button type="button" className="secondary" onClick={() => setEm({ contacts: [...em.contacts, { name: "", phone: "" }] })}>
            <Icon name="plus" /> {t("addContact")}
          </button>
        </details>
      )}
    </div>
  );
}

/** The allergens to avoid, as big picture buttons, and the diets and conditions. */
export function AllergyPicker({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const { t, state } = useApp();
  const lang = state.lang;
  const other = lang === "ar" ? "en" : "ar";
  const toggle = <T extends string>(list: T[], id: T) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <>
      <div className="field" id="p-avoid">{t("avoids")}</div>
      <div className="allergen-grid" role="group" aria-labelledby="p-avoid">
        {ALLERGENS.map((a) => (
          <button key={a} type="button" className={`select-chip ${value.avoid.includes(a) ? "selected" : ""}`} aria-pressed={value.avoid.includes(a)} onClick={() => onChange({ ...value, avoid: toggle(value.avoid, a) })}>
            <span className="chip-glyph" aria-hidden="true">{allergenGlyph(a)}</span>
            {triggerName(lang, a)}
            <small aria-hidden="true" lang={other}>{triggerName(other, a)}</small>
          </button>
        ))}
      </div>

      <div className="field" id="p-diet">{t("conditions")}</div>
      <div className="row" role="group" aria-labelledby="p-diet">
        <label className="check">
          <input type="checkbox" checked={!!value.celiac} onChange={(e) => onChange({ ...value, celiac: e.target.checked, avoid: e.target.checked && !value.avoid.includes("gluten") ? [...value.avoid, "gluten"] : value.avoid })} />
          {t("celiac")}
        </label>
        {DIETS.map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={value.diets.includes(d)} onChange={() => onChange({ ...value, diets: toggle(value.diets, d) })} />
            {triggerName(lang, d)}
          </label>
        ))}
      </div>
    </>
  );
}

/** A name is enough: a child can choose their allergies on their own phone (until then nothing is green for them). */
export function validProfile(p: Profile): boolean {
  return !!p.name.trim();
}

/** Allergens as rose chips, diets and conditions as lilac ones. */
export function Chips({ p }: { p: Profile }) {
  const { state, t } = useApp();
  const lang = state.lang;
  return (
    <div className="chips">
      {p.avoid.filter((a) => !(p.celiac && a === "gluten")).map((a) => (
        <span key={a} className="chip rose">{triggerName(lang, a)}</span>
      ))}
      {p.celiac && <span className="chip lilac">{t("celiac")}</span>}
      {p.diets.map((d) => (
        <span key={d} className="chip lilac">{triggerName(lang, d)}</span>
      ))}
    </div>
  );
}

export function MemberCard({ p, i, onClick }: { p: Profile; i: number; onClick?: () => void }) {
  const { t } = useApp();
  const body = (
    <>
      {onClick && <span className="arrow" aria-hidden="true">›</span>}
      <div className="member-head">
        <Avatar name={p.name} emoji={p.avatar} i={i} />
        <div>
          <h3>{p.name}</h3>
          <p>{p.emergency.plan ? t("hasPlan") : t("noPlanShort")}</p>
        </div>
      </div>
      <Chips p={p} />
      <div className="policy">
        <Icon name="shield" /> {p.traces === "avoid" ? t("traceStrict") : t("traceLoose")}
      </div>
    </>
  );
  return onClick ? (
    <button className="member" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="member">{body}</div>
  );
}

export function summary(lang: "en" | "ar", p: Profile): string {
  return [...p.avoid, ...p.diets].map((id) => triggerName(lang, id)).join(lang === "ar" ? "، " : ", ");
}
