/** Vue-shaped shim — compile-time path uses .vue → IR; this is for import aliases. */
export function ref(v) {
  return { value: v };
}
export function computed(fn) {
  return { get value() { return fn(); } };
}
export function defineComponent(opts) {
  return opts;
}
export default { ref, computed, defineComponent };
