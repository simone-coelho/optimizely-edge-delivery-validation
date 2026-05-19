#!/usr/bin/env python3
"""
Publish the "Indeed Pattern — Lab Emulation" experiment.

Reads the variation payloads from ../indeed-pricing/ (the actual
customer-resolved assets — 54 KB Insert HTML + 35-line custom code),
authors a four-change variation in Optimizely project 5953372780494848
targeting `/hire/cs/pricing` on our lab.

Three changes go in via the REST API (insert_html, attribute, custom_code).
The fourth — the rearrange — must be added via the Visual Editor; the
REST API does not expose `rearrange` as a creatable change type.

Run with OPTIMIZELY_API_TOKEN in env.
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

PROJECT_ID = 5953372780494848
EDIT_URL   = "https://edge-del-v2-target.pages.dev/hire/cs/pricing"
MANIFEST_URL = "https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json"
API_BASE   = "https://api.optimizely.com/v2"
NAME       = "Indeed Pattern — Lab Emulation"

HERE = Path(__file__).resolve().parent
INDEED = HERE.parent / "indeed-pricing"

TOKEN = os.environ.get("OPTIMIZELY_API_TOKEN")
if not TOKEN: sys.exit("missing env var OPTIMIZELY_API_TOKEN")

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

# ── Load the customer-resolved payloads from ../indeed-pricing/ ────────
change1_html = (INDEED / "change-1-insert-html.html").read_text(encoding="utf-8")
change4_js   = (INDEED / "change-4-custom-code.js").read_text(encoding="utf-8")
print(f"  Indeed Insert HTML payload: {len(change1_html):,} bytes")
print(f"  Indeed Custom Code shell:   {len(change4_js):,} bytes")

# ── Create the URL-targeting Page ─────────────────────────────────────
url_conditions = json.dumps([
    "and",
    ["or", {"match_type": "simple", "type": "url", "value": EDIT_URL}]
])
page_payload = {
    "project_id":      PROJECT_ID,
    "name":            "URL targeting for Indeed-pattern lab emulation",
    "edit_url":        EDIT_URL,
    "conditions":      url_conditions,
    "key":             f"{PROJECT_ID}_indeed_pattern_lab_emulation",
    "activation_type": "immediate",
    "category":        "other"
}
print()
print("[0/3] POST /v2/pages …")
status, body = api("POST", "/pages", page_payload)
if status not in (200, 201):
    err_text = json.dumps(body).lower()
    if status == 400 and ("already in use" in err_text or "duplicate" in err_text):
        m = re.search(r"id:\s*(\d+)", json.dumps(body))
        if m:
            page_id = int(m.group(1))
            print(f"  ↺ page already exists (id={page_id}); reusing")
        else:
            print("  ✗ page create failed and id not in error")
            print(json.dumps(body, indent=2)[:1000])
            sys.exit(1)
    else:
        print(f"  ✗ page create failed (status {status})")
        print(json.dumps(body, indent=2)[:1000])
        sys.exit(1)
else:
    page_id = body["id"]
    print(f"  ✓ page created (id={page_id})")

# ── Build the variation changes ───────────────────────────────────────
variation_changes = [
    # Change 1 — Insert HTML, the 54 KB pricing payload, prepended into <main>
    {
        "type":     "insert_html",
        "selector": "main",
        "operator": "prepend",
        "value":    change1_html,
        "async":    False,
        "dependencies": []
    },
    # Change 2 — Attribute class change: remove the
    # `hasTransparentGnavBackground` class. Optimizely's data model
    # writes the FULL new class string. Our test element only has this
    # one class, so the new value is "".
    {
        "type":     "attribute",
        "selector": ".hasTransparentGnavBackground",
        "attributes": {"class": ""},
        "async":    False,
        "dependencies": []
    },
    # Change 3 (REARRANGE) is NOT created here — REST API does not
    # accept change.type='rearrange'. Author it in the Visual Editor:
    # - Element: [data-tn-section="header"]
    # - Move to: before .opt-moo-1399
    # - URL conditional: /hire/cs/pricing (already satisfied by view URL)
    # Change 4 — Custom Code shell
    {
        "type":  "custom_code",
        "value": change4_js,
        "async": True,
        "dependencies": []
    }
]

# ── Create the experiment ─────────────────────────────────────────────
payload = {
    "project_id": PROJECT_ID,
    "name":       NAME,
    "type":       "a/b",
    "audience_conditions": "everyone",
    "page_ids":   [page_id],
    "variations": [
        {"name": "Original",     "weight": 0,
         "actions": [{"page_id": page_id, "changes": []}],
         "archived": False, "status": "active"},
        {"name": "Variation #1", "weight": 10000,
         "actions": [{"page_id": page_id, "changes": variation_changes}],
         "archived": False, "status": "active"}
    ],
    "metrics": [
        {"aggregator": "sum", "field": "revenue",
         "scope": "visitor", "winning_direction": "increasing"}
    ],
    "allocation_policy":  "manual",
    "traffic_allocation": 10000,
    "holdback":           0
}
print()
print("[1/3] POST /v2/experiments …")
status, body = api("POST", "/experiments", payload)
if status not in (200, 201):
    print(f"  ✗ experiment create failed (status {status})")
    print(json.dumps(body, indent=2)[:1500])
    sys.exit(1)
exp_id = body["id"]
print(f"  ✓ experiment created (id={exp_id}, status={body.get('status')})")

# ── Start the experiment ──────────────────────────────────────────────
print()
print(f"[2/3] PATCH /v2/experiments/{exp_id}?action=start …")
status, body = api("PATCH", f"/experiments/{exp_id}?action=start", body={})
if status not in (200, 201, 202):
    print(f"  ✗ start failed (status {status})")
    print(json.dumps(body, indent=2)[:1500])
    sys.exit(1)
print(f"  ✓ experiment running (earliest={body.get('earliest')})")

# ── Wait for manifest to flush ────────────────────────────────────────
print()
print("[3/3] poll manifest for new layer …")
deadline = time.time() + 120
while time.time() < deadline:
    raw = urllib.request.urlopen(MANIFEST_URL).read()
    m = json.loads(raw)
    layers = m["config"].get("layers", [])
    names = [l.get("name") for l in layers]
    if "Indeed Pattern — Lab Emulation" in names:
        print(f"  ✓ manifest revision {m['config'].get('revision')} — layer present: {names}")
        break
    time.sleep(5)
else:
    print("  ⚠ manifest didn't pick up the new layer within 120s")
    sys.exit(2)

print()
print(f"DONE. experiment_id={exp_id} page_id={page_id}")
print()
print("NEXT — manual step (REST API doesn't expose rearrange):")
print(f"  Open https://app.optimizely.com/v2/projects/{PROJECT_ID}/experiments/{exp_id}/variations")
print( "  Open Variation #1 in the Visual Editor against /hire/cs/pricing")
print( "  Click on the header (the element with [data-tn-section='header'])")
print( "  Move Element → target .opt-moo-1399 → position Before → Save")
print()
print( "Then run: npx tsx decomposition-pattern/lab-indeed-emulation/verify.mjs")
