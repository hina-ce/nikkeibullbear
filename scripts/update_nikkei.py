"""Collect the delayed cash Nikkei 225 quote and completed daily closes."""

import json
import math
import os
from pathlib import Path
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "data" / "nikkei.json"
API_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?interval=1d&range=1mo"
SOURCE_URL = "https://finance.yahoo.com/quote/%5EN225/"
JST = timezone(timedelta(hours=9))


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def positive_price(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value <= 0:
        raise ValueError("Invalid index price.")
    return round(value, 2)


def parse_chart(raw, now=None):
    now = now or datetime.now(timezone.utc)
    chart = json.loads(raw)["chart"]
    if chart.get("error") or len(chart.get("result") or []) != 1:
        raise ValueError("Index source returned an error.")
    result = chart["result"][0]
    meta = result["meta"]
    if (meta.get("symbol"), meta.get("instrumentType"), meta.get("currency"), meta.get("exchangeTimezoneName")) != ("^N225", "INDEX", "JPY", "Asia/Tokyo"):
        raise ValueError("Unexpected index, currency, or timezone.")
    timestamp = meta["regularMarketTime"]
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
        raise ValueError("Invalid quote timestamp.")
    quoted_at = datetime.fromtimestamp(timestamp, timezone.utc)
    if quoted_at > now + timedelta(seconds=60):
        raise ValueError("Quote timestamp is in the future.")
    quote_day = quoted_at.astimezone(JST).date().isoformat()
    value = positive_price(meta["regularMarketPrice"])
    timestamps = result["timestamp"]
    values = result["indicators"]["quote"][0]["close"]
    if len(timestamps) != len(values):
        raise ValueError("Index timestamps and prices do not align.")
    daily = {}
    for stamp, close in zip(timestamps, values):
        if close is None:
            continue
        day = datetime.fromtimestamp(stamp, JST).date().isoformat()
        if day > quote_day:
            continue
        if day in daily:
            raise ValueError("Duplicate index date.")
        daily[day] = positive_price(close)
    previous = [day for day in daily if day < quote_day]
    if len(previous) < 2:
        raise ValueError("Insufficient completed index history.")
    previous_close = daily[max(previous)]
    # A 1-month chartPreviousClose belongs to the START of that range, not yesterday.
    # Compare the quote to the last daily close BEFORE the quote's own Japanese date.
    regular_end = meta.get("currentTradingPeriod", {}).get("regular", {}).get("end")
    closed = quote_day < now.astimezone(JST).date().isoformat()
    if regular_end is not None:
        end = datetime.fromtimestamp(regular_end, timezone.utc)
        closed = closed or (end.astimezone(JST).date().isoformat() == quote_day and quoted_at >= end)
    closes = [{"date": day, "close": daily[day]} for day in sorted(daily) if day < quote_day]
    if closed:
        if quote_day not in daily or abs(daily[quote_day] - value) > .01:
            raise ValueError("Closing quote and daily close do not agree.")
        closes.append({"date": quote_day, "close": value})
    delay = meta.get("exchangeDataDelayedBy")
    if isinstance(delay, bool) or not isinstance(delay, (int, float)) or not math.isfinite(delay) or delay < 0:
        delay = None
    return {
        "symbol": "^N225", "sourceUrl": SOURCE_URL, "currency": "JPY",
        "fetchedAt": now.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "delayMinutes": delay,
        "quote": {"date": quote_day, "asOf": iso(timestamp), "price": value, "previousClose": previous_close, "isClose": closed},
        "closes": closes,
    }


def download_chart():
    request = Request(API_URL, headers={"User-Agent": "Mozilla/5.0 Bull43PersonalPWA/1.0", "Cache-Control": "no-cache"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                raise ValueError("Index response is too large.")
            return raw
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def update_nikkei(destination=DESTINATION, *, downloader=download_chart, now=None):
    dataset = parse_chart(downloader(), now)
    destination = Path(destination)
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        if previous["quote"]["asOf"] > dataset["quote"]["asOf"]:
            raise ValueError("Index quote regressed; keeping the saved snapshot.")
        # Retain the acquisition time of an identical snapshot, avoiding empty commits.
        if {key: value for key, value in previous.items() if key != "fetchedAt"} == {key: value for key, value in dataset.items() if key != "fetchedAt"}:
            return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=destination.parent, suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            json.dump(dataset, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write("\n")
        os.replace(temporary, destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return True


if __name__ == "__main__":
    try:
        print("Nikkei updated." if update_nikkei() else "Nikkei unchanged.")
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"Nikkei update failed: {error}", file=sys.stderr)
        sys.exit(1)
