/** Qwik-shaped shim — component$ trees lower via JSX parser. */
export function component$(fn) {
  return fn;
}
export function useSignal(init) {
  return { value: init };
}
export default { component$, useSignal };
