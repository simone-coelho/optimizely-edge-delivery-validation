#!/usr/bin/env python3
"""
Adds the variation-scoped approximation CSS (change-5-custom-css.css)
to the existing "Indeed Pattern — Lab Emulation" experiment as a
`custom_css` change on Variation #1, preserving every existing change
(including any rearrange the user added in the Visual Editor).

Authoring discipline this script enforces:

    HTML content          → insert_html change   (REST authorable)
    Visual attribute      → attribute change     (REST authorable)
    Element reorder       → rearrange change     (Visual Editor only)
    Behaviour shell       → custom_code change   (REST authorable)
    Variation-scoped CSS  → custom_css change    (REST authorable)  ← THIS SCRIPT

The CSS belongs IN OPTIMIZELY — never in the customer's source code.
The rapid-experimentation engineer's working surface is the variation
in the customer's Optimizely account; the customer's codebase is
read-only as far as the experiment is concerned.

Idempotent: run repeatedly without creating duplicates. If a
`custom_css` change with the same content already exists on the
variation, the script is a no-op.

Requires OPTIMIZELY_API_TOKEN in env (read from
optly-mcp-server/.env on this machine).
"""
from __future__ import annotations
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

EXP_ID = 5831913756164096
PROJECT_ID = 5953372780494848
MANIFEST_URL = f"https://cdn.optimizely.com/js/web_sdk_v0_{PROJECT_ID}.json"
API_BASE = "https://api.optimizely.com/v2"

HERE = Path(__file__).resolve().parent
CSS_FILE = HERE / "change-5-custom-css.css"

TOKEN = os.environ.get("OPTIMIZELY_API_TOKEN")
if not TOKEN:
    sys.exit("missing env var OPTIMIZELY_API_TOKEN")

def api(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url=f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if data else {}),
        },
    )
    try:
        r = urllib.request.urlopen(req)
        return r.getcode(), json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"raw": str(e)}

css_body = CSS_FILE.read_text(encoding="utf-8")
print(f"  custom CSS payload: {len(css_body):,} bytes ({len(css_body.splitlines())} rules)")

# 1. GET the experiment
print()
print(f"[1/4] GET /experiments/{EXP_ID} …")
status, exp = api("GET", f"/experiments/{EXP_ID}")
if status != 200:
    print(f"  ✗ fetch failed (status {status})")
    print(json.dumps(exp, indent=2)[:1000])
    sys.exit(1)
print(f"  ✓ {exp.get('name')} (status={exp.get('status')})")

variations = exp.get("variations", [])
v1 = next((v for v in variations if v["name"] == "Variation #1"), None)
if not v1:
    sys.exit("  ✗ Variation #1 not found")
print(f"  ✓ variation_id={v1.get('variation_id')} weight={v1.get('weight')}")

# 2. Locate / build the custom_css change
actions = v1.get("actions", [])
if not actions:
    sys.exit("  ✗ Variation #1 has no actions — recreate experiment via publish-via-api.py first")
action = actions[0]
changes = action.get("changes", [])

existing_css_change_idx = None
for i, c in enumerate(changes):
    if c.get("type") == "custom_css":
        existing_css_change_idx = i
        break

custom_css_change = {
    "type":  "custom_css",
    "value": css_body,
    "async": False,
    "dependencies": []
}

if existing_css_change_idx is not None:
    existing = changes[existing_css_change_idx]
    if existing.get("value") == css_body:
        print()
        print("  ↺ custom_css change already present with identical content — nothing to do.")
        print("    (re-run after editing change-5-custom-css.css to push updates)")
        sys.exit(0)
    print()
    print(f"  ↺ updating existing custom_css change at index {existing_css_change_idx}")
    custom_css_change["id"] = existing.get("id")
    changes[existing_css_change_idx] = custom_css_change
else:
    print()
    print("  + appending new custom_css change to Variation #1")
    changes.append(custom_css_change)

action["changes"] = changes

# 3. PATCH the experiment with the updated variations array
print()
print(f"[2/4] PATCH /experiments/{EXP_ID} (variations.actions.changes) …")
payload = {"variations": variations}
status, body = api("PATCH", f"/experiments/{EXP_ID}", payload)
if status not in (200, 201, 202):
    print(f"  ✗ patch failed (status {status})")
    print(json.dumps(body, indent=2)[:1500])
    sys.exit(1)
print(f"  ✓ experiment patched")

# 4. Flush manifest — pause + start cycles the CDN copy.
print()
print(f"[3/4] PATCH /experiments/{EXP_ID}?action=pause …")
status, _ = api("PATCH", f"/experiments/{EXP_ID}?action=pause", body={})
print(f"  status={status}")

time.sleep(2)

print()
print(f"[4/4] PATCH /experiments/{EXP_ID}?action=start …")
status, _ = api("PATCH", f"/experiments/{EXP_ID}?action=start", body={})
print(f"  status={status}")

# 5. Poll the manifest until the custom_css change appears.
print()
print("polling manifest for custom_css change …")
deadline = time.time() + 120
expected = css_body.strip().splitlines()[-1] if css_body else ""
while time.time() < deadline:
    raw = urllib.request.urlopen(MANIFEST_URL).read().decode()
    if "custom_css" in raw and (expected[:60] in raw or len(expected) == 0):
        print("  ✓ manifest contains custom_css change")
        break
    time.sleep(5)
else:
    print("  ⚠ manifest didn't pick up the custom_css change within 120s")
    sys.exit(2)

print()
print("DONE.")
print()
print("Next:")
print("  - Remove the lab-only useHead({ style: ... }) block from")
print("    target-app/pages/hire/cs/pricing.vue; the variation's")
print("    custom_css now owns the styling.")
print("  - Re-run: node decomposition-pattern/lab-indeed-emulation/verify.mjs")
