import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { FUND_ID, SOURCE_URL } from "../nav.mjs";

const data = {
  fundId: FUND_ID, sourceUrl: SOURCE_URL,
  prices: [
    { date: "2026-10-29", nav: 85183 }, { date: "2026-10-30", nav: 78134 },
    { date: "2026-11-02", nav: 76928 }, { date: "2026-11-04", nav: 72705 },
    { date: "2026-11-05", nav: 65130 }, { date: "2026-11-06", nav: 48950 },
  ],
};
const storageKey = `bull43:${new URL("../data/nav.json", import.meta.url).pathname}`;
const indexStorageKey = `bull43:${new URL("../data/nikkei.json", import.meta.url).pathname}`;
const indexData = () => ({
  symbol: "^N225", sourceUrl: "https://finance.yahoo.com/quote/%5EN225/", currency: "JPY", delayMinutes: null,
  fetchedAt: "2026-11-09T02:05:00Z",
  quote: { date: "2026-11-09", asOf: "2026-11-09T02:00:00Z", price: 79, previousClose: 80, isClose: false },
  closes: [{ date: "2026-11-04", close: 100 }, { date: "2026-11-05", close: 90 }, { date: "2026-11-06", close: 80 }],
});
let importId = 0;

class Element {
  children = [];
  attributes = {};
  listeners = new Map();
  hidden = false;
  _text = "";
  constructor(tag = "div") { this.tag = tag; }
  get textContent() { return this._text + this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  set textContent(text) { this._text = String(text); this.children = []; }
  append(...children) { this.children.push(...children.flatMap((child) => child?.tag === "fragment" ? child.children : [child])); }
  replaceChildren(...children) { this._text = ""; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

async function withBrowser(options, check) {
  const keys = ["window", "document", "navigator", "localStorage", "fetch", "Date", "setInterval"];
  const previous = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const originalWarn = console.warn;
  const NativeDate = Date;
  let now = options.now ?? "2026-11-08T03:00:00Z";
  const elements = new Map();
  const intervals = [];
  const listeners = new Map();
  const storage = new Map(options.saved ? [[storageKey, JSON.stringify(options.saved)]] : []);
  if (options.savedIndex) storage.set(indexStorageKey, JSON.stringify(options.savedIndex));
  const calls = [];
  const document = {
    visibilityState: "visible",
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element("fragment"),
    addEventListener: (name, callback) => listeners.set(`document:${name}`, callback),
  };
  const values = {
    window: { addEventListener: (name, callback) => listeners.set(name, callback), location: { reload() {} } },
    document,
    navigator: { onLine: !options.offline },
    localStorage: {
      getItem(key) { if (options.blockStorage) throw new Error("blocked"); return storage.get(key) ?? null; },
      setItem(key, value) { if (options.blockStorage) throw new Error("blocked"); storage.set(key, value); },
    },
    fetch: async (...args) => {
      calls.push(args);
      if (args[0].pathname.endsWith("nikkei.json")) {
        if (options.failIndex || options.fail) throw new Error("index unavailable");
        return { ok: true, json: async () => options.indexPayload ?? indexData() };
      }
      if (options.reply) return options.reply(...args);
      if (options.fail) throw new Error("network unavailable");
      return { ok: true, json: async () => options.payload ?? data };
    },
    Date: class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } },
    setInterval: (callback) => { intervals.push(callback); return 0; },
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  console.warn = () => {};
  const load = () => import(`${new URL("../app.js", import.meta.url).href}?test=${++importId}`);
  try {
    await check({ load, elements, listeners, storage, calls, document, intervals, setNow: (value) => { now = value; } });
  } finally {
    console.warn = originalWarn;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("loading state, actual rendered rows, and reload fetching published JSON", () => withBrowser({}, async ({ load, elements, storage, calls }) => {
  await load();
  assert.equal(elements.get("latest-nav").textContent, "48,950");
  assert.match(elements.get("latest-change").textContent, /-16,180円 \(-24\.84%\)/);
  assert.equal(elements.get("history-rows").children.length, 5);
  assert.match(elements.get("history-rows").children.at(-1).textContent, /-7,049円/);
  assert.match(elements.get("publication-notice").textContent, /本日分の公表データなし/);
  assert.equal(elements.get("reload").disabled, false);
  assert.equal(elements.get("quote").attributes["aria-busy"], "false");
  assert.ok(storage.has(storageKey));
  await elements.get("reload").listeners.get("click")();
  assert.equal(calls.filter(([url]) => url.pathname.endsWith("nav.json")).length, 2);
  assert.ok(calls.every(([, options]) => options.cache === "no-store"));
}));

test("loading state is visible until a pending fetch completes", async () => {
  let resolve;
  await withBrowser({ reply: () => new Promise((done) => { resolve = done; }) }, async ({ load, elements }) => {
    const loading = load();
    for (let attempt = 0; attempt < 20 && !resolve; attempt++) await setImmediate();
    assert.equal(elements.get("reload").disabled, true);
    assert.equal(elements.get("loading-notice").hidden, false);
    resolve({ ok: true, json: async () => data });
    await loading;
    assert.equal(elements.get("loading-notice").hidden, true);
  });
});

test("offline snapshot still renders prices with an explicit saved-data message", () => withBrowser({ saved: data, offline: true, fail: true }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("latest-nav").textContent, "48,950");
  assert.match(elements.get("connection-notice").textContent, /オフライン.*保存済み/);
}));

test("first load failure has no invented prices and leaves reload available", () => withBrowser({ fail: true }, async ({ load, elements }) => {
  await load();
  assert.match(elements.get("history-rows").textContent, /表示できる価格データがありません/);
  assert.match(elements.get("connection-notice").textContent, /通信環境/);
  assert.equal(elements.get("reload").disabled, false);
}));

test("invalid JSON or a stale CDN publication cannot overwrite a valid snapshot", async () => {
  for (const payload of [{}, { ...data, prices: data.prices.slice(0, -1) }]) {
    await withBrowser({ saved: data, payload }, async ({ load, elements, storage }) => {
      await load();
      assert.equal(elements.get("latest-nav").textContent, "48,950");
      assert.match(elements.get("connection-notice").textContent, /保存済み/);
      assert.deepEqual(JSON.parse(storage.get(storageKey)), data);
    });
  }
});

test("blocked storage preserves normal online use and explains the offline limit", () => withBrowser({ blockStorage: true }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("latest-nav").textContent, "48,950");
  assert.match(elements.get("connection-notice").textContent, /保存できません/);
}));

test("a visible app switches its period after Japanese Monday midnight", () => withBrowser({}, async ({ load, elements, intervals, setNow }) => {
  await load();
  assert.equal(elements.get("history-rows").children.length, 5);
  setNow("2026-11-08T15:00:00Z");
  intervals[0]();
  assert.equal(elements.get("history-rows").children.length, 1);
  assert.match(elements.get("period").textContent, /11\/6 〜 11\/9/);
}));

test("matching index declines get the prominent condition card", () => withBrowser({ now: "2026-11-09T02:06:00Z" }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("signal-title").textContent, "条件一致");
  assert.equal(elements.get("signal").className, "signal signal-match");
  assert.equal(elements.get("nikkei-price").textContent, "79.00");
  assert.match(elements.get("nikkei-change").textContent, /-1\.00円 \(-1\.25%\)/);
  assert.match(elements.get("friday-condition").textContent, /11\/6.*-10\.00円/);
  assert.match(elements.get("nikkei-delay").textContent, /遅延あり/);
  assert.match(elements.get("nikkei-asof").textContent, /11:00/);
}));

test("offline events immediately clear the highlight even when the quote is otherwise fresh", () => withBrowser({ now: "2026-11-09T02:06:00Z" }, async ({ load, elements, listeners }) => {
  await load();
  listeners.get("offline")();
  assert.equal(elements.get("signal-title").textContent, "判定保留");
  assert.equal(elements.get("signal").className, "signal");
}));

test("index errors are independent of fund loading and saved quotes cannot highlight", () => withBrowser({ now: "2026-11-09T02:06:00Z", failIndex: true, savedIndex: indexData() }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("latest-nav").textContent, "48,950");
  assert.equal(elements.get("nikkei-price").textContent, "79.00");
  assert.equal(elements.get("signal-title").textContent, "判定保留");
  assert.match(elements.get("nikkei-notice").textContent, /保存済み/);
}));

test("an intraday highlight expires without requiring a reload", () => withBrowser({ now: "2026-11-09T02:06:00Z" }, async ({ load, elements, intervals, setNow }) => {
  await load();
  setNow("2026-11-09T02:21:00Z");
  intervals[0]();
  assert.equal(elements.get("signal-title").textContent, "判定保留");
  assert.equal(elements.get("signal").className, "signal");
}));

test("an upward index leaves the condition card unhighlighted", () => {
  const indexPayload = indexData();
  indexPayload.quote.price = 81;
  return withBrowser({ now: "2026-11-09T02:06:00Z", indexPayload }, async ({ load, elements }) => {
    await load();
    assert.equal(elements.get("signal-title").textContent, "条件未一致");
    assert.equal(elements.get("signal").className, "signal");
  });
});
