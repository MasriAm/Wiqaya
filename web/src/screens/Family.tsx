import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { inviteLink } from "../lib/circle.ts";
import { randomId } from "../lib/crypto.ts";
import { blankProfile, type Profile } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Avatar, Heading, Icon, Modal } from "../ui.tsx";
import { MemberCard, ProfileEditor, validProfile } from "./ProfileEditor.tsx";

export function Family() {
  const { t, go, state, isParent, invite } = useApp();
  return (
    <>
      <Heading
        eyebrow={t("famEyebrow")}
        title={t("famTitle")}
        lead={t("famLead")}
        extra={isParent && (
          <button className="primary" onClick={() => go({ name: "member", id: "new" })}>
            <Icon name="plus" /> {t("addMember")}
          </button>
        )}
      />
      <div className="stack">
        {state.members.length === 0 ? (
          <p className="big-card small-note">{t("waitingProfiles")}</p>
        ) : (
          <div className="family-row">
            {state.members.map((m, i) => (
              <MemberCard key={m.id} p={m} i={i} onClick={() => go(isParent ? { name: "member", id: m.id } : { name: "care", tab: "emergency", id: m.id })} />
            ))}
          </div>
        )}

        <section className="big-card">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>{t("peopleTitle")}</h2>
            <span className="status green">🔒 {t("e2ee")}</span>
          </div>
          {state.people.map((p, i) => (
            <div className="activity" key={p.id}>
              <Avatar name={p.name} i={i + 2} />
              <div>
                <h4>
                  {p.name} {p.id === state.me?.id && <span className="muted">({t("you")})</span>}
                </h4>
                <p>{t(p.role === "parent" ? "roleParentDesc" : "roleCaregiverDesc")}</p>
              </div>
              <span className="chip">{t(p.role === "parent" ? "rolesParent" : "rolesCaregiver")}</span>
            </div>
          ))}
        </section>

        {isParent && (
          <section className="big-card invite-card">
            <h2>{t("inviteCardTitle")}</h2>
            <p>{t("inviteCardText")}</p>
            <div className="row" style={{ marginTop: 20 }}>
              <button className="primary" onClick={() => invite("caregiver")}>
                <Icon name="qr" /> {t("inviteCaregiver")}
              </button>
              <button className="secondary" onClick={() => invite("parent")}>
                {t("inviteParent")}
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export function MemberEdit({ id }: { id: string }) {
  const { t, back, state, isParent, publishProfiles, toast } = useApp();
  const existing = state.members.find((m) => m.id === id);
  const [p, setP] = useState<Profile>(existing ?? blankProfile(randomId(6)));
  if (!isParent) {
    return <Heading eyebrow={t("profEyebrow")} title={t("notParent")} />;
  }
  const publish = async (members: Profile[]) => {
    await publishProfiles(members);
    toast(t("profileSaved"));
    back();
  };
  const valid = validProfile(p);
  return (
    <>
      <Heading eyebrow={t("profEyebrow")} title={p.name.trim() ? t("profTitle", { name: p.name.trim() }) : t("profTitleNew")} lead={t("profLead")} />
      <form className="content big-card" onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const edited = { ...p, name: p.name.trim() };
        // keep the family's order: replace in place, or add at the end
        publish(existing ? state.members.map((m) => (m.id === p.id ? edited : m)) : [...state.members, edited]);
      }}>
        <ProfileEditor value={p} onChange={setP} emergency />
        {!valid && <p className="small-note">{t("noAllergiesYet")}</p>}
        <div className="row" style={{ marginTop: 20 }}>
          <button className="primary" type="submit" disabled={!valid}>
            {t("saveProfile")} <Icon name="arrow" />
          </button>
          {existing && (
            <button className="secondary danger-text" type="button" onClick={() => publish(state.members.filter((m) => m.id !== p.id))}>
              {t("removePerson")}
            </button>
          )}
        </div>
      </form>
    </>
  );
}

export function InviteModal({ role, onClose }: { role: "parent" | "caregiver"; onClose: () => void }) {
  const { t, state } = useApp();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const link = state.circle ? inviteLink(state.circle, role) : "";
  useEffect(() => {
    if (canvas.current && link) QRCode.toCanvas(canvas.current, link, { errorCorrectionLevel: "M", margin: 1, width: 260, color: { dark: "#0f3d38" } });
  }, [link]);
  const title = t(role === "parent" ? "inviteParent" : "inviteCaregiver");
  return (
    <Modal label={title} onClose={onClose} closeLabel={t("close")}>
      <div className="eyebrow">{t("quickInviteSub")}</div>
      <h2>{title}</h2>
      <p>{t("inviteLead")}</p>
      <div className="qr">
        <canvas ref={canvas} aria-label="QR" />
      </div>
      <p>{t(role === "parent" ? "inviteParentNote" : "inviteCaregiverNote")}</p>
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
