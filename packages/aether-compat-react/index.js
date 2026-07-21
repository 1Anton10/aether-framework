/**
 * aether-compat-react — React / Preact API surface for Aether apps.
 * useState / hooks drive local cells; compile-time JSX still lowers to Wasm IR.
 */

type Child = Node | string | number | null | undefined | boolean | Child[];

function flatten(children: Child[], into: Node[]) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) flatten(c, into);
    else if (typeof c === "string" || typeof c === "number")
      into.push(document.createTextNode(String(c)));
    else into.push(c as Node);
  }
}

export function createElement(
  type: any,
  props: Record<string, any> | null,
  ...children: Child[]
): Node {
  if (typeof type === "function") {
    return type({ ...(props || {}), children });
  }
  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    const nodes: Node[] = [];
    flatten(children, nodes);
    nodes.forEach((n) => frag.appendChild(n));
    return frag;
  }
  const el = document.createElement(String(type));
  const p = props || {};
  for (const [key, val] of Object.entries(p)) {
    if (key === "children" || val == null || val === false) continue;
    if (key === "className") {
      el.setAttribute("class", String(val));
      continue;
    }
    if (key === "style" && typeof val === "object") {
      Object.assign((el as HTMLElement).style, val);
      continue;
    }
    if (key.startsWith("on") && typeof val === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), val as EventListener);
      continue;
    }
    if (key.startsWith("on") && typeof val === "string") {
      const ev = key.slice(2).toLowerCase();
      el.setAttribute(`data-ae-${ev}`, val);
      continue;
    }
    el.setAttribute(key, String(val));
  }
  const nodes: Node[] = [];
  if (p.children) flatten([p.children], nodes);
  flatten(children, nodes);
  nodes.forEach((n) => el.appendChild(n));
  return el;
}

export function Fragment(props: { children?: Child }) {
  const frag = document.createDocumentFragment();
  const nodes: Node[] = [];
  flatten([props?.children], nodes);
  nodes.forEach((n) => frag.appendChild(n));
  return frag;
}

let hookCursor = 0;
const hookStates: any[] = [];
let rerender: (() => void) | null = null;

export function useState<T>(init: T): [T, (v: T | ((p: T) => T)) => void] {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = init;
  const set = (v: T | ((p: T) => T)) => {
    hookStates[i] = typeof v === "function" ? (v as any)(hookStates[i]) : v;
    rerender?.();
  };
  return [hookStates[i], set];
}

export function useRef<T>(init: T): { current: T } {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = { current: init };
  return hookStates[i];
}

export function useMemo<T>(fn: () => T, _deps?: any[]): T {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = fn();
  return hookStates[i];
}

export function useCallback<T extends (...args: any[]) => any>(fn: T, _deps?: any[]): T {
  return useMemo(() => fn, _deps);
}

export function useEffect(fn: () => void | (() => void), _deps?: any[]) {
  queueMicrotask(() => {
    fn();
  });
}

export function useLayoutEffect(fn: () => void | (() => void), deps?: any[]) {
  useEffect(fn, deps);
}

export function useReducer<S, A>(
  reducer: (s: S, a: A) => S,
  init: S
): [S, (a: A) => void] {
  const [state, setState] = useState(init);
  return [state, (a: A) => setState((s) => reducer(s, a))];
}

type Ctx<T> = { _value: T; Provider: (p: { value: T; children?: Child }) => Node };
export function createContext<T>(defaultValue: T): Ctx<T> {
  const ctx: Ctx<T> = {
    _value: defaultValue,
    Provider(p) {
      ctx._value = p.value;
      const frag = document.createDocumentFragment();
      const nodes: Node[] = [];
      flatten([p.children], nodes);
      nodes.forEach((n) => frag.appendChild(n));
      return frag;
    },
  };
  return ctx;
}

export function useContext<T>(ctx: Ctx<T>): T {
  return ctx._value;
}

export const Children = {
  map(children: any, fn: (c: any, i: number) => any) {
    return (Array.isArray(children) ? children : [children]).map(fn);
  },
  toArray(children: any) {
    return Array.isArray(children) ? children : children == null ? [] : [children];
  },
};

export default {
  createElement,
  Fragment,
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  createContext,
  useContext,
  Children,
};

export function render(node: Node, container: Element) {
  container.replaceChildren(node);
}

export const createRoot = (container: Element) => ({
  render(node: Node) {
    render(node, container);
  },
});

export function __setRerender(fn: () => void) {
  rerender = () => {
    hookCursor = 0;
    fn();
  };
}
