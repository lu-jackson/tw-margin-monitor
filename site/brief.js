"use strict";
/* Daily brief bar: headline only by default; click to expand the details. Data: data/daily_summary.json. */
(function () {
  const host = document.getElementById("brief");
  if (!host) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  fetch("data/daily_summary.json", { cache: "no-store" }).then(r => { if (!r.ok) throw 0; return r.json(); }).then(d => {
    const llm = d.source === "llm";
    const tag = llm ? `<span class="btag llm" title="Written by ${esc(d.model)}; every number is machine-checked against the data">AI</span>`
                    : `<span class="btag" title="Rule-based template (the AI writer was unavailable or failed verification)">AUTO</span>`;
    host.innerHTML =
      `<button class="brief-bar" type="button" aria-expanded="false"><span class="bl">DAILY BRIEF 每日摘要</span>${tag}` +
      `<span class="bh">${esc(d.headline)}</span><span class="bd">TW ${esc(d.tw_date)} · VIX ${esc(d.vix_date)}</span><span class="bx">詳情 ▾</span></button>` +
      `<div class="brief-body" hidden><ul>${d.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` +
      `<div class="brief-foot">${esc(d.disclaimer || "")} · 產生於 ${esc(d.generated_utc.replace("T", " ").replace("+00:00", "Z"))}</div></div>`;
    const bar = host.querySelector(".brief-bar"), body = host.querySelector(".brief-body");
    bar.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      bar.setAttribute("aria-expanded", String(open));
      bar.querySelector(".bx").textContent = open ? "收合 ▴" : "詳情 ▾";
    });
    host.hidden = false;
  }).catch(() => { host.hidden = true; });
})();
