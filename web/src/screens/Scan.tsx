import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verdicts } from "../engine/verdict.ts";
import type { ProductFacts } from "../engine/types.ts";
import { joinNames } from "../i18n.ts";
import { api, ApiError } from "../lib/api.ts";
import { capture, readFile, readFrame, startCamera, stopCamera, thumbnail } from "../lib/camera.ts";
import { newId } from "../lib/circle.ts";
import type { ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Heading, Icon, Modal, Spinner } from "../ui.tsx";

type Which = "original" | "sticker";
type Step =
  | { s: "barcode" }
  | { s: "photo"; which: Which }
  | { s: "preview"; which: Which; blob: Blob; url: string }
  | { s: "sticker?" }
  | { s: "checking"; stage: "lookup" | "read" | "compare" | "check" };

interface Photo {
  blob: Blob;
  hint: Which;
}

/** The scan flow: barcode first; if the product or its ingredients aren't known, photos of the label (and the
 * Arabic sticker); then the check, on this phone. */
export function Scan({ barcode: known }: { barcode?: string }) {
  const { t, go, state, update, share, me, health } = useApp();
  // a barcode passed in (from "Photograph the label too") starts at the label photo
  const [step, setStep] = useState<Step>(known ? { s: "photo", which: "original" } : { s: "barcode" });
  const [barcode, setBarcode] = useState<string | null>(known ?? null);
  const [skipped, setSkipped] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const live = step.s === "barcode" || step.s === "photo";

  // the camera runs while a live step is showing
  useEffect(() => {
    if (!live || !video.current) return;
    let cancelled = false;
    setCameraError(false);
    startCamera(video.current)
      .then((s) => {
        if (cancelled) stopCamera(s);
        else stream.current = s;
      })
      .catch(() => !cancelled && setCameraError(true));
    return () => {
      cancelled = true;
      stopCamera(stream.current);
      stream.current = null;
    };
  }, [live, step.s]);

  // finish: compute the verdicts here, save, tell the family, show the result
  const finish = useCallback(
    async (facts: ProductFacts, thumbFrom: Blob | null) => {
      setStep({ s: "checking", stage: "check" });
      const v = verdicts(facts, state.members, state.safe);
      const rec: ScanRecord = {
        id: newId(),
        at: Date.now(),
        by: me!,
        facts,
        verdicts: v,
        thumb: thumbFrom ? await thumbnail(thumbFrom).catch(() => undefined) : undefined,
      };
      update((s) => ({ ...s, scans: [rec, ...s.scans] }));
      share({ t: "scan", id: rec.id, by: me!, at: rec.at, name: facts.name, levels: Object.fromEntries(v.map((x) => [x.member_id, x.level])) });
      go({ name: "result", id: rec.id }, true);
    },
    [state.members, state.safe, me, update, share, go],
  );

  const readPhotos = useCallback(
    async (list: Photo[], code: string | null) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      setStep({ s: "checking", stage: "read" });
      try {
        const stageTimer = list.length > 1 ? setTimeout(() => setStep({ s: "checking", stage: "compare" }), 25_000) : null;
        const facts = await api.scan(list, code);
        if (stageTimer) clearTimeout(stageTimer);
        await finish(facts, list[0].blob);
      } catch (e) {
        const c = (e as ApiError).message;
        setError(c === "gemma_unavailable" ? t("gemmaDown") : c === "offline" ? t("offline") : t("errorGeneric", { msg: c }));
        setStep({ s: "sticker?" });
      } finally {
        busy.current = false;
      }
    },
    [finish, t],
  );

  const lookUp = useCallback(
    async (code: string) => {
      if (busy.current) return;
      busy.current = true;
      navigator.vibrate?.(40);
      setBarcode(code);
      setStep({ s: "checking", stage: "lookup" });
      try {
        const facts = await api.product(code);
        busy.current = false;
        if (facts.label && facts.label.ingredients.length) return finish(facts, null);
        setNote(t("notFound"));
      } catch (e) {
        busy.current = false;
        setNote((e as ApiError).status === 404 ? t("notFound") : t("lookupFailed"));
      }
      setStep({ s: "photo", which: "original" });
    },
    [finish, t],
  );

  // live barcode reading
  useEffect(() => {
    if (step.s !== "barcode") return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        if (video.current?.videoWidth) {
          const code = await readFrame(video.current).catch(() => null);
          if (code && !stop) {
            stop = true;
            lookUp(code);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 220));
      }
    };
    loop();
    return () => {
      stop = true;
    };
  }, [step.s, lookUp]);

  const takePhoto = async () => {
    if (!video.current || step.s !== "photo" || !video.current.videoWidth) return;
    const blob = await capture(video.current);
    setStep({ s: "preview", which: step.which, blob, url: URL.createObjectURL(blob) });
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    if (step.s === "barcode") {
      // a photo chosen at the barcode step: try for a barcode, else treat it as the ingredient list
      const code = await readFile(file).catch(() => null);
      if (code) return lookUp(code);
      setSkipped(true);
      setStep({ s: "preview", which: "original", blob: file, url: URL.createObjectURL(file) });
      return;
    }
    const which = step.s === "photo" || step.s === "preview" ? step.which : "original";
    setStep({ s: "preview", which, blob: file, url: URL.createObjectURL(file) });
  };

  const usePhoto = () => {
    if (step.s !== "preview") return;
    const list = [...photos.filter((p) => p.hint !== step.which), { blob: step.blob, hint: step.which }];
    setPhotos(list);
    URL.revokeObjectURL(step.url);
    if (step.which === "sticker") readPhotos(list, barcode);
    else setStep({ s: "sticker?" });
  };

  const gemmaReady = health?.gemma.available !== false;
  const previews = useMemo(() => photos.map((p) => ({ hint: p.hint, url: URL.createObjectURL(p.blob) })), [photos]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  const names = joinNames(state.lang, state.members.map((m) => m.name));
  const hasOriginal = photos.some((p) => p.hint === "original");
  const hasSticker = photos.some((p) => p.hint === "sticker");

  // which tab is showing
  const tab = step.s === "barcode" ? 0 : step.s === "photo" || step.s === "preview" ? (step.which === "original" ? 1 : 2) : 2;
  const checking = step.s === "checking";
  const shownPhoto = step.s === "preview" ? step.url : checking || step.s === "sticker?" ? previews.find((p) => p.hint === "original")?.url : undefined;

  return (
    <>
      <Heading eyebrow={t("scanEyebrow")} title={t("scanTitle")} lead={t("scanLead")} />
      <div className="content stack">
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
        <div className="row spread">
          <button className="secondary" onClick={() => go({ name: "home" }, true)}>
            ✕ {t("close")}
          </button>
          <span className="exif-note">
            <Icon name="lock" /> {t("exifNote")}
          </span>
        </div>

        <div className="segmented" role="tablist">
          {[t("tabBarcode"), t("tabOriginal"), t("tabSticker")].map((label, i) => (
            <button
              key={label}
              role="tab"
              aria-selected={tab === i}
              className={tab === i ? "active" : ""}
              disabled={checking || (i === 2 && !hasOriginal)}
              onClick={() => setStep(i === 0 ? { s: "barcode" } : { s: "photo", which: i === 1 ? "original" : "sticker" })}
            >
              {label}
            </button>
          ))}
        </div>

        {cameraError && live ? (
          <div className="warning" role="alert">{t("scanNoCamera")}</div>
        ) : (
          <div className={`camera ${checking ? "checking" : ""}`}>
            {live && <video ref={video} playsInline muted aria-label={t(step.s === "barcode" ? "scanHint" : "photoHint")} />}
            {shownPhoto && !live && <img src={shownPhoto} alt="" />}
            <span className="camera-hint">
              {step.s === "barcode" ? t("scanHint") : step.s === "photo" && step.which === "sticker" ? t("stickerHint") : t("photoHint")}
            </span>
            {checking && <div className="scanline" aria-hidden="true" />}
          </div>
        )}

        {note && step.s === "photo" && step.which === "original" && <div className="warning" role="status">{note}</div>}
        {!gemmaReady && step.s !== "barcode" && <div className="warning" role="alert">{t("gemmaDown")}</div>}
        {error && <div className="danger-box" role="alert">{error}</div>}

        <div className="steps" aria-hidden={checking}>
          <div className={tab === 0 && !checking ? "current" : "done"}>
            {barcode ? `✓ ${t("stepFound", { code: barcode })}` : skipped || tab > 0 ? `– ${t("stepSkipped")}` : `① ${t("tabBarcode")}`}
          </div>
          <div className={tab === 1 && !checking ? "current" : hasOriginal ? "done" : ""}>
            {hasOriginal ? `✓ ${t("tabOriginal")}` : `② ${t("tabOriginal")}`}
            {hasOriginal && <small>{t("stepDone")}</small>}
          </div>
          <div className={(tab === 2 || step.s === "sticker?") && !checking ? "current" : hasSticker ? "done" : ""}>
            {hasSticker ? `✓ ${t("tabSticker")}` : `③ ${t("stepAdd")}`}
          </div>
        </div>

        {step.s === "barcode" && (
          <div className="row">
            <button className="secondary" onClick={() => setTyping(true)}>
              <Icon name="keyboard" /> {t("typeBarcode")}
            </button>
            <button className="secondary" onClick={() => fileInput.current?.click()}>
              <Icon name="image" /> {t("uploadPhoto")}
            </button>
            <button className="primary" onClick={() => {
              setSkipped(true);
              setStep({ s: "photo", which: "original" });
            }}>
              <Icon name="camera" /> {t("noBarcode")}
            </button>
          </div>
        )}

        {step.s === "photo" && (
          <div className="row">
            <button className="primary" onClick={takePhoto} disabled={cameraError}>
              <Icon name="camera" /> {t("takePhoto")}
            </button>
            <button className="secondary" onClick={() => fileInput.current?.click()}>
              <Icon name="image" /> {t("uploadPhoto")}
            </button>
          </div>
        )}

        {step.s === "preview" && (
          <div className="row">
            <button className="secondary" onClick={() => setStep({ s: "photo", which: step.which })}>
              {t("retake")}
            </button>
            <button className="primary" onClick={usePhoto}>
              {t("usePhoto")} <Icon name="arrow" />
            </button>
          </div>
        )}

        {step.s === "sticker?" && (
          <section className="big-card">
            <h3>{t("stickerQuestion")}</h3>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="secondary" onClick={() => setStep({ s: "photo", which: "sticker" })}>
                <Icon name="camera" /> {t("stickerYes")}
              </button>
              <button className="primary" onClick={() => readPhotos(photos.filter((p) => p.hint === "original"), barcode)}>
                {t("checkNow")} <Icon name="arrow" />
              </button>
            </div>
          </section>
        )}

        {step.s === "checking" && (
          <section className="big-card" aria-live="polite">
            <h2>{t("checking")}</h2>
            <ol className="progress">
              {barcode && <StepLine state={step.stage === "lookup" ? "active" : "done"} text={t("stepLookup")} />}
              {step.stage !== "lookup" && photos.length > 0 && <StepLine state={step.stage === "read" ? "active" : "done"} text={t("stepRead")} />}
              {photos.length > 1 && step.stage !== "lookup" && (
                <StepLine state={step.stage === "compare" ? "active" : step.stage === "check" ? "done" : "todo"} text={t("stepCompare")} />
              )}
              <StepLine state={step.stage === "check" ? "active" : "todo"} text={t("stepCheck", { names })} />
            </ol>
            {step.stage !== "lookup" && <p className="small-note">{t("slowNote")}</p>}
          </section>
        )}
      </div>

      {typing && (
        <Modal label={t("typeBarcode")} onClose={() => setTyping(false)} closeLabel={t("close")}>
          <h2>{t("typeBarcode")}</h2>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (typed.length < 6) return;
            setTyping(false);
            lookUp(typed);
          }}>
            <label className="field" htmlFor="code">{t("barcodePh")}</label>
            <input id="code" type="text" inputMode="numeric" dir="ltr" autoFocus value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} />
            <button className="primary wide" type="submit" style={{ marginTop: 16 }} disabled={typed.length < 6}>
              {t("lookUp")}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function StepLine({ state, text }: { state: "todo" | "active" | "done"; text: string }) {
  return (
    <li className={state}>
      {state === "active" ? <Spinner /> : state === "done" ? <span className="tick"><Icon name="check" /></span> : <span className="tick" />}
      {text}
    </li>
  );
}
