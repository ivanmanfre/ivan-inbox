#!/usr/bin/env python3
"""Negative controls and one positive control for the editorial evaluator.

Written before the evaluator logic. Every test named `test_negative_*` describes
a way a false predictive claim could get through; it must fail closed.

    python3 -m unittest discover -s tools/editorial-evaluation -v
"""
from __future__ import annotations

import copy
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import dataset  # noqa: E402
import evaluate  # noqa: E402
import forecast  # noqa: E402

PROTOCOL_PATH = os.path.join(HERE, "protocol.json")
# The frozen judge lives in the run output folder, three levels above the worktree.
FROZEN_RULES = os.path.abspath(
    os.path.join(HERE, "..", "..", "..", "..", "verification", "rules.mjs")
)

DAY = 86400.0


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Synthetic cohort generator (explicitly synthetic: never gate evidence)
# ---------------------------------------------------------------------------

FORMATS = ["text", "image", "carousel", "video"]
FORMAT_EFFECT = {"text": -0.9, "image": 0.4, "carousel": 1.1, "video": -0.2}
CLIENT_EFFECT = {"ivan": 0.3, "risedtc": -0.4, "arch": 0.1}
TOPICS = ["founder_journey", "business_efficiency", "industry_trends", "other"]


def synthetic_rows(weeks: int = 70, per_week: int = 6, seed: int = 20260921):
    """A cohort with a real, learnable pre-decision signal.

    Labels come from a logistic function of features that exist before
    publication, so a correctly fitted model should be both skilful and
    calibrated. This exercises the pipeline; it is not evidence about LinkedIn.
    """
    rnd = random.Random(seed)
    start = datetime(2024, 1, 1, 9, 0, tzinfo=timezone.utc)
    rows = []
    for w in range(weeks):
        week_start = start + timedelta(weeks=w)
        for client in ("ivan", "risedtc", "arch"):
            for i in range(per_week):
                published = week_start + timedelta(days=i % 5, hours=rnd.randint(0, 9))
                fmt = FORMATS[rnd.randrange(len(FORMATS))]
                topic = TOPICS[rnd.randrange(len(TOPICS))]
                body_chars = int(math.exp(rnd.gauss(6.6, 0.7)))
                z_len = (math.log1p(body_chars) - 6.6) / 0.7
                latent = 1.6 * z_len + FORMAT_EFFECT[fmt] + CLIENT_EFFECT[client]
                p_true = 1.0 / (1.0 + math.exp(-latent))
                y = 1 if rnd.random() < p_true else 0
                baseline_median = 400.0 + 20.0 * rnd.random()
                delta = baseline_median * (0.05 + 0.6 * rnd.random())
                value = baseline_median + delta if y == 1 else baseline_median - delta
                iso_year, iso_week, _ = published.isocalendar()
                rows.append(
                    {
                        "id": f"syn:{client}:{w}:{i}",
                        "client": client,
                        "partition": None,
                        "evidence": "synthetic_control",
                        "exclusion_reason": None,
                        "exclusion_code": None,
                        "is_test": False,
                        "value": value,
                        "selection_policy": "consecutive_roster",
                        "feature_available_at": iso(published - timedelta(minutes=1)),
                        "forecast_at": iso(published),
                        "baseline_last_observed_at": iso(published - timedelta(days=1)),
                        "label_observed_at": iso(published + timedelta(days=7)),
                        "published_at": iso(published),
                        "baseline_n": 24 + rnd.randrange(30),
                        "baseline_median": baseline_median,
                        "baseline_format_scope": "same_format",
                        "y": y,
                        "group": f"syn-group:{client}:{w}:{i}",
                        "block": f"{client}:{iso_year}-W{iso_week:02d}",
                        "metric": "impressions",
                        "publication_id": f"urn:synthetic:{client}:{w}:{i}",
                        "capture_age_days": 7.0,
                        "features": {
                            "format": fmt,
                            "client": client,
                            "topic_category": topic,
                            "body_chars": body_chars,
                            "published_hour": published.hour,
                            "published_dow": published.weekday(),
                            "baseline_median": baseline_median,
                            "baseline_n": 24,
                        },
                    }
                )
    rows.sort(key=lambda r: (r["forecast_at"], r["id"]))
    return dataset.assign_partitions(rows, dataset.load_protocol(PROTOCOL_PATH))


def node_validate(data: dict):
    """Run the frozen B06 checker over a data object; return None or its message."""
    if not os.path.exists(FROZEN_RULES) or shutil.which("node") is None:
        raise unittest.SkipTest("frozen rules.mjs or node unavailable")
    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(data, tmp)
    tmp.close()
    script = (
        "import {validate} from %s;"
        "import fs from 'node:fs';"
        "const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));"
        "try{validate('B06',d);console.log('OK')}"
        "catch(e){console.log('FAIL::'+(e.message||String(e)).split('\\n')[0])}"
    ) % json.dumps("file://" + FROZEN_RULES)
    try:
        out = subprocess.run(
            ["node", "--input-type=module", "-e", script, tmp.name],
            capture_output=True,
            text=True,
            timeout=600,
        )
    finally:
        os.unlink(tmp.name)
    text = (out.stdout or "").strip() + (out.stderr or "").strip()
    if text.startswith("OK"):
        return None
    return text


class ProtocolFreeze(unittest.TestCase):
    def test_protocol_hash_is_self_consistent(self):
        proto = dataset.load_protocol(PROTOCOL_PATH)
        self.assertEqual(
            proto["protocol_hash"],
            dataset.sha256_text(proto["canonical_serialized"]),
        )
        self.assertEqual(
            proto["canonical"]["endpoint"], "own_seven_day_impressions_above_prior_median"
        )

    def test_protocol_tamper_is_detected(self):
        with open(PROTOCOL_PATH, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        doc["canonical"]["display_conditions"]["min_test_outcomes"] = 1
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(doc, fh)
            path = fh.name
        try:
            with self.assertRaises(dataset.ProtocolError):
                dataset.load_protocol(path)
        finally:
            os.unlink(path)


class DatasetNegativeControls(unittest.TestCase):
    """Real-shaped outcome/source inputs that must never become eligible rows."""

    def setUp(self):
        self.protocol = dataset.load_protocol(PROTOCOL_PATH)
        self.published = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)

    def _outcome(self, **over):
        row = {
            "client_id": "ivan",
            "snapshot_id": "snap-1",
            "artifact_role": "own_post",
            "metric": "impressions",
            "observed_value": "500",
            "unknown_reason": None,
            "scope": "native own_posts.id=aaa",
            "window_start": iso(self.published),
            "window_end": iso(self.published + timedelta(days=7)),
            "captured_at": iso(self.published + timedelta(days=7)),
            "publication_id": "urn:li:activity:1",
        }
        row.update(over)
        return row

    def _index(self, **over):
        entry = {
            "format": "text",
            "topic_category": "other",
            "body_chars": 700,
            "is_test": False,
            "selection_policy": "consecutive_roster",
            "published_at": iso(self.published),
        }
        entry.update(over)
        return {"urn:li:activity:1": entry}

    def _build(self, outcomes, index, sources=()):
        return dataset.build_dataset(
            outcomes=outcomes,
            own_sources=list(sources),
            native_index=index,
            protocol=self.protocol,
            evidence_id="outcomes_source",
            source_evidence_id="sources_index",
        )

    def test_negative_missing_metric_is_never_turned_into_zero(self):
        out = self._build(
            [
                self._outcome(
                    observed_value="0",
                    unknown_reason="No metrics_updated_at receipt; retained raw value is evaluation-ineligible",
                )
            ],
            self._index(),
        )
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "metric_unknown_no_refresh_receipt")
        self.assertIsNone(row["value"])
        self.assertIsNone(row["y"])

    def test_negative_late_total_is_not_a_seven_day_capture(self):
        out = self._build(
            [self._outcome(window_end=iso(self.published + timedelta(days=78)))],
            self._index(),
        )
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "capture_outside_seven_day_window")
        self.assertIn("+78", row["exclusion_reason"])

    def test_negative_test_generated_post_is_excluded(self):
        out = self._build([self._outcome()], self._index(is_test=True))
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "test_generated_post")

    def test_negative_outcome_selected_cohort_is_excluded(self):
        out = self._build(
            [self._outcome()], self._index(selection_policy="minimum_likes_discovery")
        )
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "outcome_selected_cohort")

    def test_negative_unknown_publication_date_is_excluded(self):
        out = self._build(
            [self._outcome(window_start=None)], self._index(published_at=None)
        )
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "publication_date_unknown")

    def test_negative_thin_baseline_cannot_produce_a_label(self):
        # One lone eligible seven-day capture: no 20-observation prior baseline exists.
        out = self._build([self._outcome()], self._index())
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "baseline_population_insufficient")
        self.assertLess(row["baseline_n"], 20)

    def test_negative_wrong_metric_is_not_substituted_for_impressions(self):
        out = self._build(
            [self._outcome(metric="reactions", snapshot_id="snap-r")], self._index()
        )
        row = out["rows"][0]
        self.assertEqual(row["partition"], "excluded")
        self.assertEqual(row["exclusion_code"], "wrong_endpoint_metric")

    def test_every_retained_observation_appears_in_the_report(self):
        outcomes = [
            self._outcome(snapshot_id="a", metric="impressions"),
            self._outcome(snapshot_id="b", metric="reactions"),
            self._outcome(snapshot_id="c", metric="impressions", publication_id="urn:li:activity:2"),
        ]
        out = self._build(outcomes, self._index())
        self.assertEqual(len(out["rows"]), 3)
        self.assertEqual(out["manifest"]["retained_observations_in"], 3)
        self.assertEqual(out["manifest"]["rows_out"], 3)
        for row in out["rows"]:
            self.assertTrue(row["exclusion_reason"])


class EvaluatorIntegrityControls(unittest.TestCase):
    """Leakage that must stop the evaluator, not merely lower a score."""

    @classmethod
    def setUpClass(cls):
        cls.protocol = dataset.load_protocol(PROTOCOL_PATH)
        cls.rows = synthetic_rows()

    def _rows(self):
        return copy.deepcopy(self.rows)

    def _first(self, rows, partition):
        return next(r for r in rows if r["partition"] == partition)

    def test_negative_future_feature_is_rejected(self):
        rows = self._rows()
        row = self._first(rows, "train")
        row["feature_available_at"] = iso(parse(row["forecast_at"]) + timedelta(hours=2))
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "future_feature")

    def test_negative_future_label_used_as_feature_is_rejected(self):
        rows = self._rows()
        row = self._first(rows, "train")
        row["features"]["observed_seven_day_impressions"] = row["value"]
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "label_as_feature")

    def test_negative_duplicate_group_across_partitions_is_rejected(self):
        rows = self._rows()
        train = self._first(rows, "train")
        test = self._first(rows, "test")
        test["group"] = train["group"]
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "group_straddles_partition")

    def test_negative_test_row_inside_training_is_rejected(self):
        rows = self._rows()
        self._first(rows, "train")["is_test"] = True
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "test_generated_post")

    def test_negative_outcome_selected_row_is_rejected(self):
        rows = self._rows()
        self._first(rows, "test")["selection_policy"] = "minimum_likes_discovery"
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "outcome_selected_cohort")

    def test_negative_missing_metric_scored_as_zero_is_rejected(self):
        rows = self._rows()
        row = self._first(rows, "test")
        row["value"] = 0.0
        row["unknown_reason"] = "collector did not retain a valid count"
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "unknown_scored_as_zero")

    def test_negative_label_arithmetic_must_match_the_baseline(self):
        rows = self._rows()
        row = self._first(rows, "test")
        row["y"] = 1 - row["y"]
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "label_arithmetic")

    def test_negative_immature_label_is_rejected(self):
        rows = self._rows()
        row = self._first(rows, "test")
        row["label_observed_at"] = iso(parse(row["published_at"]) + timedelta(days=41))
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(ctx.exception.code, "seven_day_window")

    def test_negative_test_block_may_not_be_used_for_tuning(self):
        rows = self._rows()
        with self.assertRaises(evaluate.LeakageError) as ctx:
            evaluate.build_evaluation(rows, self.protocol, tune_on_test=True)
        self.assertEqual(ctx.exception.code, "test_block_consumed")


class DisplayConditionControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = dataset.load_protocol(PROTOCOL_PATH)
        cls.rows = synthetic_rows()
        cls.data = evaluate.build_evaluation(copy.deepcopy(cls.rows), cls.protocol)

    def test_positive_control_reaches_validated_for_scope(self):
        d = self.data
        self.assertEqual(d["status"], "validated_for_scope")
        self.assertTrue(d["effectiveness_claim"])
        self.assertGreaterEqual(len(d["displayed_probabilities"]), 1)
        self.assertGreaterEqual(len([r for r in d["rows"] if r["partition"] == "test"]), 100)
        self.assertEqual(d["missing_requirements"], [])
        self.assertGreater(d["brier_skill"]["ci95"][0], 0.0)

    def test_positive_control_is_accepted_by_the_frozen_checker(self):
        self.assertIsNone(node_validate(self.data))

    def test_negative_all_positive_cohort_blocks_display(self):
        rows = copy.deepcopy(self.rows)
        for r in rows:
            if r["partition"] == "test":
                r["y"] = 1
                r["value"] = r["baseline_median"] + 10.0
        d = evaluate.build_evaluation(rows, self.protocol)
        self.assertNotEqual(d["status"], "validated_for_scope")
        self.assertEqual(d["displayed_probabilities"], [])
        self.assertFalse(d["effectiveness_claim"])
        self.assertTrue(
            any(m["requirement"] == "both_outcome_classes" for m in d["missing_requirements"])
        )

    def test_negative_model_worse_than_baseline_blocks_display(self):
        rows = copy.deepcopy(self.rows)
        d = evaluate.build_evaluation(rows, self.protocol, degrade_model_for_control=True)
        self.assertNotEqual(d["status"], "validated_for_scope")
        self.assertEqual(d["displayed_probabilities"], [])
        self.assertFalse(d["effectiveness_claim"])
        self.assertTrue(
            any(
                m["requirement"] == "positive_lower_bound_brier_skill"
                for m in d["missing_requirements"]
            )
        )

    def test_negative_sparse_band_is_never_displayed(self):
        for band in self.data["reliability_bands"]:
            if band["n"] < 30:
                self.assertNotIn(
                    band["index"], [b["index"] for b in self.data["displayed_probabilities"]]
                )
        for band in self.data["displayed_probabilities"]:
            self.assertGreaterEqual(band["n"], 30)
            self.assertLessEqual(band["half_width"], 0.15)

    def test_negative_too_few_test_outcomes_blocks_display(self):
        rows = copy.deepcopy(self.rows)
        keep = 0
        for r in rows:
            if r["partition"] == "test":
                keep += 1
                if keep > 40:
                    r["partition"] = "excluded"
                    r["exclusion_reason"] = "synthetic control: trimmed test population"
        d = evaluate.build_evaluation(rows, self.protocol)
        self.assertNotEqual(d["status"], "validated_for_scope")
        self.assertEqual(d["displayed_probabilities"], [])
        self.assertTrue(
            any(m["requirement"] == "min_test_outcomes" for m in d["missing_requirements"])
        )

    def test_negative_missing_client_blocks_a_pooled_claim(self):
        rows = copy.deepcopy(self.rows)
        for r in rows:
            if r["partition"] == "test" and r["client"] == "arch":
                r["partition"] = "excluded"
                r["exclusion_reason"] = "synthetic control: client removed from test block"
        d = evaluate.build_evaluation(rows, self.protocol)
        self.assertNotEqual(d["status"], "validated_for_scope")
        self.assertTrue(
            any(m["requirement"] == "all_clients_in_test" for m in d["missing_requirements"])
        )

    def test_negative_insufficient_data_shows_no_number(self):
        rows = [r for r in copy.deepcopy(self.rows)[:40]]
        for r in rows:
            r["partition"] = "excluded"
            r["exclusion_reason"] = "synthetic control: no eligible seven-day capture"
        d = evaluate.build_evaluation(rows, self.protocol)
        self.assertEqual(d["status"], "insufficient_data")
        self.assertEqual(d["displayed_probabilities"], [])
        self.assertFalse(d["effectiveness_claim"])
        self.assertTrue(d["missing_requirements"])
        self.assertIsNone(node_validate(d))


class ScopeAndForecastControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = dataset.load_protocol(PROTOCOL_PATH)
        cls.data = evaluate.build_evaluation(synthetic_rows(), cls.protocol)

    def _brief(self, **over):
        brief = {
            "client_id": "ivan",
            "brief_id": "brief-42",
            "version": 3,
            "content_hash": "b" * 64,
            "format": "text",
            "platform": "linkedin",
            "language": "en",
            "topic_family": "other",
        }
        brief.update(over)
        return brief

    def test_negative_probability_outside_validated_scope_abstains(self):
        out = forecast.likelihood_for(
            self._brief(platform="x", client_id="ivan"), self.data, self.protocol
        )
        self.assertIsNone(out["likelihood"])
        self.assertEqual(out["status"], "out_of_scope")
        self.assertTrue(out["limitations"])

    def test_negative_unregistered_client_abstains(self):
        out = forecast.likelihood_for(self._brief(client_id="someone_else"), self.data, self.protocol)
        self.assertIsNone(out["likelihood"])
        self.assertEqual(out["status"], "out_of_scope")

    def test_in_scope_request_returns_a_likelihood_when_validated(self):
        out = forecast.likelihood_for(self._brief(), self.data, self.protocol)
        self.assertEqual(out["status"], "validated_for_scope")
        self.assertIsInstance(out["likelihood"], float)

    def test_insufficient_evaluation_never_returns_a_number(self):
        data = copy.deepcopy(self.data)
        data["status"] = "insufficient_data"
        data["displayed_probabilities"] = []
        out = forecast.likelihood_for(self._brief(), data, self.protocol)
        self.assertIsNone(out["likelihood"])
        self.assertEqual(out["status"], "insufficient_data")

    def test_forecast_replay_creates_no_second_record(self):
        store = forecast.ForecastStore()
        brief = self._brief()
        first = forecast.record_forecast(store, brief, self.data, self.protocol)
        second = forecast.record_forecast(store, brief, self.data, self.protocol)
        self.assertEqual(first["forecast_id"], second["forecast_id"])
        self.assertEqual(store.count(), 1)
        self.assertEqual(store.writes, 1)

    def test_new_brief_version_creates_a_new_preserved_forecast(self):
        store = forecast.ForecastStore()
        first = forecast.record_forecast(store, self._brief(), self.data, self.protocol)
        second = forecast.record_forecast(
            store, self._brief(version=4, content_hash="c" * 64), self.data, self.protocol
        )
        self.assertNotEqual(first["forecast_id"], second["forecast_id"])
        self.assertEqual(store.count(), 2)
        self.assertEqual(store.get("ivan", "brief-42", 3)["forecast_id"], first["forecast_id"])

    def test_later_observation_cannot_mutate_a_recorded_forecast(self):
        store = forecast.ForecastStore()
        brief = self._brief()
        rec = forecast.record_forecast(store, brief, self.data, self.protocol)
        with self.assertRaises(forecast.ImmutableForecast):
            store.update("ivan", "brief-42", 3, {"likelihood": 0.99})
        self.assertEqual(store.get("ivan", "brief-42", 3), rec)

    def test_forecast_identity_is_deterministic(self):
        a = forecast.forecast_id(self._brief(), self.data["protocol_hash"], self.data["model_version"])
        b = forecast.forecast_id(self._brief(), self.data["protocol_hash"], self.data["model_version"])
        self.assertEqual(a, b)
        c = forecast.forecast_id(
            self._brief(content_hash="d" * 64), self.data["protocol_hash"], self.data["model_version"]
        )
        self.assertNotEqual(a, c)


class FrozenCheckerRejectsMutations(unittest.TestCase):
    """The frozen B06 judge must reject each tampered data object too."""

    @classmethod
    def setUpClass(cls):
        cls.protocol = dataset.load_protocol(PROTOCOL_PATH)
        cls.data = evaluate.build_evaluation(synthetic_rows(), cls.protocol)

    def _mutated(self, fn):
        d = copy.deepcopy(self.data)
        fn(d)
        return node_validate(d)

    def test_checker_rejects_future_feature(self):
        def mutate(d):
            row = next(r for r in d["rows"] if r["partition"] == "test")
            row["feature_available_at"] = iso(parse(row["forecast_at"]) + timedelta(hours=1))

        self.assertIn("future feature", self._mutated(mutate))

    def test_checker_rejects_group_straddling_partitions(self):
        def mutate(d):
            train = next(r for r in d["rows"] if r["partition"] == "train")
            test = next(r for r in d["rows"] if r["partition"] == "test")
            test["group"] = train["group"]

        self.assertIn("duplicate event across partitions", self._mutated(mutate))

    def test_checker_rejects_release_test_row(self):
        def mutate(d):
            next(r for r in d["rows"] if r["partition"] == "test")["is_test"] = True

        self.assertIn("release test in evaluation", self._mutated(mutate))

    def test_checker_rejects_outcome_selected_cohort(self):
        def mutate(d):
            next(r for r in d["rows"] if r["partition"] == "test")[
                "selection_policy"
            ] = "minimum_likes_discovery"

        self.assertIn("outcome-selected cohort", self._mutated(mutate))

    def test_checker_rejects_probability_without_data(self):
        def mutate(d):
            d["status"] = "insufficient_data"

        self.assertIn("probability without data", self._mutated(mutate))

    def test_checker_rejects_effectiveness_claim_without_data(self):
        def mutate(d):
            d["status"] = "insufficient_data"
            d["displayed_probabilities"] = []

        self.assertIn("false effectiveness", self._mutated(mutate))

    def test_checker_rejects_tampered_brier(self):
        def mutate(d):
            d["brier"] = d["brier"] / 2.0

        self.assertIn("Brier arithmetic", self._mutated(mutate))

    def test_checker_rejects_transform_leakage(self):
        def mutate(d):
            d["transforms_fit_partition"] = "test"

        self.assertIn("transform leakage", self._mutated(mutate))


if __name__ == "__main__":
    unittest.main(verbosity=2)
