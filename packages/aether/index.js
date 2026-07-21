/**
 * Aether meta package
 *
 *   import 'aether'
 *   import { renderToString } from 'aether/ssr'
 *   import { createRouter } from 'aether/router'
 *   import { defineStore } from 'aether/store'
 */
console.info(
  "[aether] Frontend Runtime Standard v1.0 — aether/ssr · aether/router · aether/store · CLI"
);
export const version = "1.0.0";
export { defineStore, createPinia, storeToRefs } from "./store.js";
