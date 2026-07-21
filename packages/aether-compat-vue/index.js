/**
 * aether-compat-vue — Vue / Pinia surface for Aether migrate.
 */

export function ref(init) {
  return { value: init };
}

export function computed(fn) {
  return {
    get value() {
      return fn();
    },
  };
}

export function reactive(obj) {
  return obj;
}

export function defineComponent(opts) {
  return opts;
}

export function createApp(_root) {
  return {
    use() {
      return this;
    },
    mount() {
      return this;
    },
  };
}

export function defineStore(id, options) {
  const stateInit =
    typeof options === "function"
      ? options()
      : typeof options?.state === "function"
        ? options.state()
        : { ...(options?.state || {}) };
  const actions = options?.actions || {};
  const store = { $id: id, ...stateInit };
  store.$patch = (partial) => {
    Object.assign(store, partial || {});
    const rt = globalThis.__AETHER__;
    if (!rt?.applyHostDelta || !rt.program?.slots) return;
    for (const [key, value] of Object.entries(partial || {})) {
      const s = rt.program.slots.find((x) => x.name === key);
      if (!s) continue;
      const sid = typeof s.id === "number" ? s.id : s.id?.["0"] ?? -1;
      if (sid >= 0) rt.applyHostDelta(sid, Number(value) | 0);
    }
  };
  for (const [name, fn] of Object.entries(actions)) {
    store[name] = (...args) => fn.apply(store, args);
  }
  const useStore = () => store;
  return useStore;
}

export function createPinia() {
  return { install() {} };
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

export default {
  ref,
  computed,
  reactive,
  defineComponent,
  createApp,
  defineStore,
  createPinia,
  storeToRefs,
};
