import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolio, calculateHolding, FUND_DAILY_LEVERAGE, parseHolding, validateHolding, validatePortfolio } from "../holdings.mjs";

test("holdings are valued per 10,000 units and show a profit or loss", () => {
  const holding = parseHolding("100000", "45000");
  const profit = calculateHolding(holding, 48950);
  assert.equal(profit.purchaseValue, 450000);
  assert.equal(profit.marketValue, 489500);
  assert.equal(profit.profit, 39500);
  assert.ok(Math.abs(profit.profitRate - 8.7777777778) < 1e-8);
  const loss = calculateHolding(holding, 40000);
  assert.equal(loss.profit, -50000);
  assert.ok(loss.profitRate < 0);
});

const today = "2026-11-13";
const prices = [
  { date: "2026-11-09", nav: 10000 }, { date: "2026-11-10", nav: 15000 },
  { date: "2026-11-11", nav: 12000 }, { date: "2026-11-12", nav: 15000 }, { date: today, nav: 16000 },
];
const account = (transactions = []) => ({
  version: 2, initial: { units: 10000, averageCost: 10000, date: "2026-11-08" }, transactions,
});
const buy = { id: "buy", type: "buy", date: "2026-11-09", amount: 2000 };
const sell = { id: "sell", type: "sell", date: "2026-11-10", amount: 3000 };

test("legacy holdings upgrade without losing the initial position", () => {
  assert.deepEqual(validatePortfolio({ units: 10000, averageCost: 10000 }, today), {
    version: 2, initial: { units: 10000, averageCost: 10000, date: null }, transactions: [],
  });
});

test("dated buys and withdrawals retain cumulative cash flows and remaining cost", () => {
  const result = buildPortfolio(account([sell, buy]), prices, today);
  assert.equal(result.initialCost, 10000);
  assert.equal(result.added, 2000);
  assert.equal(result.invested, 12000);
  assert.equal(result.withdrawn, 3000);
  assert.equal(result.units, 10000);
  assert.equal(result.averageCost, 10000);
  assert.equal(result.purchaseValue, 10000);
  assert.equal(result.marketValue, 16000);
  assert.equal(result.profit, 6000);
  assert.equal(result.totalProfit, 7000);
  assert.equal(result.monthly.invested, 12000);
  assert.equal(result.monthly.withdrawn, 3000);
  assert.equal(result.monthly.openingValue, 0);
  assert.equal(result.monthly.profit, 7000);
  assert.deepEqual(result.records.map((entry) => entry.id), ["buy", "sell"]);
});

test("monthly cash totals reset while positions and cost carry forward across months", () => {
  const portfolio = account([
    { id: "prior", type: "buy", date: "2026-10-28", amount: 2000 },
    { id: "nov-buy", type: "buy", date: "2026-11-02", amount: 3000 },
    { id: "nov-sell", type: "sell", date: "2026-11-02", amount: 3000 },
  ]);
  portfolio.initial.date = "2026-10-01";
  const history = [
    { date: "2026-10-28", nav: 10000 }, { date: "2026-10-30", nav: 12000 },
    { date: "2026-11-02", nav: 15000 }, { date: "2026-11-30", nav: 18000 },
    { date: "2026-12-01", nav: 20000 },
  ];
  const original = structuredClone(portfolio);
  const november = buildPortfolio(portfolio, history, "2026-11-30");
  assert.equal(november.monthly.invested, 3000);
  assert.equal(november.monthly.withdrawn, 3000);
  assert.equal(november.monthly.openingValue, 14400);
  assert.equal(november.monthly.profit, 7200);
  const december = buildPortfolio(portfolio, history, "2026-12-01");
  assert.equal(december.monthly.invested, 0);
  assert.equal(december.monthly.withdrawn, 0);
  assert.equal(december.monthly.openingValue, 21600);
  assert.equal(december.monthly.profit, 2400);
  assert.equal(december.units, november.units);
  assert.equal(december.purchaseValue, november.purchaseValue);
  assert.equal(december.records.length, 3);
  assert.deepEqual(portfolio, original);
});

test("a new month's profit starts at zero before the first new NAV is published", () => {
  const portfolio = account([buy, sell]);
  const result = buildPortfolio(portfolio, prices, "2026-12-01");
  assert.equal(result.monthly.start, "2026-12-01");
  assert.equal(result.monthly.invested, 0);
  assert.equal(result.monthly.withdrawn, 0);
  assert.equal(result.monthly.profit, 0);
  assert.equal(result.units, 10000);
});

test("January uses the last actual December NAV across year-end holidays", () => {
  const portfolio = account();
  portfolio.initial.date = "2026-12-01";
  const history = [{ date: "2026-12-30", nav: 12000 }, { date: "2027-01-04", nav: 13000 }];
  const result = buildPortfolio(portfolio, history, "2027-01-04");
  assert.equal(result.monthly.start, "2027-01-01");
  assert.equal(result.monthly.openingQuote.date, "2026-12-30");
  assert.equal(result.monthly.invested, 0);
  assert.equal(result.monthly.openingValue, 12000);
  assert.equal(result.monthly.profit, 1000);
});

test("undated legacy holdings are carried forward rather than counted as a new monthly investment", () => {
  const result = buildPortfolio({ units: 10000, averageCost: 10000 }, [
    { date: "2026-10-30", nav: 12000 }, { date: today, nav: 16000 },
  ], today);
  assert.equal(result.monthly.initialCost, 0);
  assert.equal(result.monthly.invested, 0);
  assert.equal(result.monthly.profit, 4000);
});

test("missing opening data never invents a monthly profit even if today's units are corrected", () => {
  const portfolio = account([
    { id: "pending", type: "buy", date: "2026-10-29", amount: 1000 },
    { id: "actual", type: "adjustment", date: today, units: 11000 },
    { ...buy, date: today, amount: 1000 },
  ]);
  portfolio.initial.date = "2026-10-01";
  const result = buildPortfolio(portfolio, [
    { date: "2026-10-30", nav: 12000 }, { date: today, nav: 10000 },
  ], today);
  assert.equal(result.marketValue, 12000);
  assert.equal(result.monthly.invested, 1000);
  assert.equal(result.monthly.openingValue, null);
  assert.equal(result.monthly.profit, null);
  const noPriorNav = buildPortfolio({ units: 10000, averageCost: 10000 }, prices, today);
  assert.equal(noPriorNav.monthly.profit, null);
});

test("full liquidation keeps the recovered profit after holdings become zero", () => {
  const result = buildPortfolio(account([{ ...sell, amount: 15000 }]), prices, today);
  assert.equal(result.units, 0);
  assert.equal(result.marketValue, 0);
  assert.equal(result.purchaseValue, 0);
  assert.equal(result.profit, 0);
  assert.equal(result.totalProfit, 5000);
  assert.equal(result.withdrawn, 15000);
});

test("a unit correction changes valuation without changing cumulative investment or recovery", () => {
  const correction = { id: "correction", type: "adjustment", date: "2026-11-11", units: 10010 };
  const result = buildPortfolio(account([buy, sell, correction]), prices, today);
  assert.equal(result.invested, 12000);
  assert.equal(result.withdrawn, 3000);
  assert.equal(result.purchaseValue, 10000);
  assert.equal(result.units, 10010);
  assert.equal(Math.round(result.marketValue), 16016);
  assert.equal(Math.round(result.totalProfit), 7016);
  assert.ok(Math.abs(result.averageCost - 9990.00999001) < 1e-6);
});

test("same-day trades recorded after a correction use the corrected units", () => {
  const correction = { id: "correction", type: "adjustment", date: buy.date, units: 10001 };
  const result = buildPortfolio(account([correction, buy]), prices, today);
  assert.equal(result.units, 12001);
  assert.deepEqual(result.records.map((entry) => entry.id), ["correction", "buy"]);
});

test("a missing execution-day NAV is pending, never substituted with a prior price", () => {
  const pendingBuy = { ...buy, date: today };
  const result = buildPortfolio(account([pendingBuy]), prices.slice(0, -1), today);
  assert.equal(result.invested, 12000);
  assert.equal(result.units, null);
  assert.equal(result.marketValue, null);
  assert.equal(result.totalProfit, null);
  assert.equal(result.pending.length, 1);
  const published = buildPortfolio(account([pendingBuy]), prices, today);
  assert.equal(published.units, 11250);
  assert.equal(published.pending.length, 0);
});

test("cash history and holdings survive missing price data without inventing a valuation", () => {
  const result = buildPortfolio(account(), [], today);
  assert.equal(result.units, 10000);
  assert.equal(result.invested, 10000);
  assert.equal(result.marketValue, null);
});

test("an actual-unit correction can value a pending buy without substituting a NAV", () => {
  const pendingBuy = { ...buy, date: today };
  const correction = { id: "actual", type: "adjustment", date: today, units: 11250 };
  const result = buildPortfolio(account([pendingBuy, correction]), prices.slice(0, -1), today);
  assert.equal(result.pending.length, 1);
  assert.equal(result.units, 11250);
  assert.equal(result.invested, 12000);
  assert.equal(result.purchaseValue, 12000);
  assert.equal(result.marketValue, 16875);
  assert.equal(result.totalProfit, 4875);
});

test("an actual-unit correction after a pending withdrawal values cash returns while cost basis waits", () => {
  const pendingSell = { ...sell, date: today };
  const correction = { id: "actual", type: "adjustment", date: today, units: 8000 };
  const result = buildPortfolio(account([pendingSell, correction]), prices.slice(0, -1), today);
  assert.equal(result.units, 8000);
  assert.equal(result.marketValue, 12000);
  assert.equal(result.withdrawn, 3000);
  assert.equal(result.totalProfit, 5000);
  assert.equal(result.averageCost, null);
  assert.equal(result.profit, null);
  assert.equal(result.breakEven, null);
});

test("break-even reverses the required NAV return instead of dividing the unrealized loss rate", () => {
  const portfolio = account();
  portfolio.initial.averageCost = 50000;
  const result = buildPortfolio(portfolio, [
    { date: "2026-11-12", nav: 45000 }, { date: today, nav: 48000 },
  ], today);
  assert.equal(result.breakEven.quote.date, "2026-11-12");
  assert.equal(result.breakEven.targetNav, 50000);
  assert.equal(result.breakEven.leverage, 4.3);
  assert.ok(Math.abs(result.breakEven.indexRate - 2.5839793282) < 1e-8);
  const estimatedNav = result.breakEven.quote.nav * (1 + FUND_DAILY_LEVERAGE * result.breakEven.indexRate / 100);
  assert.ok(Math.abs(estimatedNav - result.averageCost) < 1e-8);
  assert.notEqual(result.breakEven.indexRate, -result.profitRate / FUND_DAILY_LEVERAGE);
});

test("a profitable reference NAV produces a negative break-even return and exact break-even produces zero", () => {
  const portfolio = account();
  portfolio.initial.averageCost = 45000;
  const profitable = buildPortfolio(portfolio, [{ date: "2026-11-12", nav: 50000 }], today);
  assert.ok(Math.abs(profitable.breakEven.indexRate - -2.3255813953) < 1e-8);
  const flat = buildPortfolio(portfolio, [{ date: "2026-11-12", nav: 45000 }], today);
  assert.equal(flat.breakEven.indexRate, 0);
});

test("break-even follows the current cost basis after purchases, sales and a unit correction", () => {
  const correction = { id: "actual", date: "2026-11-11", type: "adjustment", units: 10010 };
  const result = buildPortfolio(account([buy, sell, correction]), prices, today);
  assert.equal(result.breakEven.targetNav, result.purchaseValue / result.units * 10000);
  assert.equal(result.breakEven.quote.nav, 15000);
  const navAtTarget = result.breakEven.quote.nav * (1 + result.breakEven.indexRate / 100 * 4.3);
  assert.ok(Math.abs(result.units / 10000 * navAtTarget - result.purchaseValue) < 1e-8);
});

test("zero holdings, pending unit calculations and a missing prior NAV have no invented break-even", () => {
  const empty = account();
  empty.initial.units = 0;
  empty.initial.averageCost = 0;
  assert.equal(buildPortfolio(empty, prices, today).breakEven, null);
  const pending = buildPortfolio(account([{ ...buy, date: today }]), prices.slice(0, -1), today);
  assert.equal(pending.breakEven, null);
  assert.equal(buildPortfolio(account(), [{ date: today, nav: 50000 }], today).breakEven, null);
});

test("overdrawn withdrawals are detected and retain an inspectable cash history", () => {
  const result = buildPortfolio(account([{ ...sell, amount: 16000 }]), prices, today);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /保有分を超え/);
  assert.equal(result.marketValue, null);
  assert.equal(result.withdrawn, 16000);
});

test("invalid cash steps, dates, types, duplicate IDs and fractional corrections are rejected", () => {
  for (const entry of [
    { ...buy, amount: 1500 }, { ...buy, amount: 0 }, { ...buy, amount: -1000 },
    { ...buy, date: "2026-02-30" }, { ...buy, date: "2026-11-14" }, { ...buy, date: "2026-11-07" },
    { ...buy, type: "unknown" }, { id: "units", type: "adjustment", date: today, units: 0.5 },
  ]) assert.throws(() => validatePortfolio(account([entry]), today));
  assert.throws(() => validatePortfolio(account([buy, buy]), today));
});

test("fractional average prices are preserved through calculation", () => {
  const result = calculateHolding(parseHolding("12345", "45000.25"), 45001);
  assert.ok(Math.abs(result.profit - 0.925875) < 1e-8);
});

test("zero holdings and break-even do not invent returns", () => {
  assert.deepEqual(calculateHolding(parseHolding("0", "0"), 48950), {
    purchaseValue: 0, marketValue: 0, profit: 0, profitRate: null,
  });
  assert.equal(calculateHolding(parseHolding("10000", "48950"), 48950).profit, 0);
});

test("empty, negative, fractional-unit, nonnumeric and unsafe holdings are rejected", () => {
  for (const [units, average] of [["", "45000"], ["10000", ""], ["-1", "45000"], ["0.5", "45000"],
    ["10000", "-1"], ["10000", "0"], ["abc", "45000"], ["10000", "Infinity"], ["9007199254740992", "1"]]) {
    assert.throws(() => parseHolding(units, average));
  }
  assert.throws(() => validateHolding(null));
  assert.throws(() => validateHolding({ units: "10000", averageCost: 45000 }));
  assert.throws(() => calculateHolding({ units: Number.MAX_SAFE_INTEGER, averageCost: 45000 }, 48950));
});
