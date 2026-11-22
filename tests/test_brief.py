"""Tests for the brief's verification layer and template (no network)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import brief as B  # noqa: E402

L = json.load(open(os.path.join(ROOT, "site", "data", "latest.json"), encoding="utf-8"))
FACTS = B.build_facts(L)


def test_template_passes_own_verification():
    t = B.template_write(FACTS)
    assert B.verify(t["headline"] + "\n" + "\n".join(t["bullets"]), FACTS) == []


def test_invented_number_rejected():
    m = FACTS["margin"]["M_pct"]
    bad = f"維持率 {m}%，比前一日大跌 99.9 點"
    p = B.verify(bad, FACTS)
    assert any("99.9" in x for x in p)


def test_real_numbers_and_years_accepted():
    m, v = FACTS["margin"]["M_pct"], FACTS["vix"]["close"]
    assert B.verify(f"維持率 {m}%，VIX {v}，2013 年後事件約 4–5 段，2020 年反彈，日期 2026-11-20", FACTS) == []


def test_advice_wording_rejected():
    assert any("用語" in x for x in B.verify("建議加碼正二", FACTS))


def test_facts_contain_no_none_ranges_when_low_margin():
    r = FACTS["equation_output_ranges_pp"]["research_basis"]
    assert all(r[k] is not None for k in ("20D", "60D", "120-250D"))


def test_gemini_path_parses_response(monkeypatch=None):
    os_env = dict(os.environ)
    os.environ["GEMINI_API_KEY"] = "dummy"
    orig = B._post
    fake = "```json" + chr(10) + '{"headline": "測試", "bullets": ["a", "b", "c"]}' + chr(10) + "```"
    B._post = lambda url, headers, payload: {"candidates": [{"content": {"parts": [{"text": fake}]}}]}
    try:
        d, model = B.llm_write(FACTS)
    finally:
        B._post = orig
        os.environ.clear(); os.environ.update(os_env)
    assert d["headline"] == "測試" and len(d["bullets"]) == 3 and model.startswith("gemini")


if __name__ == "__main__":
    for k, fn in list(globals().items()):
        if k.startswith("test_"):
            fn()
            print("ok", k)
