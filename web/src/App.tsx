import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SafeEntry } from "./engine/types.ts";
import { api, type Health } from "./lib/api.ts";
import { applyOwn, newId, parseInvite, pull, send, type InviteRole, type Message } from "./lib/circle.ts";
import { EMPTY, load, save, type AppState, type Person, type Profile } from "./lib/state.ts";
import { t as translate, type Key } from "./i18n.ts";
import { Avatar, Icon, Toast } from "./ui.tsx";
import { Join, Setup, Welcome } from "./screens/Onboarding.tsx";
import { Home } from "./screens/Home.tsx";
import { Scan } from "./screens/Scan.tsx";
import { Result } from "./screens/Result.tsx";
import { ChooseAllergies, Family, InviteModal, MemberEdit } from "./screens/Family.tsx";
import { SafeList } from "./screens/SafeList.tsx";
import { Care, type CareTab } from "./screens/Care.tsx";
import { RequestScreen } from "./screens/Request.tsx";
import { Privacy } from "./screens/Privacy.tsx";
import { Menu } from "./screens/Menu.tsx";

export type Route =
  | { name: "welcome" }
  | { name: "setup" }
  | { name: "join"; invite?: string }
  | { name: "home" }
  | { name: "scan"; barcode?: string }
  | { name: "result"; id: string }
  | { name: "family" }
  | { name: "member"; id: string }
  | { name: "choose" }
  | { name: "safe" }
  | { name: "care"; tab: CareTab; id?: string }
  | { name: "request"; id: string }
  | { name: "privacy" }
  | { name: "menu"; id?: string };

export interface Ctx {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  go: (r: Route, replace?: boolean) => void;
  back: () => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  toast: (text: string) => void;
  /** Send to the family and apply here at once. */
  share: (msg: Message) => Promise<void>;
  /** A parent publishes the family's profiles (signed, versioned). */
  publishProfiles: (members: Profile[], safe?: SafeEntry[], family?: string) => Promise<void>;
  /** Show the invite QR: for a child's own phone (their profile), or for a grandparent. */
  invite: (role: InviteRole, child?: Profile) => void;
  isParent: boolean;
  me: Person | null;
  health: Health | null;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [toastText, setToast] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [inviting, setInviting] = useState<{ role: InviteRole; child?: Profile } | null>(null);
  const stateRef = useRef<AppState>(EMPTY);

  // load, then decide the first screen (an invite in the link wins)
  useEffect(() => {
    load().then((s) => {
      stateRef.current = s;
      setState(s);
      const inv = location.hash.includes("join=") ? location.hash : null;
      const first: Route = inv ? { name: "join", invite: inv } : s.me ? { name: "home" } : { name: "welcome" };
      if (inv) history.replaceState(null, "", location.pathname);
      history.replaceState(first, "");
      setRoute(first);
    });
    api.health().then(setHealth).catch(() => setHealth(null));
    const onPop = (e: PopStateEvent) => setRoute((e.state as Route) ?? { name: "home" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // applied at once to the latest state, so a message sent right after an update sees it
  const update = useCallback((fn: (s: AppState) => AppState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
    save(next);
  }, []);

  const go = useCallback((r: Route, replace = false) => {
    if (replace) history.replaceState(r, "");
    else history.pushState(r, "");
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);
  const back = useCallback(() => history.back(), []);

  const lang = state?.lang ?? "en";
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar" ? "وقاية · عائلتكم أكثر أمانًا" : "Wiqaya · Your family, a little safer";
  }, [lang]);

  const t = useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const share = useCallback(async (msg: Message) => {
    const s = stateRef.current;
    if (!s.circle) return;
    const next = await applyOwn(s, msg);
    update(() => next);
    try {
      await send(s.circle, msg);
    } catch {
      setToast(translate(s.lang, "offline"));
    }
  }, [update]);

  const publishProfiles = useCallback(async (members: Profile[], safe?: SafeEntry[], family?: string) => {
    const s = stateRef.current;
    const keep = (safe ?? s.safe).filter((e) => members.some((m) => m.id === e.member_id));
    await share({ t: "profiles", id: newId(), v: s.profilesVersion + 1, members, safe: keep, family: family ?? s.familyName });
  }, [share]);

  // the family's messages: every 4 s while the app is open
  useEffect(() => {
    if (!state?.circle) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const before = stateRef.current;
        const { state: next, notices } = await pull(before);
        // the state changed while the messages were on their way (a scan or menu came back): applying them now
        // would undo that change. Leave it; the next tick fetches the same messages again from the old cursor.
        if (stateRef.current !== before) return;
        if (next !== before) {
          // someone new joined: a parent's phone re-sends the profiles so they have them
          const newcomer = next.people.length > before.people.length;
          update(() => next);
          if (newcomer && next.me?.role === "parent" && next.circle?.parentPriv && !next.choices.length) {
            await send(next.circle, { t: "profiles", id: newId(), v: next.profilesVersion, members: next.members, safe: next.safe, family: next.familyName });
          }
          // a child chose their allergies: the parent's phone adds them to the profile (it never removes any) and
          // publishes it signed; the parent can still change it
          if (next.me?.role === "parent" && next.circle?.parentPriv && next.choices.length) {
            const members = next.members.map((m) => {
              const c = next.choices.find((x) => x.member_id === m.id);
              if (!c) return m;
              return { ...m, avoid: [...new Set([...m.avoid, ...c.avoid])], diets: [...new Set([...m.diets, ...c.diets])], celiac: m.celiac || c.celiac, childAt: c.at };
            });
            stateRef.current = { ...stateRef.current, choices: [] };
            await publishProfiles(members);
          }
        }
        if (notices.length) setToast(notices.map(([k, ...v]) => translate(next.lang, k as Key, Object.fromEntries(pairs(v)))).join(" · "));
      } catch {
        /* offline: try again on the next tick */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [state?.circle?.id, update, publishProfiles]);

  const ctx = useMemo<Ctx | null>(
    () =>
      state && {
        state,
        update,
        go,
        back,
        t,
        toast: setToast,
        share,
        publishProfiles,
        invite: (role: InviteRole, child?: Profile) => setInviting({ role, child }),
        isParent: state.me?.role === "parent",
        me: state.me,
        health,
      },
    [state, update, go, back, t, share, publishProfiles, health],
  );

  if (!ctx) return null;
  const onboarding = !ctx.me || route.name === "welcome" || route.name === "setup" || route.name === "join";
  return (
    <AppCtx.Provider value={ctx}>
      {onboarding ? (
        <div className="shell bare">
          <header className="topbar">
            <Logo />
            <div className="top-actions">
              <LangToggle />
            </div>
          </header>
          <main className="main">
            <Screen route={route} />
            <Footer />
          </main>
        </div>
      ) : (
        <>
          <Sidebar route={route} />
          <div className="shell">
            <TopBar route={route} />
            <main className="main" id="main">
              <Screen route={route} />
              <Footer />
            </main>
          </div>
          <MobileNav route={route} />
        </>
      )}
      {inviting && <InviteModal role={inviting.role} child={inviting.child} onClose={() => setInviting(null)} />}
      {toastText && <Toast text={toastText} onDone={() => setToast(null)} />}
    </AppCtx.Provider>
  );
}

function pairs(v: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
  return out;
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "welcome":
      return <Welcome />;
    case "setup":
      return <Setup />;
    case "join":
      return <Join invite={route.invite ? parseInvite(route.invite) : null} />;
    case "home":
      return <Home />;
    case "scan":
      return <Scan barcode={route.barcode} />;
    case "result":
      return <Result id={route.id} />;
    case "family":
      return <Family />;
    case "member":
      return <MemberEdit id={route.id} />;
    case "choose":
      return <ChooseAllergies />;
    case "safe":
      return <SafeList />;
    case "care":
      return <Care tab={route.tab} id={route.id} />;
    case "request":
      return <RequestScreen id={route.id} />;
    case "privacy":
      return <Privacy />;
    case "menu":
      return <Menu id={route.id} />;
  }
}

// ------------------------------------------------------------------------------------------------ the shell
type NavItem = { route: Route; icon: string; label: Key; short: Key; match: Route["name"][]; mobile?: false };
// "Tell the cook" is the care screen's cook tab; emergency and child mode have no tab of their own
const active = (n: NavItem, r: Route) => n.match.includes(r.name) && (r.name !== "care" || r.tab === "cook");
const NAV: NavItem[] = [
  { route: { name: "home" }, icon: "home", label: "navHome", short: "navHome", match: ["home", "result", "request"] },
  { route: { name: "scan" }, icon: "scan", label: "navScan", short: "navScanShort", match: ["scan"] },
  { route: { name: "family" }, icon: "family", label: "navFamily", short: "navFamilyShort", match: ["family", "member", "choose"] },
  { route: { name: "safe" }, icon: "list", label: "navSafe", short: "navSafe", match: ["safe"] },
  { route: { name: "menu" }, icon: "menu", label: "navMenu", short: "navMenuShort", match: ["menu"] },
  // on a phone the cook card is reached from the menu result and the overview
  { route: { name: "care", tab: "cook" }, icon: "cook", label: "navCook", short: "navCookShort", match: ["care"], mobile: false },
];

/** On a child's phone, the family page is their own allergies. */
function navLabel(n: NavItem, short: boolean, me: Person | null): Key {
  if (n.route.name === "family" && me?.role === "child") return "navMine";
  return short ? n.short : n.label;
}

function Logo() {
  const { go, me } = useApp();
  return (
    <button className="logo" onClick={() => go({ name: me ? "home" : "welcome" })} aria-label="Wiqaya, وقاية">
      <span className="logo-mark">
        <Icon name="shield" />
      </span>
      wiqaya <small lang="ar">وقاية</small>
    </button>
  );
}

function LangToggle() {
  const { state, update } = useApp();
  const ar = state.lang === "ar";
  return (
    <button className="language" onClick={() => update((s) => ({ ...s, lang: ar ? "en" : "ar" }))} aria-label={ar ? "English" : "العربية"}>
      {ar ? <span>EN</span> : <b>EN</b>}
      <span className="sep" aria-hidden="true">|</span>
      {ar ? <b lang="ar">عربي</b> : <span lang="ar">عربي</span>}
    </button>
  );
}

function Sidebar({ route }: { route: Route }) {
  const { t, go, state, me } = useApp();
  return (
    <aside className="sidebar">
      <Logo />
      <div className="tagline">{t("brandTagline")}</div>
      <div className="nav-label">{t("navLabel")}</div>
      <nav className="nav" aria-label={t("navLabel")}>
        {NAV.map((n) => (
          <button key={n.label} className={active(n, route) ? "active" : ""} aria-current={active(n, route) ? "page" : undefined} onClick={() => go(n.route)}>
            <Icon name={n.icon} />
            {t(navLabel(n, false, me))}
            {n.route.name === "family" && state.members.length > 0 && <span className="count">{state.members.length}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="circle-mini" onClick={() => go({ name: "family" })}>
          <div className="circle-name">
            <span className="dot" />
            {state.familyName ? t("circleOf", { name: state.familyName }) : t("circleDefault")}
          </div>
          <div className="mini-avatars">
            {state.members.slice(0, 5).map((m, i) => (
              <Avatar key={m.id} name={m.name} emoji={m.avatar} i={i} />
            ))}
          </div>
          <small>{t("circleTogether")}</small>
        </button>
        <button className="sidebar-foot" onClick={() => go({ name: "privacy" })}>
          <Icon name="lock" /> {t("privacyData")}
        </button>
      </div>
    </aside>
  );
}

function TopBar({ route }: { route: Route }) {
  const { t, go, me } = useApp();
  const current = NAV.find((n) => active(n, route));
  const page = route.name === "care" ? t(route.tab === "emergency" ? "tabEmergency" : "tabCook") : route.name === "privacy" ? t("privacyData") : current && route.name !== "home" ? t(current.label) : null;
  return (
    <header className="topbar">
      <div className="crumb">
        <Icon name="home" />
        <span className="sep">/</span>
        <span>{t("crumbRoot")}</span>
        {page && (
          <>
            <span className="sep">/</span>
            <span>{page}</span>
          </>
        )}
      </div>
      <div className="mobile-logo">
        <Logo />
      </div>
      <div className="top-actions">
        <LangToggle />
        <button className="emergency-top" onClick={() => go({ name: "care", tab: "emergency" })}>
          <Icon name="heart" />
          {t("emergency")}
        </button>
        {me && (
          <button className="me" onClick={() => go({ name: "privacy" })} aria-label={`${me.name} · ${t("privacyData")}`}>
            <Avatar name={me.name} i={2} />
          </button>
        )}
      </div>
    </header>
  );
}

function MobileNav({ route }: { route: Route }) {
  const { t, go, me } = useApp();
  return (
    <nav className="mobile-nav" aria-label={t("navLabel")}>
      {NAV.filter((n) => n.mobile !== false).map((n) => (
        <button key={n.label} className={active(n, route) ? "active" : ""} aria-current={active(n, route) ? "page" : undefined} onClick={() => go(n.route, true)}>
          <Icon name={n.icon} />
          {t(navLabel(n, true, me))}
        </button>
      ))}
    </nav>
  );
}

function Footer() {
  const { t, health } = useApp();
  const g = health?.gemma;
  return (
    <footer className="bottom-note">
      <span>
        <Icon name="lock" /> {t("footPrivacy")}
      </span>
      <span>
        {t("footCare")} <span className="teal">♡</span>
      </span>
      <span className="gemma-line">
        <span className={`dot ${g?.available ? "" : "off"}`} />
        {g?.available ? t("footGemma", { model: g.model }) : t("footGemmaDown")}
      </span>
    </footer>
  );
}
