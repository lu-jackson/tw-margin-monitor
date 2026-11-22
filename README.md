# TW Margin Monitor

Terminal-style dashboard for the research in `../tw-margin-shock-research`: TWSE listed-market **margin maintenance ratio (M)**, CBOE **VIX**, their z-scores, and the stage-8 conditional excess-return equations.

No hand-pasted numbers: everything is rebuilt from exchange primary sources.

| Input | Source | Published |
| --- | --- | --- |
| Margin balances + amount | TWSE `MI_MARGN` (selectType=ALL) | evening, Taipei |
| Closing prices | TWSE `MI_INDEX` (ALLBUT0999) | afternoon, Taipei |
| VIX OHLC | CBOE `VIX_History.csv` | ~05:15–06:15 Taipei next morning |

`M = Σ(margin balance × 1,000 × close) ÷ margin amount`, as first published (same definition as the research, `src/build_margin.py`). This is **not** TWSE's own 整戶擔保維持率 and does not scrape 愛玩股.

## Layout

```
pipeline/   fetch.py (TWSE/CBOE) · compute.py (zV, zM, scenarios) · update.py (idempotent updater) · scenarios.json
seed/       M history 2004-02-11 → 2025-12-31 (research processed partitions; the sealed 2026 partition is NOT read)
data/       margin_ratio.csv · vix_history.csv · state.json · signal_log.csv (forward log, from 2026-11-13)
site/       static dashboard (index.html, app.js, style.css, data/latest.json, data/history.json)
tests/      test_compute.py (unit) · validate_vs_research.py (cross-check against the research calculator)
.github/workflows/update.yml   polling schedule (not yet pushed anywhere)
```

## Run locally

```powershell
python pipeline/update.py          # fetch anything new, rebuild site/data/*.json  (first run backfills 2026, ~40 min: TWSE throttles)
python -m http.server 8765 --directory site
```

Open <http://localhost:8765>. Re-running is safe; with nothing new it only refreshes the VIX file and outputs.

## Definitions (identical to research stage 8)

- `zV`: ln(VIX) of the last US session strictly before the Taiwan date, standardised on the prior 1,260 US sessions. The page shows a *research basis* (T−1) and a *latest* basis (newest VIX close, known before the next Taiwan open).
- `zM`: M standardised on the prior 1,260 Taiwan sessions. `[M<145]` = 1 when M < 145.
- Equations show only terms whose 90% CI excludes 0 and that were stable across halves (stage 8 §三). Values are **in-sample conditional averages, not forecasts.**

## Not done yet

Deployment (`moreti.app` subdomain, DNS, hosting), GitHub repo, LLM commentary layer.
