#!/usr/bin/env python3
"""Build the frozen-protocol evaluation dataset from immutable retained snapshots.

Only stdlib. Nothing here reaches the network, a provider, Supabase or n8n.

Every retained observation that enters this module leaves it as exactly one row:
either an eligible partitioned row, or an `excluded` row carrying the precise
reason it cannot serve the frozen endpoint. A missing metric is never a zero and
a later total is never a seven-day measurement.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

DAY = timedelta(days=1)
PARTITION_ORDER = {"train": 0, "calibration": 1, "test": 2}

# The only feature keys a row may carry. Anything else is treated as leakage.
ALLOWED_FEATURE_KEYS = {
    "format",
    "client",
    "topic_category",
    "body_chars",
    "published_hour",
    "published_dow",
    "baseline_median",
    "baseline_n",
}

FORMAT_VALUES = ["text", "image", "carousel", "video", "unknown"]


class ProtocolError(Exception):
    """The frozen protocol document does not verify."""


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_text(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def load_protocol(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    if doc.get("schema") != "editorial-evaluation-protocol-v1":
        raise ProtocolError("unexpected protocol schema")
    serialized = doc.get("canonical_serialized")
    if not isinstance(serialized, str):
        raise ProtocolError("protocol is missing its canonical serialization")
    if canonical_text(doc.get("canonical")) != serialized:
        raise ProtocolError("protocol body does not match its frozen serialization")
    if sha256_text(serialized) != doc.get("protocol_hash"):
        raise ProtocolError("protocol hash does not match its frozen serialization")
    return doc


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _number(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _median(values):
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return None
    mid = n // 2
    if n % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _scope_rank(scope: str) -> int:
    # Prefer the collector table that also carries the refresh receipt.
    return 0 if "own_posts" in (scope or "") else 1


# ---------------------------------------------------------------------------
# Row construction
# ---------------------------------------------------------------------------


def build_dataset(
    *,
    outcomes,
    own_sources,
    native_index,
    protocol,
    evidence_id,
    source_evidence_id,
    reference_now=None,
):
    """Return {"rows": [...], "manifest": {...}} for the frozen endpoint."""
    canonical = protocol["canonical"]
    metric = canonical["metric_name"]
    role = canonical["artifact_role"]
    label_cfg = canonical["label"]
    base_cfg = canonical["baseline"]
    clients = set(canonical["clients"])

    low = timedelta(days=label_cfg["target_age_days"]) - timedelta(
        hours=label_cfg["tolerance_hours"]
    )
    high = timedelta(days=label_cfg["target_age_days"]) + timedelta(
        hours=label_cfg["tolerance_hours"]
    )

    # Pass 1 -- normalise every retained observation, without judging it yet.
    observations = []
    for o in outcomes:
        pub = o.get("publication_id")
        published = parse_ts(o.get("window_start"))
        captured = parse_ts(o.get("window_end")) or parse_ts(o.get("captured_at"))
        entry = dict(
            native_index.get(f"{o.get('client_id')}:{pub}") or {}
        ) if pub else {}
        if published is None and entry.get("published_at"):
            published = parse_ts(entry["published_at"])
        value = _number(o.get("observed_value"))
        unknown_reason = o.get("unknown_reason")
        age = None
        if published and captured:
            age = (captured - published).total_seconds() / 86400.0
        observations.append(
            {
                "raw": o,
                "client": o.get("client_id"),
                "publication_id": pub,
                "snapshot_id": o.get("snapshot_id"),
                "metric": o.get("metric"),
                "role": o.get("artifact_role"),
                "scope": o.get("scope"),
                "published": published,
                "captured": captured,
                "value": value,
                "unknown_reason": unknown_reason,
                "eligibility_veto_reason": o.get("eligibility_veto_reason"),
                "age_days": age,
                "entry": entry,
                "in_window": bool(
                    published
                    and captured
                    and low <= (captured - published) <= high
                ),
            }
        )

    # Pass 2 -- the set of observations that can legitimately serve as a label or
    # as a prior baseline point: real value, endpoint metric, seven-day capture.
    label_pool = [
        ob
        for ob in observations
        if ob["metric"] == metric
        and ob["role"] == role
        and ob["value"] is not None
        and not ob["unknown_reason"]
        and not ob["eligibility_veto_reason"]
        and ob["in_window"]
        and ob["client"] in clients
        and ob["publication_id"]
        and not ob["entry"].get("is_test")
        and (ob["entry"].get("selection_policy") or "consecutive_roster") == canonical["selection_policy"]
    ]
    label_pool_ids = {ob["snapshot_id"] for ob in label_pool}

    # Canonical observation per publication (a publication captured by two
    # collector scopes must not become two evaluation targets).
    canonical_snapshot = {}
    for ob in observations:
        if not ob["publication_id"] or ob["metric"] != metric or ob["role"] != role:
            continue
        key = (ob["client"], ob["publication_id"])
        rank = (
            0 if not ob["eligibility_veto_reason"] else 1,
            0 if (ob["value"] is not None and not ob["unknown_reason"]) else 1,
            0 if ob["in_window"] else 1,
            abs((ob["age_days"] or 1e9) - label_cfg["target_age_days"]),
            ob["captured"] or datetime.max.replace(tzinfo=timezone.utc),
            str(ob["snapshot_id"]),
        )
        prev = canonical_snapshot.get(key)
        if prev is None or rank < prev[0]:
            canonical_snapshot[key] = (rank, ob["snapshot_id"])

    rows = []
    counts = {}

    def bump(code):
        counts[code] = counts.get(code, 0) + 1

    for ob in observations:
        raw = ob["raw"]
        client = ob["client"]
        pub = ob["publication_id"]
        entry = ob["entry"]
        published = ob["published"]
        fmt = entry.get("format") or "unknown"
        row = {
            "id": f"outcome:{client}:{ob['snapshot_id']}",
            "client": client if client in clients else "ivan",
            "partition": None,
            "evidence": evidence_id,
            "exclusion_reason": None,
            "exclusion_code": None,
            "is_test": bool(entry.get("is_test")),
            "value": None,
            "selection_policy": entry.get("selection_policy") or "consecutive_roster",
            "feature_available_at": None,
            "forecast_at": None,
            "baseline_last_observed_at": None,
            "label_observed_at": None,
            "published_at": iso(published) if published else None,
            "baseline_n": 0,
            "baseline_median": None,
            "baseline_format_scope": None,
            "y": None,
            "group": f"publication:{pub}" if pub else f"snapshot:{ob['snapshot_id']}",
            "block": None,
            "metric": ob["metric"],
            "publication_id": pub,
            "capture_age_days": round(ob["age_days"], 3) if ob["age_days"] is not None else None,
            "unknown_reason": ob["unknown_reason"],
            "collector_scope": ob["scope"],
            # True only when this retained observation is itself a usable
            # seven-day measurement of the endpoint metric.
            "seven_day_label_available": ob["snapshot_id"] in label_pool_ids,
            "features": None,
        }

        def exclude(code, reason):
            row["partition"] = "excluded"
            row["exclusion_code"] = code
            row["exclusion_reason"] = reason
            bump(code)
            rows.append(row)

        if client not in clients:
            exclude(
                "outcome_selected_cohort",
                f"observation is scoped to unregistered client {client!r}",
            )
            continue
        if ob["eligibility_veto_reason"]:
            exclude(
                "source_observation_conflict",
                "source identity is quarantined (" + str(ob["eligibility_veto_reason"])
                + "); a preserved first observation cannot remain clean after a conflicting replay",
            )
            continue
        if not pub:
            exclude(
                "no_publication_identity",
                "retained observation carries no publication identity, so no own post can be scored",
            )
            continue
        if ob["metric"] != metric or ob["role"] != role:
            exclude(
                "wrong_endpoint_metric",
                f"metric {ob['metric']!r}/role {ob['role']!r} is outside the frozen endpoint "
                f"({metric} on {role}); another metric is never substituted for impressions",
            )
            continue
        if published is None:
            exclude(
                "publication_date_unknown",
                "publication date unknown, so no seven-day window can be defined",
            )
            continue
        if row["is_test"]:
            exclude(
                "test_generated_post",
                "test-generated publication; a test row cannot become evaluation evidence",
            )
            continue
        if row["selection_policy"] != canonical["selection_policy"]:
            exclude(
                "outcome_selected_cohort",
                f"selection policy {row['selection_policy']!r} is outcome-dependent; only "
                f"{canonical['selection_policy']!r} may estimate a base rate",
            )
            continue
        if canonical_snapshot.get((client, pub), (None, None))[1] != ob["snapshot_id"]:
            exclude(
                "duplicate_scope_observation",
                "second collector-scope observation of the same publication; the canonical "
                "observation for this publication is scored instead",
            )
            continue
        if ob["value"] is None or ob["unknown_reason"]:
            code = (
                "metric_unknown_no_refresh_receipt"
                if (ob["unknown_reason"] or "").lower().find("metrics_updated_at") >= 0
                else "metric_not_retained"
            )
            exclude(
                code,
                "metric is unknown ("
                + (ob["unknown_reason"] or "no observed value retained")
                + "); an unknown metric is never read as zero",
            )
            continue
        if not ob["in_window"]:
            exclude(
                "capture_outside_seven_day_window",
                f"capture at +{ob['age_days']:.1f}d, no seven-day capture inside "
                f"±{label_cfg['tolerance_hours']}h of publication+"
                f"{label_cfg['target_age_days']}d; a later total is not a seven-day measurement",
            )
            continue

        forecast_at = published
        label_at = ob["captured"]

        # Baseline: this author's own prior seven-day observations whose window
        # completed strictly before the forecast time, inside the lookback.
        window_floor = forecast_at - timedelta(days=base_cfg["lookback_days"])
        priors = [
            p
            for p in label_pool
            if p["client"] == client
            and p["snapshot_id"] != ob["snapshot_id"]
            and p["publication_id"] != pub
            and p["captured"] < forecast_at
            and window_floor <= p["published"] < forecast_at
        ]
        # The frozen baseline counts prior publications, not repeated captures.
        # Deduplicate after the as-of filter: a later, closer capture must never
        # erase a valid earlier observation available at this forecast time.
        prior_publications = {}
        for prior in priors:
            key = (prior["client"], prior["publication_id"])
            rank = (
                abs(prior["age_days"] - label_cfg["target_age_days"]),
                prior["captured"],
                str(prior["snapshot_id"]),
            )
            existing = prior_publications.get(key)
            if existing is None or rank < existing[0]:
                prior_publications[key] = (rank, prior)
        priors = [prior_publications[key][1] for key in sorted(prior_publications)]
        same_format = [
            p for p in priors if (p["entry"].get("format") or "unknown") == fmt and fmt != "unknown"
        ]
        if len(same_format) >= base_cfg["same_format_minimum"]:
            chosen, scope_label = same_format, "same_format"
        else:
            chosen, scope_label = priors, "all_format_fallback"

        row["baseline_n"] = len(chosen)
        row["baseline_publication_ids"] = [p["publication_id"] for p in chosen]
        row["baseline_snapshot_ids"] = [p["snapshot_id"] for p in chosen]
        row["baseline_format_scope"] = scope_label
        row["baseline_median"] = _median([p["value"] for p in chosen])
        row["baseline_last_observed_at"] = (
            iso(max(p["captured"] for p in chosen)) if chosen else None
        )

        if row["baseline_n"] < base_cfg["min_prior_observations"] or row["baseline_median"] is None:
            exclude(
                "baseline_population_insufficient",
                f"{row['baseline_n']} eligible prior seven-day observations in the preceding "
                f"{base_cfg['lookback_days']}d ({scope_label}); the frozen endpoint needs "
                f"{base_cfg['min_prior_observations']}",
            )
            continue

        iso_year, iso_week, _ = published.isocalendar()
        row["value"] = ob["value"]
        row["y"] = int(ob["value"] > row["baseline_median"])
        row["forecast_at"] = iso(forecast_at)
        row["feature_available_at"] = iso(forecast_at - timedelta(minutes=1))
        row["label_observed_at"] = iso(label_at)
        row["block"] = f"{client}:{iso_year}-W{iso_week:02d}"
        row["features"] = {
            "format": fmt,
            "client": client,
            "topic_category": entry.get("topic_category"),
            "body_chars": entry.get("body_chars"),
            "published_hour": published.hour,
            "published_dow": published.weekday(),
            "baseline_median": row["baseline_median"],
            "baseline_n": row["baseline_n"],
        }
        rows.append(row)

    # Retained own sources that never produced a metric observation still have to
    # appear; silence would understate the denominator.
    seen_pubs = {r["publication_id"] for r in rows if r["publication_id"]}
    for s in own_sources:
        cf = s.get("candidate_fields") or {}
        native = ((cf.get("source_identity") or {}).get("native_id")) if cf else None
        if native and native in seen_pubs:
            continue
        rows.append(
            {
                "id": f"source:{s.get('client_id')}:{s.get('source_id')}",
                "client": s.get("client_id") if s.get("client_id") in clients else "ivan",
                "partition": "excluded",
                "evidence": source_evidence_id,
                "exclusion_code": "no_publication_identity",
                "exclusion_reason": (
                    "retained own source with no collector source identity and no retained metric "
                    "observation, so it cannot carry a seven-day endpoint measurement"
                ),
                "is_test": False,
                "value": None,
                "selection_policy": "consecutive_roster",
                "feature_available_at": None,
                "forecast_at": None,
                "baseline_last_observed_at": None,
                "label_observed_at": None,
                "published_at": s.get("source_published_at"),
                "baseline_n": 0,
                "baseline_median": None,
                "baseline_format_scope": None,
                "y": None,
                "group": f"source:{s.get('source_id')}",
                "block": None,
                "metric": None,
                "publication_id": native,
                "capture_age_days": None,
                "unknown_reason": None,
                "collector_scope": None,
                "seven_day_label_available": False,
                "features": None,
            }
        )
        bump("no_publication_identity")

    rows = assign_partitions(rows, protocol)

    manifest = {
        "protocol_hash": protocol["protocol_hash"],
        "endpoint": canonical["endpoint"],
        "built_at": iso(reference_now or datetime.now(timezone.utc)),
        "retained_observations_in": len(outcomes),
        "retained_own_sources_in": len(own_sources),
        "rows_out": len(rows),
        "eligible_rows": sum(1 for r in rows if r["partition"] != "excluded"),
        "excluded_rows": sum(1 for r in rows if r["partition"] == "excluded"),
        "label_pool_seven_day_observations": len(label_pool),
        "exclusion_counts": dict(sorted(counts.items())),
        "partition_counts": {
            p: sum(1 for r in rows if r["partition"] == p)
            for p in ("train", "calibration", "test", "excluded")
        },
        "per_client": {},
        "is_test_basis": (
            "The retained own-post contract (own_posts, client_post_metrics, "
            "editorial_outcome_snapshots) carries no is_test column; a publication is treated as "
            "non-test only because it was captured as a real published own post, and any supplied "
            "test flag excludes the row."
        ),
    }
    for c in sorted(clients):
        cr = [r for r in rows if r["client"] == c]
        manifest["per_client"][c] = {
            "rows": len(cr),
            "eligible": sum(1 for r in cr if r["partition"] != "excluded"),
            "excluded": sum(1 for r in cr if r["partition"] == "excluded"),
            "publications": len({r["publication_id"] for r in cr if r["publication_id"]}),
            "seven_day_capture_observations": sum(
                1 for p in label_pool if p["client"] == c
            ),
            "exclusion_counts": _count_by(cr, "exclusion_code"),
        }
    return {"rows": rows, "manifest": manifest}


def _count_by(rows, key):
    out = {}
    for r in rows:
        v = r.get(key)
        if v:
            out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items()))


# ---------------------------------------------------------------------------
# Chronological partitions with maturity gaps
# ---------------------------------------------------------------------------


def assign_partitions(rows, protocol):
    """Chronological train/calibration/test, never random, never overlapping.

    A row whose label matures after the next partition's first forecast would
    leak the future into a fit, so it is excluded rather than reassigned.
    """
    cfg = protocol["canonical"]["partitions"]
    candidates = [r for r in rows if r.get("partition") is None]
    candidates.sort(key=lambda r: (r["forecast_at"], r["id"]))
    n = len(candidates)
    if n == 0:
        return rows

    def fa(r):
        return parse_ts(r["forecast_at"])

    def la(r):
        return parse_ts(r["label_observed_at"])

    k1 = int(n * cfg["train_fraction"])
    train = candidates[:k1]
    rest = candidates[k1:]
    b1 = max((la(r) for r in train), default=None)
    gap1 = [r for r in rest if b1 is not None and fa(r) <= b1]
    remaining = [r for r in rest if b1 is None or fa(r) > b1]

    k2 = int(len(remaining) * cfg["calibration_fraction_of_remainder"])
    cal = remaining[:k2]
    tail = remaining[k2:]
    b2 = max((la(r) for r in cal), default=None)
    gap2 = [r for r in tail if b2 is not None and fa(r) <= b2]
    test = [r for r in tail if b2 is None or fa(r) > b2]

    for r in train:
        r["partition"] = "train"
    for r in cal:
        r["partition"] = "calibration"
    for r in test:
        r["partition"] = "test"
    for r in gap1 + gap2:
        r["partition"] = "excluded"
        r["exclusion_code"] = "temporal_partition_gap"
        r["exclusion_reason"] = (
            "forecast time falls inside the maturity gap that keeps the previous partition's "
            "labels from leaking into the next partition's fit"
        )

    # A duplicate/repost/event group may not straddle partitions: keep the
    # earliest partition, exclude the later copies.
    first = {}
    for r in train + cal + test:
        rank = PARTITION_ORDER[r["partition"]]
        if r["group"] not in first or rank < first[r["group"]]:
            first[r["group"]] = rank
    for r in train + cal + test:
        if PARTITION_ORDER[r["partition"]] != first[r["group"]]:
            r["partition"] = "excluded"
            r["exclusion_code"] = "group_straddles_partition"
            r["exclusion_reason"] = (
                "duplicate/repost/event group already appears in an earlier partition; copies of "
                "one event may not straddle a split"
            )
    return rows
