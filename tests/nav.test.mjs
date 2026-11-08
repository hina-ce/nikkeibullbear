import test from "node:test";
import assert from "node:assert/strict";
import { FUND_ID, SOURCE_URL, buildView, changeFrom, isISODate, japanDate, previousWeekFriday, shortDate, signedNumber, validateDataset } from "../nav.mjs";

const dataset = (prices) => ({ fundId: FUND_ID, sourceUrl: SOURCE_URL, prices: prices.map(([date, nav]) => ({ date, nav })) });
const fixture = dataset([
  ["2026-10-29", 85183], ["2026-10-30", 78134], ["2026-11-02", 76928],
  ["2026-11-04", 72705], ["2026-11-05", 65130], ["2026-11-06", 48950],
]);

test("Monday through Sunday keep the same previous-week Friday", () => {
  for (const day of [9, 10, 11, 12, 13, 14, 15]) {
    assert.equal(previousWeekFriday(`2026-11-${day.toString().padStart(2, "0")}`), "2026-11-06");
  }
  assert.equal(previousWeekFriday("2026-11-16"), "2026-11-13");
});

test("month, leap year and year boundaries", () => {
  assert.equal(previousWeekFriday("2026-11-02"), "2026-10-30");
  assert.equal(previousWeekFriday("2027-01-01"), "2026-12-25");
  assert.equal(previousWeekFriday("2024-03-04"), "2024-03-01");
  assert.equal(isISODate("2024-02-29"), true);
  assert.equal(isISODate("2026-02-29"), false);
  assert.throws(() => previousWeekFriday("2026-02-30"));
});

test("Japanese midnight changes the week independently of host timezone", () => {
  assert.equal(japanDate(new Date("2026-11-08T14:59:59Z")), "2026-11-08");
  assert.equal(japanDate(new Date("2026-11-08T15:00:00Z")), "2026-11-09");
  assert.equal(previousWeekFriday(japanDate(new Date("2026-11-08T14:59:59Z"))), "2026-10-30");
  assert.equal(previousWeekFriday(japanDate(new Date("2026-11-08T15:00:00Z"))), "2026-11-06");
});

test("all published days are newest first; the initial Friday compares to Thursday", () => {
  const view = buildView(fixture, "2026-11-08");
  assert.deepEqual(view.rows.map((price) => price.date), ["2026-11-06", "2026-11-05", "2026-11-04", "2026-11-02", "2026-10-30"]);
  assert.equal(view.rows.at(-1).delta, 78134 - 85183);
  assert.equal(view.latest.delta, -16180);
  assert.equal(signedNumber(view.latest.rate, 2), "-24.84");
  assert.equal(buildView(fixture, "2026-11-09").rows.length, 1);
});

test("a holiday Friday uses the preceding publication with its own prior-day delta", () => {
  const view = buildView(dataset([["2026-10-28", 100], ["2026-10-29", 110], ["2026-11-02", 99]]), "2026-11-02");
  assert.equal(view.start, "2026-10-29");
  assert.equal(view.substituted, true);
  assert.deepEqual(view.rows.map((price) => price.delta), [-11, 10]);
});

test("unpublished today, future records and first record are handled", () => {
  const view = buildView(fixture, "2026-11-05");
  assert.equal(view.latest.date, "2026-11-05");
  assert.equal(buildView(fixture, "2026-11-09").latest.date, "2026-11-06");
  assert.deepEqual(changeFrom(100, undefined), { delta: null, rate: null });
  assert.throws(() => buildView(fixture, "2010-01-01"));
});

test("positive, negative, unchanged, signed-zero rounding and number grouping", () => {
  assert.deepEqual(changeFrom(110, 100), { delta: 10, rate: 10 });
  assert.deepEqual(changeFrom(100, 100), { delta: 0, rate: 0 });
  assert.equal(signedNumber(16180), "+16,180");
  assert.equal(signedNumber(0, 2), "0.00");
  assert.equal(signedNumber(-0.001, 2), "0.00");
  assert.equal(shortDate("2026-11-06", true), "11/6（金）");
  assert.throws(() => changeFrom(100, 0));
});

test("bad fund, source, prices, dates, order and duplicate dates are rejected", () => {
  for (const bad of [null, {}, { ...fixture, fundId: "other" }, { ...fixture, sourceUrl: "https://example.com" }, dataset([]),
    dataset([["2026-02-30", 100]]), dataset([["2026-11-06", 0]]), dataset([["2026-11-06", "100"]]),
    dataset([["2026-11-06", 100], ["2026-11-06", 110]]), dataset([["2026-11-06", 100], ["2026-11-05", 110]])]) {
    assert.throws(() => validateDataset(bad));
  }
});
