// The app's state, and how it is saved: encrypted with a device key, in IndexedDB.
import type { Level, Member, MemberVerdict, ProductFacts, SafeEntry } from "../engine/types.ts";
import { newDeviceKey, openLocal, sealLocal } from "./crypto.ts";

export type Lang = "en" | "ar";
export type Role = "parent" | "caregiver";

export interface Contact {
  name: string;
  phone: string;
}

/** A family member, plus what the emergency card shows. */
export interface Profile extends Member {
  emergency: { plan: string; meds: string; contacts: Contact[]; epi_expiry: string };
}

export interface Person {
  id: string;
  name: string;
  role: Role;
}

export interface Circle {
  id: string;
  key: string;
  parentPub: string;
  /** Only on parents' phones. */
  parentPriv?: string;
}

export interface ScanRecord {
  id: string;
  at: number;
  by: Person;
  facts: ProductFacts;
  verdicts: MemberVerdict[];
  /** A small photo of the label, kept on the phone (and sent to the family with a question). */
  thumb?: string;
  /** Gemma has looked up the ingredients no list knew. */
  researched?: boolean;
}

export interface AskRequest {
  id: string;
  at: number;
  from: Person;
  scan: ScanRecord;
  status: "waiting" | "approved" | "refused";
  answeredBy?: string;
  note?: string;
  member_ids: string[];
}

export interface FeedItem {
  id: string;
  at: number;
  by: Person;
  name: string | null;
  levels: Record<string, Level>;
}

export interface AppState {
  lang: Lang;
  me: Person | null;
  circle: Circle | null;
  members: Profile[];
  profilesVersion: number;
  people: Person[];
  scans: ScanRecord[];
  feed: FeedItem[];
  safe: SafeEntry[];
  requests: AskRequest[];
  cursor: number;
  seen: string[];
}

export const EMPTY: AppState = {
  lang: navigatorLang(),
  me: null,
  circle: null,
  members: [],
  profilesVersion: 0,
  people: [],
  scans: [],
  feed: [],
  safe: [],
  requests: [],
  cursor: 0,
  seen: [],
};

function navigatorLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
  } catch {
    return "en";
  }
}

// ------------------------------------------------------------------------------------------------ IndexedDB
const DB = "wiqaya";
const STORE = "kv";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deviceKey(): Promise<CryptoKey> {
  let k = await get<CryptoKey>("device-key");
  if (!k) {
    k = await newDeviceKey();
    await put("device-key", k);
  }
  return k;
}

export async function load(): Promise<AppState> {
  try {
    const box = await get<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }>("state");
    if (!box) return EMPTY;
    return { ...EMPTY, ...(await openLocal<AppState>(await deviceKey(), box)) };
  } catch {
    return EMPTY;
  }
}

let saving: Promise<void> = Promise.resolve();
export function save(state: AppState): Promise<void> {
  // keep the newest 60 scans and 40 feed items on the phone
  const trimmed = { ...state, scans: state.scans.slice(0, 60), feed: state.feed.slice(0, 40), seen: state.seen.slice(-400) };
  saving = saving.then(async () => put("state", await sealLocal(await deviceKey(), trimmed))).catch(() => undefined);
  return saving;
}

export async function wipe(): Promise<void> {
  const d = await db();
  d.close();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

export function blankProfile(id: string): Profile {
  return { id, name: "", avoid: [], diets: [], traces: "avoid", emergency: { plan: "", meds: "", contacts: [], epi_expiry: "" } };
}
