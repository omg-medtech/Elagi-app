/* Elagi service worker — offline app shell. Bump VERSION to force an update. */
const VERSION = "elagi-v10";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";
const PRECACHE = ["./", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-48.png"];
const LIBS = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0", "https://unpkg.com/@supabase/supabase-js@2"];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";
const CACHEABLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL), rt = await caches.open(RUNTIME);
    await Promise.all(PRECACHE.map(u => shell.add(u).catch(() => {})));
    await Promise.all(LIBS.map(u => fetch(u, { mode: "no-cors" }).then(r => rt.put(u, r)).catch(() => {})));
    try { // fonts: cache the CSS and every font file it points to
      const css = await fetch(FONT_CSS, { mode: "cors" });
      const text = await css.clone().text();
      await rt.put(FONT_CSS, css);
      const urls = [...new Set([...text.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, "")))];
      await Promise.all(urls.map(u => fetch(u, { mode: "cors" }).then(r => rt.put(u, r)).catch(() => {})));
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

const timeout = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error("timeout")), ms); p.then(v => { clearTimeout(t); ok(v) }, v => { clearTimeout(t); no(v) }) });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept Supabase (auth + data) or other APIs: data must always be live.
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return;

  // Page loads: show the cached app instantly, refresh it in the background (the new version is used next time).
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const shell = await caches.open(SHELL);
      const hit = (await shell.match("./")) || (await shell.match(req, { ignoreSearch: true }));
      const net = fetch(req).then(res => {
        if (res && res.ok && url.origin === location.origin) shell.put("./", res.clone());
        return res;
      }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    })());
    return;
  }

  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return;

  // Static files + CDN libs + fonts: cache first, refresh in the background.
  e.respondWith((async () => {
    const cache = await caches.open(sameOrigin ? SHELL : RUNTIME);
    const hit = await cache.match(req, { ignoreSearch: sameOrigin });
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});

/* ---- Web Push: show reminders even when the app is closed ---- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "عِلاجي";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/favicon-48.png",
    tag: d.tag || "elagi-reminder", renotify: true, requireInteraction: true, silent: false,
    vibrate: [400, 150, 400, 150, 600], timestamp: Date.now(), dir: d.dir || "auto", lang: d.lang || "ar",
    actions: [{ action: "listen", title: "🔊 استمع" }, { action: "open", title: "فتح التطبيق" }],
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const base = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope);
  base.searchParams.set("speak", "1");
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: "speak" }); return; } }
    await clients.openWindow(base.href);
  })());
});
