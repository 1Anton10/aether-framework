/**
 * aether-compat-svelte — Svelte / store surface for Aether.
 */

export function writable(init) {
  let value = init;
  const subs = new Set();
  return {
    subscribe(fn) {
      subs.add(fn);
      fn(value);
      return () => subs.delete(fn);
    },
    set(v) {
      value = v;
      subs.forEach((fn) => fn(value));
      const rt = globalThis.__AETHER__;
      // Best-effort: if a single known slot matches, skip (bindings drive Wasm).
      void rt;
    },
    update(fn) {
      this.set(fn(value));
    },
  };
}

export function readable(init, start) {
  const w = writable(init);
  start?.((v) => w.set(v));
  return { subscribe: w.subscribe.bind(w) };
}

export function derived(stores, fn) {
  const list = Array.isArray(stores) ? stores : [stores];
  const w = writable(undefined);
  const values = list.map(() => undefined);
  list.forEach((s, i) => {
    s.subscribe((v) => {
      values[i] = v;
      w.set(fn(Array.isArray(stores) ? values : values[0]));
    });
  });
  return { subscribe: w.subscribe.bind(w) };
}

export function get(store) {
  let v;
  store.subscribe((x) => {
    v = x;
  })();
  return v;
}

export function onMount(fn) {
  queueMicrotask(() => fn());
}

export function onDestroy(_fn) {}

export default { writable, readable, derived, get, onMount, onDestroy };
