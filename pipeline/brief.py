"""Daily brief: a short Traditional-Chinese read-out of the latest numbers.

Agent workflow (each step is code, the LLM is only the writer):
  1. FACTS     build a compact facts JSON from site/data/latest.json (all numbers come from the pipeline).
  2. WRITE     ask a free LLM (GitHub Models, authenticated with the workflow's own GITHUB_TOKEN; no API key,
               no billing) to turn the facts into {"headline", "bullets"}.
  3. VERIFY    every number in the text must exist in the facts, and advice / forecast wording is rejected.
  4. FALLBACK  if the LLM is unavailable or fails verification twice, a deterministic template is used.
Nothing here can block the data update: failures degrade to the template.

  python pipeline/brief.py            # write only when the data date changed
  python pipeline/brief.py --force    # regenerate now
  python pipeline/brief.py --no-llm   # template only
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LATEST = os.path.join(ROOT, "site", "data", "latest.json")
OUT = os.path.join(ROOT, "site", "data", "daily_summary.json")
LOG = os.path.join(ROOT, "data", "brief_log.jsonl")

ENDPOINT = "https://models.github.ai/inference/chat/completions"
MODEL = os.environ.get("BRIEF_MODEL", "openai/gpt-4.1-mini")
DISCLAIMER = "樣本內歷史條件平均，非預測、非投資建議。"

SYSTEM = """你是台股量化研究儀表板的「每日摘要」撰寫員，使用繁體中文。
依使用者提供的 facts JSON 寫摘要。嚴格規則：
1. 只能使用 facts 裡出現的數字，不可自行計算、推算、換算或改寫成別的數字（例如不要算差值）。
2. 不可加入 facts 沒有的事實（新聞、原因、事件、其他指標）。
3. 不可給買進、賣出、加碼、減碼等建議，不可預測未來走勢。
4. 方程式輸出要用「歷史上類似讀數之後，平均…」的語氣，並指出這是樣本內歷史平均。
5. 必須提到可信度限制（事件很少）。
輸出純 JSON，格式：{"headline": "一句話，30 字內", "bullets": ["…","…","…","…"]}
bullets 共 4 條、每條 60 字內，依序是：①維持率狀態與變化 ②VIX 狀態 ③方程式輸出範圍（以 research 口徑為主） ④可信度限制。"""

BANNED = re.compile(r"建議|應該|應當|買進|賣出|加碼|減碼|進場|出場|停損|一定會|將會上漲|將會下跌|必漲|必跌")


# ------------------------------------------------------------------ facts
def _rng(vals):
    vals = [round(v, 1) for v in vals]
    return [min(vals), max(vals)] if vals else None


def build_facts(L):
    M, R, V = L["margin"], L["vix_research"], L["vix_latest"]
    scn = {s["id"]: s for s in L["scenario_meta"]["scenarios"]}

    def outs(basis):
        ev = {e["id"]: e["total_pp"] for e in L["scenarios"][basis]}
        by = {"20D": [], "60D": [], "120-250D": []}
        for sid, s in scn.items():
            h = s["horizon"]
            by["20D" if h == 20 else "60D" if h == 60 else "120-250D"].append(ev[sid])
        return {k: _rng(v) for k, v in by.items()}

    p13 = scn.get("P13-20", {})
    return {
        "taiwan_date": L["tw_date"],
        "margin": {
            "M_pct": round(M["M"], 2), "previous_M_pct": round(M["prev_M"], 2), "change_1d_pts": round(M["chg_1d"], 2),
            "change_5d_pts": round(M["chg_5d"], 2), "zM": round(M["zM"], 2),
            "below_145": bool(M["L145"]), "sessions_in_current_below_145_episode": M["episode_days"],
            "points_vs_145": round(M["dist"]["145"], 2),
            "became_below_145_today": bool(M["L145"]) and M["prev_M"] >= 145,
        },
        "vix": {
            "date_latest": V["date"], "close": round(V["close"], 2), "previous_close": round(V["prev_close"], 2),
            "change_1d": round(V["chg_1d"], 2), "zV_research": round(R["zV"], 2), "zV_latest": round(V["zV"], 2),
            "elevated_latest": V["signal"], "elevated_research": R["signal"],
            "percentile_5y_latest": round(V["pctile_5y"], 0),
        },
        "definitions": {"low_margin_threshold_pct": 145, "horizon_days": [20, 60, 120, 250], "leverage_x": 2,
                        "reference_window_years": 5, "vix_elevated_rule": "zV 達過去 5 年最高 20%（第 80 百分位）"},
        "equation_output_ranges_pp": {"research_basis": outs("research"), "latest_vix_basis": outs("latest")},
        "evidence": {"low_margin_sessions_since_2013": p13.get("low_days"), "episodes_since_2013": "4-5",
                     "independent_windows_250d": 12, "note": "2013 年後低維持率事件很少，數字多來自 2020 年反彈"},
    }


# ------------------------------------------------------------------ verification
NUM = re.compile(r"(?<![\w.])[+−\-–]?\d+(?:\.\d+)?")


def _numbers(text):
    text = re.sub(r"\d{4}-\d{2}-\d{2}", " ", text)
    return [(m.group(0), m.group(0).lstrip("+−-–")) for m in NUM.finditer(text)]


def verify(parts, facts):
    """Return a list of problems (empty = OK). parts = headline + bullets joined."""
    allowed = [abs(float(x[1])) for x in _numbers(json.dumps(facts, ensure_ascii=False))]
    problems = []
    for raw, n in _numbers(parts):
        v = float(n)
        if 1990 <= v <= 2035 and "." not in n:  # years such as 2013
            continue
        k = len(n.split(".")[1]) if "." in n else 0
        if not any(abs(round(a, k) - v) < 0.5 * 10 ** -k + 1e-9 for a in allowed):
            problems.append(f"數字 {raw} 不在 facts 內")
    m = BANNED.search(parts)
    if m:
        problems.append(f"出現建議或預測用語「{m.group(0)}」")
    return problems


# ------------------------------------------------------------------ writers
def _post(url, headers, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            status, raw = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:240]}")
    try:
        return json.loads(raw)
    except ValueError:
        raise RuntimeError(f"non-JSON response (HTTP {status}): {raw[:240]!r}")


def _parse(txt):
    txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.M).strip()
    d = json.loads(txt)
    assert isinstance(d.get("headline"), str) and isinstance(d.get("bullets"), list) and 2 <= len(d["bullets"]) <= 6
    return {"headline": d["headline"].strip(), "bullets": [str(b).strip() for b in d["bullets"]]}


def provider():
    """Gemini (free tier, needs GEMINI_API_KEY secret) > GitHub Models (free, workflow token) > none."""
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini", os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    if os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"):
        return "github", MODEL
    return None, None


GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


def _gemini(model, user):
    out = _post(f"{GEMINI_BASE}/models/{model}:generateContent", {"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
                {"systemInstruction": {"parts": [{"text": SYSTEM}]},
                 "contents": [{"role": "user", "parts": [{"text": user}]}],
                 "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2000, "responseMimeType": "application/json"}})
    return out["candidates"][0]["content"]["parts"][0]["text"]


def _gemini_pick_model():
    """Newest general-purpose Flash model that supports generateContent (names printed to the log, key never is)."""
    req = urllib.request.Request(f"{GEMINI_BASE}/models?pageSize=200", headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            models = json.loads(r.read().decode("utf-8"))["models"]
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} listing models: {e.read().decode('utf-8', 'replace')[:200]}")
    names = [m["name"].split("/")[-1] for m in models if "generateContent" in m.get("supportedGenerationMethods", [])]
    print("Gemini models with generateContent:", ", ".join(names))
    bad = re.compile(r"image|tts|live|audio|embed|vision|thinking|exp|preview|lite|robotics|computer|learnlm|gemma|aqa|imagen|veo")
    flash = [n for n in names if "flash" in n and not bad.search(n)]
    key = lambda n: [int(x) for x in re.findall(r"\d+", n)] or [0]
    pick = sorted(flash, key=key, reverse=True)
    if not pick:
        pick = sorted([n for n in names if n.startswith("gemini") and not bad.search(n)], key=key, reverse=True)
    if not pick:
        raise RuntimeError("no usable Gemini model found for this key")
    return pick[0]


def llm_write(facts, feedback=None):
    kind, model = provider()
    if kind is None:
        raise RuntimeError("no LLM credentials in the environment")
    user = "facts:\n" + json.dumps(facts, ensure_ascii=False)
    if feedback:
        user += "\n\n上一版被退回，原因：" + "；".join(feedback) + "。請修正後重寫。"
    if kind == "gemini":
        try:
            txt = _gemini(model, user)
        except RuntimeError as e:
            if not str(e).startswith("HTTP 404"):   # model retired / renamed: discover a current one and retry once
                raise
            model = _gemini_pick_model()
            print("configured Gemini model not found; using", model)
            txt = _gemini(model, user)
    else:
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        out = _post(ENDPOINT, {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
                    {"model": model, "temperature": 0.2, "max_tokens": 700,
                     "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]})
        txt = out["choices"][0]["message"]["content"]
    return _parse(txt), model


def template_write(facts):
    m, v = facts["margin"], facts["vix"]
    eq = facts["equation_output_ranges_pp"]["research_basis"]
    low, elev = m["below_145"], v["elevated_research"]
    sg = lambda x: ("+" if x > 0 else "") + f"{x:g}"
    rg = lambda r: "—" if not r else (sg(r[0]) if r[0] == r[1] else f"{sg(r[0])} ~ {sg(r[1])}")
    head = ("雙重壓力：低維持率與 VIX 偏高同時出現" if low and elev else "低維持率區：維持率低於 145%" if low
            else "VIX 偏高，維持率仍在 145% 之上" if elev else "中性：兩項訊號都未啟動")
    b = [f"維持率 {m['M_pct']}%（前一日 {m['previous_M_pct']}%），" + (f"已低於 145%，本段第 {m['sessions_in_current_below_145_episode']} 個交易日。" if low else f"高於 145% 共 {m['points_vs_145']} 點。"),
         f"VIX {v['close']}（{v['date_latest']}），zV 研究口徑 {sg(v['zV_research'])}、最新 {sg(v['zV_latest'])}，" + ("已進入過去 5 年最高 20%。" if elev else "未達過去 5 年前 20% 門檻。"),
         f"代入方程式，歷史上類似讀數之後 2× 多單平均額外：20 日 {rg(eq['20D'])} pp、60 日 {rg(eq['60D'])} pp、120–250 日 {rg(eq['120-250D'])} pp。",
         "可信度有限：2013 年後低維持率事件約 4–5 段，一年期約 12 個獨立窗口，數字多來自 2020 年反彈。"]
    return {"headline": head, "bullets": b}


# ------------------------------------------------------------------ main
def main():
    force, no_llm = "--force" in sys.argv, "--no-llm" in sys.argv
    L = json.load(open(LATEST, encoding="utf-8"))
    key = f"{L['tw_date']}|{L['vix_date_latest']}"
    if os.path.exists(OUT) and not force:
        if json.load(open(OUT, encoding="utf-8")).get("key") == key:
            print("brief up to date:", key)
            return
    facts = build_facts(L)
    source, model, text, note = "template", None, None, None
    if not no_llm:
        feedback = None
        for attempt in (1, 2):
            try:
                cand, used_model = llm_write(facts, feedback)
                problems = verify(cand["headline"] + "\n" + "\n".join(cand["bullets"]), facts)
                if not problems:
                    text, source, model = cand, "llm", used_model
                    break
                feedback = problems
                print(f"attempt {attempt} rejected:", problems)
            except (urllib.error.URLError, RuntimeError, ValueError, KeyError, AssertionError, OSError) as e:
                note = f"{type(e).__name__}: {str(e)[:160]}"
                print(f"attempt {attempt} failed: {note}")
                break
    if text is None:
        text = template_write(facts)
    rec = {"key": key, "tw_date": L["tw_date"], "vix_date": L["vix_date_latest"],
           "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "source": source, "model": model, "headline": text["headline"], "bullets": text["bullets"],
           "disclaimer": DISCLAIMER, "note": note}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rec, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"brief written ({source}): {rec['headline']}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
