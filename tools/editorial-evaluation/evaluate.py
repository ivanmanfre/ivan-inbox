#!/usr/bin/env python3
"""Evaluate the frozen own seven-day reach endpoint. Abstention is a valid result.

A successful run of this module is an operational fact about the evaluator. It is
never, on its own, evidence that the forecasts are accurate.

CLI:
    python3 evaluate.py --inputs <inputs.json> --out <report.json> [--rows <rows.json>]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone

import dataset
from dataset import ALLOWED_FEATURE_KEYS, FORMAT_VALUES, parse_ts, iso

MODEL_VERSION = "logistic-l2-v1"
EPS = 1e-6


class LeakageError(Exception):
    """A row that could smuggle the future, a duplicate or a test artefact in."""

    def __init__(self, code, message, row_id=None):
        super().__init__(f"{code}: {message}" + (f" [{row_id}]" if row_id else ""))
        self.code = code
        self.row_id = row_id


# ---------------------------------------------------------------------------
# Integrity gate -- these never downgrade a score, they stop the evaluation
# ---------------------------------------------------------------------------


def check_integrity(rows, protocol, tune_on_test=False):
    canonical = protocol["canonical"]
    if tune_on_test:
        raise LeakageError(
            "test_block_consumed",
            "tuning on the untouched test block consumes it; a validated claim needs a later block",
        )
    base_min = canonical["baseline"]["min_prior_observations"]
    low = timedelta(days=canonical["label"]["target_age_days"]) - timedelta(
        hours=canonical["label"]["tolerance_hours"]
    )
    high = timedelta(days=canonical["label"]["target_age_days"]) + timedelta(
        hours=canonical["label"]["tolerance_hours"]
    )
    seen_ids = set()
    group_partition = {}
    for r in rows:
        if r["id"] in seen_ids:
            raise LeakageError("duplicate_row", "the same observation appears twice", r["id"])
        seen_ids.add(r["id"])
        if r["partition"] == "excluded":
            if not (r.get("exclusion_reason") or "").strip():
                raise LeakageError("silent_exclusion", "excluded row without a reason", r["id"])
            continue
        if r["partition"] not in ("train", "calibration", "test"):
            raise LeakageError("unknown_partition", f"partition {r['partition']!r}", r["id"])
        if r.get("is_test"):
            raise LeakageError(
                "test_generated_post", "a test-generated post cannot enter evaluation", r["id"]
            )
        if r.get("selection_policy") != canonical["selection_policy"]:
            raise LeakageError(
                "outcome_selected_cohort",
                f"selection policy {r.get('selection_policy')!r} is outcome-dependent",
                r["id"],
            )
        if r.get("value") is None:
            raise LeakageError("missing_label", "eligible row without a label", r["id"])
        if r.get("unknown_reason") and float(r["value"]) == 0.0:
            raise LeakageError(
                "unknown_scored_as_zero",
                "an unknown metric was scored as a zero measurement",
                r["id"],
            )
        for key in (r.get("features") or {}):
            if key not in ALLOWED_FEATURE_KEYS:
                raise LeakageError(
                    "label_as_feature",
                    f"feature {key!r} is not a pre-decision feature in the frozen protocol",
                    r["id"],
                )
        fa, fc = parse_ts(r["feature_available_at"]), parse_ts(r["forecast_at"])
        bl, lo = parse_ts(r["baseline_last_observed_at"]), parse_ts(r["label_observed_at"])
        pu = parse_ts(r["published_at"])
        if not (fa and fc and bl and lo and pu):
            raise LeakageError("missing_timestamp", "a required timestamp is absent", r["id"])
        if fa > fc:
            raise LeakageError("future_feature", "feature observed after the forecast", r["id"])
        if bl >= fc:
            raise LeakageError("future_baseline", "baseline observed at/after the forecast", r["id"])
        if not (low <= (lo - pu) <= high):
            raise LeakageError(
                "seven_day_window",
                f"label observed at +{(lo - pu).total_seconds() / 86400.0:.1f}d, outside the frozen window",
                r["id"],
            )
        if lo <= fc:
            raise LeakageError("label_before_forecast", "label precedes the forecast", r["id"])
        if r.get("baseline_median") is None or r.get("baseline_n", 0) < base_min:
            raise LeakageError("baseline_population", "baseline below the frozen floor", r["id"])
        if r.get("y") not in (0, 1):
            raise LeakageError("binary_label", "label is not binary", r["id"])
        if r["y"] != int(float(r["value"]) > float(r["baseline_median"])):
            raise LeakageError(
                "label_arithmetic", "label does not follow from value vs baseline median", r["id"]
            )
        prior = group_partition.get(r["group"])
        if prior and prior != r["partition"]:
            raise LeakageError(
                "group_straddles_partition",
                "a duplicate/repost/event group crosses a partition boundary",
                r["id"],
            )
        group_partition[r["group"]] = r["partition"]

    train = [r for r in rows if r["partition"] == "train"]
    cal = [r for r in rows if r["partition"] == "calibration"]
    test = [r for r in rows if r["partition"] == "test"]
    if train and cal:
        if max(parse_ts(r["label_observed_at"]) for r in train) >= min(
            parse_ts(r["forecast_at"]) for r in cal
        ):
            raise LeakageError(
                "partition_boundary", "a training label matures after a calibration forecast"
            )
    if cal and test:
        if max(parse_ts(r["label_observed_at"]) for r in cal) >= min(
            parse_ts(r["forecast_at"]) for r in test
        ):
            raise LeakageError(
                "partition_boundary", "a calibration label matures after a test forecast"
            )


# ---------------------------------------------------------------------------
# Deterministic block bootstrap -- byte-for-byte the frozen checker's procedure
# ---------------------------------------------------------------------------


def block_bootstrap(rows, fn, protocol):
    cfg = protocol["canonical"]["dependence_block"]
    blocks = list(dict.fromkeys(r["block"] for r in rows))
    if len(blocks) < 2:
        return None
    by_block = {b: [r for r in rows if r["block"] == b] for b in blocks}
    seed = cfg["bootstrap_seed"]
    out = []
    n = len(blocks)
    for _ in range(cfg["bootstrap_resamples"]):
        sample = []
        for _j in range(n):
            seed = (1664525 * seed + 1013904223) % 4294967296
            sample.extend(by_block[blocks[int((seed / 4294967296.0) * n)]])
        out.append(fn(sample))
    out.sort()
    m = len(out)
    return [out[int((m - 1) * cfg["quantiles"][0])], out[int((m - 1) * cfg["quantiles"][1])]]


def brier(rows, key):
    total = 0.0
    for r in rows:
        d = r[key] - r["y"]
        total += d * d
    return total / len(rows)


def log_loss(rows, key):
    total = 0.0
    for r in rows:
        p = min(max(r[key], EPS), 1.0 - EPS)
        total += -(r["y"] * math.log(p) + (1 - r["y"]) * math.log(1.0 - p))
    return total / len(rows)


# ---------------------------------------------------------------------------
# Feature encoding and the one regularized logistic candidate
# ---------------------------------------------------------------------------


def _raw_vector(features):
    f = features or {}
    fmt = f.get("format") if f.get("format") in FORMAT_VALUES else "unknown"
    onehot_fmt = [1.0 if fmt == v else 0.0 for v in FORMAT_VALUES]
    onehot_client = [1.0 if f.get("client") == c else 0.0 for c in ("ivan", "risedtc", "arch")]
    body = f.get("body_chars")
    hour = f.get("published_hour") or 0
    dow = f.get("published_dow") or 0
    med = f.get("baseline_median")
    return (
        onehot_fmt
        + onehot_client
        + [
            math.log1p(float(body)) if body else 0.0,
            math.sin(2 * math.pi * hour / 24.0),
            math.cos(2 * math.pi * hour / 24.0),
            math.sin(2 * math.pi * dow / 7.0),
            math.cos(2 * math.pi * dow / 7.0),
            math.log1p(float(med)) if med else 0.0,
            float(f.get("baseline_n") or 0),
        ]
    )


def _fit_standardizer(vectors):
    dim = len(vectors[0])
    n = float(len(vectors))
    mean = [sum(v[i] for v in vectors) / n for i in range(dim)]
    std = []
    for i in range(dim):
        var = sum((v[i] - mean[i]) ** 2 for v in vectors) / n
        std.append(math.sqrt(var) if var > 1e-12 else 1.0)
    return {"mean": mean, "std": std}


def _standardize(vec, sc):
    return [(vec[i] - sc["mean"][i]) / sc["std"][i] for i in range(len(vec))]


def _sigmoid(z):
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def _fit_logistic(X, y, iterations, lr, lam):
    dim = len(X[0])
    w = [0.0] * dim
    b = 0.0
    n = float(len(X))
    for _ in range(iterations):
        gw = [0.0] * dim
        gb = 0.0
        for xi, yi in zip(X, y):
            z = b
            for j in range(dim):
                z += w[j] * xi[j]
            err = _sigmoid(z) - yi
            gb += err
            for j in range(dim):
                gw[j] += err * xi[j]
        b -= lr * (gb / n)
        for j in range(dim):
            w[j] -= lr * (gw[j] / n + lam * w[j] / n)
    return w, b


def _logit(p):
    p = min(max(p, EPS), 1.0 - EPS)
    return math.log(p / (1.0 - p))


# ---------------------------------------------------------------------------
# Baselines (train-only)
# ---------------------------------------------------------------------------


def _clip(p):
    return min(max(p, EPS), 1.0 - EPS)


def build_baselines(train, protocol):
    specs = {b["key"]: b for b in protocol["canonical"]["baselines_predeclared"]}
    pooled = sum(r["y"] for r in train) / float(len(train)) if train else 0.5
    author = {}
    for r in train:
        a = author.setdefault(r["client"], [0, 0])
        a[0] += r["y"]
        a[1] += 1
    k_author = specs["baseline_author_shrunk"]["shrinkage_k"]
    cell = {}
    for r in train:
        key = ((r.get("features") or {}).get("topic_category"), (r.get("features") or {}).get("format"))
        c = cell.setdefault(key, [0, 0])
        c[0] += r["y"]
        c[1] += 1
    k_cell = specs["baseline_topic_format"]["shrinkage_k"]

    def apply(row):
        a = author.get(row["client"], [0, 0])
        cl = cell.get(
            ((row.get("features") or {}).get("topic_category"), (row.get("features") or {}).get("format")),
            [0, 0],
        )
        row["baseline_pooled"] = _clip(pooled)
        row["baseline_author_shrunk"] = _clip((a[0] + k_author * pooled) / (a[1] + k_author))
        row["baseline_topic_format"] = _clip((cl[0] + k_cell * pooled) / (cl[1] + k_cell))

    return apply, {
        "pooled_train_rate": pooled,
        "author_counts": {k: {"positives": v[0], "n": v[1]} for k, v in sorted(author.items())},
        "topic_format_cells": len(cell),
    }


# ---------------------------------------------------------------------------
# The evaluation
# ---------------------------------------------------------------------------


def build_evaluation(rows, protocol, tune_on_test=False, degrade_model_for_control=False):
    canonical = protocol["canonical"]
    dc = canonical["display_conditions"]
    check_integrity(rows, protocol, tune_on_test=tune_on_test)

    train = [r for r in rows if r["partition"] == "train"]
    cal = [r for r in rows if r["partition"] == "calibration"]
    test = [r for r in rows if r["partition"] == "test"]
    baseline_keys = [b["key"] for b in canonical["baselines_predeclared"]]

    data = {
        "schema": "editorial-evaluation-result-v1",
        "endpoint": canonical["endpoint"],
        "protocol_hash": protocol["protocol_hash"],
        "model_version": MODEL_VERSION,
        "transforms_fit_partition": "train",
        "test_used_for_tuning": False,
        "baseline_keys": baseline_keys,
        "rows": rows,
        "status": "insufficient_data",
        "displayed_probabilities": [],
        "effectiveness_claim": False,
        "missing_requirements": [],
        "claimed_clients": [],
        "validated_scope": None,
        "brier": None,
        "log_loss": None,
        "brier_skill": None,
        "baseline_metrics": {},
        "reliability_bands": [],
        "weekly_selection_precision": None,
        "population": {
            "rows": len(rows),
            "train": len(train),
            "calibration": len(cal),
            "test": len(test),
            "excluded": sum(1 for r in rows if r["partition"] == "excluded"),
            "per_client_test": {
                c: sum(1 for r in test if r["client"] == c) for c in canonical["clients"]
            },
            "per_client_eligible": {
                c: sum(1 for r in rows if r["client"] == c and r["partition"] != "excluded")
                for c in canonical["clients"]
            },
            "per_client_excluded": {
                c: sum(1 for r in rows if r["client"] == c and r["partition"] == "excluded")
                for c in canonical["clients"]
            },
            "test_blocks": len({r["block"] for r in test}),
        },
        "interpretation": (
            "A completed run of this evaluator is an operational fact. It is not evidence of "
            "predictive accuracy; only status validated_for_scope carries that, and only inside "
            "validated_scope."
        ),
    }

    missing = []

    def need(requirement, statement, observed, required, field):
        missing.append(
            {
                "requirement": requirement,
                "statement": statement,
                "observed": observed,
                "required": required,
                "field": field,
            }
        )

    if not train or not cal or not test:
        for name, got in (("train", len(train)), ("calibration", len(cal)), ("test", len(test))):
            if got == 0:
                need(
                    f"non_empty_{name}_partition",
                    f"no eligible observation reached the {name} partition",
                    got,
                    1,
                    f"rows[].partition=='{name}'",
                )
        labelled = {
            c: sum(1 for r in rows if r["client"] == c and r.get("seven_day_label_available"))
            for c in canonical["clients"]
        }
        need(
            "seven_day_labelled_observations",
            "a retained observation can only carry the endpoint label when the endpoint metric "
            "was captured inside publication+"
            f"{canonical['label']['target_age_days']}d ±{canonical['label']['tolerance_hours']}h "
            "with a real observed value; a single later total is not that measurement",
            dict(labelled, total=sum(labelled.values())),
            f"at least {canonical['baseline']['min_prior_observations']} per author to seed one "
            f"baseline, and {dc['min_test_outcomes']} in the untouched test block",
            "editorial_outcome_snapshots where metric='"
            + canonical["metric_name"]
            + "' and artifact_role='"
            + canonical["artifact_role"]
            + "' and observed_value is not null and unknown_reason is null and "
            "(window_end - window_start) within the frozen tolerance",
        )
        best_baseline = max((r.get("baseline_n") or 0) for r in rows) if rows else 0
        need(
            "baseline_prior_population",
            "no target post has enough of this author's own completed seven-day observations in "
            "the preceding lookback window to form a historical median",
            best_baseline,
            canonical["baseline"]["min_prior_observations"],
            "rows[].baseline_n",
        )
        need(
            "min_test_outcomes",
            "the untouched test block is empty, so no Brier, log loss, calibration band, weekly "
            "selection precision or uncertainty interval can be computed",
            0,
            dc["min_test_outcomes"],
            "rows[].partition=='test'",
        )
        data["missing_requirements"] = missing
        data["exclusion_accounting"] = {
            "total_rows": len(rows),
            "by_code": _count(rows, "exclusion_code"),
            "by_client": {
                c: _count([r for r in rows if r["client"] == c], "exclusion_code")
                for c in canonical["clients"]
            },
            "seven_day_labelled_observations": labelled,
        }
        data["status"] = "insufficient_data"
        return data

    # --- fit (train only), calibrate (calibration only), score (test untouched)
    raw_train = [_raw_vector(r.get("features")) for r in train]
    scaler = _fit_standardizer(raw_train)
    mcfg = canonical["candidate_model"]
    Xtr = [_standardize(v, scaler) for v in raw_train]
    ytr = [r["y"] for r in train]
    w, b = _fit_logistic(
        Xtr, ytr, mcfg["iterations"], mcfg["learning_rate"], mcfg["inverse_strength_lambda"]
    )

    def raw_score(features):
        x = _standardize(_raw_vector(features), scaler)
        z = b + sum(w[j] * x[j] for j in range(len(w)))
        return _sigmoid(z)

    # Platt scaling on the calibration partition only.
    zcal = [[_logit(raw_score(r.get("features")))] for r in cal]
    ycal = [r["y"] for r in cal]
    pw, pb = _fit_logistic(zcal, ycal, 600, 0.5, 1.0)

    def calibrated(features):
        return _clip(_sigmoid(pb + pw[0] * _logit(raw_score(features))))

    apply_baselines, baseline_meta = build_baselines(train, protocol)
    for r in rows:
        if r["partition"] == "excluded":
            continue
        apply_baselines(r)
        p = calibrated(r.get("features"))
        if degrade_model_for_control:
            p = _clip(1.0 - p)
        r["p"] = p

    data["model"] = {
        "version": MODEL_VERSION,
        "family": mcfg["family"],
        "penalty": mcfg["penalty"],
        "fit_partition": "train",
        "calibration_partition": "calibration",
        "coefficients": w,
        "intercept": b,
        "platt": {"slope": pw[0], "intercept": pb},
        "scaler": scaler,
        "feature_defaults": _feature_defaults(train),
        "degraded_control": bool(degrade_model_for_control),
    }
    data["baseline_metrics"] = {
        "train_definitions": baseline_meta,
        "test": {k: {"brier": brier(test, k), "log_loss": log_loss(test, k)} for k in baseline_keys},
    }
    data["brier"] = brier(test, "p")
    data["log_loss"] = log_loss(test, "p")

    strongest = min(baseline_keys, key=lambda k: brier(test, k))
    skill_ci = block_bootstrap(test, lambda s: 1.0 - brier(s, "p") / brier(s, strongest), protocol)
    data["brier_skill"] = {
        "reference_baseline": strongest,
        "point": 1.0 - data["brier"] / brier(test, strongest),
        "ci95": skill_ci,
        "method": "author/week block bootstrap, 1000 deterministic resamples",
    }

    # --- reliability bands
    bands = []
    for index in range(5):
        rs = [r for r in test if min(4, int(r["p"] * 5)) == index]
        entry = {
            "index": index,
            "range": dc["bands"][index],
            "n": len(rs),
            "mean_predicted": (sum(r["p"] for r in rs) / len(rs)) if rs else None,
            "observed_rate": (sum(r["y"] for r in rs) / len(rs)) if rs else None,
            "ci95": None,
            "half_width": None,
            "blocks": len({r["block"] for r in rs}),
        }
        if rs:
            ci = block_bootstrap(rs, lambda s: sum(x["y"] for x in s) / len(s), protocol)
            if ci:
                entry["ci95"] = ci
                entry["half_width"] = (ci[1] - ci[0]) / 2.0
        bands.append(entry)
    data["reliability_bands"] = bands
    data["weekly_selection_precision"] = _weekly_selection_precision(test)
    data["uncertainty"] = {
        "test_blocks": len({r["block"] for r in test}),
        "test_authors": len({r["client"] for r in test}),
        "raw_n": len(test),
        "note": (
            "Effective independent units are author/week blocks, not rows; a small author cohort "
            "must not be reported as hundreds of independent trials."
        ),
    }

    # --- predeclared display conditions
    if len(test) < dc["min_test_outcomes"]:
        need(
            "min_test_outcomes",
            "the untouched test block is smaller than the predeclared floor",
            len(test),
            dc["min_test_outcomes"],
            "rows[].partition=='test'",
        )
    present = {r["client"] for r in test}
    if dc["pooled_claim_requires_all_clients"] and present != set(canonical["clients"]):
        need(
            "all_clients_in_test",
            "a pooled own-results claim must cover every registered client",
            sorted(present),
            sorted(canonical["clients"]),
            "rows[].client where partition=='test'",
        )
    if len({r["y"] for r in test}) < 2:
        need(
            "both_outcome_classes",
            "both outcome classes must be present in the untouched test block",
            sorted({r["y"] for r in test}),
            [0, 1],
            "rows[].y where partition=='test'",
        )
    claimed = [
        c
        for c in canonical["clients"]
        if sum(1 for r in test if r["client"] == c) >= dc["min_test_outcomes_per_claimed_client"]
    ]
    for c in canonical["clients"]:
        n = sum(1 for r in test if r["client"] == c)
        if n < dc["min_test_outcomes_per_claimed_client"]:
            need(
                "min_test_outcomes_per_claimed_client",
                f"client {c} has too few held-out outcomes for a client-specific claim",
                n,
                dc["min_test_outcomes_per_claimed_client"],
                f"rows[].client=='{c}' and partition=='test'",
            )
    if skill_ci is None or skill_ci[0] <= 0:
        need(
            "positive_lower_bound_brier_skill",
            "Brier skill against the strongest predeclared baseline must have a positive lower "
            "95% bound on the untouched test block",
            skill_ci[0] if skill_ci else None,
            "> 0",
            "brier_skill.ci95[0]",
        )

    displayable = []
    for entry in bands:
        if entry["n"] < dc["min_observations_per_displayed_band"]:
            continue
        if entry["ci95"] is None or entry["half_width"] is None:
            continue
        if entry["half_width"] > dc["band_interval_max_half_width"]:
            continue
        if not (entry["ci95"][0] <= entry["mean_predicted"] <= entry["ci95"][1]):
            continue
        displayable.append(entry)
    if len(displayable) < dc["min_displayed_bands_for_validated"]:
        need(
            "calibrated_displayable_band",
            "no probability band met the predeclared count, containment and width conditions",
            len(displayable),
            dc["min_displayed_bands_for_validated"],
            "reliability_bands[]",
        )

    data["missing_requirements"] = missing
    data["claimed_clients"] = claimed

    if missing:
        data["status"] = "experimental"
        data["displayed_probabilities"] = []
        data["effectiveness_claim"] = False
        data["private_experimental_likelihoods"] = {
            "logged_for_later_comparison": True,
            "displayed": False,
            "note": "An experimental likelihood may be logged privately; it is not user guidance.",
        }
        return data

    scope = {
        "endpoint": canonical["endpoint"],
        "clients": claimed,
        "platform": canonical["platform"],
        "formats": sorted({(r.get("features") or {}).get("format") or "unknown" for r in test}),
        "period": {
            "first_test_forecast_at": min(r["forecast_at"] for r in test),
            "last_test_label_observed_at": max(r["label_observed_at"] for r in test),
        },
        "limits": (
            "Validated only for these clients, this platform and this endpoint. Abstain outside "
            "this scope and revalidate before widening it."
        ),
    }
    data["validated_scope"] = scope
    data["displayed_probabilities"] = [dict(e, scope=scope) for e in displayable]
    data["status"] = "validated_for_scope"
    data["effectiveness_claim"] = True
    return data


def _count(rows, key):
    out = {}
    for r in rows:
        v = r.get(key)
        if v:
            out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items()))


def _feature_defaults(train):
    def med(key):
        vals = [
            (r.get("features") or {}).get(key)
            for r in train
            if (r.get("features") or {}).get(key) is not None
        ]
        vals = sorted(float(v) for v in vals)
        if not vals:
            return None
        return vals[len(vals) // 2]

    return {
        "body_chars": med("body_chars"),
        "published_hour": med("published_hour"),
        "published_dow": med("published_dow"),
        "baseline_median": med("baseline_median"),
        "baseline_n": med("baseline_n"),
    }


def _weekly_selection_precision(test, top_k=5):
    weeks = {}
    for r in test:
        weeks.setdefault(r["block"].split(":")[1], []).append(r)
    per_week = []
    for week in sorted(weeks):
        rs = sorted(weeks[week], key=lambda r: -r["p"])[:top_k]
        per_week.append(
            {
                "week": week,
                "selected": len(rs),
                "precision": sum(r["y"] for r in rs) / len(rs) if rs else None,
            }
        )
    valid = [w for w in per_week if w["precision"] is not None]
    return {
        "top_k_per_week": top_k,
        "weeks": per_week,
        "pooled_precision": (sum(w["precision"] for w in valid) / len(valid)) if valid else None,
        "note": (
            "Selection precision describes performance among pieces actually selected. Human "
            "selection is a bias, not a causal effect on unchosen ideas. Deteriorating weeks are "
            "reported, never hidden."
        ),
    }


def score_features(model, features):
    """Calibrated probability for one pre-decision feature dictionary."""
    sc = model["scaler"]
    x = _standardize(_raw_vector(features), sc)
    z = model["intercept"] + sum(model["coefficients"][j] * x[j] for j in range(len(x)))
    return _clip(
        _sigmoid(model["platt"]["intercept"] + model["platt"]["slope"] * _logit(_sigmoid(z)))
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True, help="JSON with outcomes/sources/native_index paths")
    ap.add_argument("--out", required=True)
    ap.add_argument("--rows", help="optional path to write the full row-level data object")
    args = ap.parse_args(argv)

    with open(args.inputs, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    protocol = dataset.load_protocol(cfg["protocol"])
    with open(cfg["outcomes"], "r", encoding="utf-8") as fh:
        outcomes = json.load(fh)
    with open(cfg["sources"], "r", encoding="utf-8") as fh:
        sources = [s for s in json.load(fh) if s.get("source_kind") == "own_post"]
    native_index = build_native_index(sources, cfg.get("native_captures", []))

    built = dataset.build_dataset(
        outcomes=outcomes,
        own_sources=sources,
        native_index=native_index,
        protocol=protocol,
        evidence_id=cfg.get("evidence_id", "outcomes_source"),
        source_evidence_id=cfg.get("source_evidence_id", "sources_index"),
    )
    data = build_evaluation(built["rows"], protocol)
    data["manifest"] = built["manifest"]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    if args.rows:
        with open(args.rows, "w", encoding="utf-8") as fh:
            json.dump(built, fh, indent=2)
    print(f"status={data['status']} rows={len(data['rows'])} missing={len(data['missing_requirements'])}")
    return 0


def build_native_index(own_sources, native_capture_paths):
    """Pre-decision metadata per publication: format, topic, length, test flag."""
    index = {}
    for s in own_sources:
        cf = s.get("candidate_fields") or {}
        native = (cf.get("source_identity") or {}).get("native_id")
        if not native:
            continue
        passage = s.get("passage") or ""
        index[native] = {
            "format": "unknown",
            "topic_category": None,
            "body_chars": len(passage) if passage else None,
            "is_test": False,
            "selection_policy": "consecutive_roster",
            "published_at": s.get("source_published_at"),
        }
    for path in native_capture_paths:
        with open(path, "r", encoding="utf-8") as fh:
            captured = json.load(fh)
        for row in captured:
            native = row.get("social_id")
            if not native or native not in index:
                continue
            index[native]["format"] = row.get("post_type") or "unknown"
            index[native]["topic_category"] = row.get("topic_category")
            text = row.get("post_text") or ""
            if text:
                index[native]["body_chars"] = len(text)
    return index


if __name__ == "__main__":
    sys.exit(main())
