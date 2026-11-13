import { isISODate, japanDate } from "./nav.mjs";

export const NIKKEI_SOURCE = "https://finance.yahoo.com/quote/%5EN225/";
const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const timestamp = (value) => typeof value === "string" && /Z$/.test(value) && Number.isFinite(Date.parse(value));

export function validateNikkei(data) {
  if (data?.symbol !== "^N225" || data.sourceUrl !== NIKKEI_SOURCE || data.currency !== "JPY" || !timestamp(data.fetchedAt)
    || !(data.delayMinutes === null || (typeof data.delayMinutes === "number" && Number.isFinite(data.delayMinutes) && data.delayMinutes >= 0))) {
    throw new Error("日経平均のデータ形式が不正です。");
  }
  const quote = data.quote;
  if (!isISODate(quote?.date) || !timestamp(quote.asOf) || japanDate(new Date(quote.asOf)) !== quote.date
    || !positive(quote.price) || !positive(quote.previousClose) || typeof quote.isClose !== "boolean"
    || Date.parse(quote.asOf) > Date.parse(data.fetchedAt) + 60000 || !Array.isArray(data.closes) || data.closes.length < 2) {
    throw new Error("日経平均の価格または時刻が不正です。");
  }
  let previous = "";
  for (const close of data.closes) {
    if (!isISODate(close?.date) || close.date <= previous || close.date > quote.date
      || (close.date === quote.date && !quote.isClose) || !positive(close.close)) {
      throw new Error("日経平均の履歴が不正です。");
    }
    previous = close.date;
  }
  const prior = data.closes.filter((close) => close.date < quote.date).at(-1);
  if (!prior || Math.abs(prior.close - quote.previousClose) > .005) throw new Error("日経平均の前日終値が履歴と一致しません。");
  if (quote.isClose && (data.closes.at(-1).date !== quote.date || Math.abs(data.closes.at(-1).close - quote.price) > .005)) {
    throw new Error("日経平均の終値が履歴と一致しません。");
  }
  return data;
}

export function buildNikkeiView(data, { now = new Date() } = {}) {
  validateNikkei(data);
  const today = japanDate(now);
  // Even after the market closes, today's record is excluded until JST midnight.
  const completed = data.closes.filter((close) => close.date < today);
  const latest = completed.at(-1) ?? null;
  const previous = completed.at(-2) ?? null;
  const delta = latest && previous ? Number((latest.close - previous.close).toFixed(2)) : null;
  const rate = delta == null ? null : delta / previous.close * 100;
  return { today, latest, delta, rate };
}
