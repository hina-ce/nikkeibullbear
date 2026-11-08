import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");

function worker() {
  const scope = "https://example.com/bull43/";
  const events = new Map();
  const deleted = [];
  const added = [];
  const cache = {
    addAll: async (requests) => { added.push(...requests); },
    match: async (url) => new Response(`cached:${url}`),
  };
  const self = {
    registration: { scope },
    addEventListener: (name, listener) => events.set(name, listener),
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(source, {
    self, URL, Request, Response, fetch: () => { throw new Error("unexpected network"); },
    caches: {
      open: async () => cache,
      keys: async () => [`bull43:${scope}:dev-v1`, `bull43:${scope}:old`, "unrelated-cache", "bull43:https://example.com/other/:old"],
      delete: async (key) => { deleted.push(key); },
    },
  });
  return { scope, events, deleted, added };
}

test("all precached assets stay under the repository subdirectory", async () => {
  const { events, added, scope } = worker();
  let completion;
  events.get("install")({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.equal(added.length, 8);
  assert.ok(added.every((request) => request.url.startsWith(scope)));
  assert.ok(added.some((request) => request.url.endsWith("nav.mjs")));
});

test("offline directory and index navigations return the cached app shell", async () => {
  const { events, scope } = worker();
  for (const path of ["", "index.html", "?from=homescreen"]) {
    let response;
    events.get("fetch")({ request: { method: "GET", mode: "navigate", url: scope + path }, respondWith: (value) => { response = value; } });
    assert.equal(await (await response).text(), `cached:${scope}index.html`);
  }
});

test("NAV requests and other sites are never served from an old static cache", () => {
  const { events, scope } = worker();
  for (const url of [scope + "data/nav.json", "https://example.com/other/app.js", "https://other.com/bull43/app.js"]) {
    let intercepted = false;
    events.get("fetch")({ request: { method: "GET", mode: "cors", url }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});

test("activation only deletes this app's old releases", async () => {
  const { events, deleted, scope } = worker();
  let completion;
  events.get("activate")({ waitUntil: (promise) => { completion = promise; } });
  await completion;
  assert.deepEqual(deleted, [`bull43:${scope}:old`]);
});
