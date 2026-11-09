import { isISODate, japanDate, previousWeekFriday } from "./nav.mjs";

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

export function buildNikkeiView(data, { now = new Date(), online = true, verified = true } = {}) {
  validateNikkei(data);
  const today = japanDate(now);
  const fridayDate = previousWeekFriday(today);
  const completed = data.closes.filter((close) => close.date < today);
  const withDelta = completed.map((close, index) => ({
    ...close, delta: index ? Number((close.close - completed[index - 1].close).toFixed(2)) : null,
  }));
  const friday = withDelta.find((close) => close.date === fridayDate) ?? null;
  const previous = withDelta.at(-1) ?? null;
  const delta = Number((data.quote.price - data.quote.previousClose).toFixed(2));
  const rate = delta / data.quote.previousClose * 100;
  const quoteAge = now.getTime() - Date.parse(data.quote.asOf);
  const fetchedAge = now.getTime() - Date.parse(data.fetchedAt);
  const weekend = [0, 6].includes(new Date(`${today}T00:00:00Z`).getUTCDay());
  let holdReason = "";
  if (!online || !verified) holdReason = "通信を確認できないため、保存値での判定を保留しています。";
  else if (data.quote.date !== today || weekend) holdReason = "本日分のデータがないため、判定を保留しています。";
  else if (quoteAge < -60000 || fetchedAge < -60000) holdReason = "データの時刻を確認できないため、判定を保留しています。";
  else if (!data.quote.isClose && (quoteAge > 35 * 60000 || fetchedAge > 15 * 60000)) holdReason = "データが古いため、判定を保留しています。";
  const down = (record) => record?.delta == null ? null : record.delta < 0;
  const checks = [down(friday), down(previous), holdReason ? null : delta < 0];
  const state = holdReason || checks.includes(null) ? "waiting" : checks.every(Boolean) ? "match" : "no-match";
  if (!holdReason && checks.includes(null)) holdReason = "前週金曜または直前営業日の履歴が不足しているため、判定を保留しています。";
  return { today, fridayDate, friday, previous, delta, rate, checks, state, holdReason };
}

export function japanTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
