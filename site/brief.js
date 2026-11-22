"use strict";
/* Daily brief bar: shows data/daily_summary.json (written by pipeline/brief.py). Hidden if the file is missing. */
(function () {
  const host = document.getElementById("brief");
  if (!host) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  fetch("data/daily_summary.json", { cache: "no-store" }).then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => {
    const llm = d.source === "llm";
    const tag = llm ? `<span class="btag llm" title="Written by ${esc(d.model)}; every number is machine-checked against the data">AI · ${esc((d.model || "").split("/").pop())}</span>`
                    : `<span class="btag" title="Rule-based template (the AI writer was unavailable or failed verification)">AUTO TEMPLATE</span>`;
    host.innerHTML =
      `<div class="ptitle"><span class="pt">DAILY BRIEF · 每日摘要</span>${tag}<span class="pc">TW ${esc(d.tw_date)} · VIX ${esc(d.vix_date)} · ${esc(d.generated_utc.replace("T", " ").replace("+00:00", "Z"))}</span></div>` +
      `<div class="brief-body"><div class="brief-head">${esc(d.headline)}</div><ul>${d.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` +
      `<div class="brief-foot">${esc(d.disclaimer || "")}</div></div>`;
    host.hidden = false;
  }).catch(() => { host.hidden = true; });
})();
