"use strict";
/* Worked example on the guide page: fills section 7 with today's real readings from data/latest.json. */
(function () {
  const f = (x, d = 2) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sg = (x, d = 2) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  fetch("data/latest.json", { cache: "no-store" }).then(r => r.json()).then(L => {
    const M = L.margin, R = L.vix_research, V = L.vix_latest;
    const sc = id => L.scenario_meta.scenarios.find(s => s.id === id);
    const ev = (basis, id) => L.scenarios[basis].find(e => e.id === id);
    const pick = M.L145 ? "P13-60" : "P13-20";
    const s = sc(pick), er = ev("research", pick), el = ev("latest", pick);
    const terms = s.terms.map(t => t.var === "zV" ? `${f(t.coef)} × zV` : `${f(t.coef)} × [M<145]`).join(" + ");
    const calc = (e) => e.contrib.map(c => c.var === "zV" ? `${f(c.coef)} × ${sg(c.x)}` : `${f(c.coef)} × ${c.x}`).join(" + ");
    document.getElementById("exDate").textContent = "TW " + L.tw_date + " · VIX " + V.date;
    document.getElementById("exBody").innerHTML =
      `<p>以下數字取自網站最新資料，每次資料更新後會自動變動。</p>
       <div class="ex">
         <span class="step">① 維持率</span>　M = <b>${f(M.M)}%</b>　→　${M.M < 145 ? '<span class="dn">低於 145，旗標 [M&lt;145] = 1（ACTIVE）</span>' : `高於 145 共 ${f(M.M - 145)} 點，旗標 [M&lt;145] = 0`}<br>
         <span class="step">② 標準化</span>　zM = <b>${sg(M.zM)}</b>（5 年平均 ${f(M.mean_5y, 1)}，標準差 ${f(M.sd_5y, 1)}）<br>
         <span class="step">③ 恐慌指數</span>　研究口徑：T−1 = ${R.date}，VIX ${f(R.close)}，zV = <b>${sg(R.zV)}</b>；最新收盤：${V.date}，VIX ${f(V.close)}，zV = <b>${sg(V.zV)}</b><br>
         <span class="step">④ 代入 ${pick}</span>　額外報酬 = ${terms}
       </div>
       <ul class="plain">
         <li><b>研究口徑：</b>${calc(er)} ＝ <b>${sg(er.total_pp)} pp</b></li>
         <li><b>最新 VIX：</b>${calc(el)} ＝ <b>${sg(el.total_pp)} pp</b></li>
       </ul>
       <p>怎麼解讀：${M.L145 ? "低維持率旗標亮著，所以矩陣裡有低維持率項的列都被加上一大塊（這也是 NOW 欄數字偏大的原因，但那一項背後只有約 4–5 段歷史事件）。" : "目前旗標沒有亮，低維持率項貢獻為 0，數字只來自 VIX 項（或為 0）。"}
       <b>這個數字的意思是</b>「歷史上讀數類似的日子，之後 ${s.horizon} 個交易日，2 倍多單平均比平常多（少）賺這麼多個百分點」，不是對下一段走勢的預測。</p>`;
  }).catch(() => { document.getElementById("exBody").innerHTML = '<p class="mu">無法載入即時數字（請透過網址開啟本頁）。</p>'; });
})();
