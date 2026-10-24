// The family circle: encrypted messages through the relay. Profiles, approvals and removals from the safe list
// must carry a parent's signature; anything else from the circle is shown, never trusted to change a profile.
import type { Level, SafeEntry } from "../engine/types.ts";
import { api } from "./api.ts";
import { open, randomId, seal, sign, verify, b64u, unb64u } from "./crypto.ts";
import type { AppState, AskRequest, Circle, Person, Profile, ScanRecord } from "./state.ts";

export type Message =
  | { t: "hello"; id: string; from: Person }
  | { t: "profiles"; id: string; v: number; members: Profile[]; safe: SafeEntry[]; sig?: string }
  | { t: "scan"; id: string; by: Person; at: number; name: string | null; levels: Record<string, Level> }
  | { t: "ask"; id: string; from: Person; at: number; scan: ScanRecord; member_ids: string[] }
  | { t: "answer"; id: string; ask: string; by: string; at: number; decision: "approved" | "refused"; note: string; safe: SafeEntry[]; sig?: string }
  | { t: "unsafe"; id: string; barcode: string; member_id: string; sig?: string };

// ------------------------------------------------------------------------------------------------ invites
export interface Invite {
  c: string;
  k: string;
  p: string;
  r: "parent" | "caregiver";
  s?: string;
}

export function inviteLink(circle: Circle, role: "parent" | "caregiver"): string {
  const inv: Invite = { c: circle.id, k: circle.key, p: circle.parentPub, r: role, ...(role === "parent" ? { s: circle.parentPriv } : {}) };
  const payload = b64u(new TextEncoder().encode(JSON.stringify(inv)));
  // the fragment (#...) never reaches any server
  return `${location.origin}/#join=${payload}`;
}

export function parseInvite(text: string): Invite | null {
  try {
    const m = text.match(/#join=([A-Za-z0-9_-]+)/) ?? text.match(/^([A-Za-z0-9_-]{40,})$/);
    if (!m) return null;
    const inv = JSON.parse(new TextDecoder().decode(unb64u(m[1]))) as Invite;
    if (!inv.c || !inv.k || !inv.p || (inv.r !== "parent" && inv.r !== "caregiver")) return null;
    return inv;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ sending
const unsigned = <T extends { sig?: string }>(m: T): Omit<T, "sig"> => {
  const { sig: _sig, ...rest } = m;
  return rest;
};

export async function send(circle: Circle, msg: Message): Promise<void> {
  let out: Message = msg;
  if ((msg.t === "profiles" || msg.t === "answer" || msg.t === "unsafe") && circle.parentPriv) {
    out = { ...msg, sig: await sign(circle.parentPriv, unsigned(msg)) } as Message;
  }
  await api.post(circle.id, await seal(circle.key, out));
}

export const newId = () => randomId(9);

// ------------------------------------------------------------------------------------------------ receiving
export interface Pulled {
  state: AppState;
  notices: string[][]; // [key, ...vars] for toasts
}

/** Apply a message this phone just sent, without waiting for the relay. */
export async function applyOwn(state: AppState, msg: Message): Promise<AppState> {
  if (!state.circle) return state;
  const signed = (msg.t === "profiles" || msg.t === "answer" || msg.t === "unsafe") && state.circle.parentPriv
    ? ({ ...msg, sig: await sign(state.circle.parentPriv, unsigned(msg)) } as Message)
    : msg;
  return apply({ ...state, seen: [...state.seen, msg.id] }, signed, state.circle, []);
}

export async function pull(state: AppState): Promise<Pulled> {
  const circle = state.circle;
  if (!circle) return { state, notices: [] };
  const { messages } = await api.since(circle.id, state.cursor);
  let s = state;
  const notices: string[][] = [];
  for (const raw of messages) {
    const msg = await open<Message>(circle.key, raw.body);
    s = { ...s, cursor: Math.max(s.cursor, raw.id) };
    if (!msg || s.seen.includes(msg.id)) continue;
    s = { ...s, seen: [...s.seen, msg.id] };
    s = await apply(s, msg, circle, notices);
  }
  return { state: s, notices };
}

async function signedByParent(circle: Circle, msg: Message & { sig?: string }): Promise<boolean> {
  return !!msg.sig && (await verify(circle.parentPub, unsigned(msg), msg.sig));
}

async function apply(s: AppState, msg: Message, circle: Circle, notices: string[][]): Promise<AppState> {
  const mine = (id?: string) => !!s.me && id === s.me.id;
  switch (msg.t) {
    case "hello":
      if (s.people.some((p) => p.id === msg.from.id)) return s;
      return { ...s, people: [...s.people, msg.from] };
    case "profiles":
      if (msg.v <= s.profilesVersion || !(await signedByParent(circle, msg))) return s;
      if (s.profilesVersion > 0) notices.push(["newProfiles"]);
      return { ...s, members: msg.members, safe: msg.safe ?? s.safe, profilesVersion: msg.v };
    case "scan":
      if (mine(msg.by.id) || s.feed.some((f) => f.id === msg.id)) return s;
      return { ...s, feed: [{ id: msg.id, at: msg.at, by: msg.by, name: msg.name, levels: msg.levels }, ...s.feed] };
    case "ask": {
      if (s.requests.some((r) => r.id === msg.id)) return s;
      const req: AskRequest = { id: msg.id, at: msg.at, from: msg.from, scan: msg.scan, status: "waiting", member_ids: msg.member_ids };
      if (!mine(msg.from.id) && s.me?.role === "parent") notices.push(["newRequest", "name", msg.from.name]);
      return { ...s, requests: [req, ...s.requests] };
    }
    case "answer": {
      if (!(await signedByParent(circle, msg))) return s;
      const requests = s.requests.map((r) =>
        r.id === msg.ask && r.status === "waiting" ? { ...r, status: msg.decision, answeredBy: msg.by, note: msg.note } : r,
      );
      const req = s.requests.find((r) => r.id === msg.ask);
      if (req && mine(req.from.id)) notices.push(["newAnswer", "by", msg.by, "product", req.scan.facts.name ?? ""]);
      const safe = [...s.safe.filter((e) => !msg.safe.some((n) => n.barcode === e.barcode && n.member_id === e.member_id)), ...msg.safe];
      return { ...s, requests, safe };
    }
    case "unsafe":
      if (!(await signedByParent(circle, msg))) return s;
      return { ...s, safe: s.safe.filter((e) => !(e.barcode === msg.barcode && e.member_id === msg.member_id)) };
  }
}
