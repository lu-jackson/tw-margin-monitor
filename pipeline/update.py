"""Idempotent updater. Safe to run every few minutes; does nothing when no new data has been published.

  python pipeline/update.py            # fetch anything new, rebuild site/data/*.json
  python pipeline/update.py --rebuild  # only recompute outputs from stored data (no network for TWSE)

Flow
  1. TWSE: for every weekday after the last stored date, pull MI_MARGN + MI_INDEX. A date counts only when BOTH
     tables are published (holidays / not-yet-published evenings are skipped and retried on the next run).
  2. CBOE: re-download the VIX history (single file).
  3. Recompute zV / zM / scenario values and write site/data/latest.json and history.json.
  4. Append each new post-freeze Taiwan date to data/signal_log.csv (forward record; git history timestamps it).
"""
import datetime as dt
import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compute as C  # noqa: E402
import fetch as F  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "seed", "margin_ratio_2004_2025.csv")
MARGIN = os.path.join(ROOT, "data", "margin_ratio.csv")
VIXF = os.path.join(ROOT, "data", "vix_history.csv")
STATE = os.path.join(ROOT, "data", "state.json")
LOG = os.path.join(ROOT, "data", "signal_log.csv")
SITE = os.path.join(ROOT, "site", "data")
SCN = os.path.join(ROOT, "pipeline", "scenarios.json")
FORWARD_FROM = "2026-11-13"  # research freeze: data after 2026-11-12 is a clean forward sample

COLS = ["date", "M", "margin_amt_k", "margin_units", "n_sec", "n_no_price", "mv_share_no_price"]


def tw_today():
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)).date()


def load_margin():
    path = MARGIN if os.path.exists(MARGIN) else SEED
    return pd.read_csv(path)[COLS]


def load_state():
    if os.path.exists(STATE):
        return json.load(open(STATE, encoding="utf-8"))
    return {"last_close": {}, "last_close_date": None}


def fetch_new_days(m, state):
    last = m.date.max()
    start = dt.date.fromisoformat(last) + dt.timedelta(days=1)
    end = tw_today()
    if not state["last_close"]:  # seed price memory from the last stored session
        d0 = last.replace("-", "")
        px = F.parse_prices(F.index(d0))
        state["last_close"], state["last_close_date"] = px, last
        print(f"seeded last_close from {last}: {len(px)} codes", flush=True)
    new = []
    d = start
    while d <= end:
        if d.weekday() < 5:
            ds = d.strftime("%Y%m%d")
            mo = F.margn(ds)
            if mo.get("stat") == "OK":
                io = F.index(ds)
                if io.get("stat") == "OK":
                    new.append(build_day(d.isoformat(), mo, io, state))
                    print("  +", d.isoformat(), round(new[-1]["M"], 2), flush=True)
                else:
                    print("  . prices not yet published for", d.isoformat(), flush=True)
        d += dt.timedelta(days=1)
    return new


def build_day(date, mo, io, state):
    mg, px = F.parse_margn(mo), F.parse_prices(io)
    lc = state["last_close"]
    lc.update(px)
    mv = mv_miss = 0.0
    n_miss = n_bal = 0
    for code, bal in mg["rows"]:
        if bal <= 0:
            continue
        n_bal += 1
        p = px.get(code)
        if p is None:
            p = lc.get(code)
            n_miss += 1
            if p is None:
                continue
            mv_miss += bal * 1000 * p
        mv += bal * 1000 * p
    state["last_close_date"] = date
    return {"date": date, "M": mv / (mg["amt_today_k"] * 1000) * 100, "margin_amt_k": mg["amt_today_k"],
            "margin_units": mg["units_today"], "n_sec": n_bal, "n_no_price": n_miss,
            "mv_share_no_price": mv_miss / mv if mv else 0.0}


def append_log(m, latest_by_date):
    seen = set(pd.read_csv(LOG).date) if os.path.exists(LOG) else set()
    rows = []
    for _, r in m[m.date >= FORWARD_FROM].iterrows():
        if r.date in seen:
            continue
        rows.append({"date": r.date, "M": round(r.M, 3), "zM": round(r.zM, 4), "L145": int(r.L145),
                     "logged_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")})
    if rows:
        pd.DataFrame(rows).to_csv(LOG, mode="a", header=not os.path.exists(LOG), index=False)


def main():
    rebuild_only = "--rebuild" in sys.argv
    m = load_margin()
    state = load_state()
    n_new = 0
    if not rebuild_only:
        new = fetch_new_days(m, state)
        n_new = len(new)
        if new:
            m = pd.concat([m, pd.DataFrame(new)], ignore_index=True)
        text = F.vix_csv()
        open(VIXF, "w", encoding="utf-8", newline="").write(text)
    else:
        text = open(VIXF, encoding="utf-8").read()
    m = m.drop_duplicates("date").sort_values("date").reset_index(drop=True)
    m.to_csv(MARGIN, index=False)
    json.dump(state, open(STATE, "w", encoding="utf-8"), ensure_ascii=False)

    v = C.load_vix(text)
    mz = C.add_margin_z(m)
    scn = json.load(open(SCN, encoding="utf-8"))
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    latest = C.build_latest(mz, v, scn, now)
    latest["scenario_meta"] = scn
    latest["sources"] = {"margin": "TWSE MI_MARGN + MI_INDEX (twse.com.tw)", "vix": "CBOE VIX_History.csv (cboe.com)"}
    append_log(mz, None)
    latest["forward_log"] = pd.read_csv(LOG).to_dict("records") if os.path.exists(LOG) else []
    C.write_json(os.path.join(SITE, "latest.json"), latest)
    C.write_json(os.path.join(SITE, "history.json"), C.build_history(mz, v))
    print(f"done. new TW days: {n_new}; M[{latest['tw_date']}]={latest['margin']['M']:.2f}; "
          f"VIX[{latest['vix_date_latest']}]={latest['vix_latest']['close']:.2f}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
