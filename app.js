import { buildView, japanDate, shortDate, signedNumber, validateDataset } from "./nav.mjs";

const element = (id) => document.getElementById(id);
const cacheKey = `bull43:${new URL("./data/nav.json", import.meta.url).pathname}`;
const money = new Intl.NumberFormat("ja-JP");
let dataset = null;
let busy = false;
let renderedDate = "";

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

dataset = readSaved();
if (dataset) {
  render();
  notice("connection-notice", "保存済みデータを表示し、更新を確認しています。");
}
await loadPrices();
await registerWorker();
