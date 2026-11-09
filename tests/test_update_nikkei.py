import copy
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import URLError

from scripts.update_nikkei import parse_chart, update_nikkei

NOW = datetime(2026, 11, 9, 2, 5, tzinfo=timezone.utc)


def epoch(day, hour=0):
    return int(datetime.fromisoformat(f"{day}T{hour:02d}:00:00+00:00").timestamp())


def chart():
    return {"chart": {"error": None, "result": [{
        "meta": {
            "symbol": "^N225", "instrumentType": "INDEX", "currency": "JPY", "exchangeTimezoneName": "Asia/Tokyo",
            "regularMarketTime": epoch("2026-11-09", 2), "regularMarketPrice": 79,
            "chartPreviousClose": 9999,
            "currentTradingPeriod": {"regular": {"end": epoch("2026-11-09", 7)}},
        },
        "timestamp": [epoch(day) for day in ("2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09")],
        "indicators": {"quote": [{"close": [100, 90, 80, 79]}]},
    }]}}


def raw(value):
    return json.dumps(value).encode()


class ParseTests(unittest.TestCase):
    def test_uses_actual_previous_daily_close_and_excludes_partial_today(self):
        result = parse_chart(raw(chart()), NOW)
        self.assertEqual(result["quote"]["previousClose"], 80)
        self.assertEqual(result["quote"]["price"], 79)
        self.assertFalse(result["quote"]["isClose"])
        self.assertEqual(result["closes"][-1]["date"], "2026-11-06")
        self.assertEqual(result["quote"]["date"], "2026-11-09")
        self.assertIsNone(result["delayMinutes"])

    def test_completed_quote_preserves_its_own_date_and_previous_close(self):
        source = chart()
        meta = source["chart"]["result"][0]["meta"]
        meta["regularMarketTime"] = epoch("2026-11-06", 7)
        meta["regularMarketPrice"] = 80
        source["chart"]["result"][0]["indicators"]["quote"][0]["close"][-1] = None
        result = parse_chart(raw(source), NOW)
        self.assertEqual(result["quote"]["date"], "2026-11-06")
        self.assertEqual(result["quote"]["previousClose"], 90)
        self.assertTrue(result["quote"]["isClose"])
        self.assertEqual(result["closes"][-1], {"date": "2026-11-06", "close": 80})

    def test_invalid_index_prices_and_future_quote_are_rejected(self):
        for key, value in [("symbol", "JP225-CFD"), ("instrumentType", "FUTURE"), ("currency", "USD"),
                           ("regularMarketPrice", 0), ("regularMarketPrice", float("nan")),
                           ("regularMarketTime", epoch("2026-11-10"))]:
            source = chart()
            source["chart"]["result"][0]["meta"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                parse_chart(raw(source), NOW)

    def test_source_errors_missing_history_and_mismatched_arrays_are_rejected(self):
        variants = [{"chart": {"error": {"code": "Not Found"}, "result": None}}]
        for values in ([None, None, 80, 79], [100, 90]):
            source = chart()
            source["chart"]["result"][0]["indicators"]["quote"][0]["close"] = values
            variants.append(source)
        for source in variants:
            with self.subTest(source=source), self.assertRaises(ValueError):
                parse_chart(raw(source), NOW)


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "nikkei.json"

    def test_new_snapshot_and_identical_snapshot(self):
        self.assertTrue(update_nikkei(self.path, downloader=lambda: raw(chart()), now=NOW))
        original = self.path.read_bytes()
        self.assertFalse(update_nikkei(self.path, downloader=lambda: raw(chart()), now=NOW + timedelta(minutes=2)))
        self.assertEqual(self.path.read_bytes(), original)

    def test_invalid_response_and_network_failure_preserve_original_bytes(self):
        update_nikkei(self.path, downloader=lambda: raw(chart()), now=NOW)
        original = self.path.read_bytes()
        with self.assertRaises(ValueError):
            update_nikkei(self.path, downloader=lambda: b"bad", now=NOW)
        def unavailable():
            raise URLError("unavailable")
        with self.assertRaises(URLError):
            update_nikkei(self.path, downloader=unavailable, now=NOW)
        self.assertEqual(self.path.read_bytes(), original)

    def test_regressed_timestamp_does_not_replace_newer_snapshot(self):
        update_nikkei(self.path, downloader=lambda: raw(chart()), now=NOW)
        original = self.path.read_bytes()
        older = copy.deepcopy(chart())
        older["chart"]["result"][0]["meta"]["regularMarketTime"] -= 60
        with self.assertRaises(ValueError):
            update_nikkei(self.path, downloader=lambda: raw(older), now=NOW)
        self.assertEqual(self.path.read_bytes(), original)
