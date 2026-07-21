/**
 * Lightweight client router — history API + Link helpers.
 * Use for multi-view apps alongside Aether Wasm pages / static routes.
 */

export type RouteHandler = (params: Record<string, string>, path: string) => void;

export type RouteDef = {
  path: string; // "/about" or "/users/:id"
  handler: RouteHandler;
};

function match(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean);
  const ss = path.split("/").filter(Boolean);
  if (pp.length !== ss.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(ss[i]);
    else if (pp[i] !== ss[i]) return null;
  }
  return params;
}

export function createRouter(routes: RouteDef[]) {
  let current = location.pathname;

  const resolve = (path: string) => {
    const clean = path.split("?")[0] || "/";
    for (const r of routes) {
      const params = match(r.path, clean);
      if (params) {
        current = clean;
        r.handler(params, clean);
        return true;
      }
    }
    return false;
  };

  const onPop = () => resolve(location.pathname);
  window.addEventListener("popstate", onPop);

  return {
    get path() {
      return current;
    },
    start() {
      resolve(location.pathname);
    },
    navigate(to: string, replace = false) {
      if (replace) history.replaceState({}, "", to);
      else history.pushState({}, "", to);
      resolve(to.split("?")[0] || "/");
    },
    destroy() {
      window.removeEventListener("popstate", onPop);
    },
  };
}

/** Declarative link: intercept clicks for SPA navigation. */
export function bindLinks(root: ParentNode, navigate: (to: string) => void) {
  root.addEventListener("click", (ev) => {
    const t = ev.target as Element | null;
    const a = t?.closest?.("a[data-aether-link], a[href^='/']");
    if (!a || !(a instanceof HTMLAnchorElement)) return;
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("//")) return;
    ev.preventDefault();
    navigate(href);
  });
}

declare global {
  interface Window {
    AetherRouter?: ReturnType<typeof createRouter>;
  }
}
