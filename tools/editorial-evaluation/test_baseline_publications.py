"""Repeated captures cannot manufacture independent prior publications."""
import copy
import unittest
from datetime import timedelta
import test_evaluate as fixtures
iso = fixtures.iso


class BaselinePublicationControls(unittest.TestCase):
    setUp = fixtures.DatasetNegativeControls.setUp
    _obs = fixtures.DatasetNegativeControls._obs
    _index = fixtures.DatasetNegativeControls._index
    _build = fixtures.DatasetNegativeControls._build
    def cohort(self, repeats=6):
        outcomes, index = [], {}
        for i in range(4):
            published = self.published + timedelta(days=i)
            pub = f"urn:li:activity:prior-{i}"
            index[f"ivan:{pub}"] = next(iter(self._index(published_at=iso(published)).values()))
            for j in range(repeats):
                captured = published + timedelta(days=7, minutes=j)
                outcomes.append(self._obs(snapshot_id=f"prior-{i}-{j}", publication_id=pub,
                    window_start=iso(published), window_end=iso(captured), captured_at=iso(captured),
                    observed_value=str(100 + i * 100 + j)))
        target_time = self.published + timedelta(days=20)
        index["ivan:urn:li:activity:target"] = next(iter(self._index(published_at=iso(target_time)).values()))
        outcomes.append(self._obs(snapshot_id="target", publication_id="urn:li:activity:target",
            window_start=iso(target_time), window_end=iso(target_time + timedelta(days=7)),
            captured_at=iso(target_time + timedelta(days=7))))
        return outcomes, index

    def test_duplicate_captures_cannot_satisfy_twenty_post_baseline(self):
        outcomes, index = self.cohort()
        target = next(r for r in self._build(outcomes, index)["rows"] if r["id"].endswith(":target"))
        self.assertEqual(target["baseline_n"], 4)
        self.assertEqual(len(set(target["baseline_publication_ids"])), 4)
        self.assertEqual(target["baseline_median"], 250)
        self.assertEqual(target["exclusion_code"], "baseline_population_insufficient")

    def test_test_and_outcome_selected_priors_are_excluded(self):
        outcomes, index = self.cohort()
        index["ivan:urn:li:activity:prior-0"]["is_test"] = True
        index["ivan:urn:li:activity:prior-1"]["selection_policy"] = "top_performers"
        target = next(r for r in self._build(outcomes, index)["rows"] if r["id"].endswith(":target"))
        self.assertEqual(target["baseline_n"], 2)

    def test_asof_dedup_does_not_select_future_capture(self):
        outcomes, index = self.cohort(repeats=1)
        # For the target, a day-6.5 capture is available; the closer day-7
        # capture is in its future and must neither leak nor erase that prior.
        target_time = self.published + timedelta(days=6.75)
        outcomes = [r for r in outcomes if r["snapshot_id"] in ["prior-0-0", "target"]]
        early = copy.deepcopy(outcomes[0]); early["snapshot_id"] = "early"
        early["window_end"] = early["captured_at"] = iso(self.published + timedelta(days=6.5))
        outcomes.append(early)
        for r in outcomes:
            if r["snapshot_id"] == "target":
                r["window_start"] = iso(target_time)
                r["window_end"] = r["captured_at"] = iso(target_time + timedelta(days=7))
        index["ivan:urn:li:activity:target"]["published_at"] = iso(target_time)
        target = next(r for r in self._build(outcomes, index)["rows"] if r["id"].endswith(":target"))
        self.assertEqual(target["baseline_snapshot_ids"], ["early"])


if __name__ == '__main__':
    unittest.main()
