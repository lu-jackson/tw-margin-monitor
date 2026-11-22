"""Cross-check the dashboard's numbers against the research repo's own calculator (score_calculator.py).

  python tests/validate_vs_research.py [path-to-research-repo]

For several dates it compares zV, zM, M (rows from the pre-2026 partitions) computed by this pipeline with
the research implementation. Differences should be ~1e-9.
"""
import os
import subprocess
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import compute as C  # noqa: E402

research = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), "tw-margin-shock-research")
dates = ["2020-03-19", "2022-09-30", "2024-08-05", "2025-04-09", "2025-06-30"]

m = C.add_margin_z(pd.read_csv(os.path.join(ROOT, "data", "margin_ratio.csv")))
v = C.load_vix(open(os.path.join(ROOT, "data", "vix_history.csv"), encoding="utf-8").read())

out = subprocess.run([sys.executable, "-I", os.path.join(research, "src", "score_calculator.py"), *dates],
                     capture_output=True, text=True, encoding="utf-8", cwd=research).stdout
ref = {}
cur = None
for line in out.splitlines():
    if line.startswith("== "):
        cur = line[3:].strip(); ref[cur] = {}
    elif cur and ":" in line and "個百分點" not in line:
        k, val = line.strip().split(":", 1)
        try:
            ref[cur][k.strip()] = float(val)
        except ValueError:
            pass
worst = 0.0
for d in dates:
    row = m[m.date == d].iloc[0]
    vr = C.vix_for_tw_date(v, d)
    mine = {"zV": vr.zv, "zM": row.zM, "M": row.M}
    for k, x in mine.items():
        diff = abs(x - ref[d][k])
        worst = max(worst, diff)
        print(f"{d} {k:3s} dashboard={x:10.5f} research={ref[d][k]:10.5f} diff={diff:.2e}")
print("MAX ABS DIFF:", worst)
sys.exit(0 if worst < 1e-3 else 1)
