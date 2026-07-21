/** Solid-shaped shim — signals compile to Aether slots at build time. */
export function createSignal(init) {
  let v = init;
  const read = () => v;
  const write = (n) => {
    v = typeof n === "function" ? n(v) : n;
  };
  return [read, write];
}
export function createEffect(fn) {
  queueMicrotask(fn);
}
export default { createSignal, createEffect };
