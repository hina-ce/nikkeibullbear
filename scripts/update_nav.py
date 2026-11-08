"""Fetch the official NAV history without third-party dependencies."""

import csv
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "data" / "nav.json"
FUND_ID = "JP90C000CCD0"
SOURCE_URL = "https://www.rakuten-toushin.co.jp/assets/csv/chart_100019.csv"
JST = timezone(timedelta(hours=9))


def parse_csv(raw, today=None):
    today = today or datetime.now(JST).date()
    for encoding in ("utf-8-sig", "cp932"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError("CSVの文字コードを解析できません。")
    rows = csv.reader(io.StringIO(text), strict=True)
    header = next(rows, [])
    header = [unicodedata.normalize("NFKC", item).strip() for item in header]
    if header.count("基準日") != 1 or header.count("基準価額(円)") != 1:
        raise ValueError("CSVに基準日・基準価額の列がありません。")
    date_column = header.index("基準日")
    nav_column = header.index("基準価額(円)")
    prices = {}
    for line_number, row in enumerate(rows, 2):
        if not row or not any(item.strip() for item in row):
            continue
        if len(row) != len(header):
            raise ValueError(f"CSVの{line_number}行目の列数が不正です。")
        day = datetime.strptime(row[date_column].strip(), "%Y/%m/%d").date()
        if day < date(2015, 10, 7) or day > today:
            raise ValueError(f"CSVの{line_number}行目の日付が範囲外です。")
        value = row[nav_column].strip()
        if not re.fullmatch(r"(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+)", value):
            raise ValueError(f"CSVの{line_number}行目の基準価額が不正です。")
        nav = int(value.replace(",", ""))
        if not 0 < nav <= 2**53 - 1 or day.isoformat() in prices:
            raise ValueError(f"CSVの{line_number}行目の値が不正または日付が重複しています。")
        prices[day.isoformat()] = nav
    if len(prices) < 2:
        raise ValueError("基準価額の履歴が不足しています。")
    return {
        "fundId": FUND_ID,
        "sourceUrl": SOURCE_URL,
        "prices": [{"date": day, "nav": prices[day]} for day in sorted(prices)],
    }


def download_csv():
    request = Request(SOURCE_URL, headers={"User-Agent": "Bull43PersonalPWA/1.0", "Cache-Control": "no-cache"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError("CSVのサイズが想定範囲を超えています。")
            return raw
        except (URLError, TimeoutError, OSError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def update_nav(destination=DESTINATION, *, downloader=download_csv, today=None):
    # Validate the entire response before creating or touching any output file.
    dataset = parse_csv(downloader(), today=today)
    destination = Path(destination)
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        if previous.get("fundId") != FUND_ID or previous.get("sourceUrl") != SOURCE_URL:
            raise ValueError("保存済みデータのファンドまたは出典が不正です。")
        old_dates = {price["date"] for price in previous["prices"]}
        new_dates = {price["date"] for price in dataset["prices"]}
        if not old_dates.issubset(new_dates):
            raise ValueError("取得データの履歴が欠落しています。保存済みデータを維持します。")
        if previous == dataset:
            return False
    content = json.dumps(dataset, ensure_ascii=False, indent=2) + "\n"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=destination.parent, suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
        os.replace(temporary, destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return True


def main():
    try:
        changed = update_nav()
    except (ValueError, KeyError, TypeError, csv.Error, OSError) as error:
        print(f"NAV update failed: {error}", file=sys.stderr)
        return 1
    print("NAV updated." if changed else "NAV unchanged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
