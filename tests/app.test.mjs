import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { readFile } from "node:fs/promises";
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
const holdingsKey = `bull43:holdings:${new URL("../", import.meta.url).pathname}`;
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const elementIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
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
  value = "";
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
  const elements = new Map(elementIds.map((id) => [id, new Element()]));
  const intervals = [];
  const listeners = new Map();
  const storage = new Map(options.saved ? [[storageKey, JSON.stringify(options.saved)]] : []);
  if (options.savedIndex) storage.set(indexStorageKey, JSON.stringify(options.savedIndex));
  if (options.savedHolding) storage.set(holdingsKey, JSON.stringify(options.savedHolding));
  const calls = [];
  const document = {
    visibilityState: "visible",
    getElementById(id) { return elements.get(id) ?? null; },
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

test("the index shows only the prior confirmed session and its daily change", () => withBrowser({ now: "2026-11-09T02:06:00Z" }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("nikkei-price").textContent, "80.00");
  assert.match(elements.get("nikkei-date").textContent, /2026\/11\/6/);
  assert.match(elements.get("nikkei-change").textContent, /-10\.00円 \(-11\.11%\)/);
}));

test("index errors are independent of fund loading and preserve saved closes", () => withBrowser({ now: "2026-11-09T02:06:00Z", failIndex: true, savedIndex: indexData() }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("latest-nav").textContent, "48,950");
  assert.equal(elements.get("nikkei-price").textContent, "80.00");
  assert.match(elements.get("nikkei-notice").textContent, /保存済み/);
}));

test("a confirmed same-day close appears only after Japanese midnight without a reload", () => {
  const indexPayload = indexData();
  indexPayload.quote.isClose = true;
  indexPayload.quote.asOf = "2026-11-09T06:45:00Z";
  indexPayload.fetchedAt = "2026-11-09T06:50:00Z";
  indexPayload.closes.push({ date: "2026-11-09", close: 79 });
  return withBrowser({ now: "2026-11-09T14:59:59Z", indexPayload }, async ({ load, elements, intervals, setNow }) => {
    await load();
    assert.equal(elements.get("nikkei-price").textContent, "80.00");
    setNow("2026-11-09T15:00:00Z");
    intervals[0]();
    assert.equal(elements.get("nikkei-price").textContent, "79.00");
  });
});

test("holdings can be entered, saved and valued without changing price caches", () => withBrowser({}, async ({ load, elements, storage }) => {
  await load();
  assert.equal(elements.get("holding-profit").textContent, "—");
  elements.get("units-input").value = "100000";
  elements.get("average-input").value = "45000";
  elements.get("holdings-form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(elements.get("holding-units").textContent, "100,000口");
  assert.equal(elements.get("holding-average").textContent, "45,000円");
  assert.equal(elements.get("holding-cost").textContent, "450,000円");
  assert.equal(elements.get("holding-value").textContent, "489,500円");
  assert.equal(elements.get("holding-profit").textContent, "+39,500円");
  assert.equal(elements.get("holding-rate").textContent, "+8.78%");
  assert.equal(elements.get("holdings-editor").open, false);
  assert.match(elements.get("holding-basis").textContent, /2026\/11\/06/);
  assert.deepEqual(JSON.parse(storage.get(holdingsKey)), {
    version: 2, initial: { units: 100000, averageCost: 45000, date: "2026-11-08" }, transactions: [],
  });
  assert.deepEqual(JSON.parse(storage.get(storageKey)), data);
}));

test("saved holdings restore inputs and show losses after reopening", () => withBrowser({ savedHolding: { units: 100000, averageCost: 50000 } }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("units-input").value, "100000");
  assert.equal(elements.get("average-input").value, "50000");
  assert.equal(elements.get("holding-profit").textContent, "-10,500円");
  assert.equal(elements.get("holding-profit").className, "change negative");
}));

test("invalid edits preserve saved holdings and the previous calculation", () => withBrowser({ savedHolding: { units: 100000, averageCost: 45000 } }, async ({ load, elements, storage }) => {
  await load();
  elements.get("units-input").value = "1.5";
  elements.get("holdings-form").listeners.get("submit")({ preventDefault() {} });
  assert.match(elements.get("holding-status").textContent, /整数/);
  assert.equal(elements.get("holding-profit").textContent, "+39,500円");
  assert.equal(JSON.parse(storage.get(holdingsKey)).units, 100000);
}));

test("storage failure still calculates holdings and explains that the edit is unsaved", () => withBrowser({ blockStorage: true }, async ({ load, elements }) => {
  await load();
  elements.get("units-input").value = "10000";
  elements.get("average-input").value = "45000";
  elements.get("holdings-form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(elements.get("holding-profit").textContent, "+3,950円");
  assert.match(elements.get("holding-status").textContent, /保存できません/);
}));

test("saved holdings without available NAV never show an invented profit", () => withBrowser({ savedHolding: { units: 10000, averageCost: 45000 }, fail: true }, async ({ load, elements }) => {
  await load();
  assert.equal(elements.get("holding-units").textContent, "10,000口");
  assert.equal(elements.get("holding-profit").textContent, "—");
  assert.match(elements.get("holding-basis").textContent, /基準価額を取得/);
}));

const tradeData = {
  fundId: FUND_ID, sourceUrl: SOURCE_URL,
  prices: [{ date: "2026-11-04", nav: 10000 }, { date: "2026-11-05", nav: 15000 }, { date: "2026-11-06", nav: 16000 }],
};
const initialPosition = { units: 10000, averageCost: 10000 };
const click = (elements, id) => elements.get(id).listeners.get("click")();

test("repeated 1,000-yen clicks and an amount step record cash flows, then cancel and undo", () => withBrowser({ savedHolding: initialPosition, payload: tradeData }, async ({ load, elements, storage }) => {
  await load();
  elements.get("trade-date").value = "2026-11-04";
  assert.equal(elements.get("invest-button").textContent, "1,000円を投資");
  click(elements, "invest-button");
  click(elements, "invest-button");
  assert.equal(elements.get("total-invested").textContent, "12,000円");
  elements.get("trade-date").value = "2026-11-05";
  click(elements, "amount-increase");
  click(elements, "amount-increase");
  assert.equal(elements.get("withdraw-button").textContent, "3,000円を回収");
  click(elements, "withdraw-button");
  assert.equal(elements.get("holding-units").textContent, "10,000口");
  assert.equal(elements.get("total-withdrawn").textContent, "3,000円");
  assert.equal(elements.get("holding-profit").textContent, "+6,000円");
  assert.equal(elements.get("total-profit").textContent, "+7,000円");
  assert.equal(JSON.parse(storage.get(holdingsKey)).transactions.length, 3);
  const latestRow = elements.get("transaction-rows").children[0];
  latestRow.children[1].listeners.get("click")();
  assert.equal(elements.get("total-withdrawn").textContent, "0円");
  assert.equal(elements.get("undo-transaction").hidden, false);
  click(elements, "undo-transaction");
  assert.equal(elements.get("total-withdrawn").textContent, "3,000円");
  assert.equal(elements.get("total-profit").textContent, "+7,000円");
}));

test("a manual unit correction preserves cumulative cash and survives restoration", async () => {
  let savedHolding;
  await withBrowser({ savedHolding: initialPosition, payload: tradeData }, async ({ load, elements, storage }) => {
    await load();
    elements.get("correction-date").value = "2026-11-06";
    elements.get("correction-units").value = "10001";
    elements.get("correction-form").listeners.get("submit")({ preventDefault() {} });
    assert.equal(elements.get("holding-units").textContent, "10,001口");
    assert.equal(elements.get("total-invested").textContent, "10,000円");
    assert.equal(elements.get("total-withdrawn").textContent, "0円");
    assert.equal(elements.get("total-profit").textContent, "+6,002円");
    savedHolding = JSON.parse(storage.get(holdingsKey));
  });
  await withBrowser({ savedHolding, payload: tradeData }, async ({ load, elements }) => {
    await load();
    assert.equal(elements.get("holding-units").textContent, "10,001口");
    assert.equal(elements.get("transaction-rows").children.length, 1);
    assert.equal(elements.get("units-input").value, "10000");
  });
});

test("pending trades count cash immediately and acquire units only at the exact execution-day NAV", async () => {
  let payload = tradeData;
  await withBrowser({ savedHolding: initialPosition, now: "2026-11-09T03:00:00Z", reply: async () => ({ ok: true, json: async () => payload }) }, async ({ load, elements }) => {
    await load();
    click(elements, "invest-button");
    assert.equal(elements.get("total-invested").textContent, "11,000円");
    assert.equal(elements.get("holding-value").textContent, "—");
    assert.match(elements.get("holding-basis").textContent, /基準価額待ち/);
    payload = { ...tradeData, prices: [...tradeData.prices, { date: "2026-11-09", nav: 20000 }] };
    await click(elements, "reload");
    assert.equal(elements.get("holding-units").textContent, "10,500口");
    assert.equal(elements.get("holding-value").textContent, "21,000円");
    assert.equal(elements.get("total-profit").textContent, "+10,000円");
  });
});

test("invalid amounts, invalid dates and excess withdrawals never change saved records", () => withBrowser({ savedHolding: initialPosition, payload: tradeData }, async ({ load, elements, storage }) => {
  await load();
  const original = storage.get(holdingsKey);
  elements.get("trade-date").value = "2026-11-04";
  elements.get("trade-amount").value = "1500";
  click(elements, "invest-button");
  assert.match(elements.get("holding-status").textContent, /1,000円単位/);
  elements.get("trade-amount").value = "1000";
  elements.get("trade-date").value = "2026-02-30";
  click(elements, "invest-button");
  assert.match(elements.get("holding-status").textContent, /有効な日付/);
  elements.get("trade-date").value = "2026-11-04";
  elements.get("trade-amount").value = "11000";
  click(elements, "withdraw-button");
  assert.match(elements.get("holding-status").textContent, /保有分を超え/);
  assert.equal(storage.get(holdingsKey), original);
  assert.equal(elements.get("total-invested").textContent, "10,000円");
}));

test("editing the initial position retains previously recorded investment history", () => withBrowser({ savedHolding: initialPosition, payload: tradeData }, async ({ load, elements, storage }) => {
  await load();
  elements.get("trade-date").value = "2026-11-04";
  click(elements, "invest-button");
  elements.get("units-input").value = "20000";
  elements.get("holdings-form").listeners.get("submit")({ preventDefault() {} });
  assert.equal(JSON.parse(storage.get(holdingsKey)).transactions.length, 1);
  assert.equal(elements.get("total-invested").textContent, "21,000円");
  assert.equal(elements.get("holding-units").textContent, "21,000口");
}));
