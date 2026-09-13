#!/usr/bin/env python3
# 开仓·现货 — OKX数据快照(Actions每10分钟): 全市场24h行情+四周期+250日收盘
import json
import urllib.request
import datetime
import time

STABLES = {"USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "PAXG", "EUR", "GBP", "TRY",
           "BRL", "AEUR", "USD1", "EURI", "XUSD", "USDE", "USTC", "FRAX"}
MIN_VOL = 1_000_000

def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 spot-radar/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def main():
    tick = get("https://www.okx.com/api/v5/market/tickers?instType=SPOT")
    assert tick.get("code") == "0"
    universe = []
    for t in tick.get("data", []):
        iid = t.get("instId", "")
        if not iid.endswith("-USDT"):
            continue
        base = iid[:-5]
        if base in STABLES:
            continue
        try:
            last, open24, vol = float(t["last"]), float(t["open24h"]), float(t.get("volCcy24h") or 0)
            hi, lo = float(t.get("high24h") or 0), float(t.get("low24h") or 0)
        except (ValueError, TypeError):
            continue
        if open24 <= 0 or vol < MIN_VOL:
            continue
        universe.append({"sym": base, "price": last, "open24": open24, "hi24": hi, "lo24": lo,
                         "c24": (last / open24 - 1) * 100, "vol24": vol})

    # 每只: 1h线170根(算1h/4h/7d窗口) + 日线250根收盘(画图)
    for i, r in enumerate(universe):
        try:
            c = get(f"https://www.okx.com/api/v5/market/candles?instId={r['sym']}-USDT&bar=1H&limit=170")
            closes = [float(k[4]) for k in c.get("data", [])][::-1]
            if len(closes) >= 2: r["c1"] = (closes[-1] / closes[-2] - 1) * 100
            if len(closes) >= 5: r["c4"] = (closes[-1] / closes[-5] - 1) * 100
            if len(closes) >= 25: r["c7"] = (closes[-1] / closes[-25] - 1) * 100
        except Exception:
            pass
        try:
            d = get(f"https://www.okx.com/api/v5/market/history-candles?instId={r['sym']}-USDT&bar=1D&limit=250")
            r["closes"] = [round(float(k[4]), 8) for k in d.get("data", [])][::-1]
            if r["closes"]:
                r["dates"] = [k[0][:10] for k in d.get("data", [])][::-1]
        except Exception:
            r["closes"] = []
        r.setdefault("c1", 0.0); r.setdefault("c4", 0.0); r.setdefault("c7", 0.0)
        if i % 4 == 3:
            time.sleep(0.35)

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    out = {"time": now.strftime("%Y-%m-%d %H:%M:%S"), "ts": int(now.timestamp()),
           "total": len(universe), "rows": universe}
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    withchart = sum(1 for r in universe if r.get("closes"))
    print("OKX现货快照OK %d对(含日线%d) %s" % (len(universe), withchart, out["time"]))

if __name__ == "__main__":
    main()
