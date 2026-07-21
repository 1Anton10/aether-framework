/**
 * Aether SSR — render AetherProgram JSON to HTML strings or streams.
 */

export type Id = { "0"?: number } | number;

export type SlotKind = "I32" | "F64" | "Bytes";

export type Binding =
  | { Static: string }
  | { Reactive: string }
  | { Expression: string };

export type ControlFlow =
  | "None"
  | { Condition: string }
  | { Loop: [string, string] };

export type EventHandler = { Local: string } | { Server: string };

export type NodeType =
  | {
      Element: {
        tag: string;
        props?: Record<string, Binding>;
        events?: Record<string, EventHandler>;
      };
    }
  | { Text: Binding }
  | {
      Component: {
        name: string;
        props?: Record<string, Binding>;
      };
    };

export interface AetherNode {
  id: Id;
  node_type: NodeType;
  control_flow?: ControlFlow;
  children?: Id[];
}

export interface Slot {
  id: Id;
  name: string;
  kind?: SlotKind;
  offset?: number;
}

export type ReactiveEdge =
  | { SlotToText: { slot: Id; node: Id } }
  | { SlotToAttr: { slot: Id; node: Id; attr: string } };

export type EffectOp =
  | { LocalMutate: { slot: Id; delta: number } }
  | { ServerMutate: { slot: Id; action: string; delta: number } }
  | { Perform: { effect: string; resume_slot: Id } };

export interface AetherProgram {
  root: Id;
  nodes: AetherNode[];
  slots: Slot[];
  edges?: ReactiveEdge[];
  subscribers?: number[][];
  propagates_to?: number[][];
  derived?: Array<{
    target: Id;
    sources: Id[];
    op: { Copy?: null; Mul?: number; Add?: number } | string;
  }>;
  effects?: Record<string, EffectOp>;
  memory_bytes?: number;
  memory_pages?: number;
  wasm_gc?: boolean;
  frontends?: string[];
  memory_model?: string;
}

export type SlotValues = Record<string, number | string>;

function nid(id: Id | undefined): number {
  if (id === undefined) return 0;
  return typeof id === "number" ? id : id["0"] ?? 0;
}

/** Escape text content for HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape attribute values for HTML. */
export function escapeAttr(text: string): string {
  return escapeHtml(text);
}

function resolveBinding(
  binding: Binding | undefined,
  program: AetherProgram,
  slotValues: SlotValues
): string {
  if (!binding) return "";
  if ("Static" in binding) return String(binding.Static ?? "");
  if ("Reactive" in binding) {
    const name = binding.Reactive;
    if (name in slotValues) return String(slotValues[name]);
    const slot = program.slots.find((s) => s.name === name);
    if (slot && slot.name in slotValues) return String(slotValues[slot.name]);
    return "";
  }
  if ("Expression" in binding) {
    const expr = binding.Expression;
    if (expr in slotValues) return String(slotValues[expr]);
    return expr;
  }
  return "";
}

function renderAttrs(
  props: Record<string, Binding> | undefined,
  program: AetherProgram,
  slotValues: SlotValues
): string {
  if (!props) return "";
  let out = "";
  for (const [key, binding] of Object.entries(props)) {
    const value = resolveBinding(binding, program, slotValues);
    if (value !== "") out += ` ${key}="${escapeAttr(value)}"`;
  }
  return out;
}

function renderEventAttrs(
  events: Record<string, EventHandler> | undefined,
  effects: Record<string, EffectOp> | undefined
): string {
  if (!events) return "";
  let out = "";
  for (const [ev, handler] of Object.entries(events)) {
    const name = "Local" in handler ? handler.Local : handler.Server;
    out += ` data-ae-${ev}="${escapeAttr(name)}"`;
    if ("Server" in handler) out += ` data-ae-server="1"`;
    const op = effects?.[name];
    if (op && "Perform" in op) out += ` data-ae-effect="1"`;
  }
  return out;
}

function renderNode(
  program: AetherProgram,
  slotValues: SlotValues,
  nodeId: number
): string {
  const node = program.nodes[nodeId];
  if (!node) return "";

  const nt = node.node_type;

  if ("Text" in nt) {
    const text = resolveBinding(nt.Text, program, slotValues);
    // Wrap reactive text so hydration can attach handles
    if ("Reactive" in nt.Text) {
      return `<span data-aether-nid="${nodeId}">${escapeHtml(text)}</span>`;
    }
    return escapeHtml(text);
  }

  if ("Element" in nt) {
    const { tag, props, events } = nt.Element;
    const tagName = String(tag).toLowerCase();
    const attrs =
      ` data-aether-nid="${nodeId}"` +
      renderAttrs(props, program, slotValues) +
      renderEventAttrs(events, program.effects);
    const children = node.children ?? [];
    if (children.length === 0) {
      return `<${tagName}${attrs}></${tagName}>`;
    }
    let inner = "";
    for (const childId of children) {
      inner += renderNode(program, slotValues, nid(childId));
    }
    return `<${tagName}${attrs}>${inner}</${tagName}>`;
  }

  if ("Component" in nt) {
    const { name, props } = nt.Component;
    const attrs =
      ` data-aether-component="${escapeAttr(name)}"` +
      renderAttrs(props, program, slotValues);
    let inner = "";
    for (const childId of node.children ?? []) {
      inner += renderNode(program, slotValues, nid(childId));
    }
    if (inner) return `<div${attrs}>${inner}</div>`;
    return `<div${attrs}></div>`;
  }

  return "";
}

/**
 * Render an Aether program root subtree to an HTML fragment (no document shell).
 */
export function renderToString(
  program: AetherProgram,
  slotValues: SlotValues = {}
): string {
  return renderNode(program, slotValues, nid(program.root));
}

/**
 * Stream a full HTML document: doctype, head placeholder, body with SSR markup.
 */
export async function* renderToStream(
  program: AetherProgram,
  slotValues: SlotValues = {}
): AsyncGenerator<string> {
  yield "<!DOCTYPE html>\n";
  yield '<html lang="en">\n';
  yield "<head>\n";
  yield '<meta charset="utf-8" />\n';
  yield "<title>Aether</title>\n";
  yield "<!-- aether-head -->\n";
  yield "</head>\n";
  yield "<body>\n";
  yield '<div id="root">';
  yield renderToString(program, slotValues);
  yield "</div>\n";
  yield "</body>\n";
  yield "</html>\n";
}
