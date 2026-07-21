/**
 * Ambient types for Aether JSX apps (compiled by aether-compile, not React).
 */
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown> | null | undefined;
  }
  type Element = unknown;
  interface ElementClass {
    render?: () => unknown;
  }
  interface ElementAttributesProperty {
    props: unknown;
  }
  interface ElementChildrenAttribute {
    children: unknown;
  }
}

declare const cart: number;
declare const total: number;
declare const points: number;
declare const catalog: number;
declare const pingMs: number;
declare const items: number;

declare function add_item(): void;
declare function remove_item(): void;
declare function clear_cart(): void;
declare function sync_cart(): void;
declare function load_catalog(): void;
declare function measure_ping(): void;
declare const showPanel: number;
declare function toggle_panel(): void;
declare function add_row(): void;
declare function remove_row(): void;
