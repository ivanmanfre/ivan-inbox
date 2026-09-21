# tools/editorial-evaluation

Measured ranking/evaluation module for the frozen own-reach endpoint
`own_seven_day_impressions_above_prior_median`. Python 3 standard library only;
no network, provider, Supabase or n8n access, and no production write.

```
protocol.json       frozen measurement protocol (hash-verified on load)
dataset.py          retained snapshots -> row-level dataset + exclusion report
evaluate.py         integrity gate, baselines, one regularized logistic, display conditions
forecast.py         versioned forecast records on the existing immutable brief contract
test_evaluate.py    negative controls (written first) + one positive control
```

Run the tests:

```
python3 -m unittest discover -s tools/editorial-evaluation -t tools/editorial-evaluation
```

Run the evaluator over an input manifest:

```
python3 tools/editorial-evaluation/evaluate.py --inputs <inputs.json> --out <report.json>
```

## What a passing run does and does not mean

`status: insufficient_data` is a correct, expected result when no eligible
seven-day capture population exists. A completed run proves the evaluator works.
It never proves the forecasts are accurate. Only `validated_for_scope` supports a
displayed probability, and only inside `validated_scope`.

## Protocol freeze

`protocol.json` carries `canonical`, its canonical serialization and the sha256
of that serialization. `dataset.load_protocol` refuses a document whose body,
serialization and hash disagree, so a threshold cannot be quietly relaxed after
looking at labels. Every threshold is taken from
`DATA-AND-EVALUATION.md` (sha256 recorded in the document).

## Forecast storage: no new physical table

A3 did not surface a requirement the existing contract cannot express, so no
migration is proposed. A forecast is stored as:

* `editorial_brief_versions.payload.forecast` — written with the brief version it
  belongs to. `editorial_brief_versions_immutable` blocks update and delete, so a
  later observation cannot rewrite a recorded prediction. A later edit is a new
  brief version with its own forecast; the previous one is preserved.
* `editorial_brief_artifacts` with `artifact_role='forecast'` — the primary key
  `(client_id, brief_id, version, artifact_role)` and the unique
  `(client_id, request_id)` make a replayed request collide instead of creating a
  second forecast. `request_id` is derived deterministically from
  `(client_id, brief_id, version, content_hash, protocol_hash, model_version)`.

`forecast.ForecastStore` mirrors exactly those two constraints in-process so the
replay and immutability behaviour is testable without a database.

## Observation-path limitation (carried forward, not solved here)

The existing own-metric collectors append a capture when they run; they are not
scheduled to land inside publication+7d ±24h. This module does not add a
scheduler, trigger or fetch to change that. Where the timing misses the window,
the observation stays ineligible and the forecast stays unevaluated.
