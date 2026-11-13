import { isISODate, japanDate } from "./nav.mjs";

export function validateHolding(value) {
  if (!Number.isSafeInteger(value?.units) || value.units < 0) {
    throw new Error("保有口数は0以上の整数で入力してください。");
  }
  if (typeof value.averageCost !== "number" || !Number.isFinite(value.averageCost)
    || value.averageCost < 0 || value.averageCost > Number.MAX_SAFE_INTEGER
    || (value.units > 0 && value.averageCost === 0)) {
    throw new Error("平均取得単価は1万口あたりの金額を入力してください（保有ありの場合は0円より大きい値）。");
  }
  return { units: value.units, averageCost: value.averageCost };
}

export function parseHolding(units, averageCost) {
  if (!units.trim() || !averageCost.trim()) {
    throw new Error("保有口数と平均取得単価を両方入力してください。");
  }
  return validateHolding({ units: Number(units), averageCost: Number(averageCost) });
}

export function calculateHolding(holding, nav) {
  const { units, averageCost } = validateHolding(holding);
  if (!Number.isSafeInteger(nav) || nav <= 0) throw new Error("基準価額が不正です。");
  const purchaseValue = units / 10000 * averageCost;
  const marketValue = units / 10000 * nav;
  if (Math.max(purchaseValue, marketValue) > Number.MAX_SAFE_INTEGER) {
    throw new Error("計算できる金額の範囲を超えています。入力値を確認してください。");
  }
  return {
    purchaseValue, marketValue, profit: marketValue - purchaseValue,
    profitRate: purchaseValue ? (nav / averageCost - 1) * 100 : null,
  };
}

function validDate(date, today) {
  if (!isISODate(date) || date > today) throw new Error("日付は本日以前の有効な日付を選択してください。");
}

export function validatePortfolio(value, today = japanDate()) {
  // Upgrade the previous single-position format without discarding saved holdings.
  if (value && value.version == null && "units" in value) {
    return { version: 2, initial: { ...validateHolding(value), date: null }, transactions: [] };
  }
  if (value?.version !== 2 || !value.initial || !Array.isArray(value.transactions)) {
    throw new Error("保有情報の保存形式が不正です。");
  }
  const initial = { ...validateHolding(value.initial), date: value.initial.date };
  if (initial.date !== null) validDate(initial.date, today);
  const ids = new Set();
  const transactions = value.transactions.map((entry) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) {
      throw new Error("取引履歴の識別情報が不正です。");
    }
    ids.add(entry.id);
    validDate(entry.date, today);
    if (initial.date && entry.date < initial.date) throw new Error("約定日・補正日は記録開始日以降を選択してください。");
    const record = { id: entry.id, date: entry.date, type: entry.type };
    if (entry.type === "buy" || entry.type === "sell") {
      if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0 || entry.amount % 1000 !== 0) {
        throw new Error("投資・回収額は1,000円以上、1,000円単位で入力してください。");
      }
      record.amount = entry.amount;
    } else if (entry.type === "adjustment") {
      if (!Number.isSafeInteger(entry.units) || entry.units < 0) throw new Error("補正する口数は0以上の整数で入力してください。");
      record.units = entry.units;
    } else {
      throw new Error("取引の種類が不正です。");
    }
    return record;
  });
  return { version: 2, initial, transactions };
}

export function buildPortfolio(value, prices = [], today = japanDate()) {
  const portfolio = validatePortfolio(value, today);
  const initialCost = portfolio.initial.units / 10000 * portfolio.initial.averageCost;
  let invested = initialCost;
  let added = 0;
  let withdrawn = 0;
  let units = portfolio.initial.units;
  let purchaseValue = initialCost;
  const pending = [];
  const errors = [];
  const byDate = new Map(prices.filter((price) => price.date <= today).map((price) => [price.date, price.nav]));
  const latest = prices.filter((price) => price.date <= today).at(-1) ?? null;
  // Same-day entries keep their recording order, so later trades use corrected units.
  const sorted = portfolio.transactions.map((entry, order) => ({ ...entry, order })).sort((a, b) =>
    a.date.localeCompare(b.date) || a.order - b.order);
  let unitsKnown = true;
  let costKnown = true;
  const records = sorted.map((entry) => {
    if (entry.type === "adjustment") {
      units = entry.units;
      unitsKnown = true;
      if (units === 0) {
        purchaseValue = 0;
        costKnown = true;
      }
      return { ...entry, unitsAfter: units };
    }
    if (entry.type === "buy") {
      added += entry.amount;
      invested += entry.amount;
    } else {
      withdrawn += entry.amount;
    }
    const nav = byDate.get(entry.date) ?? null;
    if (nav == null) {
      pending.push(entry);
      unitsKnown = false;
      if (entry.type === "buy" && costKnown) purchaseValue += entry.amount;
      if (entry.type === "sell") costKnown = false;
      return { ...entry, nav, unitDelta: null, unitsAfter: null };
    }
    if (!Number.isSafeInteger(nav) || nav <= 0) throw new Error("取引日の基準価額が不正です。");
    const quantity = Math.round(entry.amount / nav * 10000);
    if (!unitsKnown) {
      if (entry.type === "buy" && costKnown) purchaseValue += entry.amount;
      if (entry.type === "sell") costKnown = false;
      return { ...entry, nav, unitDelta: null, unitsAfter: null };
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || (entry.type === "buy" && !Number.isSafeInteger(units + quantity))) {
      errors.push({ id: entry.id, message: `${entry.date}：計算できる口数の範囲を超えています。金額を確認してください。` });
      unitsKnown = false;
      costKnown = false;
    } else if (entry.type === "sell" && quantity > units) {
      errors.push({ id: entry.id, message: `${entry.date}：回収額が保有分を超えています。金額・約定日・その日以前の口数を確認してください。` });
      unitsKnown = false;
      costKnown = false;
    } else if (entry.type === "buy") {
      units += quantity;
      if (costKnown) purchaseValue += entry.amount;
    } else {
      if (costKnown) purchaseValue *= (units - quantity) / units;
      units -= quantity;
      if (units === 0) {
        purchaseValue = 0;
        costKnown = true;
      }
    }
    return { ...entry, nav, unitDelta: unitsKnown ? quantity * (entry.type === "buy" ? 1 : -1) : null, unitsAfter: unitsKnown ? units : null };
  });
  if (!Number.isFinite(invested) || Math.max(invested, withdrawn) > Number.MAX_SAFE_INTEGER) {
    throw new Error("累計金額が計算できる範囲を超えています。");
  }
  const averageCost = !unitsKnown || !costKnown ? null : units ? purchaseValue / units * 10000 : 0;
  const marketValue = !unitsKnown || errors.length || !latest ? null : units / 10000 * latest.nav;
  if (marketValue != null && (!Number.isFinite(marketValue) || marketValue > Number.MAX_SAFE_INTEGER)) {
    throw new Error("評価額が計算できる範囲を超えています。");
  }
  const profit = marketValue == null || !costKnown ? null : marketValue - purchaseValue;
  return {
    portfolio, initialCost, invested, added, withdrawn,
    units: unitsKnown ? units : null, averageCost, purchaseValue: unitsKnown && costKnown ? purchaseValue : null,
    latest, marketValue, profit, profitRate: profit == null || !purchaseValue ? null : profit / purchaseValue * 100,
    totalProfit: marketValue == null ? null : marketValue + withdrawn - invested,
    records, pending, errors,
  };
}
