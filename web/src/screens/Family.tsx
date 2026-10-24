import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { inviteLink, newId, type InviteRole } from "../lib/circle.ts";
import { randomId } from "../lib/crypto.ts";
import { blankProfile, checked, type Person, type Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Avatar, Heading, Icon, Modal } from "../ui.tsx";
import { AllergyPicker, Chips, ProfileEditor, validProfile } from "./ProfileEditor.tsx";

/** Who is in the family: the children (each with a profile, and maybe their own phone) and the grown-ups. */
export function Family() {
  const { t, me } = useApp();
  if (me?.role === "child") return <MyAllergies />;
  return (
    <>
      <Heading eyebrow={t("famEyebrow")} title={t("famTitle")} lead={t(me?.role === "parent" ? "famLeadParent" : "famLeadOther")} />
      <div className="stack">
        <Children />
        <GrownUps />
      </div>
    </>
  );
}

function Children() {
  const { t, go, state, isParent, invite } = useApp();
  const phoneOf = (m: Profile): Person | undefined => state.people.find((p) => p.role === "child" && p.member_id === m.id);
  return (
    <section className="big-card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{t("childrenTitle")}</h2>
        {isParent && (
          <button className="primary" onClick={() => go({ name: "member", id: "new" })}>
            <Icon name="plus" /> {t("addChild")}
          </button>
        )}
      </div>
      {state.members.length === 0 && <p className="small-note" style={{ marginTop: 12 }}>{isParent ? t("noChildrenYet") : t("waitingProfiles")}</p>}
      <div className="people-list">
        {state.members.map((m, i) => {
          const phone = phoneOf(m);
          const none = !m.avoid.length && !m.diets.length;
          return (
            <div className="person-row" key={m.id}>
              <button className="person-main" onClick={() => go(isParent ? { name: "member", id: m.id } : { name: "care", tab: "emergency", id: m.id })}>
                <Avatar name={m.name} emoji={m.avatar} i={i} size={48} />
                <span className="person-text">
                  <span className="person-name">
                    {m.name} <span className="role-badge child">{t("roleChild")}</span>
                  </span>
                  {none ? <span className="small-note">{t("noAllergiesShort", { name: m.name })}</span> : <Chips p={m} />}
                  <span className="person-phone">
                    <Icon name="phone" /> {phone ? t("onOwnPhone", { name: m.name }) : t("noPhoneYet")}
                  </span>
                </span>
                {isParent && <span className="arrow" aria-hidden="true">›</span>}
              </button>
              {isParent && !phone && (
                <button className="secondary" onClick={() => invite("child", m)}>
                  <Icon name="qr" /> {t("inviteChild", { name: m.name })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GrownUps() {
  const { t, state, isParent, invite } = useApp();
  const grown = state.people.filter((p) => p.role !== "child");
  return (
    <section className="big-card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>{t("grownUpsTitle")}</h2>
        <span className="status green">🔒 {t("e2ee")}</span>
      </div>
      <div className="people-list">
        {grown.map((p, i) => (
          <div className="person-row" key={p.id}>
            <div className="person-main">
              <Avatar name={p.name} emoji={p.role === "grandparent" ? "👵🏻" : undefined} i={i + 2} size={48} />
              <span className="person-text">
                <span className="person-name">
                  {p.name} {p.id === state.me?.id && <span className="muted">({t("you")})</span>}{" "}
                  <span className={`role-badge ${p.role}`}>{t(p.role === "parent" ? "roleOwner" : "roleGrandparent")}</span>
                </span>
                <span className="small-note">{t(p.role === "parent" ? "roleParentDesc" : "roleGrandparentDesc")}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
      {isParent && (
        <div className="row" style={{ marginTop: 16 }}>
          <button className="secondary" onClick={() => invite("grandparent")}>
            <Icon name="qr" /> {t("inviteGrandparent")}
          </button>
        </div>
      )}
    </section>
  );
}

/** A child's own page: their allergies as the family has them, and a way to change them (a parent checks). */
function MyAllergies() {
  const { t, go, state, me } = useApp();
  const mine = checked(state)[0];
  const waiting = !!state.myChoice;
  return (
    <>
      <Heading eyebrow={t("famEyebrow")} title={t("myAllergiesTitle")} lead={t("myAllergiesLead")} />
      <div className="stack">
        <section className="big-card">
          <div className="person-main">
            <Avatar name={me?.name ?? ""} emoji={mine?.avatar} size={56} />
            <span className="person-text">
              <span className="person-name">
                {me?.name} <span className="role-badge child">{t("roleChild")}</span>
              </span>
              {mine && (mine.avoid.length || mine.diets.length) ? <Chips p={mine} /> : <span className="small-note">{t("noAllergiesMine")}</span>}
            </span>
          </div>
          {waiting && <p className="warning" style={{ marginTop: 14 }}>{t("choiceWaiting")}</p>}
          <button className="primary" style={{ marginTop: 16 }} onClick={() => go({ name: "choose" })}>
            {t("changeMyAllergies")} <Icon name="arrow" />
          </button>
        </section>
        <GrownUps />
      </div>
    </>
  );
}

/** A child chooses their allergies on their own phone. The parent's phone takes them in; the parent can change them. */
export function ChooseAllergies() {
  const { t, back, state, me, share, toast } = useApp();
  const current = checked(state)[0];
  const [p, setP] = useState<Profile>(current ?? { ...blankProfile(me?.member_id ?? ""), name: me?.name ?? "" });
  if (me?.role !== "child" || !me.member_id) return <Heading eyebrow={t("famEyebrow")} title={t("notParent")} />;
  return (
    <>
      <Heading eyebrow={t("famEyebrow")} title={t("myAllergiesTitle")} lead={t("chooseLead")} />
      <form className="content big-card" onSubmit={async (e) => {
        e.preventDefault();
        await share({ t: "choice", id: newId(), from: me, at: Date.now(), member_id: me.member_id!, avoid: p.avoid, diets: p.diets, celiac: !!p.celiac });
        toast(t("choiceSent"));
        back();
      }}>
        <AllergyPicker value={p} onChange={setP} />
        <p className="small-note">{t("choiceNote")}</p>
        <button className="primary" type="submit" style={{ marginTop: 16 }}>
          {t("saveMyAllergies")} <Icon name="arrow" />
        </button>
      </form>
    </>
  );
}

export function MemberEdit({ id }: { id: string }) {
  const { t, back, go, state, isParent, publishProfiles, toast, invite } = useApp();
  const existing = state.members.find((m) => m.id === id);
  const [p, setP] = useState<Profile>(existing ?? blankProfile(randomId(6)));
  if (!isParent) {
    return <Heading eyebrow={t("profEyebrow")} title={t("notParent")} />;
  }
  const valid = validProfile(p);
  const none = !p.avoid.length && !p.diets.length;
  const hasPhone = state.people.some((x) => x.role === "child" && x.member_id === p.id);
  return (
    <>
      <Heading eyebrow={t("profEyebrow")} title={p.name.trim() ? t("profTitle", { name: p.name.trim() }) : t("profTitleNew")} lead={t("profLead")} />
      <form className="content big-card" onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        const edited = { ...p, name: p.name.trim() };
        // keep the family's order: replace in place, or add at the end
        await publishProfiles(existing ? state.members.map((m) => (m.id === p.id ? edited : m)) : [...state.members, edited]);
        toast(t("profileSaved"));
        if (!existing) {
          // a new child: show the code for their own phone straight away
          go({ name: "family" }, true);
          invite("child", edited);
        } else back();
      }}>
        {existing?.childAt && <p className="notice-line">{t("childChoseNote", { name: existing.name })}</p>}
        <ProfileEditor value={p} onChange={setP} emergency />
        {none && p.name.trim() && <p className="small-note">{t("noAllergiesYet", { name: p.name.trim() })}</p>}
        <div className="row" style={{ marginTop: 20 }}>
          <button className="primary" type="submit" disabled={!valid}>
            {t(existing ? "saveProfile" : "saveAndInvite")} <Icon name="arrow" />
          </button>
          {existing && !hasPhone && (
            <button className="secondary" type="button" onClick={() => invite("child", existing)}>
              <Icon name="qr" /> {t("inviteChild", { name: existing.name })}
            </button>
          )}
          {existing && (
            <button className="secondary danger-text" type="button" onClick={async () => {
              await publishProfiles(state.members.filter((m) => m.id !== p.id));
              toast(t("profileSaved"));
              back();
            }}>
              {t("removePerson")}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export function InviteModal({ role, child, onClose }: { role: InviteRole; child?: Profile; onClose: () => void }) {
  const { t, state } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const link = state.circle ? inviteLink(state.circle, role, child) : "";
  useEffect(() => {
    if (canvas.current && link) QRCode.toCanvas(canvas.current, link, { errorCorrectionLevel: "M", margin: 1, width: 260, color: { dark: "#0f3d38" } });
  }, [link]);
  const title = child ? t("inviteChildTitle", { name: child.name }) : t("inviteGrandparent");
  return (
    <Modal label={title} onClose={onClose} closeLabel={t("close")}>
      <div className="eyebrow">{t(child ? "roleChild" : "roleGrandparent")}</div>
      <h2>{title}</h2>
      <p>{child ? t("inviteChildLead", { name: child.name }) : t("inviteGrandparentLead")}</p>
      <div className="qr">
        <canvas ref={canvas} aria-label="QR" />
      </div>
      <label className="field" htmlFor="invite-link">{t("inviteLinkLabel")}</label>
      <input id="invite-link" type="text" readOnly value={link} dir="ltr" onFocus={(e) => e.target.select()} />
      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" onClick={async () => {
          await navigator.clipboard?.writeText(link).catch(() => undefined);
          setCopied(true);
        }}>
          {copied ? t("inviteCopied") : t("inviteCopy")}
        </button>
        {"share" in navigator && (
          <button className="secondary" onClick={() => navigator.share({ title: "Wiqaya", url: link }).catch(() => undefined)}>
            <Icon name="share" /> {t("inviteShare")}
          </button>
        )}
      </div>
      <div className="warning" style={{ marginTop: 16 }}>{t("invitePrivate")}</div>
    </Modal>
  );
}
