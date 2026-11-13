// Updated by the packaging script whenever an app-shell asset changes.
const RELEASE = "dev-v1";
const CACHE_PREFIX = `bull43:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;
const CORE_ASSETS = [
  "./index.html", "./styles.css", "./app.js", "./nav.mjs", "./holdings.mjs", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];
const assetURLs = new Set(CORE_ASSETS.map((path) => new URL(path, self.registration.scope).href));
const indexURL = new URL("./index.html", self.registration.scope).href;
const rootURL = new URL("./", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map((path) => new Request(new URL(path, self.registration.scope), { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  url.search = "";
  const href = url.href;
  // Price JSON always goes to the network. The app owns its last-good fallback.
  if (!assetURLs.has(href) && !(request.mode === "navigate" && href === rootURL)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(href === rootURL ? indexURL : href);
    return cached || fetch(request);
  })());
});
