import { useEffect, useRef, useState } from "react";
import { useApp } from "../App.tsx";
import { newFamilyKey, newParentKeys, randomId } from "../lib/crypto.ts";
import { newId, parseInvite, type Invite } from "../lib/circle.ts";
import { readFrame, startCamera, stopCamera } from "../lib/camera.ts";
import { blankProfile, wipe, type Person, type Profile } from "../lib/state.ts";
import { Heading, Icon, Modal } from "../ui.tsx";
import { AllergyPicker, MemberCard, ProfileEditor, validProfile } from "./ProfileEditor.tsx";

/** Consent first: what Wiqaya keeps and where, then create a family or join one. */
export function Welcome() {
  const { t, go } = useApp();
  const [agreed, setAgreed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const points: [string, string][] = [
    [t("p1t"), t("p1")],
    [t("p2t"), t("p2")],
    [t("p3t"), t("p3")],
  ];
  return (
    <>
      <Heading eyebrow={t("welEyebrow")} title={t("welTitle")} lead={t("welLead")} />
      <div className="content stack">
        <div className="start-grid">
          <section className="big-card start-card">
            <div className="start-emoji" aria-hidden="true">👩‍👧</div>
            <h2>{t("startParentTitle")}</h2>
            <p>{t("startParentText")}</p>
            <label className="check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              {t("consent")}
            </label>
            <button className="primary wide" disabled={!agreed} onClick={() => go({ name: "setup" })}>
              {t("createCircle")} <Icon name="arrow" />
            </button>
          </section>
          <section className="big-card start-card">
            <div className="start-emoji" aria-hidden="true">📱</div>
            <h2>{t("startJoinTitle")}</h2>
            <p>{t("startJoinText")}</p>
            <button className="secondary wide" onClick={() => go({ name: "join" })}>
              <Icon name="qr" /> {t("joinCircle")}
            </button>
          </section>
        </div>
        <section className="big-card">
          <h2 className="icon-title">
            <Icon name="shield" /> {t("privacyByDesign")}
          </h2>
          {points.map(([title, text], i) => (
            <div className="activity" key={title}>
              <div>
                <h4>
                  0{i + 1} · {title}
                </h4>
                <p>{text}</p>
              </div>
            </div>
          ))}
        </section>
        <section className="big-card">
          <h3>{t("controlTitle")}</h3>
          <p style={{ margin: "10px 0" }}>{t("controlText")}</p>
          <button className="secondary danger-text" onClick={() => setDeleting(true)}>
            {t("deleteEverything")}
          </button>
        </section>
      </div>
      {deleting && <DeleteModal onClose={() => setDeleting(false)} />}
    </>
  );
}

export function DeleteModal({ onClose }: { onClose: () => void }) {
  const { t, update, toast } = useApp();
  return (
    <Modal label={t("deleteConfirmTitle")} onClose={onClose} closeLabel={t("close")}>
      <h2>{t("deleteConfirmTitle")}</h2>
      <p>{t("deleteConfirmText")}</p>
      <button className="danger-btn wide" onClick={() => {
        update((s) => ({ ...s, me: null, circle: null, members: [], people: [], scans: [], feed: [], safe: [], requests: [], cursor: 0, seen: [], profilesVersion: 0, familyName: "" }));
        toast(t("deleted"));
        wipe().then(() => location.replace("/"));
      }}>
        {t("deleteEverything")}
      </button>
    </Modal>
  );
}

export function Setup() {
  const { t, update, go, share, state } = useApp();
  const [myName, setMyName] = useState("");
  const [family, setFamily] = useState("");
  const [members, setMembers] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    const keys = await newParentKeys();
    const me: Person = { id: randomId(9), name: myName.trim(), role: "parent" };
    const circle = { id: randomId(16), key: await newFamilyKey(), parentPub: keys.pub, parentPriv: keys.priv };
    update((s) => ({ ...s, me, circle, members, people: [me], profilesVersion: 0, familyName: family.trim() }));
    // tell the relay: the profiles are versioned and signed, the hello lets other phones list this person
    setTimeout(async () => {
      await share({ t: "hello", id: newId(), from: me });
      await share({ t: "profiles", id: newId(), v: 1, members, safe: [], family: family.trim() });
      go({ name: "home" }, true);
    }, 0);
  };

  if (editing) {
    const existing = members.some((m) => m.id === editing.id);
    return (
      <>
        <Heading eyebrow={t("setupEyebrow")} title={editing.name.trim() ? t("profTitle", { name: editing.name.trim() }) : t("profTitleNew")} lead={t("profLead")} />
        <form className="content big-card" onSubmit={(e) => {
          e.preventDefault();
          if (!validProfile(editing)) return;
          setMembers((m) => (existing ? m.map((x) => (x.id === editing.id ? { ...editing, name: editing.name.trim() } : x)) : [...m, { ...editing, name: editing.name.trim() }]));
          setEditing(null);
        }}>
          <ProfileEditor value={editing} onChange={setEditing} emergency />
          {editing.name.trim() && !editing.avoid.length && !editing.diets.length && <p className="small-note">{t("noAllergiesYet", { name: editing.name.trim() })}</p>}
          <div className="row" style={{ marginTop: 20 }}>
            <button className="primary" type="submit" disabled={!validProfile(editing)}>
              {t("save")} <Icon name="arrow" />
            </button>
            <button className="secondary" type="button" onClick={() => setEditing(null)}>
              {t("cancel")}
            </button>
            {existing && (
              <button className="secondary danger-text" type="button" onClick={() => {
                setMembers((m) => m.filter((x) => x.id !== editing.id));
                setEditing(null);
              }}>
                {t("removePerson")}
              </button>
            )}
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <Heading eyebrow={t("setupEyebrow")} title={t("setupTitle")} lead={t("setupLead")} />
      <div className="content stack">
        <section className="big-card">
          <label className="field first" htmlFor="me-name">{t("yourName")}</label>
          <input id="me-name" type="text" autoFocus maxLength={40} value={myName} placeholder={t("yourNamePh")} onChange={(e) => setMyName(e.target.value)} />
          <label className="field" htmlFor="fam-name">{t("familyName")}</label>
          <input id="fam-name" type="text" maxLength={40} value={family} placeholder={t("familyNamePh")} onChange={(e) => setFamily(e.target.value)} />
        </section>
        <div className="section-title">
          <h2>{t("setupPeople")}</h2>
        </div>
        {members.length > 0 && (
          <div className="family-row">
            {members.map((m, i) => (
              <MemberCard key={m.id} p={m} i={i} onClick={() => setEditing(m)} />
            ))}
          </div>
        )}
        <button className="add-card" onClick={() => setEditing(blankProfile(randomId(6)))}>
          <Icon name="plus" /> {t("addPerson")}
        </button>
        {members.length === 0 && <p className="small-note">{t("setupNeedPerson")}</p>}
        <button className="primary wide" disabled={busy || !myName.trim() || members.length === 0} onClick={finish}>
          {t("setupStart")} <Icon name="arrow" />
        </button>
        <p className="center small-note">
          {t("checkNotGuarantee")} · <span lang={state.lang === "ar" ? "en" : "ar"}>{state.lang === "ar" ? "A check, not a guarantee" : "فحص وليس ضمانًا"}</span>
        </p>
      </div>
    </>
  );
}

export function Join({ invite }: { invite: Invite | null }) {
  const { t, update, go, share, toast } = useApp();
  const [inv, setInv] = useState<Invite | null>(invite);
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [scanning, setScanning] = useState(false);
  // a grandparent can arrive straight from an invite link, past the welcome screen: ask for consent here too
  const [agreed, setAgreed] = useState(false);
  const [picked, setPicked] = useState<Profile>(blankProfile(""));
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!scanning || !video.current) return;
    let stream: MediaStream | null = null;
    let stop = false;
    startCamera(video.current)
      .then(async (s) => {
        stream = s;
        while (!stop) {
          const text = await readFrame(video.current!, "qr").catch(() => null);
          const found = text ? parseInvite(text) : null;
          if (found) {
            setInv(found);
            setScanning(false);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      })
      .catch(() => {
        setScanning(false);
        toast(t("scanNoCamera"));
      });
    return () => {
      stop = true;
      stopCamera(stream);
    };
  }, [scanning, t, toast]);

  const child = inv?.r === "child";
  const join = () => {
    if (!inv) return;
    const me: Person = child ? { id: randomId(9), name: inv.n ?? "", role: "child", member_id: inv.m } : { id: randomId(9), name: name.trim(), role: "grandparent" };
    update((s) => ({ ...s, me, circle: { id: inv.c, key: inv.k, parentPub: inv.p }, people: [me], cursor: 0 }));
    setTimeout(async () => {
      await share({ t: "hello", id: newId(), from: me });
      if (child && (picked.avoid.length || picked.diets.length)) {
        await share({ t: "choice", id: newId(), from: me, at: Date.now(), member_id: inv.m!, avoid: picked.avoid, diets: picked.diets, celiac: !!picked.celiac });
      }
      toast(t(child ? "joinedChild" : "joinedGrandparent"));
      go({ name: "home" }, true);
    }, 0);
  };

  return (
    <>
      <Heading
        eyebrow={t("joinEyebrow")}
        title={inv && child ? t("joinChildTitle", { name: inv.n ?? "" }) : t("joinTitle")}
        lead={inv ? t(child ? "joinAsChild" : "joinAsGrandparent") : t("joinHelp")}
      />
      <div className="content stack">
        {!inv ? (
          <section className="big-card">
            {scanning ? (
              <div className="camera">
                <video ref={video} playsInline muted aria-label={t("scanInvite")} />
                <span className="camera-hint">{t("scanInvite")}</span>
              </div>
            ) : (
              <button className="primary" onClick={() => setScanning(true)}>
                <Icon name="qr" /> {t("scanInvite")}
              </button>
            )}
            <label className="field" htmlFor="paste">{t("joinPaste")}</label>
            <input id="paste" type="text" value={pasted} dir="ltr" onChange={(e) => setPasted(e.target.value)} placeholder="https://…#join=…" />
            <button className="secondary" style={{ marginTop: 14 }} disabled={!pasted.trim()} onClick={() => {
              const p = parseInvite(pasted.trim());
              if (p) setInv(p);
              else toast(t("joinBad"));
            }}>
              {t("next")}
            </button>
          </section>
        ) : child ? (
          <form className="big-card" onSubmit={(e) => {
            e.preventDefault();
            join();
          }}>
            <AllergyPicker value={picked} onChange={setPicked} />
            <p className="small-note">{t("choiceNote")}</p>
            <button className="primary wide" type="submit" style={{ marginTop: 18 }}>
              {t(picked.avoid.length || picked.diets.length ? "joinChildGo" : "joinChildLater")} <Icon name="arrow" />
            </button>
          </form>
        ) : (
          <form className="big-card" onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && agreed) join();
          }}>
            <label className="field first" htmlFor="join-name">{t("yourName")}</label>
            <input id="join-name" type="text" autoFocus maxLength={40} value={name} placeholder={t("yourNamePh")} onChange={(e) => setName(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              {t("consent")}
            </label>
            <p className="small-note">{t("p2")}</p>
            <button className="primary" type="submit" style={{ marginTop: 18 }} disabled={!name.trim() || !agreed}>
              {t("joinGo")} <Icon name="arrow" />
            </button>
          </form>
        )}
      </div>
    </>
  );
}
