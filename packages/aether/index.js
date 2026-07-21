/**
 * aether-std — Aether Frontend Runtime Standard meta package
 *
 *   import 'aether-std'
 *   import { renderToString } from 'aether-std/ssr'
 *   import { createRouter } from 'aether-std/router'
 *   import { defineStore } from 'aether-std/store'
 */
console.info(
  "[aether-std] Frontend Runtime Standard v1.0 — aether-std/ssr · /router · /store · CLI"
);
export const version = "1.0.0";
export { defineStore, createPinia, storeToRefs } from "./store.js";
