import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { verdicts } from "../engine/verdict.ts";
import type { ProductFacts } from "../engine/types.ts";
import { joinNames } from "../i18n.ts";
import { api, ApiError } from "../lib/api.ts";
import { capture, readFile, readFrame, shrink, startCamera, stopCamera, thumbnail } from "../lib/camera.ts";
import { newId } from "../lib/circle.ts";
import { checked, type ScanRecord } from "../lib/state.ts";
import { useApp } from "../App.tsx";
import { Heading, Icon, Modal, Spinner } from "../ui.tsx";

type Which = "original" | "sticker";
type Step =
  | { s: "live" }
  | { s: "preview" }
  | { s: "checking"; stage: "lookup" | "read" | "compare" | "check" };

interface Photo {
  blob: Blob;
  url: string;
  hint: Which;
}

/** One viewfinder for everything: a barcode is read by itself while the camera runs; the shutter photographs the
 * ingredients. After a photo: check it, or add the Arabic sticker's list first. */
export function Scan({ barcode: known }: { barcode?: string }) {
  const { t, go, state, update, share, me, health } = useApp();
  const [step, setStep] = useState<Step>({ s: "live" });
  // a barcode passed in (from "Photograph the label too") skips the barcode reading
  const [barcode, setBarcode] = useState<string | null>(known ?? null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [note, setNote] = useState<string | null>(known ? t("labelToo") : null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [flash, setFlash] = useState(false);
  // a real photo is read twice and its edges checked: past the first reading, say so, so a long wait doesn't look stuck
  const [slow, setSlow] = useState(false);
  const reading = step.s === "checking" && step.stage === "read";
  useEffect(() => {
    setSlow(false);
    if (!reading) return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [reading]);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const members = checked(state);

  const live = step.s === "live";
  const next: Which = photos.some((p) => p.hint === "original") ? "sticker" : "original";

  // the camera runs while the viewfinder shows
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
  }, [live]);

  // finish: compute the verdicts here, save, tell the family, show the result
  const finish = useCallback(
    async (facts: ProductFacts, thumbFrom: Blob | null) => {
      setStep({ s: "checking", stage: "check" });
      const v = verdicts(facts, members, state.safe);
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
    [members, state.safe, me, update, share, go],
  );

  const readPhotos = useCallback(
    async (list: Photo[]) => {
      if (busy.current || !list.length) return;
      busy.current = true;
      setError(null);
      setStep({ s: "checking", stage: "read" });
      try {
        const stageTimer = list.length > 1 ? setTimeout(() => setStep({ s: "checking", stage: "compare" }), 25_000) : null;
        const facts = await api.scan(list, barcode);
        if (stageTimer) clearTimeout(stageTimer);
        await finish(facts, list[0].blob);
      } catch (e) {
        const c = (e as ApiError).message;
        setError(c === "gemma_unavailable" ? t("gemmaDown") : c === "offline" ? t("offline") : t("errorGeneric", { msg: c }));
        setStep({ s: "preview" });
      } finally {
        busy.current = false;
      }
    },
    [finish, t, barcode],
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
      setStep({ s: "live" });
    },
    [finish, t],
  );

  // a barcode is read by itself, until there is one or a photo is taken
  useEffect(() => {
    if (!live || barcode || photos.length) return;
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
  }, [live, barcode, photos.length, lookUp]);

  const addPhoto = (blob: Blob) => {
    setPhotos((list) => [...list.filter((p) => p.hint !== next), { blob, url: URL.createObjectURL(blob), hint: next }]);
    setStep({ s: "preview" });
  };

  const shoot = async () => {
    if (!video.current?.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    addPhoto(await capture(video.current));
  };

  const onFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    // a chosen photo: a barcode if it has one (and nothing else is taken yet), otherwise the ingredients
    if (!barcode && !photos.length) {
      const code = await readFile(file).catch(() => null);
      if (code) return lookUp(code);
    }
    addPhoto(await shrink(file));
  };

  const retake = () => {
    setPhotos((list) => {
      const last = list.at(-1);
      if (last) URL.revokeObjectURL(last.url);
      return list.slice(0, -1);
    });
    setError(null);
    setStep({ s: "live" });
  };

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const gemmaReady = health?.gemma.available !== false;
  const names = joinNames(state.lang, members.map((m) => m.name));
  const checking = step.s === "checking";
  const shown = useMemo(() => photos.at(-1), [photos]);
  const hint = next === "sticker" ? t("stickerHint") : barcode ? t("photoHint") : t("scanHintBoth");

  return (
    <>
      <Heading eyebrow={t("scanEyebrow")} title={t("scanTitle")} lead={t("scanLeadOne")} />
      <div className="content stack scan-screen">
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />

        {cameraError && live ? (
          <div className="warning" role="alert">{t("scanNoCamera")}</div>
        ) : (
          <div className={`camera viewfinder ${checking ? "checking" : ""} ${flash ? "flash" : ""}`}>
            {live && <video ref={video} playsInline muted aria-label={hint} />}
            {!live && shown && <img src={shown.url} alt="" />}
            {live && <span className="camera-hint">{hint}</span>}
            {photos.length > 0 && (
              <div className="shots" aria-label={t("photosTaken")}>
                {photos.map((p) => (
                  <span key={p.url} className="shot">
                    <img src={p.url} alt="" />
                    <small>{t(p.hint === "original" ? "shotLabel" : "shotSticker")}</small>
                  </span>
                ))}
              </div>
            )}
            {checking && <div className="scanline" aria-hidden="true" />}
          </div>
        )}

        {note && live && <div className="warning" role="status">{note}</div>}
        {!gemmaReady && <div className="warning" role="alert">{t("gemmaDown")}</div>}
        {error && <div className="danger-box" role="alert">{error}</div>}

        {live && (
          <>
            <div className="shutter-row">
              <button className="text-button" onClick={() => fileInput.current?.click()}>
                <Icon name="image" /> {t("uploadPhoto")}
              </button>
              {/* no camera here: the shutter picks a photo instead */}
              <button className="shutter" onClick={cameraError ? () => fileInput.current?.click() : shoot} aria-label={t(next === "sticker" ? "shootSticker" : "shootLabel")}>
                <span />
              </button>
              {!barcode && !photos.length ? (
                <button className="text-button" onClick={() => setTyping(true)}>
                  <Icon name="keyboard" /> {t("typeBarcode")}
                </button>
              ) : photos.length ? (
                <button className="text-button" onClick={() => setStep({ s: "preview" })}>
                  {t("cancel")}
                </button>
              ) : (
                <span />
              )}
            </div>
            <p className="center small-note">
              {barcode ? `✓ ${t("stepFound", { code: barcode })} · ` : ""}
              {t(next === "sticker" ? "shootSticker" : "shootLabel")}
            </p>
          </>
        )}

        {step.s === "preview" && (
          <section className="big-card preview-actions">
            <h3>{t(photos.length > 1 ? "previewBoth" : "previewOne")}</h3>
            <p className="small-note">{t("previewCheckText")}</p>
            <button className="primary wide" onClick={() => readPhotos(photos)} disabled={!gemmaReady}>
              <Icon name="check" /> {t("checkNow")}
            </button>
            <div className="row" style={{ marginTop: 10 }}>
              {next === "sticker" && photos.length === 1 && (
                <button className="secondary" onClick={() => setStep({ s: "live" })}>
                  <Icon name="plus" /> {t("addSticker")}
                </button>
              )}
              <button className="secondary" onClick={retake}>
                <Icon name="camera" /> {t("retake")}
              </button>
            </div>
          </section>
        )}

        {step.s === "checking" && (
          <section className="big-card" aria-live="polite">
            <h2>{t("checking")}</h2>
            <ol className="progress">
              {barcode && <StepLine state={step.stage === "lookup" ? "active" : "done"} text={t("stepLookup")} />}
              {step.stage !== "lookup" && photos.length > 0 && <StepLine state={step.stage === "read" ? "active" : "done"} text={t(slow ? "stepDoubleCheck" : "stepRead")} />}
              {photos.length > 1 && step.stage !== "lookup" && (
                <StepLine state={step.stage === "compare" ? "active" : step.stage === "check" ? "done" : "todo"} text={t("stepCompare")} />
              )}
              <StepLine state={step.stage === "check" ? "active" : "todo"} text={t("stepCheck", { names })} />
            </ol>
            {step.stage !== "lookup" && <p className="small-note">{t("slowNote")}</p>}
          </section>
        )}

        <div className="row spread">
          <button className="secondary" onClick={() => go({ name: "home" }, true)}>
            ✕ {t("close")}
          </button>
          <span className="exif-note">
            <Icon name="lock" /> {t("exifNote")}
          </span>
        </div>
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
