"""Primary-source fetchers: TWSE (margin balances, closing prices) and CBOE (VIX history).

No third-party aggregator is used. Both sources are public, official and need no API key.
TWSE's TLS certificate lacks a Subject Key Identifier, which Python >= 3.13 rejects under
VERIFY_X509_STRICT; only that single strict flag is relaxed (chain / hostname checks stay on).
"""
import json
import ssl
import time
import urllib.request

CTX = ssl.create_default_context()
CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT

UA = "Mozilla/5.0 (compatible; margin-dashboard/1.0)"
TWSE_MARGN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date={d}&selectType=ALL&response=json"
TWSE_INDEX = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date={d}&type=ALLBUT0999&response=json"
CBOE_VIX = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"

_last_call = 0.0
MIN_GAP = 2.6  # seconds between TWSE requests (TWSE throttles bursts)


def _get(url, tries=4, timeout=60):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return r.read()
        except Exception as e:  # network hiccup / throttle: back off and retry
            err = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url} ({err!r})")


def twse_json(url):
    global _last_call
    wait = MIN_GAP - (time.time() - _last_call)
    if wait > 0:
        time.sleep(wait)
    body = _get(url)
    _last_call = time.time()
    return json.loads(body.decode("utf-8"))


def margn(date_yyyymmdd):
    return twse_json(TWSE_MARGN.format(d=date_yyyymmdd))


def index(date_yyyymmdd):
    return twse_json(TWSE_INDEX.format(d=date_yyyymmdd))


def vix_csv():
    return _get(CBOE_VIX).decode("utf-8")


def num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    if s in ("", "--", "-", "X"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_margn(obj):
    """Return dict(amt_today_k, units_today, rows=[(code, balance_today_lots)])."""
    tabs = obj["tables"]
    summ = {r[0]: r for r in tabs[0]["data"]}
    amt_row = next(v for k, v in summ.items() if k.startswith("融資金額"))
    unit_row = next(v for k, v in summ.items() if k.startswith("融資(交易單位)") or k.startswith("融資("))
    det = next(t for t in tabs if t.get("fields") and "代號" in t["fields"] and "今日餘額" in t["fields"])
    i_today = det["fields"].index("今日餘額")  # first occurrence = margin (融資) block
    rows = [(r[0].strip(), num(r[i_today]) or 0.0) for r in det["data"]]
    return {"amt_today_k": num(amt_row[5]), "units_today": num(unit_row[5]), "rows": rows}


def parse_prices(obj):
    px = {}
    for t in obj["tables"]:
        f = t.get("fields") or []
        if "證券代號" in f and "收盤價" in f:
            ic, ip = f.index("證券代號"), f.index("收盤價")
            for r in t["data"]:
                v = num(r[ip])
                if v is not None and v > 0:
                    px[r[ic].strip()] = v
    return px
