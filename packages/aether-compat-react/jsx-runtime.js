import { createElement, Fragment } from "./index.js";

export function jsx(type, props, key) {
  const { children, ...rest } = props || {};
  const p = { ...rest };
  if (key != null) p.key = key;
  const kids = children == null ? [] : Array.isArray(children) ? children : [children];
  return createElement(type, p, ...kids);
}

export const jsxs = jsx;
export { Fragment };
