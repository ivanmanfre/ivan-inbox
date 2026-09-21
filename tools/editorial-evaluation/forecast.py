#!/usr/bin/env python3
"""Versioned forecast records on the existing immutable brief contract.

No new physical table. A forecast lives as:

  * `editorial_brief_versions.payload.forecast` -- the frozen record, written with
    the brief version it belongs to; the `editorial_brief_versions_immutable`
    trigger blocks any later update or delete;
  * `editorial_brief_artifacts` with `artifact_role='forecast'` -- primary key
    (client_id, brief_id, version, artifact_role) plus unique (client_id,
    request_id), so replaying the same request collides instead of creating a
    second forecast, and `editorial_brief_artifacts_immutable` blocks mutation.

`ForecastStore` below is the in-process stand-in used by tests and by the
evaluator's dry runs. It enforces exactly those two constraints so the behaviour
is provable without touching a database.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import evaluate as evaluator

ARTIFACT_ROLE = "forecast"


class ImmutableForecast(Exception):
    """A recorded forecast cannot be changed by a later observation."""


def _canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def forecast_id(brief, protocol_hash, model_version) -> str:
    payload = [
        brief["client_id"],
        brief["brief_id"],
        int(brief["version"]),
        brief["content_hash"],
        protocol_hash,
        model_version,
    ]
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def request_id(brief, protocol_hash, model_version) -> str:
    return "forecast:" + forecast_id(brief, protocol_hash, model_version)[:32]


def likelihood_for(brief, evaluation, protocol, features=None):
    """Return the displayable likelihood, or abstain with an explicit reason."""
    canonical = protocol["canonical"]
    limitations = []
    status = evaluation.get("status")
    if status != "validated_for_scope":
        return {
            "likelihood": None,
            "status": status or "insufficient_data",
            "endpoint": canonical["endpoint"],
            "scope": evaluation.get("validated_scope"),
            "limitations": [
                "No validated numeric likelihood exists for this endpoint; the evaluator "
                f"status is {status!r}. No success probability is displayed."
            ],
        }

    scope = evaluation["validated_scope"]
    if brief.get("client_id") not in scope["clients"]:
        limitations.append(
            f"client {brief.get('client_id')!r} is outside the validated client scope "
            f"{scope['clients']}"
        )
    if brief.get("platform", canonical["platform"]) != scope["platform"]:
        limitations.append(
            f"platform {brief.get('platform')!r} is outside the validated platform "
            f"{scope['platform']!r}"
        )
    fmt = brief.get("format", "unknown")
    if fmt not in scope["formats"]:
        limitations.append(f"format {fmt!r} is outside the validated formats {scope['formats']}")
    if brief.get("language", "en") != "en":
        limitations.append(f"language {brief.get('language')!r} is outside the evaluated language")
    if limitations:
        return {
            "likelihood": None,
            "status": "out_of_scope",
            "endpoint": canonical["endpoint"],
            "scope": scope,
            "limitations": limitations,
        }

    defaults = evaluation["model"]["feature_defaults"]
    resolved = {
        "format": fmt,
        "client": brief["client_id"],
        "topic_category": brief.get("topic_family"),
        "body_chars": brief.get("body_chars", defaults.get("body_chars")),
        "published_hour": brief.get("published_hour", defaults.get("published_hour")),
        "published_dow": brief.get("published_dow", defaults.get("published_dow")),
        "baseline_median": brief.get("baseline_median", defaults.get("baseline_median")),
        "baseline_n": brief.get("baseline_n", defaults.get("baseline_n")),
    }
    if features:
        resolved.update(features)
    return {
        "likelihood": float(evaluator.score_features(evaluation["model"], resolved)),
        "status": "validated_for_scope",
        "endpoint": canonical["endpoint"],
        "scope": scope,
        "limitations": [
            "Calibrated only inside the declared scope and only for the own seven-day reach "
            "endpoint; it is not a market, sales or new-author likelihood."
        ],
        "features_used": resolved,
    }


def build_record(brief, evaluation, protocol, forecast_at=None):
    outcome = likelihood_for(brief, evaluation, protocol)
    fid = forecast_id(brief, evaluation["protocol_hash"], evaluation["model_version"])
    return {
        "forecast_id": fid,
        "request_id": request_id(brief, evaluation["protocol_hash"], evaluation["model_version"]),
        "client_id": brief["client_id"],
        "brief_id": brief["brief_id"],
        "brief_version": int(brief["version"]),
        "content_hash": brief["content_hash"],
        "artifact_role": ARTIFACT_ROLE,
        "forecast_at": forecast_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "evidence_cutoff": brief.get("source_cutoff"),
        "model_version": evaluation["model_version"],
        "protocol_hash": evaluation["protocol_hash"],
        "feature_snapshot_hash": hashlib.sha256(
            _canonical(outcome.get("features_used") or {}).encode("utf-8")
        ).hexdigest(),
        "endpoint": outcome["endpoint"],
        "baseline_snapshot_id": brief.get("baseline_snapshot_id"),
        "likelihood": outcome["likelihood"],
        "status": outcome["status"],
        "eligible_population": evaluation["population"]["test"],
        "evaluation_report_id": evaluation.get("report_id"),
        "limitations": outcome["limitations"],
    }


class ForecastStore:
    """Mirrors the two database constraints that make replay safe."""

    def __init__(self):
        self._by_version = {}
        self._by_request = {}
        self.writes = 0

    def count(self):
        return len(self._by_version)

    def get(self, client_id, brief_id, version):
        return self._by_version.get((client_id, brief_id, int(version), ARTIFACT_ROLE))

    def insert(self, record):
        key = (
            record["client_id"],
            record["brief_id"],
            int(record["brief_version"]),
            record["artifact_role"],
        )
        rkey = (record["client_id"], record["request_id"])
        existing = self._by_version.get(key) or self._by_request.get(rkey)
        if existing is not None:
            # Primary-key / unique-request collision: return the original,
            # write nothing. This is what a replayed request must do.
            return existing
        self._by_version[key] = record
        self._by_request[rkey] = record
        self.writes += 1
        return record

    def update(self, client_id, brief_id, version, patch):
        raise ImmutableForecast(
            "editorial_brief_artifacts/editorial_brief_versions are immutable; a later "
            "observation cannot rewrite a recorded forecast. Record a new brief version instead."
        )

    def delete(self, *_args, **_kwargs):
        raise ImmutableForecast("recorded forecasts are append-only")


def record_forecast(store, brief, evaluation, protocol, forecast_at=None):
    return store.insert(build_record(brief, evaluation, protocol, forecast_at=forecast_at))
