# Session Data Manifest — NASM PT Online Redirect A/B/C

Experiment `6470479964274688` · project `25023950326` · account `24796730409` (Ascend Learning)
Generated 2026-06-08 → 2026-06-09. **All data below was injected by us for testing.**

## Everything we sent

| Source | Visits | Engine | Task ID | Run record |
|---|---|---|---|---|
| Synthetic Event-API smokes (2×50) | ~100 | Event API (no browser) | — (foreground) | — |
| Validation batch | 63 | Chromium | — | `runs/20260608T205604Z` |
| "3,000" run | 3,003 | Chromium | `b8r3wawtl` | `runs/20260608T211311Z` |
| iOS 30-batch | 32 | WebKit | — | `runs/20260608T233546Z` |
| WebKit smoke | 5 | WebKit | — | `runs/20260609T032212Z` |
| Batch 1 — mixed | 6,264 | iOS 3,115 + Web 3,149 | `blvw5s3b9` | `runs/mix-20260608T235451Z` |
| Batch 2 — iOS (crashed @630) | 630 | WebKit | `bvc4mhzic` | `runs/mix-20260609T025859Z` |
| Batch 3 — final iOS | 1,003 | WebKit | `b229xiaju` | `runs/20260609T032248Z` |
| **TOTAL** | **~11,100** | | | |

### By traffic type
- **iOS (WebKit):** ~4,785  (32 + 3,115 + 630 + 1,003 + 5)
- **Web/desktop (Chromium):** ~6,215  (63 + 3,003 + 3,149)
- **Synthetic (Event API):** ~100

## How to isolate / exclude our data (use the Enriched Events / data export, not the Results page)

| To find… | Filter on |
|---|---|
| The ~100 **synthetic** events | `client_name = "synthetic-data-harness"` |
| **All ~11,000 organic** browser visits | **source IP `98.23.11.75`** (every organic visit came from this single IP) |
| Secondary tells | UA `Chrome/124.0.0.0` (web) · Playwright "iPhone 13" Mobile Safari (iOS) · timestamps 2026-06-08 ~20:00Z → 2026-06-09 ~03:50Z |

## Is any of it real customer traffic?
Results visitor count (~10,300, settling toward ~11,000) ≈ our total sent. They match, so **this experiment is essentially 100% our test data — no meaningful organic/real traffic detected.** If real traffic existed, the count would exceed what we sent.

## Observed result
Primary "Landing Page Rev Gen": Control A ~99.97%, Variation B ~97.8%, Variation C ~97.6% (>99% significance). The ~2% gap on B/C is redirect-related event loss (control doesn't redirect); it trends slightly higher as more iOS data is added.
