// 开仓·现货 — 纯OKX数据: 实时优先, Actions快照兜底
const $ = (id) => document.getElementById(id);
const FEE = 0.001;   // OKX现货taker 0.1%(双边)
const TRADE_KEY = "spot_trades_v1";

const fmtP = (p) => p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 2 })
  : p >= 1 ? String(+(+p).toFixed(4)) : String(+(+p).toFixed(8));
const fmtVol = (v) => v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + (v / 1e3).toFixed(0) + "K";
const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const clsOf = (n) => n >= 0 ? "c-up" : "c-down";

// ---------- 快照与实时 ----------
let snap = null, rows = [], cur = null, live = false, timer = null, busy = false;
const bySym = () => Object.fromEntries(rows.map(r => [r.sym, r]));

async function loadSnapshot() {
  snap = await fetch("data.json?v=" + Date.now(), { cache: "no-store" }).then(r => r.json()).catch(() => null);
  if (snap && snap.rows) rows = snap.rows;
}

async function liveOverlay() {
  live = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const d = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT", { signal: ctrl.signal }).then(r => r.json());
    clearTimeout(t);
    if (d.code === "0") {
      const m = {};
      for (const x of d.data) if (x.instId.endsWith("-USDT")) m[x.instId.slice(0, -5)] = x;
      rows.forEach(r => {
        const x = m[r.sym];
        if (x) {
          const last = +x.last, o = +x.open24h;
          r.price = last; r.hi24 = +x.high24h || r.hi24; r.lo24 = +x.low24h || r.lo24;
          if (o > 0) r.c24 = (last / o - 1) * 100;
          r.vol24 = +x.volCcy24h || r.vol24;
        }
      });
      live = true;
    }
  } catch (e) { /* 快照模式 */ }
  const el = $("okxSrc");
  if (snap) {
    const ageMin = Math.max(0, Math.round((Date.now() / 1000 - snap.ts) / 60));
    el.textContent = live ? "OKX:实时" : `OKX:快照${ageMin}分钟前`;
    el.className = "okx-src " + (live ? "live" : "");
  }
}

// ---------- 币种与行情 ----------
function buildSelector() {
  $("coinSel").innerHTML = rows.map(r => `<option value="${r.sym}">${r.sym}</option>`).join("");
  $("coinSel").value = cur || (rows[0] && rows[0].sym) || "";
}

function renderQuote() {
  const r = bySym()[cur];
  if (!r) return;
  $("qName").textContent = r.sym + "/USDT";
  $("qSub").textContent = `OKX现货 · ${live ? "实时" : "快照"}`;
  const pe = $("qPrice");
  pe.textContent = fmtP(r.price);
  pe.className = "qh-price " + clsOf(r.c24);
  const ce = $("qChg");
  ce.textContent = pct(r.c24);
  ce.className = "qh-chg " + clsOf(r.c24);
  const mg = (k, v, c = "") => `<div class="mg-cell"><span class="k">${k}</span><span class="v ${c}">${v}</span></div>`;
  $("metricGrid").innerHTML =
    mg("24h开", fmtP(r.open24)) + mg("24h高", fmtP(r.hi24), "c-up") + mg("24h低", fmtP(r.lo24), "c-down") +
    mg("24h额", fmtVol(r.vol24)) + mg("1小时", pct(r.c1), clsOf(r.c1)) +
    mg("4小时", pct(r.c4), clsOf(r.c4)) + mg("7天", pct(r.c7), clsOf(r.c7));
  renderChart(r);
  updateBuyPreview();
  renderPositions();
}

function renderChart(r) {
  const closes = r.closes || [];
  if (closes.length < 30) { $("klineChart").innerHTML = "<span class='loading'>日线数据不足</span>"; $("rangeStats").innerHTML = ""; return; }
  const cl = [...closes, r.price];   // 快照/实时最新价补最后一根
  const W = 640, H = 210, PL = 70, PR = 12, PT = 12, PB = 24;
  const cw = W - PL - PR, chh = H - PT - PB;
  const hi = Math.max(...cl), lo = Math.min(...cl);
  const range = hi - lo || 1;
  const x = i => PL + i / (cl.length - 1) * cw;
  const y = p => PT + (1 - (p - lo) / range) * chh;
  const chg = cl[cl.length - 1] / cl[0] - 1;
  const lc = chg >= 0 ? "#e54545" : "#24b28c";
  const pts = cl.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  let grid = "";
  for (let g = 0; g <= 4; g++) {
    const p = lo + range * g / 4, yy = y(p);
    grid += `<line x1="${PL}" y1="${yy}" x2="${W - PR}" y2="${yy}" stroke="#232a3a" stroke-width="0.6"/>` +
      `<text x="${PL - 5}" y="${yy + 3}" text-anchor="end" font-size="8.5" fill="#7a8299">${fmtP(p)}</text>`;
  }
  const n = closes.length;
  for (let g = 0; g <= 5; g++) {
    const xx = x(g * n / 5);
    grid += `<line x1="${xx}" y1="${PT}" x2="${xx}" y2="${H - PB}" stroke="#232a3a" stroke-width="0.6"/>`;
  }
  $("klineChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}
    <polygon points="${PL},${H-PB} ${pts} ${x(n)},${H-PB}" fill="${lc}" opacity="0.06"/>
    <polyline points="${pts}" fill="none" stroke="${lc}" stroke-width="1.5"/>
    <circle cx="${x(n)}" cy="${y(r.price)}" r="2.6" fill="${lc}"/>
    <text x="${W-PR}" y="12" text-anchor="end" font-size="10.5" fill="${lc}" font-weight="700">250日 ${pct(chg*100)}</text>
  </svg>`;
  $("chartNote").textContent = `(末点为${live ? "实时" : "快照"}价)`;
  const chgN = (k) => cl.length > k ? (cl[cl.length - 1] / cl[cl.length - 1 - k] - 1) * 100 : null;
  const cell = (k, v) => `<div class="rs-cell"><span class="k">${k}</span><b class="${v === null ? "" : clsOf(v)}">${v === null ? "--" : pct(v)}</b></div>`;
  $("rangeStats").innerHTML = cell("近5日", chgN(5)) + cell("近20日", chgN(20)) + cell("近60日", chgN(60)) + cell("近250日", chgN(250));
}

// ---------- 现货模拟交易 ----------
const loadT = () => { try { return JSON.parse(localStorage.getItem(TRADE_KEY)) || []; } catch (e) { return []; } };
const saveT = (l) => localStorage.setItem(TRADE_KEY, JSON.stringify(l));

function updateBuyPreview() {
  const r = bySym()[cur];
  if (!r) return;
  const amt = +$("buyAmount").value || 0;
  if (amt < 10) { $("buyPreview").textContent = "金额太小(最少10U)"; return; }
  const qty = amt * (1 - FEE) / r.price;
  $("buyPreview").innerHTML = `按 ${fmtP(r.price)} 买入 ≈ <b>${qty < 1 ? qty.toFixed(6) : qty.toFixed(4)} ${r.sym}</b> · 手续费 ${ (amt * FEE).toFixed(2) }U`;
}
$("buyAmount").addEventListener("input", updateBuyPreview);

$("buyBtn").addEventListener("click", () => {
  const r = bySym()[cur];
  if (!r) return;
  const amt = +$("buyAmount").value || 0;
  if (amt < 10) { alert("最少10U"); return; }
  const list = loadT();
  list.push({
    id: Date.now(), sym: r.sym,
    costU: amt, feeU: +(amt * FEE).toFixed(4), qty: +(amt * (1 - FEE) / r.price).toFixed(8),
    buyPrice: r.price, buyTime: Date.now(),
    sellPrice: null, sellTime: null, sellFeeU: null, pnl: null, pct: null, status: "hold",
  });
  saveT(list);
  renderPositions(); renderHistory();
});

function curPrice(sym) { const r = bySym()[sym]; return r ? r.price : 0; }

function renderPositions() {
  const list = loadT().filter(t => t.status === "hold");
  if (!list.length) { $("posList").innerHTML = "<span class='loading'>暂无持仓</span>"; $("posSummary").textContent = ""; return; }
  let totCost = 0, totVal = 0;
  $("posList").innerHTML = list.map(t => {
    const p = curPrice(t.sym) || t.buyPrice;
    const val = t.qty * p * (1 - FEE);          // 现在清仓可得
    const pnl = val - t.costU;
    totCost += t.costU; totVal += val;
    const cls = pnl >= 0 ? "c-up" : "c-down";
    return `<div class="pos-card">
      <div class="pos-head">
        <span class="pc-name">${t.sym}</span>
        <span class="pc-pnl ${cls}">${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}U (${(pnl / t.costU * 100).toFixed(2)}%)</span>
      </div>
      <div class="pc-rows">
        <span>${t.qty < 1 ? t.qty.toFixed(6) : t.qty.toFixed(4)}个 @${fmtP(t.buyPrice)}</span>
        <span>成本${t.costU}U</span><span>现价${fmtP(p)}</span><span>清仓得≈${val.toFixed(2)}U</span>
        <span>${new Date(t.buyTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
      </div>
      <button class="sell-btn" data-id="${t.id}">💰 全部卖出</button>
    </div>`;
  }).join("");
  $("posSummary").textContent = `${list.length}笔 · 成本${totCost.toFixed(0)}U · 市值≈${totVal.toFixed(0)}U · 浮动${(totVal - totCost >= 0 ? "+" : "")}${(totVal - totCost).toFixed(2)}U`;
  $("posList").querySelectorAll(".sell-btn").forEach(b =>
    b.addEventListener("click", () => sellAll(+b.dataset.id)));
}

function sellAll(id) {
  const list = loadT();
  const t = list.find(x => x.id === id);
  const p = curPrice(t.sym);
  if (!t || t.status !== "hold" || !(p > 0)) { alert("价格不可用"); return; }
  const gross = t.qty * p;
  t.sellPrice = p;
  t.sellFeeU = +(gross * FEE).toFixed(4);
  const net = gross * (1 - FEE);
  t.sellTime = Date.now();
  t.pnl = +(net - t.costU).toFixed(2);
  t.pct = +(t.pnl / t.costU * 100).toFixed(2);
  t.status = "closed";
  saveT(list);
  renderPositions(); renderHistory();
}

function renderHistory() {
  const closed = loadT().filter(t => t.status === "closed").sort((a, b) => b.sellTime - a.sellTime);
  if (!closed.length) { $("histList").innerHTML = "<span class='loading'>暂无交易</span>"; $("histSummary").textContent = ""; return; }
  const wins = closed.filter(t => t.pnl > 0).length;
  const tot = closed.reduce((s, t) => s + t.pnl, 0);
  $("histSummary").textContent = `${closed.length}笔 · 胜率${(wins / closed.length * 100).toFixed(0)}% · 净${tot >= 0 ? "+" : ""}${tot.toFixed(2)}U`;
  $("histList").innerHTML = closed.slice(0, 30).map(t => {
    const days = Math.max(0, (t.sellTime - t.buyTime) / 86400000);
    const dstr = days >= 1 ? days.toFixed(1) + "天" : (days * 24).toFixed(1) + "时";
    return `<div class="hist-row">
      <span class="hr-date">${new Date(t.sellTime).toLocaleDateString("zh-CN")}</span>
      <span class="hr-name">${t.sym}</span>
      <span class="hr-detail">${fmtP(t.buyPrice)}→${fmtP(t.sellPrice)} ${dstr} 费${(t.feeU + t.sellFeeU).toFixed(2)}U</span>
      <span class="hr-pnl ${clsOf(t.pnl)}">${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}U (${pct(t.pct)})</span>
    </div>`;
  }).join("");
}

// ---------- 刷新 ----------
async function refreshAll() {
  if (busy) return;
  busy = true;
  $("statusDot").className = "dot";
  try {
    await liveOverlay();
    renderQuote();
    $("statusDot").className = "dot ok";
    $("lastUpdate").textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (e) {
    $("statusDot").className = "dot err";
  } finally { busy = false; }
}
function startTimer() {
  clearInterval(timer);
  const sec = +$("intervalSel").value;
  if (sec > 0) timer = setInterval(refreshAll, sec * 1000);
}
$("intervalSel").addEventListener("change", startTimer);
$("refreshBtn").addEventListener("click", refreshAll);
$("coinSel").addEventListener("change", (e) => { cur = e.target.value; renderQuote(); });

(async function init() {
  await loadSnapshot();
  if (!rows.length) { $("qName").textContent = "快照不可用"; return; }
  rows.sort((a, b) => b.vol24 - a.vol24);
  cur = localStorage.getItem("spot_last") || "BTC";
  if (!bySym()[cur]) cur = rows[0].sym;
  localStorage.setItem("spot_last", cur);
  buildSelector();
  renderQuote();
  renderPositions();
  renderHistory();
  refreshAll();
  startTimer();
  $("coinSel").addEventListener("change", () => localStorage.setItem("spot_last", $("coinSel").value));
})();
