"""Signal math. Definitions are identical to the research (stage 8 protocol / score_calculator.py):

  zV : ln(VIX close) of the latest US session strictly BEFORE the Taiwan date t, standardised with the
       previous 1,260 US sessions (excluding that session).
  zM : margin ratio standardised with the previous 1,260 Taiwan sessions (excluding t).
  L  : 1 if margin ratio < 145 else 0.
  VIX signal : zV >= 80th percentile of the previous 1,260 daily zV values.

Two VIX bases are exported for the latest day:
  research : the strict research convention (VIX of the session before t).
  latest   : the most recent VIX close available now (known before the next Taiwan open).
"""
import io
import json
import os

import numpy as np
import pandas as pd

W = 1260
THRESH_LOW = 145.0
REF_LEVELS = [145, 150, 170, 205, 210]


def load_vix(text):
    v = pd.read_csv(io.StringIO(text))
    v["d"] = pd.to_datetime(v["DATE"], format="%m/%d/%Y")
    v = v.sort_values("d").reset_index(drop=True)
    v = v.rename(columns={"OPEN": "o", "HIGH": "h", "LOW": "l", "CLOSE": "c"})[["d", "o", "h", "l", "c"]]
    v["lv"] = np.log(v.c)
    mu = v.lv.rolling(W).mean().shift(1)
    sd = v.lv.rolling(W).std(ddof=1).shift(1)
    v["zv"] = (v.lv - mu) / sd
    # 80th percentile of the previous W daily zV values (the day itself included, as in the research)
    v["p80"] = v.zv.rolling(W, min_periods=W).apply(lambda a: np.percentile(a, 80), raw=True)
    return v


def add_margin_z(m):
    m = m.sort_values("date").reset_index(drop=True)
    mu = m.M.rolling(W).mean().shift(1)
    sd = m.M.rolling(W).std(ddof=1).shift(1)
    m["zM"] = (m.M - mu) / sd
    m["L145"] = (m.M < THRESH_LOW).astype(int)
    return m


def vix_for_tw_date(v, t):
    """Row of the latest US session strictly before Taiwan date t."""
    prev = v[v.d < pd.Timestamp(t)]
    return prev.iloc[-1]


def eval_scenarios(scn, zv, L):
    """Return list of dicts with per-term contributions (percentage points)."""
    out = []
    for s in scn["scenarios"]:
        contrib, total = [], 0.0
        for t in s["terms"]:
            x = zv if t["var"] == "zV" else float(L)
            c = t["coef"] * x
            total += c
            contrib.append({"var": t["var"], "x": x, "coef": t["coef"], "contrib": round(c, 2)})
        out.append({"id": s["id"], "contrib": contrib, "total_pp": round(total, 2)})
    return out


def episodes_below(m, thr=THRESH_LOW, max_gap=5):
    """Episodes of M < thr; flagged days separated by <= max_gap non-flagged sessions are merged."""
    idx = np.flatnonzero((m.M < thr).values)
    dates, vals = m.date.values, m.M.values
    eps, grp = [], []
    for k in idx:
        if grp and k - grp[-1] - 1 > max_gap:
            eps.append(grp)
            grp = []
        grp.append(int(k))
    if grp:
        eps.append(grp)
    out = []
    for g in eps:
        kmin = g[int(np.argmin(vals[g]))]
        out.append({"start": str(dates[g[0]])[:10], "end": str(dates[g[-1]])[:10], "days": len(g),
                    "min_M": round(float(vals[kmin]), 2), "min_date": str(dates[kmin])[:10]})
    return out


def pct_rank(series, x):
    s = series.dropna()
    return float((s < x).mean() * 100) if len(s) else None


def build_latest(m, v, scn, now_utc_iso):
    m = m.copy()
    last = m.iloc[-1]
    t = last.date
    vr = vix_for_tw_date(v, t)
    vlast = v.iloc[-1]
    zv_res = float(vr.zv)
    zv_lat = float(vlast.zv)
    L = int(last.L145)

    def chg(s, n):
        return float(s.iloc[-1] - s.iloc[-1 - n]) if len(s) > n else None

    i = len(m) - 1
    win5y = m.M.iloc[max(0, i - W):i]
    eps = episodes_below(m)
    in_ep = L == 1
    cur_ep_days = 0
    if in_ep:
        k = i
        while k >= 0 and m.M.iloc[k] < THRESH_LOW:
            cur_ep_days += 1
            k -= 1
    p80_res = float(vr.p80) if not np.isnan(vr.p80) else None
    p80_lat = float(vlast.p80) if not np.isnan(vlast.p80) else None
    latest = {
        "generated_utc": now_utc_iso,
        "tw_date": t,
        "vix_date_research": str(vr.d.date()),
        "vix_date_latest": str(vlast.d.date()),
        "margin": {
            "M": round(float(last.M), 3), "zM": round(float(last.zM), 3) if not np.isnan(last.zM) else None,
            "L145": L,
            "amt_k": float(last.margin_amt_k), "units": float(last.margin_units),
            "n_sec": int(last.n_sec), "n_no_price": int(last.n_no_price), "mv_share_no_price": float(last.mv_share_no_price),
            "mv_ntd": float(last.M) / 100 * float(last.margin_amt_k) * 1000,
            "chg_1d": chg(m.M, 1), "chg_5d": chg(m.M, 5), "chg_20d": chg(m.M, 20),
            "pctile_5y": pct_rank(win5y, float(last.M)), "pctile_all": pct_rank(m.M, float(last.M)),
            "mean_5y": float(win5y.mean()), "sd_5y": float(win5y.std(ddof=1)),
            "high_52w": float(m.M.iloc[-250:].max()), "low_52w": float(m.M.iloc[-250:].min()),
            "dist": {str(k): round(float(last.M) - k, 2) for k in REF_LEVELS},
            "episode_days": cur_ep_days,
            "prev_M": round(float(m.M.iloc[-2]), 3),
        },
        "vix_research": {"zV": round(zv_res, 4), "p80": p80_res, "signal": bool(p80_res is not None and zv_res >= p80_res),
                         "close": float(vr.c), "date": str(vr.d.date())},
        "vix_latest": {"zV": round(zv_lat, 4), "p80": p80_lat, "signal": bool(p80_lat is not None and zv_lat >= p80_lat),
                       "close": float(vlast.c), "open": float(vlast.o), "high": float(vlast.h), "low": float(vlast.l),
                       "date": str(vlast.d.date()),
                       "prev_close": float(v.c.iloc[-2]),
                       "chg_1d": float(vlast.c - v.c.iloc[-2]), "chg_5d": float(vlast.c - v.c.iloc[-6]),
                       "chg_20d": float(vlast.c - v.c.iloc[-21]),
                       "pctile_5y": pct_rank(v.c.iloc[-W - 1:-1], float(vlast.c)), "pctile_all": pct_rank(v.c, float(vlast.c)),
                       "high_52w": float(v.c.iloc[-252:].max()), "low_52w": float(v.c.iloc[-252:].min()),
                       "mean_5y": float(np.exp(v.lv.iloc[-W - 1:-1].mean())), "mean_lnV_5y": float(v.lv.iloc[-W - 1:-1].mean()),
                       "sd_lnV_5y": float(v.lv.iloc[-W - 1:-1].std(ddof=1))},
        "scenarios": {"research": eval_scenarios(scn, zv_res, L), "latest": eval_scenarios(scn, zv_lat, L)},
        "episodes_below_145": eps,
        "ref_levels": REF_LEVELS,
    }
    return latest


def build_history(m, v):
    m = m[m.date >= "2004-01-01"]
    vv = v[v.d >= "2004-01-01"]

    def r(x, k=3):
        return None if pd.isna(x) else round(float(x), k)

    return {
        "m": {"d": m.date.tolist(), "v": [r(x) for x in m.M], "z": [r(x) for x in m.zM]},
        "vix": {"d": [str(x.date()) for x in vv.d], "o": [r(x, 2) for x in vv.o], "h": [r(x, 2) for x in vv.h],
                "l": [r(x, 2) for x in vv.l], "c": [r(x, 2) for x in vv.c], "z": [r(x) for x in vv.zv],
                "p80": [r(x) for x in vv.p80]},
    }


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
