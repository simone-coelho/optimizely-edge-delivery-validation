#!/usr/bin/env python3
"""
Push the updated change-4-custom-code.js content into the live Optimizely
experiment via PATCH /v2/experiments/{id}.

Re-reads the file each time so this can be re-run after edits.
"""
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

EXP_ID  = 5365514667556864
API_BASE = "https://api.optimizely.com/v2"
HERE = Path(__file__).resolve().parent
TOKEN = os.environ.get("OPTIMIZELY_API_TOKEN")
if not TOKEN: sys.exit("missing OPTIMIZELY_API_TOKEN")

def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url=f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data else {})
        }
    )
    try:
        resp = urllib.request.urlopen(req)
        return resp.getcode(), json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: err = json.loads(e.read())
        except Exception: err = {"raw": str(e)}
        return e.code, err

# 1. GET current experiment so we have the full shape to PATCH.
status, exp = api("GET", f"/experiments/{EXP_ID}")
if status != 200:
    print("GET failed:", status, exp); sys.exit(1)

# 2. Find the custom_code change in Variation #1 and replace its value.
new_code = (HERE / "change-4-custom-code.js").read_text(encoding="utf-8")
updated = False
for v in exp.get("variations", []):
    if v.get("name") != "Variation #1": continue
    for a in v.get("actions", []):
        for c in a.get("changes", []):
            if c.get("type") == "custom_code":
                c["value"] = new_code
                # Clear the src so the SDK uses the new value, not the
                # previously-uploaded versioned URL.
                c.pop("src", None)
                updated = True
if not updated:
    print("no custom_code change found"); sys.exit(1)

# 3. PATCH the experiment. Use ?action=publish so the change goes live.
status, body = api("PATCH", f"/experiments/{EXP_ID}?action=publish", body={
    "variations": exp["variations"]
})
if status not in (200, 201, 202):
    print("PATCH failed:", status, json.dumps(body)[:500]); sys.exit(1)
print(f"✓ patched. status={body.get('status')} earliest={body.get('earliest')}")
print(f"  custom_code now {len(new_code)} bytes")
