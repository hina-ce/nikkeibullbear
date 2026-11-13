import test from "node:test";
import assert from "node:assert/strict";
import { buildNikkeiView, validateNikkei, NIKKEI_SOURCE } from "../nikkei.mjs";

const indexData = () => ({
  symbol: "^N225", sourceUrl: NIKKEI_SOURCE, currency: "JPY", delayMinutes: null,
  fetchedAt: "2026-11-09T02:05:00Z",
  quote: { date: "2026-11-09", asOf: "2026-11-09T02:00:00Z", price: 79, previousClose: 80, isClose: false },
  closes: [{ date: "2026-11-04", close: 100 }, { date: "2026-11-05", close: 90 }, { date: "2026-11-06", close: 80 }],
});
const at = (now) => ({ now: new Date(now) });

test("Monday shows Friday's confirmed close, using Thursday for its change", () => {
  const view = buildNikkeiView(indexData(), at("2026-11-09T02:06:00Z"));
  assert.deepEqual(view.latest, { date: "2026-11-06", close: 80 });
  assert.equal(view.delta, -10);
  assert.equal(view.rate, -10 / 90 * 100);
});

test("a confirmed same-day close is excluded until Japanese midnight", () => {
  const data = indexData();
  data.quote.asOf = "2026-11-09T06:45:00Z";
  data.fetchedAt = "2026-11-09T06:50:00Z";
  data.quote.isClose = true;
  data.closes.push({ date: "2026-11-09", close: 79 });
  const evening = buildNikkeiView(data, at("2026-11-09T14:59:59Z"));
  assert.equal(evening.latest.date, "2026-11-06");
  assert.equal(evening.delta, -10);
  const nextDay = buildNikkeiView(data, at("2026-11-09T15:00:00Z"));
  assert.equal(nextDay.latest.date, "2026-11-09");
  assert.equal(nextDay.delta, -1);
});

test("weekends, holidays, and year boundaries select the latest actual prior session", () => {
  const data = indexData();
  data.closes = [{ date: "2026-12-28", close: 100 }, { date: "2026-12-29", close: 90 }, { date: "2026-12-30", close: 95 }];
  data.quote = { date: "2026-12-30", asOf: "2026-12-30T06:45:00Z", price: 95, previousClose: 90, isClose: true };
  data.fetchedAt = "2026-12-30T07:00:00Z";
  for (const now of ["2026-12-31T02:00:00Z", "2027-01-01T02:00:00Z", "2027-01-03T02:00:00Z"]) {
    const view = buildNikkeiView(data, at(now));
    assert.equal(view.latest.date, "2026-12-30");
    assert.equal(view.delta, 5);
  }
});

test("a single prior close has no invented change and no prior closes has no price", () => {
  const data = indexData();
  const one = buildNikkeiView(data, at("2026-11-05T02:00:00Z"));
  assert.equal(one.latest.date, "2026-11-04");
  assert.equal(one.delta, null);
  assert.equal(one.rate, null);
  assert.equal(buildNikkeiView(data, at("2026-11-04T02:00:00Z")).latest, null);
});

test("wrong instruments, mismatched prior closes, bad dates and partial closes are rejected", () => {
  for (const change of [
    (data) => { data.symbol = "JP225-CFD"; },
    (data) => { data.quote.previousClose = 9999; },
    (data) => { data.quote.date = "2026-11-08"; },
    (data) => { data.quote.price = NaN; },
    (data) => { data.closes.push({ date: "2026-11-09", close: 79 }); },
  ]) {
    const data = indexData();
    change(data);
    assert.throws(() => validateNikkei(data));
  }
});
