#!/usr/bin/env python3
"""Export Wooldridge datasets closest to advertising/marketing for OLS checks."""
from pathlib import Path
import json

try:
    import wooldridge as woo
except ImportError:
    raise SystemExit("pip install wooldridge")

out = Path(__file__).resolve().parents[1] / "data" / "examples"
out.mkdir(parents=True, exist_ok=True)

v = woo.dataWoo("vote1")
c = woo.dataWoo("charity").dropna()

cases = {
    "vote1_share": {
        "title": "vote1: доля кампанийных расходов → % голосов",
        "source": "wooldridge vote1 (политическая реклама / campaign spend)",
        "y_label": "voteA (% голосов кандидата A)",
        "y": v["voteA"].astype(float).tolist(),
        "X": {
            "shareA": {
                "label": "Доля расходов A в суммарных (shareA)",
                "values": v["shareA"].astype(float).tolist(),
            },
            "prtystrA": {
                "label": "Сила партии A (prtystrA)",
                "values": v["prtystrA"].astype(float).tolist(),
            },
        },
    },
    "vote1_expend": {
        "title": "vote1: log расходов кампании → % голосов",
        "source": "wooldridge vote1",
        "y_label": "voteA",
        "y": v["voteA"].astype(float).tolist(),
        "X": {
            "lexpendA": {
                "label": "log расходов A",
                "values": v["lexpendA"].astype(float).tolist(),
            },
            "lexpendB": {
                "label": "log расходов B (конкурент)",
                "values": v["lexpendB"].astype(float).tolist(),
            },
            "prtystrA": {
                "label": "Сила партии A",
                "values": v["prtystrA"].astype(float).tolist(),
            },
        },
    },
    "charity_mailings": {
        "title": "charity: частота рассылок → размер дара (маркетинг)",
        "source": "wooldridge charity (Franses & Paap, Quantitative Models in Marketing Research)",
        "y_label": "gift (дар, гульдены)",
        "y": c["gift"].astype(float).tolist(),
        "X": {
            "mailsyear": {
                "label": "Рассылок в год (mailsyear)",
                "values": c["mailsyear"].astype(float).tolist(),
            },
            "giftlast": {
                "label": "Прошлый дар",
                "values": c["giftlast"].astype(float).tolist(),
            },
            "weekslast": {
                "label": "Недель с прошлого ответа",
                "values": c["weekslast"].astype(float).tolist(),
            },
            "propresp": {
                "label": "Доля ответов на рассылки",
                "values": c["propresp"].astype(float).tolist(),
            },
        },
    },
}

for key, payload in cases.items():
    (out / f"{key}.json").write_text(json.dumps(payload))
    print(f"wrote {key} n={len(payload['y'])}")

print(f"OK → {out}")
