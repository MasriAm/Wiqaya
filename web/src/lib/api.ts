// Calls to Wiqaya's server. Nothing here carries a name, an allergy profile or a location.
import type { MenuFacts } from "../engine/menu.ts";
import type { ProductFacts, Suspicion, TriggerId } from "../engine/types.ts";
import { shrink } from "./camera.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 600_000): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new ApiError(0, (e as Error)?.name === "TimeoutError" ? "timeout" : "offline");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error ?? `http_${r.status}`);
  return j as T;
}

export interface Health {
  version: string;
  gemma: { available: boolean; model: string; reason?: string };
  web_search: boolean;
}

export const api = {
  health: () => call<Health>("/api/health", undefined, 8000),
  product: (barcode: string) => call<ProductFacts>(`/api/product/${encodeURIComponent(barcode)}`, undefined, 20_000),
  scan: (photos: { blob: Blob; hint: "original" | "sticker" | "" }[], barcode: string | null) => {
    const fd = new FormData();
    photos.forEach((p, i) => {
      fd.append("photos", p.blob, `label-${i}.jpg`);
      fd.append("hints", p.hint);
    });
    if (barcode) fd.append("barcode", barcode);
    return call<ProductFacts & { seconds: number }>("/api/scan", { method: "POST", body: fd });
  },
  /** A restaurant menu: a link, or photos / a PDF. Only the menu is sent. */
  menu: async (url: string, files: File[]) => {
    const fd = new FormData();
    if (url) fd.append("url", url);
    for (const f of files) {
      const small = await shrink(f);
      fd.append("files", small, small === f ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
    }
    return call<MenuFacts & { seconds: number }>("/api/menu", { method: "POST", body: fd });
  },
  expiry: async (photo: Blob) => {
    const fd = new FormData();
    fd.append("photo", await shrink(photo), "box.jpg");
    return call<{ expiry: string | null; printed: string | null }>("/api/expiry", { method: "POST", body: fd });
  },
  research: (ingredients: string[], product_name: string | null) =>
    call<{ suspicions: Suspicion[]; tools_used: { tool: string; args: Record<string, string> }[] }>("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients, product_name }),
    }),
  explain: (findings: { trigger: TriggerId; quote: string }[], lang: string) =>
    call<{ items: { trigger: TriggerId; quote: string; text: string }[] }>("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ findings, lang }),
    }),
  post: (circle: string, body: string) =>
    call<{ id: number }>(`/api/circle/${circle}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }, 15_000),
  since: (circle: string, after: number) => call<{ messages: { id: number; at: number; body: string }[] }>(`/api/circle/${circle}?after=${after}`, undefined, 15_000),
};
