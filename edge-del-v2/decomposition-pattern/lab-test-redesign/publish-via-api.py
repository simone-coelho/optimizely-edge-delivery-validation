#!/usr/bin/env python3
"""
Publish the "Lab — Decomposition pattern test" experiment to Optimizely
project 5953372780494848 via the Web Experimentation REST API.

Reads OPTIMIZELY_API_TOKEN from env. Reads the change content from
./change-1-insert-html.html and ./change-4-custom-code.js (siblings of
this script).

Creates the experiment with four changes (Insert HTML, attribute/class,
rearrange, custom_code), 100% to Variation #1, URL-targeted to
https://edge-del-v2-target.pages.dev/pricing. Then starts the experiment.
Then polls the public Edge Delivery manifest until the new layer
appears.
"""
from __future__ import annotations
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

PROJECT_ID = 5953372780494848
EDIT_URL   = "https://edge-del-v2-target.pages.dev/pricing"
MANIFEST_URL = "https://cdn.optimizely.com/js/web_sdk_v0_5953372780494848.json"
API_BASE   = "https://api.optimizely.com/v2"
NAME       = "Lab — Decomposition pattern test"

HERE = Path(__file__).resolve().parent

def must(env_name: str) -> str:
    val = os.environ.get(env_name)
    if not val:
        sys.exit(f"missing env var {env_name}")
    return val

TOKEN = must("OPTIMIZELY_API_TOKEN")

def api(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
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
        try:
            err = json.loads(e.read())
        except Exception:
            err = {"raw": str(e)}
        return e.code, err

# ── load change content from sibling files ────────────────────────────
change1_html = (HERE / "change-1-insert-html.html").read_text(encoding="utf-8")
change4_js   = (HERE / "change-4-custom-code.js").read_text(encoding="utf-8")
print(f"  change-1 HTML: {len(change1_html)} bytes")
print(f"  change-4 JS:   {len(change4_js)} bytes")

# ── create the Page object first ──────────────────────────────────────
# The REST API requires actions[] to reference an existing page_id. The
# Visual Editor implicitly creates pages when authoring; via REST we
# create one explicitly.
url_conditions = json.dumps([
    "and",
    ["or", {"match_type": "simple", "type": "url", "value": EDIT_URL}]
])

print("[0/3] POST /v2/pages — create URL-targeting page for /pricing …")
page_payload = {
    "project_id":      PROJECT_ID,
    "name":            "URL targeting for Lab decomposition test",
    "edit_url":        EDIT_URL,
    "conditions":      url_conditions,
    "key":             f"{PROJECT_ID}_lab_decomposition_pricing",
    "activation_type": "immediate",
    "category":        "other"
}
status, body = api("POST", "/pages", page_payload)
if status not in (200, 201):
    err_text = json.dumps(body).lower()
    # If a page with that key/api_name already exists from a prior attempt,
    # the API returns 400 with "already in use" — look it up by listing.
    if status == 400 and ("already in use" in err_text or "duplicate" in err_text):
        # Try to extract the existing id from the error message itself.
        import re
        m = re.search(r"id:\s*(\d+)", json.dumps(body))
        if m:
            page_id = int(m.group(1))
            print(f"  ↺ page already exists (id={page_id}); reusing")
        else:
            status, lookup = api("GET", f"/pages?project_id={PROJECT_ID}&per_page=100")
            existing = next((p for p in (lookup if isinstance(lookup, list) else [])
                             if p.get("api_name") == page_payload["key"]
                             or p.get("key") == page_payload["key"]), None)
            if existing:
                page_id = existing["id"]
                print(f"  ↺ page already exists (id={page_id}); reusing")
            else:
                print("  ✗ page create failed and lookup didn't find it")
                print(json.dumps(body, indent=2)[:2000])
                sys.exit(1)
    else:
        print(f"  ✗ page create failed (status {status})")
        print(json.dumps(body, indent=2)[:2000])
        sys.exit(1)
else:
    page_id = body["id"]
    print(f"  ✓ page created (id={page_id})")

variation_changes = [
    # Change 1 — Insert HTML at <main>, position "prepend" (first child)
    {
        "type":     "insert_html",
        "selector": "main",
        "operator": "prepend",
        "value":    change1_html,
        "async":    False,
        "dependencies": []
    },
    # Change 2 — Attribute class on h1#pricing-page-title
    {
        "type":     "attribute",
        "selector": "#pricing-page-title",
        "attributes": {"class": "optly-redesign"},
        "async":    False,
        "dependencies": []
    },
    # Change 3 — REARRANGE — NOT CREATABLE VIA REST API.
    # The Web Experimentation API's accepted change types are
    # [attribute, custom_code, custom_css, extension, insert_html,
    # insert_image, redirect]. 'rearrange' is omitted. The change must
    # be authored manually in the Visual Editor after this script runs.
    # See README.md §"After publish: add Change 3 via Visual Editor".
    # Change 4 — Custom Code (accordion wiring)
    {
        "type":  "custom_code",
        "value": change4_js,
        "async": True,
        "dependencies": []
    }
]

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

# ── create experiment ─────────────────────────────────────────────────
print()
print("[1/3] POST /v2/experiments …")
status, body = api("POST", "/experiments", payload)
if status not in (200, 201):
    print(f"  ✗ create failed (status {status})")
    print(json.dumps(body, indent=2)[:2000])
    sys.exit(1)
exp_id = body.get("id")
print(f"  ✓ experiment created (id={exp_id}, status={body.get('status')})")

# ── start experiment ──────────────────────────────────────────────────
# Documented endpoint (see swagger-web.json line 7641):
#   PATCH /v2/experiments/{id}?action=start
# Empty body. The `action` is a query parameter, not a body field.
print()
print(f"[2/3] PATCH /v2/experiments/{exp_id}?action=start …")
status, body = api("PATCH", f"/experiments/{exp_id}?action=start", body={})
if status not in (200, 201, 202):
    print(f"  ✗ start failed (status {status})")
    print(json.dumps(body, indent=2)[:2000])
    sys.exit(1)
print(f"  ✓ experiment started (status={body.get('status')}, earliest={body.get('earliest')})")

# ── poll manifest until the new layer is visible ──────────────────────
print()
print("[3/3] poll Edge Delivery manifest for the new layer …")
deadline = time.time() + 120
prev_rev = None
while time.time() < deadline:
    raw = urllib.request.urlopen(MANIFEST_URL).read()
    m = json.loads(raw)
    rev = m["config"].get("revision")
    layers = m["config"].get("layers", [])
    names = [l.get("name") for l in layers]
    if prev_rev != rev:
        print(f"  revision={rev} layers={names}")
        prev_rev = rev
    if any("decomposition" in (l.get("name") or "").lower() or "lab" in (l.get("name") or "").lower() and "decomposition" in (l.get("name") or "").lower() for l in layers):
        print(f"  ✓ new layer present at revision {rev}")
        break
    # accept any second layer as confirmation
    if len(layers) >= 2:
        print(f"  ✓ second layer present at revision {rev}: {names}")
        break
    time.sleep(5)
else:
    print("  ⚠ manifest didn't pick up the new layer within 120s — check Optimizely UI")
    sys.exit(2)

print()
print(f"DONE. experiment_id={exp_id}")
print(f"     manifest URL: {MANIFEST_URL}")
print(f"     edit URL:     {EDIT_URL}")
