"""Unit tests for the signal math (run: python -m pytest tests -q   or   python tests/test_compute.py)."""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
import compute as C  # noqa: E402


def _margin(n=1400, seed=1):
    rng = np.random.default_rng(seed)
    d = pd.bdate_range("2015-01-01", periods=n).strftime("%Y-%m-%d")
    M = 165 + np.cumsum(rng.normal(0, 1.2, n)) * 0.3
    return pd.DataFrame({"date": d, "M": M, "margin_amt_k": 1e8, "margin_units": 1e6, "n_sec": 1000,
                         "n_no_price": 1, "mv_share_no_price": 0.0})


def test_zM_excludes_current_observation():
    m = C.add_margin_z(_margin())
    i = len(m) - 1
    w = m.M.iloc[i - C.W:i]
    assert abs(m.zM.iloc[i] - (m.M.iloc[i] - w.mean()) / w.std(ddof=1)) < 1e-12
    assert m.zM.iloc[:C.W].isna().all()


def test_L145_flag():
    m = _margin(10)
    m.loc[3, "M"] = 144.99
    m.loc[4, "M"] = 145.0
    z = C.add_margin_z(m)
    assert z.L145.tolist()[3:5] == [1, 0]


def test_vix_uses_session_strictly_before_tw_date():
    rng = np.random.default_rng(2)
    n = 1400
    d = pd.bdate_range("2015-01-01", periods=n)
    c = 18 + np.cumsum(rng.normal(0, .2, n))
    text = "DATE,OPEN,HIGH,LOW,CLOSE\n" + "\n".join(f"{x:%m/%d/%Y},{y},{y},{y},{y}" for x, y in zip(d, c))
    v = C.load_vix(text)
    t = d[-1]
    row = C.vix_for_tw_date(v, t.strftime("%Y-%m-%d"))
    assert row.d == d[-2]
    hist = np.log(c[-2 - C.W:-2])
    exp = (np.log(c[-2]) - hist.mean()) / hist.std(ddof=1)
    assert abs(row.zv - exp) < 1e-9


def test_episodes_merge_short_gaps():
    m = _margin(40)
    m["M"] = 160.0
    m.loc[5:8, "M"] = 140.0     # 4 days
    m.loc[10:11, "M"] = 141.0   # gap of 1 -> merged
    m.loc[30:31, "M"] = 139.0   # separate
    eps = C.episodes_below(m)
    assert len(eps) == 2 and eps[0]["days"] == 6 and eps[1]["days"] == 2


def test_scenario_equation():
    scn = {"scenarios": [{"id": "X", "terms": [{"var": "zV", "coef": 2.0}, {"var": "L145", "coef": 10.0}]}]}
    r = C.eval_scenarios(scn, 1.5, 1)[0]
    assert r["total_pp"] == 13.0


if __name__ == "__main__":
    for k, fn in list(globals().items()):
        if k.startswith("test_"):
            fn()
            print("ok", k)
