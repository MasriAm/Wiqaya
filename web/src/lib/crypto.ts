// Encryption for the family circle and for what the phone stores.
// * Family key: AES-GCM 256, random, shared only inside the invite QR code (in the URL fragment, which browsers
//   never send to a server).
// * Parent key: ECDSA P-256. Profile updates and approvals are signed, so a caregiver's phone accepts them only
//   from a parent.
// * Device key: AES-GCM, non-extractable, kept in IndexedDB; the app's saved state is encrypted with it.

const subtle = globalThis.crypto.subtle;

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomId(bytes = 16): string {
  return b64u(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ------------------------------------------------------------------------------------------------ family key
export async function newFamilyKey(): Promise<string> {
  return b64u(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

async function aesKey(raw: string): Promise<CryptoKey> {
  return subtle.importKey("raw", unb64u(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** ``iv.ciphertext`` in base64url: the only form the relay accepts. */
export async function seal(familyKey: string, value: unknown): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(familyKey), enc.encode(JSON.stringify(value)));
  return `${b64u(iv)}.${b64u(ct)}`;
}

export async function open<T = unknown>(familyKey: string, body: string): Promise<T | null> {
  try {
    const [iv, ct] = body.split(".");
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv) }, await aesKey(familyKey), unb64u(ct));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null; // not ours, or tampered with
  }
}

// ------------------------------------------------------------------------------------------------ parent key
export async function newParentKeys(): Promise<{ pub: string; priv: string }> {
  const kp = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    pub: b64u(await subtle.exportKey("raw", kp.publicKey)),
    priv: b64u(enc.encode(JSON.stringify(await subtle.exportKey("jwk", kp.privateKey)))),
  };
}

function canonical(value: unknown): string {
  // stable key order, so the signer and the checker hash the same text
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

export async function sign(priv: string, value: unknown): Promise<string> {
  const jwk = JSON.parse(dec.decode(unb64u(priv)));
  const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return b64u(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(canonical(value))));
}

export async function verify(pub: string, value: unknown, sig: string): Promise<boolean> {
  try {
    const key = await subtle.importKey("raw", unb64u(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(sig), enc.encode(canonical(value)));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ device key
export async function newDeviceKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) as Promise<CryptoKey>;
}

export async function sealLocal(key: CryptoKey, value: unknown): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return { iv, data: await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))) };
}

export async function openLocal<T>(key: CryptoKey, box: { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }): Promise<T> {
  return JSON.parse(dec.decode(await subtle.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.data))) as T;
}
