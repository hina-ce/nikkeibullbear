export const FUND_ID = "JP90C000CCD0";
export const SOURCE_URL = "https://www.rakuten-toushin.co.jp/assets/csv/chart_100019.csv";

export function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function japanDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function previousWeekFriday(today) {
  if (!isISODate(today)) throw new Error("日付が不正です。");
  const date = new Date(`${today}T00:00:00Z`);
  const mondayBasedWeekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayBasedWeekday - 3);
  return date.toISOString().slice(0, 10);
}

export function validateDataset(value) {
  if (value?.fundId !== FUND_ID || value.sourceUrl !== SOURCE_URL || !Array.isArray(value.prices) || !value.prices.length) {
    throw new Error("価格データの形式が不正です。");
  }
  let previous = "";
  for (const price of value.prices) {
    if (!isISODate(price?.date) || price.date <= previous || !Number.isSafeInteger(price.nav) || price.nav <= 0) {
      throw new Error("価格データの日付または数値が不正です。");
    }
    previous = price.date;
  }
  return value;
}

export function changeFrom(nav, previousNav) {
  if (previousNav == null) return { delta: null, rate: null };
  if (!Number.isSafeInteger(nav) || nav <= 0 || !Number.isSafeInteger(previousNav) || previousNav <= 0) {
    throw new Error("基準価額が不正です。");
  }
  const delta = nav - previousNav;
  return { delta, rate: delta / previousNav * 100 };
}

export function buildView(dataset, today = japanDate()) {
  validateDataset(dataset);
  const friday = previousWeekFriday(today);
  const prices = dataset.prices.filter((price) => price.date <= today);
  if (!prices.length) throw new Error("本日以前の価格データがありません。");
  const records = prices.map((price, index) => ({
    ...price, ...changeFrom(price.nav, prices[index - 1]?.nav),
  }));
  const anchor = records.filter((price) => price.date <= friday).at(-1);
  const start = anchor?.date ?? friday;
  return {
    today, friday, start,
    latest: records.at(-1),
    rows: records.filter((price) => price.date >= start).reverse(),
    substituted: Boolean(anchor && anchor.date !== friday),
  };
}

export function shortDate(value, withWeekday = false) {
  const date = new Date(`${value}T00:00:00Z`);
  const label = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return withWeekday ? `${label}（${"日月火水木金土"[date.getUTCDay()]}）` : label;
}

export function signedNumber(value, digits = 0) {
  if (value == null) return "—";
  // Avoid displaying a signed zero after rounding a very small change.
  const rounded = Number(value.toFixed(digits));
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
    signDisplay: rounded === 0 ? "never" : "always",
  }).format(rounded);
}
