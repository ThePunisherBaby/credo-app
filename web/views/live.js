// views/live.js — Redirects cleanly to Explorar → En Vivo (Radios)
export async function mount({ app }) {
  app.navigate('#/explore?filter=live');
  return { cleanup() {} };
}
