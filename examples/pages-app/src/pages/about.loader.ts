/** Data loader for /about — runs on server before SSR. */
export async function load() {
  return { title: "About Aether", ts: Date.now() };
}
