/**
 * aether-compat-react — React / Preact API surface for Aether apps.
 * useState / hooks drive local cells; compile-time JSX still lowers to Wasm IR.
 */

function flatten(children, into) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) flatten(c, into);
    else if (typeof c === "string" || typeof c === "number")
      into.push(document.createTextNode(String(c)));
    else into.push(c);
  }
}

export function createElement(type, props, ...children) {
  if (typeof type === "function") {
    return type({ ...(props || {}), children });
  }
  if (type === Fragment) {
    const frag = document.createDocumentFragment();
    const nodes = [];
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
      Object.assign(el.style, val);
      continue;
    }
    if (key.startsWith("on") && typeof val === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), val);
      continue;
    }
    if (key.startsWith("on") && typeof val === "string") {
      const ev = key.slice(2).toLowerCase();
      el.setAttribute(`data-ae-${ev}`, val);
      continue;
    }
    el.setAttribute(key, String(val));
  }
  const nodes = [];
  if (p.children) flatten([p.children], nodes);
  flatten(children, nodes);
  nodes.forEach((n) => el.appendChild(n));
  return el;
}

export function Fragment(props) {
  const frag = document.createDocumentFragment();
  const nodes = [];
  flatten([props?.children], nodes);
  nodes.forEach((n) => frag.appendChild(n));
  return frag;
}

let hookCursor = 0;
const hookStates = [];
let rerender = null;

export function useState(init) {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = init;
  const set = (v) => {
    hookStates[i] = typeof v === "function" ? v(hookStates[i]) : v;
    rerender?.();
  };
  return [hookStates[i], set];
}

export function useRef(init) {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = { current: init };
  return hookStates[i];
}

export function useMemo(fn, _deps) {
  const i = hookCursor++;
  if (hookStates[i] === undefined) hookStates[i] = fn();
  return hookStates[i];
}

export function useCallback(fn, _deps) {
  return useMemo(() => fn, _deps);
}

export function useEffect(fn, _deps) {
  queueMicrotask(() => {
    fn();
  });
}

export function useLayoutEffect(fn, deps) {
  useEffect(fn, deps);
}

export function useReducer(reducer, init) {
  const [state, setState] = useState(init);
  return [state, (a) => setState((s) => reducer(s, a))];
}

export function createContext(defaultValue) {
  const ctx = {
    _value: defaultValue,
    Provider(p) {
      ctx._value = p.value;
      const frag = document.createDocumentFragment();
      const nodes = [];
      flatten([p.children], nodes);
      nodes.forEach((n) => frag.appendChild(n));
      return frag;
    },
  };
  return ctx;
}

export function useContext(ctx) {
  return ctx._value;
}

export const Children = {
  map(children, fn) {
    return (Array.isArray(children) ? children : [children]).map(fn);
  },
  toArray(children) {
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

export function render(node, container) {
  container.replaceChildren(node);
}

export const createRoot = (container) => ({
  render(node) {
    render(node, container);
  },
});

export function __setRerender(fn) {
  rerender = () => {
    hookCursor = 0;
    fn();
  };
}
