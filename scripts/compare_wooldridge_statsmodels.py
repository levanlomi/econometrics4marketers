#!/usr/bin/env python3
"""Compare data/examples/our_ols_report.json to statsmodels OLS."""
from pathlib import Path
import json
import numpy as np

try:
    import statsmodels.api as sm
except ImportError:
    raise SystemExit("pip install statsmodels")

base = Path(__file__).resolve().parents[1] / "data" / "examples"
report = json.loads((base / "our_ols_report.json").read_text())
all_ok = True

for case in report:
    raw = json.loads((base / f"{case['name']}.json").read_text())
    y = np.array(raw["y"], float)
    cols = list(raw["X"].keys())
    X = sm.add_constant(np.column_stack([raw["X"][c]["values"] for c in cols]))
    smr = sm.OLS(y, X).fit()
    print(f"=== {case['title']} ===")
    print(f"R²  our={case['r2']:.8f}  sm={smr.rsquared:.8f}  Δ={case['r2'] - smr.rsquared:.2e}")
    for i, c in enumerate(cols):
        bo, po = case["coefficients"][i]["beta"], case["coefficients"][i]["p"]
        bs, ps = smr.params[i + 1], smr.pvalues[i + 1]
        ok = abs(bo - bs) < 1e-6 and abs(po - ps) < 0.01
        all_ok &= ok
        print(f"  {c:12s} βΔ={abs(bo - bs):.2e} pΔ={abs(po - ps):.4f}  [{'OK' if ok else 'DIFF'}]")
    print()

print("PASS" if all_ok else "FAIL")
raise SystemExit(0 if all_ok else 1)
