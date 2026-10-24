import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verdicts } from "../engine/verdict.ts";
import type { ProductFacts } from "../engine/types.ts";
import { api, ApiError } from "../lib/api.ts";
import { capture, readFile, readFrame, startCamera, stopCamera, thumbnail } from "../lib/camera.ts";
import { newId } from "../lib/circle.ts";
import type { ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Icon, Sheet, Spinner, Top } from "../ui.tsx";

type Step =
  | { s: "barcode" }
  | { s: "photo"; which: "original" | "sticker" }
  | { s: "preview"; which: "original" | "sticker"; blob: Blob; url: string }
  | { s: "sticker?" }
  | { s: "checking"; stage: "lookup" | "read" | "compare" | "check" };

interface Photo {
  blob: Blob;
  hint: "original" | "sticker" | "";
}

/** The scan flow: barcode first; if the product or its ingredients aren't known, photos of the label (and the
 * Arabic sticker); then the check, on this phone. */
export function Scan({ barcode: known }: { barcode?: string }) {
  const { t, back, go, state, update, share, me, health } = useApp();
  // a barcode passed in (from "Photograph the label too") starts at the label photo
  const [step, setStep] = useState<Step>(known ? { s: "photo", which: "original" } : { s: "barcode" });
  const [barcode, setBarcode] = useState<string | null>(known ?? null);
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
        const code = (e as ApiError).message;
        setError(code === "gemma_unavailable" ? t("gemmaDown") : code === "offline" ? t("offline") : t("errorGeneric", { msg: code }));
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
    if (!video.current || step.s !== "photo") return;
    const blob = await capture(video.current);
    setStep({ s: "preview", which: step.which, blob, url: URL.createObjectURL(blob) });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (step.s === "barcode") {
      // a photo chosen at the barcode step: try for a barcode, else treat it as the ingredient list
      const code = await readFile(file).catch(() => null);
      if (code) return lookUp(code);
      setStep({ s: "preview", which: "original", blob: file, url: URL.createObjectURL(file) });
      return;
    }
    const which = step.s === "photo" || step.s === "preview" ? step.which : "original";
    setStep({ s: "preview", which, blob: file, url: URL.createObjectURL(file) });
  };

  const usePhoto = () => {
    if (step.s !== "preview") return;
    const list = [...photos.filter((p) => p.hint !== step.which), { blob: step.blob, hint: step.which } as Photo];
    setPhotos(list);
    URL.revokeObjectURL(step.url);
    if (step.which === "sticker") readPhotos(list, barcode);
    else setStep({ s: "sticker?" });
  };

  const gemmaReady = health?.gemma.available !== false;
  const previews = useMemo(() => photos.map((p) => URL.createObjectURL(p.blob)), [photos]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const names = state.members.map((m) => m.name).join(state.lang === "ar" ? "، " : ", ");

  return (
    <>
      <Top title={t("scan")} onBack={back} backLabel={t("back")} />
      <main className="page">
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />

        {live && (
          <>
            {step.s === "photo" && (
              <>
                <h2 className="big">{t(step.which === "sticker" ? "stickerStepTitle" : "photoStepTitle")}</h2>
                {note && step.which === "original" && <p className="card small" role="status">{note}</p>}
                {!gemmaReady && <p className="card small request" role="alert">{t("gemmaDown")}</p>}
                <p className="lead small">{t("photoStepLead")}</p>
              </>
            )}
            {cameraError ? (
              <p className="card" role="alert">{t("scanNoCamera")}</p>
            ) : (
              <div className="camera">
                <video ref={video} playsInline muted aria-label={t(step.s === "barcode" ? "scanHint" : "photoStepTitle")} />
                <div className={`frame ${step.s === "photo" ? "label" : ""}`} />
                {step.s === "barcode" && <div className="hint">{t("scanHint")}</div>}
                {step.s === "photo" && <button className="shutter" onClick={takePhoto} aria-label={t("takePhoto")} />}
              </div>
            )}
            {step.s === "barcode" ? (
              <div className="stack">
                <button className="btn block" onClick={() => setStep({ s: "photo", which: "original" })}>
                  <Icon name="camera" />
                  {t("photoLabel")}
                </button>
                <div className="row">
                  <button className="btn grow" onClick={() => fileInput.current?.click()}>
                    <Icon name="image" />
                    {t("photoGallery")}
                  </button>
                  <button className="btn grow" onClick={() => setTyping(true)}>
                    <Icon name="keyboard" />
                    {t("typeBarcode")}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn block" onClick={() => fileInput.current?.click()}>
                <Icon name="image" />
                {t("photoGallery")}
              </button>
            )}
          </>
        )}

        {step.s === "preview" && (
          <>
            <h2 className="big">{t(step.which === "sticker" ? "stickerStepTitle" : "photoStepTitle")}</h2>
            <div className="camera" style={{ aspectRatio: "auto", maxHeight: "60dvh" }}>
              <img src={step.url} alt="" style={{ objectFit: "contain", background: "#111" }} />
            </div>
            <div className="row">
              <button className="btn grow" onClick={() => setStep({ s: "photo", which: step.which })}>
                {t("retake")}
              </button>
              <button className="btn primary grow" onClick={usePhoto}>
                {t("usePhoto")}
              </button>
            </div>
          </>
        )}

        {step.s === "sticker?" && (
          <>
            {error && <p className="card request" role="alert">{error}</p>}
            <div className="thumbs">
              {previews.map((u) => (
                <img key={u} src={u} alt="" />
              ))}
            </div>
            <h2 className="big">{t("stickerQuestion")}</h2>
            <button className="btn block" onClick={() => setStep({ s: "photo", which: "sticker" })}>
              <Icon name="camera" />
              {t("stickerYes")}
            </button>
            <button className="btn primary big block" onClick={() => readPhotos(photos.filter((p) => p.hint === "original"), barcode)}>
              {t("stickerNo")}
            </button>
          </>
        )}

        {step.s === "checking" && (
          <section className="card stack" aria-live="polite">
            <h2 className="big">{t("checking")}</h2>
            <ol className="steps">
              {barcode && <StepLine state={step.stage === "lookup" ? "active" : "done"} text={t("stepLookup")} />}
              {step.stage !== "lookup" && photos.length > 0 && (
                <StepLine state={step.stage === "read" ? "active" : "done"} text={t("stepRead")} />
              )}
              {photos.length > 1 && step.stage !== "lookup" && (
                <StepLine state={step.stage === "compare" ? "active" : step.stage === "check" ? "done" : "todo"} text={t("stepCompare")} />
              )}
              <StepLine state={step.stage === "check" ? "active" : "todo"} text={t("stepCheck", { names })} />
            </ol>
            {step.stage !== "lookup" && <p className="small muted">{t("slowNote")}</p>}
          </section>
        )}
      </main>

      {typing && (
        <Sheet title={t("typeBarcode")} onClose={() => setTyping(false)} closeLabel={t("close")}>
          <label className="field">
            {t("barcodePh")}
            <input inputMode="numeric" dir="ltr" autoFocus value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))} />
          </label>
          <button className="btn primary block" disabled={typed.length < 6} onClick={() => {
            setTyping(false);
            lookUp(typed);
          }}>
            {t("lookUp")}
          </button>
        </Sheet>
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
