// The camera: live barcode reading (zxing-wasm, served by Wiqaya itself, not a CDN) and label photos.
import { prepareZXingModule, readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

const PRODUCT: ReaderOptions = { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 };
const QR: ReaderOptions = { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 };

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("no_camera");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

/** One frame from the video, scaled so the long side is at most ``max``. */
function frame(video: HTMLVideoElement, max: number): ImageData | null {
  if (!canvas || !video.videoWidth) return null;
  const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** A product barcode (or an invite QR code) in the current frame, or null. */
export async function readFrame(video: HTMLVideoElement, kind: "product" | "qr" = "product"): Promise<string | null> {
  const img = frame(video, 1280);
  if (!img) return null;
  const res = await readBarcodes(img, kind === "product" ? PRODUCT : QR);
  const hit = res.find((r) => r.isValid && r.text);
  return hit ? hit.text : null;
}

export async function readFile(file: Blob, kind: "product" | "qr" = "product"): Promise<string | null> {
  const res = await readBarcodes(file, kind === "product" ? PRODUCT : QR);
  return res.find((r) => r.isValid && r.text)?.text ?? null;
}

/** A full-resolution photo of what the viewfinder shows. The video fills its box ("object-fit: cover"), so the edges
 * of the camera's frame are hidden; the photo is cut the same way, so it looks exactly as framed, not zoomed out. */
export async function capture(video: HTMLVideoElement): Promise<Blob> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const box = video.clientWidth / Math.max(1, video.clientHeight);
  let sw = vw;
  let sh = vh;
  if (video.clientWidth && video.clientHeight) {
    if (vw / vh > box) sw = Math.round(vh * box);
    else sh = Math.round(vw / box);
  }
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  c.getContext("2d")!.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, sw, sh);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("capture"))), "image/jpeg", 0.92));
}

/** A photo chosen from the phone, made the size of a camera shot: phones save 12-48 MP photos that can be larger than
 * the server takes, and Gemma reads no more from them. Anything that isn't an image the browser can open is sent as it is. */
export async function shrink(file: Blob, max = 2560): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.type === "image/jpeg" && file.size < 4 * 1024 * 1024) return file;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((resolve) => c.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.9));
}

/** A small preview (data URL) of a photo, kept on the phone. */
export async function thumbnail(blob: Blob, max = 360): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.72);
}
