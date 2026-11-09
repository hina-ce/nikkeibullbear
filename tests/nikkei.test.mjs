import test from "node:test";
import assert from "node:assert/strict";
import { buildNikkeiView, validateNikkei, NIKKEI_SOURCE } from "../nikkei.mjs";

export const indexData = () => ({
  symbol: "^N225", sourceUrl: NIKKEI_SOURCE, currency: "JPY", delayMinutes: null,
  fetchedAt: "2026-11-09T02:05:00Z",
  quote: { date: "2026-11-09", asOf: "2026-11-09T02:00:00Z", price: 79, previousClose: 80, isClose: false },
  closes: [{ date: "2026-11-04", close: 100 }, { date: "2026-11-05", close: 90 }, { date: "2026-11-06", close: 80 }],
});
const at = (now = "2026-11-09T02:06:00Z", options = {}) => ({ now: new Date(now), ...options });

test("all three Nikkei declines match, including Monday's shared Friday/previous session", () => {
  const view = buildNikkeiView(indexData(), at());
  assert.equal(view.state, "match");
  assert.deepEqual(view.checks, [true, true, true]);
  assert.equal(view.delta, -1);
  assert.equal(view.rate, -1.25);
  assert.equal(view.friday.date, "2026-11-06");
  assert.equal(view.previous.date, "2026-11-06");
});

test("zero or positive current change does not match", () => {
  for (const price of [80, 81]) {
    const data = indexData();
    data.quote.price = price;
    assert.equal(buildNikkeiView(data, at()).state, "no-match");
  }
});

test("Friday, previous session and current quote must all decline independently", () => {
  const data = indexData();
  data.closes.push({ date: "2026-11-09", close: 82 });
  data.quote = { date: "2026-11-10", asOf: "2026-11-10T02:00:00Z", price: 81, previousClose: 82, isClose: false };
  data.fetchedAt = "2026-11-10T02:05:00Z";
  const view = buildNikkeiView(data, at("2026-11-10T02:06:00Z"));
  assert.deepEqual(view.checks, [true, false, true]);
  assert.equal(view.state, "no-match");
});

test("only the all-down combination highlights among all eight combinations", () => {
  for (const fridayDown of [false, true]) for (const previousDown of [false, true]) for (const todayDown of [false, true]) {
    const data = indexData();
    const priorClose = previousDown ? 90 : 110;
    data.closes = [
      { date: "2026-11-04", close: 100 }, { date: "2026-11-05", close: 100 },
      { date: "2026-11-06", close: fridayDown ? 90 : 110 },
      { date: "2026-11-09", close: 100 }, { date: "2026-11-10", close: priorClose },
    ];
    data.quote = { date: "2026-11-11", asOf: "2026-11-11T02:00:00Z", price: priorClose + (todayDown ? -1 : 1), previousClose: priorClose, isClose: false };
    data.fetchedAt = "2026-11-11T02:05:00Z";
    const view = buildNikkeiView(data, at("2026-11-11T02:06:00Z"));
    assert.deepEqual(view.checks, [fridayDown, previousDown, todayDown]);
    assert.equal(view.state, fridayDown && previousDown && todayDown ? "match" : "no-match");
  }
});

test("a missing Friday is unknown and is never replaced with a falling Thursday", () => {
  const data = indexData();
  data.closes = [{ date: "2026-11-03", close: 110 }, { date: "2026-11-04", close: 100 }, { date: "2026-11-05", close: 90 }];
  data.quote.previousClose = 90;
  const view = buildNikkeiView(data, at());
  assert.equal(view.friday, null);
  assert.equal(view.state, "waiting");
});

test("old dates, offline, unverified saved data, and stale intraday snapshots cannot highlight", () => {
  const cases = [at("2026-11-10T02:06:00Z"), at(undefined, { online: false }), at(undefined, { verified: false }), at("2026-11-09T02:21:00Z")];
  for (const options of cases) {
    const view = buildNikkeiView(indexData(), options);
    assert.equal(view.state, "waiting");
    assert.notEqual(view.holdReason, "");
  }
  const data = indexData();
  data.quote.asOf = "2026-11-09T01:20:00Z";
  assert.equal(buildNikkeiView(data, at()).state, "waiting");
});

test("a same-day confirmed close remains useful that evening and expires at Japanese midnight", () => {
  const data = indexData();
  data.quote.asOf = "2026-11-09T06:45:00Z";
  data.fetchedAt = "2026-11-09T06:50:00Z";
  data.quote.isClose = true;
  data.closes.push({ date: "2026-11-09", close: 79 });
  assert.equal(buildNikkeiView(data, at("2026-11-09T14:59:59Z")).state, "match");
  assert.equal(buildNikkeiView(data, at("2026-11-09T15:00:00Z")).state, "waiting");
});

test("range and Friday lookup work across a year boundary", () => {
  const data = indexData();
  data.closes = [{ date: "2026-12-23", close: 100 }, { date: "2026-12-24", close: 90 }, { date: "2026-12-25", close: 80 }, { date: "2026-12-30", close: 70 }];
  data.quote = { date: "2027-01-01", asOf: "2027-01-01T02:00:00Z", price: 69, previousClose: 70, isClose: false };
  data.fetchedAt = "2027-01-01T02:05:00Z";
  const view = buildNikkeiView(data, at("2027-01-01T02:06:00Z"));
  assert.equal(view.fridayDate, "2026-12-25");
  assert.equal(view.previous.date, "2026-12-30");
});

test("wrong cash instrument, mismatched prior close, bad dates and partial closes are rejected", () => {
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
