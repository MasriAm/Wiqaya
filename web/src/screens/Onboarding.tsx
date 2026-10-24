import { useEffect, useRef, useState } from "react";
import { useApp } from "../App.tsx";
import { newFamilyKey, newParentKeys, randomId } from "../lib/crypto.ts";
import { newId, parseInvite, type Invite } from "../lib/circle.ts";
import { readFrame, startCamera, stopCamera } from "../lib/camera.ts";
import { blankProfile, type Person, type Profile } from "../lib/state.ts";
import { Icon, Initial, Top } from "../ui.tsx";
import { ProfileEditor, summary } from "./ProfileEditor.tsx";

function LangSwitch() {
  const { state, update } = useApp();
  return (
    <button className="btn ghost" onClick={() => update((s) => ({ ...s, lang: s.lang === "ar" ? "en" : "ar" }))} lang={state.lang === "ar" ? "en" : "ar"}>
      {state.lang === "ar" ? "English" : "العربية"}
    </button>
  );
}

export function Welcome() {
  const { t, go } = useApp();
  return (
    <main className="page">
      <div className="row spread">
        <span />
        <LangSwitch />
      </div>
      <section className="hero">
        <div className="mark" aria-label="Wiqaya, وقاية">
          <span>Wiqaya</span>
          <span lang="ar">وقاية</span>
        </div>
        <p className="tag">{t("tagline")}</p>
        <p className="lead">{t("welcomeLead")}</p>
      </section>
      <div className="stack">
        <button className="btn primary big block" onClick={() => go({ name: "setup" })}>
          {t("setUp")}
        </button>
        <button className="btn block" onClick={() => go({ name: "join" })}>
          {t("join")}
        </button>
      </div>
    </main>
  );
}

export function Setup() {
  const { t, back, update, go, share, state } = useApp();
  const [step, setStep] = useState(0);
  const [myName, setMyName] = useState("");
  const [members, setMembers] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    const keys = await newParentKeys();
    const me: Person = { id: randomId(9), name: myName.trim(), role: "parent" };
    const circle = { id: randomId(16), key: await newFamilyKey(), parentPub: keys.pub, parentPriv: keys.priv };
    update((s) => ({ ...s, me, circle, members, people: [me], profilesVersion: 0 }));
    // tell the relay: the profiles are versioned and signed, the hello lets other phones list this person
    setTimeout(async () => {
      await share({ t: "hello", id: newId(), from: me });
      await share({ t: "profiles", id: newId(), v: 1, members, safe: [] });
      go({ name: "home" }, true);
    }, 0);
  };

  const valid = (p: Profile) => p.name.trim() && p.avoid.length + p.diets.length > 0;

  if (editing) {
    return (
      <>
        <Top title={t("addPerson")} onBack={() => setEditing(null)} backLabel={t("back")} />
        <main className="page">
          <ProfileEditor value={editing} onChange={setEditing} />
          {!valid(editing) && <p className="muted small">{t("noAllergiesYet")}</p>}
          <button className="btn primary block" disabled={!valid(editing)} onClick={() => {
            setMembers((m) => [...m.filter((x) => x.id !== editing.id), { ...editing, name: editing.name.trim() }]);
            setEditing(null);
          }}>
            {t("save")}
          </button>
        </main>
      </>
    );
  }

  return (
    <>
      <Top title={t("setUp")} onBack={step === 0 ? back : () => setStep(step - 1)} backLabel={t("back")} right={<LangSwitch />} />
      <main className="page">
        {step === 0 && (
          <>
            <label className="field">
              <span style={{ fontSize: 20 }}>{t("yourName")}</span>
              <input autoFocus value={myName} placeholder={t("yourNamePh")} onChange={(e) => setMyName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && myName.trim() && setStep(1)} />
            </label>
            <button className="btn primary block" disabled={!myName.trim()} onClick={() => setStep(1)}>
              {t("next")}
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="big">{t("setupMembersTitle")}</h2>
            <p className="lead">{t("setupMembersLead")}</p>
            {members.length > 0 && (
              <ul className="list card">
                {members.map((m) => (
                  <li key={m.id}>
                    <button className="item" onClick={() => setEditing(m)}>
                      <Initial name={m.name} />
                      <span className="grow">
                        <strong>{m.name}</strong>
                        <br />
                        <span className="muted small">{summary(state.lang, m)}</span>
                      </span>
                      <span className="muted small">{t("edit")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn block" onClick={() => setEditing(blankProfile(randomId(6)))}>
              <Icon name="plus" />
              {t("addPerson")}
            </button>
            <button className="btn primary block" disabled={members.length === 0} onClick={() => setStep(2)}>
              {t("next")}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="big">{t("setupPrivacyTitle")}</h2>
            <ul className="points">
              <li>{t("setupPrivacy1")}</li>
              <li>{t("setupPrivacy2")}</li>
              <li>{t("setupPrivacy3")}</li>
            </ul>
            <button className="btn primary big block" disabled={busy} onClick={finish}>
              {t("setupFinish")}
            </button>
          </>
        )}
      </main>
    </>
  );
}

export function Join({ invite }: { invite: Invite | null }) {
  const { t, back, update, go, share, toast } = useApp();
  const [inv, setInv] = useState<Invite | null>(invite);
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [scanning, setScanning] = useState(false);
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
      .catch(() => setScanning(false));
    return () => {
      stop = true;
      stopCamera(stream);
    };
  }, [scanning]);

  const join = () => {
    if (!inv) return;
    const me: Person = { id: randomId(9), name: name.trim(), role: inv.r };
    update((s) => ({ ...s, me, circle: { id: inv.c, key: inv.k, parentPub: inv.p, ...(inv.s ? { parentPriv: inv.s } : {}) }, people: [me], cursor: 0 }));
    setTimeout(async () => {
      await share({ t: "hello", id: newId(), from: me });
      toast(t("joinedAs", { role: t(inv.r === "parent" ? "parent" : "caregiver") }));
      go({ name: "home" }, true);
    }, 0);
  };

  return (
    <>
      <Top title={t("join")} onBack={back} backLabel={t("back")} right={<LangSwitch />} />
      <main className="page">
        {!inv && (
          <>
            <p className="lead">{t("joinHelp")}</p>
            {scanning ? (
              <div className="camera">
                <video ref={video} playsInline muted />
                <div className="frame" />
              </div>
            ) : (
              <button className="btn block" onClick={() => setScanning(true)}>
                <Icon name="qr" />
                {t("scanInvite")}
              </button>
            )}
            <label className="field">
              {t("joinPaste")}
              <input value={pasted} dir="ltr" onChange={(e) => setPasted(e.target.value)} placeholder="https://…#join=…" />
            </label>
            <button className="btn primary block" disabled={!pasted.trim()} onClick={() => {
              const p = parseInvite(pasted.trim());
              if (p) setInv(p);
              else toast(t("joinBad"));
            }}>
              {t("next")}
            </button>
          </>
        )}
        {inv && (
          <>
            <p className="lead">{t(inv.r === "parent" ? "inviteParentNote" : "inviteCaregiverNote")}</p>
            <label className="field">
              <span style={{ fontSize: 20 }}>{t("yourName")}</span>
              <input autoFocus value={name} placeholder={t("yourNamePh")} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="btn primary big block" disabled={!name.trim()} onClick={join}>
              {t("joinGo")}
            </button>
          </>
        )}
      </main>
    </>
  );
}
