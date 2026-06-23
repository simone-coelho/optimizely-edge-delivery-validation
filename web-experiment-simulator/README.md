# Optimizely Web — Synthetic Visitor Simulator

Generate synthetic bucketing + conversion data for a **normal browser-snippet
Optimizely Web Experimentation experiment** and post it to Optimizely's Event
API, so the experiment's **Results page fills in across the days you choose**
(e.g. Saturday, Sunday, today) for any number of visitors.

This is the non‑edge counterpart to the edge-delivery validation kit in the
parent folder. It does not touch a browser — it reproduces what the browser
snippet does (decide a variation for a visitor, then report that decision and
any conversions back to Optimizely) for N synthetic visitors at once, with
**controlled timestamps** so each event is attributed to the day you want.

Pure Node.js 18+. No `npm install` — uses built-in `fetch`.

---

## How the real thing works (and what we replicate)

When a visitor loads a page running the Optimizely Web snippet:

1. The snippet reads the project config (the datafile embedded in the snippet),
   finds the active experiment, and **buckets the visitor** — a deterministic
   hash of the visitor's id + the experiment id, mapped onto the experiment's
   traffic allocation, decides the variation.
2. The snippet **POSTs that decision back to Optimizely's event endpoint**
   (`https://logx.optimizely.com/v1/events`) as a `campaign_activated` event.
   That impression is what the Results page counts as a *unique visitor* for the
   variation.
3. Later, when the visitor triggers a tracked goal (click, pageview, custom
   event), the snippet POSTs a **conversion event** to the same endpoint.

The stats engine then joins decisions and conversions by `visitor_id` and
computes conversion rate + significance per variation.

> **The timestamp is the source of truth for the date.** Optimizely attributes
> every event to the calendar day of the `timestamp` *in the payload* (Unix
> epoch **milliseconds**) — **not** the wall-clock time the request arrives. That
> is exactly why we can backfill Saturday/Sunday/today: we just stamp each event
> with a time inside that day.

This tool does steps 1–3 directly against the Event API. The endpoint **requires
no auth token** (it's the same public ingestion endpoint the browser hits), so a
correctly-shaped payload with valid IDs is all it takes.

### Two rules the engine enforces (the tool guarantees both)

1. A **conversion with a timestamp earlier than its visitor's
   `campaign_activated`** event is silently dropped. We always place conversions
   strictly *after* activation.
2. A **future-dated** event is rejected/clamped. We never place an event after
   "now"; today's events are spread only up to the current moment.

---

## Quick start

```bash
cd web-experiment-simulator

# 1. Copy the template and fill in your experiment's IDs (see below)
cp experiments/example.json experiments/my-test.json

# 2. Dry run — generates the full population, prints a summary, writes a sample
#    payload, sends NOTHING.
node simulate.js --experiment experiments/my-test.json

# 3. Inspect the exact JSON that would be sent
cat runs/<timestamp>/sample-payload.json

# 4. When you're happy, send it for real
node simulate.js --experiment experiments/my-test.json --send
```

Dry run is the default. **Nothing is sent until you pass `--send`.**

Example dry-run summary (10,000 visitors, 50/50, control 10% vs variant 12%):

```
  Population
  Total visitors: 10,000   Total conversion events: 1,096

  Variation               Visitors   Share       cta_click     CR%
  Original                   4,996   50.0%             494   9.89%
  Variation #1               5,004   50.0%             602  12.03%

  Per-day spread
  2026-06-06       3,503    ████████████████████████████
  2026-06-07       3,514    ████████████████████████████
  2026-06-08       2,983    ████████████████████████░░░░   ← "today" only fills up to now
```

---

## Where to get the IDs

The manifest needs five kinds of ID. The fastest way to read them all is the
browser console **on a page where your experiment's snippet is running**. Paste
this and it prints a ready-to-map manifest skeleton:

```js
(function () {
  const d = window.optimizely && window.optimizely.get && window.optimizely.get('data');
  if (!d) { console.warn('Run this on a page where the Optimizely snippet is active.'); return; }
  const campaigns = d.campaigns || {}, exps = d.experiments || {};
  const expToCampaign = {};
  Object.keys(campaigns).forEach(cid =>
    (campaigns[cid].experimentIds || []).forEach(eid => (expToCampaign[eid] = cid)));
  const out = {
    account_id: String(d.accountId), project_id: String(d.projectId),
    experiments: Object.keys(exps).map(eid => ({
      experiment_id: String(eid), name: exps[eid].name,
      campaign_id: String(exps[eid].layerId || expToCampaign[eid] || ''),
      variations: (exps[eid].variations || []).map(v => ({ id: String(v.id), name: v.name, weight: v.weight })),
    })),
    events: Object.keys(d.events || {}).map(id => ({ entity_id: String(id), key: (d.events[id].apiName || d.events[id].name) })),
  };
  console.log(JSON.stringify(out, null, 2)); return out;
})();
```

| Manifest field        | What it is                          | Also findable in        |
|-----------------------|-------------------------------------|-------------------------|
| `account_id`          | Optimizely account id               | UI → Settings; REST API |
| `project_id`          | Project id                          | URL of the project      |
| `campaign_id`         | The experiment's **layer/campaign** id (a standard A/B test lives in one layer) | datafile `layerId` |
| `experiment_id`       | The experiment id                   | Experiment URL / API    |
| `variations[].id`     | Each variation id                   | Variation settings      |
| `metrics[].entity_id` | The tracked event/metric id         | Events dashboard        |
| `metrics[].key`       | The event **api_name** (its "key")  | Event settings          |

> Snippet field names vary slightly across snippet versions. Cross-check against
> Optimizely's *Find IDs for API calls* support article or the REST API if a
> value looks off. The numeric IDs themselves are stable.

---

## The experiment manifest

```jsonc
{
  "name": "Homepage CTA — A/B test (SYNTHETIC)",
  "region": "US",                       // US or EU (selects the logx endpoint)

  "account_id": "1887578053",
  "project_id": "12345678",
  "campaign_id": "9560823711",          // the layer/campaign id
  "experiment_id": "5733750339",

  "variations": [
    { "id": "6630810318", "name": "Original",     "weight": 50 },
    { "id": "6630810319", "name": "Variation #1", "weight": 50 }
  ],

  "metrics": [
    {
      "name": "Primary CTA click",
      "entity_id": "10412290000",       // the event id
      "key": "cta_click",               // the event api_name
      "rates": {                        // per-variation conversion probability
        "6630810318": 0.10,
        "6630810319": 0.12
      },
      "revenueCents": [1500, 8000]       // optional: per-conversion revenue range (cents)
    }
  ],

  "visitors": 10000,
  "assignment": "weighted",             // "weighted" (default) or "murmurhash"
  "seed": 1,                            // same seed → identical population

  "dates": {
    "days": ["2026-06-06", "2026-06-07", "2026-06-08"],
    "weights": [0.35, 0.35, 0.30],      // relative traffic per day (optional)
    "diurnal": true,                    // realistic intraday curve vs uniform
    "timezoneOffsetMinutes": 0          // day boundaries in this offset (e.g. -300 = US Eastern)
  },

  "conversion": {
    "delaySecondsMin": 30,              // how long after activation conversions land
    "delaySecondsMax": 1800
  },

  "client_name": "synthetic-data-harness",  // identifies this traffic as synthetic
  "anonymize_ip": true,
  "outputDir": "runs"
}
```

### Modelling the result you want

- **A clear winner:** give the variation a higher `rate` than control
  (e.g. `0.10` vs `0.12` → ~20% relative lift). Bump `visitors` until the lift
  clears significance.
- **A flat / inconclusive test:** give every variation the *same* rate.
- **No-effect-but-noisy:** same rate, smaller `visitors`.
- **Multiple metrics:** add more objects to `metrics[]`; each is rolled
  independently per visitor with its own per-variation `rates`.
- **Revenue:** add `revenueCents` (a fixed integer or a `[min,max]` range) to a
  metric; converting visitors get a `revenue` field (integer cents).

### Variation assignment modes

| Mode         | Behaviour                                                                 |
|--------------|---------------------------------------------------------------------------|
| `weighted`   | Weighted-random per `weight`. Lets you manufacture an exact split. Default. |
| `murmurhash` | Reproduces Optimizely's **real** bucketing: `murmur32(visitorId + experimentId, seed 1)` mapped to the allocation ranges. Deterministic and sticky — the same visitor id always lands in the same variation, exactly as the browser would compute it. |

Both produce the same statistical distribution; `murmurhash` is for when you want
bucketing identical to what the live snippet would have done.

---

## Flags

```
--experiment <path>   Manifest JSON (required)
--send                Actually POST to Optimizely (omit = dry run)
--visitors <n>        Override manifest visitor count
--seed <n>            RNG seed for a reproducible population (default 1)
--assignment <mode>   weighted | murmurhash
--batch <n>           Visitors per request (default 500; payload stays < 3.5 MB)
--concurrency <n>     Parallel requests when sending (default 6)
--out <dir>           Output dir for the run record (default runs)
--dump                Also write every generated payload to the run dir
```

## Scale & batching

The Event API accepts many visitors per request (one JSON object must be
≤ **3.5 MB**). The tool packs ~500 visitors per request (~210 KB) and sends them
through a small concurrency pool, so 10,000 visitors is ~20 requests and
completes in seconds. Increase `--batch` / `--concurrency` for larger volumes.

## Run records

Each run writes `runs/<timestamp>/`:

- `manifest-snapshot.json` — exact config used
- `sample-payload.json` — the first 2 visitors as they'd be sent (eyeball before `--send`)
- `summary.json` — per-variation / per-day counts, batch count, send results
- `payloads/` — every batch payload (only with `--dump`)

---

## Verifying it landed

After `--send`, allow a few minutes for Optimizely's pipeline, then open the
experiment **Results** page. You should see unique visitors and conversions
appear for each variation, distributed across the dates in your manifest. Filter
the date range to Saturday/Sunday/today to confirm the day attribution.

If decisions appear but conversions don't, the usual cause is rule #1 — a
conversion timestamped before its activation. This tool prevents that, but it's
worth knowing if you hand-edit payloads.

---

## Responsible use

This injects synthetic data into a live Optimizely project, so:

- **Target a test, demo, or dedicated experiment** — not a production experiment
  whose results drive real business decisions. Synthetic traffic mixed into a
  real decision would corrupt it.
- The `client_name` (default `synthetic-data-harness`) tags the traffic as
  synthetic so it's identifiable later.
- Use this for QA, demos, validating a customer's reporting/integration setup,
  load-checking the stats pipeline, or training — with the experiment owner's
  knowledge.
- There is no undo on ingested events. Dry-run first; send deliberately.

---

## Files

```
web-experiment-simulator/
├─ simulate.js            # orchestrator / entry point
├─ lib/
│  ├─ event-api.js        # payload build + POST batching (the Event API contract)
│  ├─ bucketing.js        # weighted + murmurhash variation assignment
│  ├─ murmur.js           # MurmurHash3 x86 32-bit (Optimizely's bucketing hash)
│  ├─ timeline.js         # date/timestamp distribution (the attribution logic)
│  ├─ visitor.js          # optimizelyEndUserId generation
│  └─ util.js             # colors, concurrency pool, seeded RNG
├─ experiments/
│  └─ example.json        # manifest template
└─ runs/                  # timestamped run records
```
