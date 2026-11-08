import json
from pathlib import Path
import tempfile
import unittest
from datetime import date
from unittest.mock import patch
from urllib.error import URLError

from scripts.update_nav import FUND_ID, SOURCE_URL, parse_csv, update_nav

HEADER = "基準日,基準価額(円),分配金再投資基準価額(円),純資産総額(億円),分配金(円)\n"
CSV = HEADER + "2026/11/05,65130,99999,1327.14,\n2026/11/06,48950,99999,1013.65,\n"
TODAY = date(2026, 11, 9)


class ParseTests(unittest.TestCase):
    def test_cp932_and_actual_nav_column(self):
        result = parse_csv(CSV.encode("cp932"), TODAY)
        self.assertEqual(result["fundId"], FUND_ID)
        self.assertEqual(result["sourceUrl"], SOURCE_URL)
        self.assertEqual(result["prices"], [{"date": "2026-11-05", "nav": 65130}, {"date": "2026-11-06", "nav": 48950}])

    def test_utf8_bom_and_reordered_columns(self):
        raw = "基準価額（円）,基準日\n48,2026/11/06\n65,2026/11/05\n".encode("utf-8-sig")
        self.assertEqual(parse_csv(raw, TODAY)["prices"][0], {"date": "2026-11-05", "nav": 65})

    def test_quoted_thousands(self):
        raw = CSV.replace("65130", '"65,130"').encode("cp932")
        self.assertEqual(parse_csv(raw, TODAY)["prices"][0]["nav"], 65130)

    def test_invalid_responses(self):
        cases = [b"", b"<html>Error</html>", HEADER.encode("cp932")]
        for bad in ("2026/02/30", "2026/11/10", "2015/10/06"):
            cases.append(CSV.replace("2026/11/06", bad).encode("cp932"))
        for bad in ("0", "-1", "NaN", "48.5", "9007199254740992", '"48,95"'):
            cases.append(CSV.replace("48950", bad).encode("cp932"))
        cases += [CSV.replace("2026/11/06", "2026/11/05").encode("cp932"), CSV.replace(",1013.65,", "").encode("cp932")]
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises((ValueError, UnicodeError)):
                parse_csv(raw, TODAY)


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "data" / "nav.json"

    def save(self, csv=CSV):
        return update_nav(self.path, downloader=lambda: csv.encode("cp932"), today=TODAY)

    def test_initial_write_and_noop(self):
        self.assertTrue(self.save())
        original = self.path.read_bytes()
        modified = self.path.stat().st_mtime_ns
        self.assertFalse(self.save())
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(self.path.stat().st_mtime_ns, modified)

    def test_corrections_and_appended_day(self):
        self.save()
        self.assertTrue(self.save(CSV.replace("48950", "48951") + "2026/11/09,50000,99999,1000,\n"))
        self.assertEqual(json.loads(self.path.read_text())["prices"][-1]["date"], "2026-11-09")

    def test_invalid_or_missing_history_keeps_existing_bytes(self):
        self.save()
        original = self.path.read_bytes()
        for bad in ("<html>unavailable</html>", CSV.replace("48950", "bad"), HEADER + "2026/11/06,48950,99999,1000,\n2026/11/09,50000,99999,1000,\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.save(bad)
            self.assertEqual(self.path.read_bytes(), original)

    def test_network_failure_keeps_existing_bytes(self):
        self.save()
        original = self.path.read_bytes()
        def unavailable():
            raise URLError("unavailable")
        with self.assertRaises(URLError):
            update_nav(self.path, downloader=unavailable, today=TODAY)
        self.assertEqual(self.path.read_bytes(), original)

    def test_failed_atomic_replace_keeps_existing_and_removes_temp_file(self):
        self.save()
        original = self.path.read_bytes()
        with patch("scripts.update_nav.os.replace", side_effect=OSError("disk full")), self.assertRaises(OSError):
            self.save(CSV.replace("48950", "48951"))
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_initial_failure_creates_no_file(self):
        with self.assertRaises(ValueError):
            self.save("bad")
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
