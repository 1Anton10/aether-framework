/**
 * Aether Bridge — compatibility shim for React.createElement style packages.
 * Maps createElement trees onto real DOM (mount path), not React fiber.
 */

type Child = Node | string | number | null | undefined | boolean | Child[];

function flatten(children: Child[], into: Node[]) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) flatten(c, into);
    else if (typeof c === "string" || typeof c === "number") {
      into.push(document.createTextNode(String(c)));
    } else {
      into.push(c as Node);
    }
  }
}

export function createElement(
  type: string | ((props: any) => Node),
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
    for (const n of nodes) frag.appendChild(n);
    return frag;
  }

  const el = document.createElement(type);
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
      const ev = key.slice(2).toLowerCase();
      el.addEventListener(ev, val as EventListener);
      continue;
    }
    if (key.startsWith("on") && typeof val === "string") {
      // Aether handler name → data-ae-* for sterile runtime
      const ev = key.slice(2).toLowerCase();
      el.setAttribute(`data-ae-${ev}`, val);
      if (String(val).startsWith("server_")) el.setAttribute("data-ae-server", "1");
      if (String(val).startsWith("perform_")) el.setAttribute("data-ae-effect", "1");
      continue;
    }
    el.setAttribute(key, String(val));
  }

  const nodes: Node[] = [];
  if (p.children) flatten([p.children], nodes);
  flatten(children, nodes);
  for (const n of nodes) el.appendChild(n);
  return el;
}

export function Fragment(props: { children?: Child }) {
  const frag = document.createDocumentFragment();
  const nodes: Node[] = [];
  flatten([props?.children], nodes);
  for (const n of nodes) frag.appendChild(n);
  return frag;
}

export const React = { createElement, Fragment };

export function render(node: Node, container: Element) {
  container.replaceChildren(node);
}

declare global {
  interface Window {
    AetherBridge?: typeof React;
  }
}

if (typeof window !== "undefined") {
  window.AetherBridge = React;
}
