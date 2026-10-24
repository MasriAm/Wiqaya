// The app's state, and how it is saved: encrypted with a device key, in IndexedDB.
import type { MenuFacts } from "../engine/menu.ts";
import type { Level, Member, MemberVerdict, ProductFacts, SafeEntry } from "../engine/types.ts";
import { newDeviceKey, openLocal, sealLocal } from "./crypto.ts";

export type Lang = "en" | "ar";
/** The parent owns the family; a child has their own phone and profile; a grandparent scans and asks. */
export type Role = "parent" | "child" | "grandparent";

export interface Contact {
  name: string;
  phone: string;
}

/** A family member, plus what the emergency card shows. */
export interface Profile extends Member {
  /** A face for the profile card (an emoji), chosen by a parent. */
  avatar?: string;
  /** Celiac disease: shown as a condition; it always adds gluten to what is avoided. */
  celiac?: boolean;
  emergency: { plan: string; meds: string; contacts: Contact[]; epi_expiry: string };
  /** When the parent last took in the allergies this child chose on their own phone. */
  childAt?: number;
}

/** Allergies a child chose on their own phone, until a parent's signed profile includes them. */
export interface Choice {
  at: number;
  member_id: string;
  avoid: Profile["avoid"];
  diets: Profile["diets"];
  celiac: boolean;
}

export interface Person {
  id: string;
  name: string;
  role: Role;
  /** A child's own profile. */
  member_id?: string;
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
  /** "The Al-Khatib circle": optional, set by the parent who created the family. */
  familyName: string;
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
  /** On a child's phone: what they chose, used until the parent's profile takes it in. */
  myChoice: Choice | null;
  /** On the parent's phone: children's choices still to take in. */
  choices: (Choice & { from: string })[];
  /** Restaurant menus checked on this phone, newest first. */
  menus: MenuRecord[];
}

export interface MenuRecord {
  id: string;
  at: number;
  /** Where it came from: the link, or the file names. */
  source: string;
  facts: MenuFacts;
}

export const EMPTY: AppState = {
  lang: navigatorLang(),
  familyName: "",
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
  myChoice: null,
  choices: [],
  menus: [],
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
    const s = { ...EMPTY, ...(await openLocal<AppState>(await deviceKey(), box)) };
    // caregivers from before the roles changed are grandparents now
    const role = (p: Person): Person => ((p.role as string) === "caregiver" ? { ...p, role: "grandparent" } : p);
    return { ...s, me: s.me && role(s.me), people: s.people.map(role) };
  } catch {
    return EMPTY;
  }
}

let saving: Promise<void> = Promise.resolve();
export function save(state: AppState): Promise<void> {
  // keep the newest 60 scans and 40 feed items on the phone
  const trimmed = { ...state, scans: state.scans.slice(0, 60), feed: state.feed.slice(0, 40), seen: state.seen.slice(-400), menus: state.menus.slice(0, 8) };
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
  return { id, name: "", avatar: "", avoid: [], diets: [], traces: "avoid", emergency: { plan: "", meds: "", contacts: [], epi_expiry: "" } };
}

/** The profiles this phone checks against: on a child's phone, only their own, with their own choice added in until
 * the parent's profile takes it (a child's choice can only add caution). */
export function checked(state: AppState): Profile[] {
  const me = state.me;
  if (me?.role !== "child") return state.members;
  const c = state.myChoice;
  const mine = state.members.find((m) => m.id === me.member_id) ?? (c ? { ...blankProfile(c.member_id), name: me.name } : null);
  if (!mine) return [];
  if (!c || c.member_id !== mine.id) return [mine];
  const avoid = [...new Set([...mine.avoid, ...c.avoid])];
  return [{ ...mine, avoid, diets: [...new Set([...mine.diets, ...c.diets])], celiac: mine.celiac || c.celiac }];
}
