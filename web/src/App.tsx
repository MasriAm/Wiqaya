import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type Health } from "./lib/api.ts";
import { applyOwn, newId, parseInvite, pull, send, type Message } from "./lib/circle.ts";
import { EMPTY, load, save, type AppState, type Person } from "./lib/state.ts";
import { t as translate, type Key } from "./i18n.ts";
import { Icon, Toast } from "./ui.tsx";
import { Join, Setup, Welcome } from "./screens/Onboarding.tsx";
import { Home } from "./screens/Home.tsx";
import { Scan } from "./screens/Scan.tsx";
import { Result } from "./screens/Result.tsx";
import { CookCard, Family, InviteScreen, MemberEdit } from "./screens/Family.tsx";
import { RequestScreen } from "./screens/Request.tsx";
import { Emergency } from "./screens/Emergency.tsx";
import { Settings } from "./screens/Settings.tsx";

export type Route =
  | { name: "welcome" }
  | { name: "setup" }
  | { name: "join"; invite?: string }
  | { name: "home" }
  | { name: "scan"; barcode?: string }
  | { name: "result"; id: string }
  | { name: "family" }
  | { name: "member"; id: string }
  | { name: "invite"; role: "parent" | "caregiver" }
  | { name: "cook"; id: string }
  | { name: "request"; id: string }
  | { name: "emergency"; id?: string }
  | { name: "settings" };

export interface Ctx {
  state: AppState;
  update: (fn: (s: AppState) => AppState) => void;
  go: (r: Route, replace?: boolean) => void;
  back: () => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  toast: (text: string) => void;
  /** Send to the family and apply here at once. */
  share: (msg: Message) => Promise<void>;
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
    document.title = lang === "ar" ? "وقاية" : "Wiqaya";
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

  // the family's messages: every 4 s while the app is open
  useEffect(() => {
    if (!state?.circle) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const before = stateRef.current;
        const { state: next, notices } = await pull(before);
        if (next !== before) {
          // someone new joined: a parent's phone re-sends the profiles so they have them
          const newcomer = next.people.length > before.people.length;
          update(() => next);
          if (newcomer && next.me?.role === "parent" && next.circle?.parentPriv) {
            await send(next.circle, { t: "profiles", id: newId(), v: next.profilesVersion, members: next.members, safe: next.safe });
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
  }, [state?.circle?.id, update]);

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
        isParent: state.me?.role === "parent",
        me: state.me,
        health,
      },
    [state, update, go, back, t, share, health],
  );

  if (!ctx) return null;
  const tabs = ["home", "family", "settings"].includes(route.name) || route.name === "scan";
  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <Screen route={route} />
        {tabs && ctx.me && <Nav route={route} />}
        {toastText && <Toast text={toastText} onDone={() => setToast(null)} />}
      </div>
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
    case "invite":
      return <InviteScreen role={route.role} />;
    case "cook":
      return <CookCard id={route.id} />;
    case "request":
      return <RequestScreen id={route.id} />;
    case "emergency":
      return <Emergency id={route.id} />;
    case "settings":
      return <Settings />;
  }
}

function Nav({ route }: { route: Route }) {
  const { go, t } = useApp();
  const tab = (name: "home" | "family" | "settings", icon: string, label: string) => (
    <button onClick={() => go({ name } as Route, true)} aria-current={route.name === name ? "page" : undefined}>
      <Icon name={icon} />
      {label}
    </button>
  );
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {tab("home", "home", t("home"))}
        <button className="scan-tab" onClick={() => go({ name: "scan" })} aria-current={route.name === "scan" ? "page" : undefined}>
          <span className="disc">
            <Icon name="scan" />
          </span>
          {t("scanShort")}
        </button>
        {tab("family", "family", t("family"))}
      </div>
    </nav>
  );
}
