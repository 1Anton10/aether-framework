/**
 * Universal Aether adapter — any frontend that can emit a template / JSX-like tree
 * registers via defineFrontend(). Compile-time parsers in aether_compiler consume the same IR.
 */
export type FrontendKind =
  | "jsx"
  | "vue"
  | "svelte"
  | "html"
  | "angular"
  | "solid"
  | "qwik"
  | "lit"
  | "preact"
  | "generic";

export type FrontendAdapter = {
  name: FrontendKind | string;
  /** Extensions this adapter claims */
  extensions: string[];
  /** Optional: normalize source to JSX-ish before compile */
  toJsxish?: (source: string) => string;
};

const registry = new Map<string, FrontendAdapter>();

export function defineFrontend(adapter: FrontendAdapter) {
  registry.set(adapter.name, adapter);
  for (const ext of adapter.extensions) {
    registry.set(`ext:${ext.replace(/^\./, "")}`, adapter);
  }
  return adapter;
}

export function resolveFrontend(nameOrExt: string): FrontendAdapter | undefined {
  return registry.get(nameOrExt) || registry.get(`ext:${nameOrExt.replace(/^\./, "")}`);
}

export function listFrontends(): FrontendAdapter[] {
  return [...new Set(registry.values())];
}

// Built-in registrations (mirrors Rust parsers)
defineFrontend({ name: "jsx", extensions: ["tsx", "jsx", "ts", "js"] });
defineFrontend({ name: "vue", extensions: ["vue"] });
defineFrontend({ name: "svelte", extensions: ["svelte"] });
defineFrontend({ name: "html", extensions: ["html", "htm"] });
defineFrontend({ name: "angular", extensions: ["component.html"] });
defineFrontend({ name: "solid", extensions: ["solid.tsx"] });
defineFrontend({ name: "qwik", extensions: ["qwik.tsx"] });
defineFrontend({ name: "lit", extensions: ["lit.ts"] });
defineFrontend({ name: "preact", extensions: ["preact.tsx"] });
defineFrontend({ name: "generic", extensions: [] });

export default { defineFrontend, resolveFrontend, listFrontends };
