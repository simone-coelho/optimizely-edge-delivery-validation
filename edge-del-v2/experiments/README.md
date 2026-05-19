Experiment cases — change-type catalogue
=========================================

Each case maps to a bucket from `optimizely_guidance.txt §3` (Hydration and SSR
Frameworks). The harness runs every case against the target app twice — once
with the reinforcement layer disabled, once with it enabled — and asserts the
`expected.withoutReinforcement` / `expected.withReinforcement` outcomes.

| File                          | Page       | Bucket    | Without reinforcement | With reinforcement |
|-------------------------------|------------|-----------|-----------------------|--------------------|
| 01-text-content.json          | /          | safe      | recovered             | survives           |
| 02-attribute-only.json        | /          | safe      | recovered             | survives           |
| 03-css-class-toggle.json      | /          | safe      | recovered             | survives           |
| 04-additive-dom.json          | /          | fragile   | recovered             | survives           |
| 05-rearrange-unkeyed.json     | /features  | fragile   | recovered             | survives           |
| 06-rearrange-keyed.json       | /pricing   | graceful  | survives              | survives           |
| 07-stateful-subtree.json      | /about     | fragile   | recovered             | survives           |
| 08-combination.json           | /          | mixed     | partial               | survives           |

How to author a new case
------------------------

1. Pick the target page in `target-app/pages/` and a stable selector. Stable
   selectors are ids (`#hero-headline`), data attributes (`[data-edge-region=...]`),
   or anchors (`[data-edge-anchor=...]`). Avoid descendant selectors that span
   client-only regions.
2. Pick one or more ops from the schema in `edge-worker/src/types.ts`.
3. Predict the outcome with and without reinforcement using the bucket
   mapping in the guidance. The harness will tell you if your prediction
   was wrong.
4. Save the file as `NN-<slug>.json` (NN sorts the case order) and add an
   import line to `edge-worker/src/cases.ts`.

Schema (Op union)
-----------------

```ts
type Op =
  | { type: 'text';      selector; value }
  | { type: 'attribute'; selector; name; value }
  | { type: 'class';     selector; add?; remove? }
  | { type: 'add';       selector; html; position: 'before'|'after'|'prepend'|'append'|'replace' }
  | { type: 'remove';    selector }
  | { type: 'move';      selector; toSelector; position: 'before'|'after'|'prepend'|'append' }
```

Notes
-----

- Cases activate via `?case=<id>` query param or `edge-del-v2-case=<id>` cookie.
- The worker stamps `x-edge-del-v2: mode=local; case=<id>; build=<build>` on
  every transformed response — the harness uses this to confirm provenance.
- Multiple ops in a single case are applied in array order. The annotator
  unions their scopes per-selector before emitting `data-allow-mismatch`.
