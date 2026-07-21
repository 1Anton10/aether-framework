/** Lit-shaped shim — html`...` templates compile via lit parser. */
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s + (i < values.length ? String(values[i]) : "");
  });
  return out;
}
export function css(strings, ...values) {
  return html(strings, ...values);
}
export class LitElement extends HTMLElement {}
export default { html, css, LitElement };
