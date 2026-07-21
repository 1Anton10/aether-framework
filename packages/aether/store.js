/**
 * Aether store — Pinia-shaped API backed by Wasm slots (not a JS proxy store).
 *
 * defineStore("cart", { state: () => ({ count: 0 }), actions: { inc() { this.count++ } } })
 * Writers call into the live AetherRuntime via window.__AETHER__ when mounted.
 */

const registry = new Map();

function getRuntime() {
  return typeof globalThis !== "undefined" ? globalThis.__AETHER__ : null;
}

function slotIdByName(name) {
  const rt = getRuntime();
  const prog = rt?.program;
  if (!prog?.slots) return -1;
  const s = prog.slots.find((x) => x.name === name);
  if (!s) return -1;
  return typeof s.id === "number" ? s.id : s.id?.["0"] ?? -1;
}

export function defineStore(id, options) {
  if (registry.has(id)) return registry.get(id);

  const stateInit =
    typeof options === "function"
      ? options()
      : typeof options?.state === "function"
        ? options.state()
        : { ...(options?.state || {}) };

  const actions = options?.actions || {};
  const getters = options?.getters || {};

  const store = {
    $id: id,
    ...stateInit,
    $patch(partial) {
      const rt = getRuntime();
      for (const [key, value] of Object.entries(partial || {})) {
        store[key] = value;
        const sid = slotIdByName(key);
        if (rt?.applyHostDelta && sid >= 0) {
          rt.applyHostDelta(sid, Number(value) | 0);
        }
      }
    },
    $reset() {
      store.$patch(stateInit);
    },
  };

  for (const [name, fn] of Object.entries(actions)) {
    store[name] = function (...args) {
      return fn.apply(store, args);
    };
  }

  for (const [name, fn] of Object.entries(getters)) {
    Object.defineProperty(store, name, {
      get() {
        return fn.call(store, store);
      },
      enumerable: true,
    });
  }

  const useStore = () => store;
  useStore.$id = id;
  registry.set(id, useStore);
  return useStore;
}

export function createPinia() {
  return {
    install() {
      /* no-op — Aether runtime owns memory */
    },
  };
}

export function getActivePinia() {
  return createPinia();
}

export function storeToRefs(store) {
  const refs = {};
  for (const key of Object.keys(store)) {
    if (key.startsWith("$") || typeof store[key] === "function") continue;
    refs[key] = {
      get value() {
        return store[key];
      },
      set value(v) {
        store.$patch({ [key]: v });
      },
    };
  }
  return refs;
}
