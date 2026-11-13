import { buildView, japanDate, shortDate, signedNumber, validateDataset } from "./nav.mjs";
import { buildPortfolio, parseHolding, validatePortfolio } from "./holdings.mjs";

const element = (id) => document.getElementById(id);
const cacheKey = `bull43:${new URL("./data/nav.json", import.meta.url).pathname}`;
const holdingsKey = `bull43:holdings:${new URL("./", import.meta.url).pathname}`;
const money = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const averageMoney = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 8 });
let dataset = null;
let busy = false;
let renderedDate = "";
let portfolio = null;
let lastRemoved = null;

function notice(id, message) {
  element(id).textContent = message;
  element(id).hidden = !message;
}

function direction(delta) {
  return delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
}

function render() {
  const view = buildView(dataset);
  renderedDate = view.today;
  element("latest-nav").textContent = money.format(view.latest.nav);
  element("latest-date").textContent = `基準日 ${shortDate(view.latest.date, true)}`;
  const latestChange = element("latest-change");
  latestChange.className = `change change-pill ${direction(view.latest.delta)}`;
  latestChange.textContent = view.latest.delta == null ? "前日比 —" : `前日比 ${signedNumber(view.latest.delta)}円 (${signedNumber(view.latest.rate, 2)}%)`;
  const periodDate = (value) => (view.start.slice(0, 4) !== view.today.slice(0, 4) ? `${value.slice(0, 4)}/` : "") + shortDate(value);
  element("period").textContent = `${periodDate(view.start)} 〜 ${periodDate(view.today)}`;
  notice("anchor-note", view.substituted ? `前週金曜日の値がないため、${shortDate(view.start, true)}を起点に表示しています。` : "");
  notice("publication-notice", view.latest.date !== view.today ? `本日分の公表データなし · 最新公表日 ${view.latest.date.replaceAll("-", "/")}` : "");

  const fragment = document.createDocumentFragment();
  for (const price of view.rows) {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    const weekday = document.createElement("span");
    weekday.className = "weekday";
    weekday.textContent = shortDate(price.date, true).slice(shortDate(price.date).length);
    dateCell.append(shortDate(price.date), weekday);
    const navCell = document.createElement("td");
    const unit = document.createElement("span");
    unit.className = "nav-unit";
    unit.textContent = "円";
    navCell.append(money.format(price.nav), unit);
    const changeCell = document.createElement("td");
    changeCell.className = `change ${direction(price.delta)}`;
    const delta = document.createElement("span");
    delta.className = "delta";
    delta.textContent = price.delta == null ? "—" : `${signedNumber(price.delta)}円`;
    const rate = document.createElement("span");
    rate.className = "rate";
    rate.textContent = price.rate == null ? "—" : `${signedNumber(price.rate, 2)}%`;
    changeCell.append(delta, rate);
    row.append(dateCell, navCell, changeCell);
    fragment.append(row);
  }
  element("history-rows").replaceChildren(fragment);
  renderHolding();
}

function renderHolding() {
  for (const id of ["holding-units", "holding-average", "holding-cost", "holding-value", "holding-profit", "holding-rate", "total-invested", "total-withdrawn", "total-profit"]) {
    element(id).textContent = "—";
  }
  for (const id of ["holding-profit", "holding-rate", "total-profit"]) element(id).className = "change neutral";
  for (const id of ["invest-button", "withdraw-button", "correction-save"]) element(id).disabled = !portfolio;
  element("undo-transaction").hidden = !lastRemoved;
  element("transaction-rows").replaceChildren();
  element("transaction-count").textContent = `履歴（${portfolio?.transactions.length ?? 0}件）`;
  for (const id of ["trade-date", "correction-date", "initial-date"]) element(id).max = japanDate();
  if (!portfolio) return;
  try {
    const result = buildPortfolio(portfolio, dataset?.prices);
    element("holding-units").textContent = result.units == null ? "計算待ち" : `${money.format(result.units)}口`;
    element("holding-average").textContent = result.averageCost == null ? "—" : `${averageMoney.format(result.averageCost)}円`;
    for (const [id, amount] of [["holding-cost", result.purchaseValue], ["holding-value", result.marketValue], ["total-invested", result.invested], ["total-withdrawn", result.withdrawn]]) {
      element(id).textContent = amount == null ? "—" : `${money.format(amount)}円`;
    }
    for (const [id, amount, unit, digits] of [["holding-profit", result.profit, "円", 0], ["holding-rate", result.profitRate, "%", 2], ["total-profit", result.totalProfit, "円", 0]]) {
      element(id).textContent = amount == null ? "—" : `${signedNumber(amount, digits)}${unit}`;
      element(id).className = `change ${direction(amount)}`;
    }
    element("investment-period").textContent = `累計期間：${portfolio.initial.date ? portfolio.initial.date.replaceAll("-", "/") : "初期保有（開始日未設定）"} 〜 ${japanDate().replaceAll("-", "/")}`;
    element("investment-breakdown").textContent = `初期取得額 ${money.format(result.initialCost)}円 ＋ 追加投資 ${money.format(result.added)}円`;
    const basis = result.latest ? `評価基準：${result.latest.date.replaceAll("-", "/")} ${money.format(result.latest.nav)}円 / 1万口` : "基準価額を取得すると損益を表示します。";
    element("holding-basis").textContent = result.errors.length ? result.errors[0].message
      : result.pending.length && result.units == null ? `基準価額待ち ${result.pending.length}件。約定日の基準価額が公表されると口数・損益を計算します。休業日を選んだ場合は履歴を取り消して登録し直してください。`
      : result.pending.length ? `${basis} · 基準価額待ち ${result.pending.length}件は補正済み口数で評価。取得金額が未確定の場合、保有分の評価損益は公表後に表示します。`
      : basis;
    element("trade-date").min = portfolio.initial.date ?? "";
    element("correction-date").min = portfolio.initial.date ?? "";
    if (!element("units-editor").open && result.units != null) element("correction-units").value = String(result.units);
    for (const record of result.records.slice().reverse()) {
      const row = document.createElement("li");
      const content = document.createElement("div");
      const title = document.createElement("p");
      title.textContent = `${record.date.replaceAll("-", "/")} ${record.type === "buy" ? "投資" : record.type === "sell" ? "回収" : "口数補正"} ${money.format(record.type === "adjustment" ? record.units : record.amount)}${record.type === "adjustment" ? "口" : "円"}`;
      const detail = document.createElement("p");
      detail.className = "publication-note";
      detail.textContent = record.type === "adjustment" ? "その時点の口数に補正（入出金なし）"
        : record.nav == null ? "基準価額待ち"
        : `基準価額 ${money.format(record.nav)}円${record.unitDelta == null ? " · 口数計算待ち" : ` · 概算 ${signedNumber(record.unitDelta)}口`}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "取消";
      remove.setAttribute("aria-label", `${title.textContent}を取り消す`);
      remove.addEventListener("click", () => removeTransaction(record.id));
      content.append(title, detail);
      row.append(content, remove);
      element("transaction-rows").append(row);
    }
  } catch (error) {
    element("holding-basis").textContent = error.message;
  }
}

function loadHolding() {
  try {
    const saved = localStorage.getItem(holdingsKey);
    if (saved !== null) {
      portfolio = validatePortfolio(JSON.parse(saved));
      element("units-input").value = String(portfolio.initial.units);
      element("average-input").value = String(portfolio.initial.averageCost);
      element("initial-date").value = portfolio.initial.date ?? "";
      element("holdings-editor").open = false;
      notice("holding-status", "この端末に保存した保有情報です。");
    }
  } catch {
    notice("holding-status", "保存した保有情報を読み込めません。保有口数と平均取得単価を入力してください。");
  }
  renderHolding();
}

function commitPortfolio(candidate, message) {
  const normalized = validatePortfolio(candidate);
  const result = buildPortfolio(normalized, dataset?.prices);
  if (result.errors.length) throw new Error(result.errors[0].message);
  portfolio = normalized;
  try {
    localStorage.setItem(holdingsKey, JSON.stringify(portfolio));
    notice("holding-status", message);
  } catch {
    notice("holding-status", "記録をこの端末に保存できません。今回の表示は利用できますが、再起動すると変更が失われます。");
  }
  renderHolding();
}

function saveHolding(event) {
  event.preventDefault();
  try {
    const initial = { ...parseHolding(element("units-input").value, element("average-input").value), date: element("initial-date").value || null };
    commitPortfolio({ version: 2, initial, transactions: portfolio?.transactions ?? [] }, "初期保有を保存しました。売買履歴は引き継いでいます。");
    element("holdings-editor").open = false;
    lastRemoved = null;
    element("undo-transaction").hidden = true;
  } catch (error) {
    notice("holding-status", error.message);
  }
}

function recordTransaction(type) {
  try {
    if (!portfolio) throw new Error("先に初期保有を設定してください。保有なしの場合は口数・単価ともに0を入力できます。");
    const entry = { id: `${new Date().getTime()}-${Math.random().toString(36).slice(2)}`, date: element("trade-date").value, type, amount: Number(element("trade-amount").value) };
    commitPortfolio({ ...portfolio, transactions: [...portfolio.transactions, entry] }, `${entry.date.replaceAll("-", "/")}に${money.format(entry.amount)}円の${type === "buy" ? "投資" : "回収"}を記録しました。`);
    lastRemoved = null;
    element("undo-transaction").hidden = true;
  } catch (error) {
    notice("holding-status", error.message);
  }
}

function correctUnits(event) {
  event.preventDefault();
  try {
    if (!portfolio) throw new Error("先に初期保有を設定してください。");
    if (!element("correction-units").value.trim()) throw new Error("補正後の口数を入力してください。");
    const entry = { id: `${new Date().getTime()}-${Math.random().toString(36).slice(2)}`, date: element("correction-date").value, type: "adjustment", units: Number(element("correction-units").value) };
    commitPortfolio({ ...portfolio, transactions: [...portfolio.transactions, entry] }, `${entry.date.replaceAll("-", "/")}時点の口数を${money.format(entry.units)}口に補正しました。累計投資額・回収額は変わりません。`);
    element("units-editor").open = false;
    lastRemoved = null;
    element("undo-transaction").hidden = true;
  } catch (error) {
    notice("holding-status", error.message);
  }
}

function removeTransaction(id) {
  try {
    const previous = portfolio;
    commitPortfolio({ ...portfolio, transactions: portfolio.transactions.filter((entry) => entry.id !== id) }, "記録を取り消しました。「取消を戻す」で復元できます。");
    lastRemoved = previous;
    element("undo-transaction").hidden = false;
  } catch (error) {
    notice("holding-status", error.message);
  }
}

function undoTransaction() {
  if (!lastRemoved) return;
  try {
    commitPortfolio(lastRemoved, "取り消した記録を復元しました。");
    lastRemoved = null;
    element("undo-transaction").hidden = true;
  } catch (error) {
    notice("holding-status", error.message);
  }
}

function updateTradeAmount(step = 0) {
  let amount = Number(element("trade-amount").value);
  if (step) {
    amount = Math.max(1000, (Number.isFinite(amount) ? amount : 1000) + step);
    element("trade-amount").value = String(amount);
  }
  const valid = Number.isSafeInteger(amount) && amount >= 1000 && amount % 1000 === 0;
  element("invest-button").textContent = valid ? `${money.format(amount)}円を投資` : "投資を記録";
  element("withdraw-button").textContent = valid ? `${money.format(amount)}円を回収` : "回収を記録";
}

function readSaved() {
  try {
    const saved = validateDataset(JSON.parse(localStorage.getItem(cacheKey)));
    buildView(saved);
    return saved;
  } catch {
    return null;
  }
}

async function loadPrices() {
  if (busy) return;
  busy = true;
  element("reload").disabled = true;
  element("quote").setAttribute("aria-busy", "true");
  notice("loading-notice", "基準価額を読み込んでいます…");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(new URL("./data/nav.json", import.meta.url), {
      cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candidate = validateDataset(await response.json());
    buildView(candidate);
    if (dataset && candidate.prices.at(-1).date < dataset.prices.at(-1).date) {
      throw new Error("配信データが保存済みデータより古くなっています。");
    }
    dataset = candidate;
    render();
    try {
      localStorage.setItem(cacheKey, JSON.stringify(dataset));
      notice("connection-notice", "");
    } catch {
      notice("connection-notice", "端末に価格データを保存できません。今回の表示は利用できますが、オフラインでは表示できない場合があります。");
    }
  } catch (error) {
    console.warn("NAV could not be loaded:", error);
    if (dataset) {
      render();
      notice("connection-notice", navigator.onLine
        ? "データを取得できませんでした。保存済みデータを表示しています。"
        : "オフラインです。保存済みデータを表示しています。");
    } else {
      notice("connection-notice", "価格データを取得できませんでした。通信環境を確認して、再読込してください。");
      element("history-rows").replaceChildren();
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.className = "empty";
      cell.textContent = "表示できる価格データがありません。";
      const row = document.createElement("tr");
      row.append(cell);
      element("history-rows").append(row);
    }
  } finally {
    clearTimeout(timeout);
    busy = false;
    element("reload").disabled = false;
    element("quote").setAttribute("aria-busy", "false");
    notice("loading-notice", "");
  }
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    let hasController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hasController) window.location.reload();
      hasController = true;
    });
    await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch (error) {
    console.warn("Offline screen could not be registered:", error);
    notice("connection-notice", "オフライン表示を準備できませんでした。オンラインで引き続き利用できます。");
  }
}

element("reload").addEventListener("click", loadPrices);
element("holdings-form").addEventListener("submit", saveHolding);
element("invest-button").addEventListener("click", () => recordTransaction("buy"));
element("withdraw-button").addEventListener("click", () => recordTransaction("sell"));
element("amount-decrease").addEventListener("click", () => updateTradeAmount(-1000));
element("amount-increase").addEventListener("click", () => updateTradeAmount(1000));
element("trade-amount").addEventListener("input", () => updateTradeAmount());
element("correction-form").addEventListener("submit", correctUnits);
element("undo-transaction").addEventListener("click", undoTransaction);
window.addEventListener("online", loadPrices);
window.addEventListener("offline", () => {
  notice("connection-notice", dataset ? "オフラインです。保存済みデータを表示しています。" : "オフラインです。オンラインに戻ってから再読込してください。");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadPrices();
});
setInterval(() => {
  if (dataset && document.visibilityState === "visible" && japanDate() !== renderedDate) render();
}, 30000);

element("trade-date").value = japanDate();
element("correction-date").value = japanDate();
element("initial-date").value = japanDate();
element("trade-amount").value = "1000";
updateTradeAmount();
loadHolding();

dataset = readSaved();
if (dataset) {
  render();
  notice("connection-notice", "保存済みデータを表示し、更新を確認しています。");
}
await loadPrices();
await registerWorker();
