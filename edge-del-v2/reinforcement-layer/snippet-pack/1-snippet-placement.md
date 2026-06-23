# 1 — Snippet placement on SCA

## The rule

Synchronous `<script>` tag, as high in the `<head>` as you can put it,
in the SSP shell template. Never via GTM. Never deferred or async.

```html
<!-- shell.tpl (or whatever your SSP shell file is called) -->
<head>
  <!-- everything from your existing <head> up to and including any
       CSS that affects layout -->

  <!-- Optimizely Web Experimentation snippet — first thing that
       can run JavaScript on this page. Synchronous on purpose. -->
  <script src="https://cdn.optimizely.com/js/{PROJECT_ID}.js"></script>

  <!-- everything else -->
</head>
```

`{PROJECT_ID}` is the numeric ID from your Optimizely project URL.

## Why this exact placement

Two reasons, both about race conditions:

1. **The snippet must run before Backbone starts rendering.** If
   Backbone's first `view.render()` lands before the snippet has
   evaluated, Optimizely doesn't know which experiments are eligible
   yet, can't apply DOM changes for the matching pages, and you get
   flicker (control content shown for ~100-300ms, then variation
   content). Synchronous head placement is the only way to be ahead of
   Backbone.

2. **Anti-flicker depends on synchronous evaluation.** Optimizely's
   built-in anti-flicker behavior hides the page briefly while
   variations are computed. That hiding works only if the snippet is
   already executing when the body starts rendering. An async or
   deferred snippet can't beat the browser's parser to that.

## Why never via GTM on SCA

Google Tag Manager loads asynchronously by design. Even if you
configure GTM to fire the Optimizely tag at "Page View - DOM Ready,"
the GTM container itself loads async, meaning the Optimizely tag fires
**after** Backbone has already started rendering. Three observable
problems:

| What goes wrong | What it looks like |
|---|---|
| Variation arrives after first paint | Flicker — control flashes, variation pops in |
| Backbone re-renders before the snippet has scanned | The MutationObserver Optimizely installs (via Support for Dynamic Websites) starts AFTER the relevant mutations have already happened — misses them |
| Visitor counts skewed | Some visits bounce in the window between page-load and snippet-fire and never trigger `activate` — they never count in Optimizely's denominator, inflating apparent conversion rates |

GTM is fine for downstream analytics tags (GA4, Adobe). It is the
wrong loader for an experimentation snippet on this platform.

## The two SCA template files you might need to edit

SCA structures the SSP layout across multiple template files
depending on the version. The two most likely to need the snippet
inserted:

| File | When |
|---|---|
| `Modules/.../layout/header.tpl` | Most SCA installations. The header partial is included in every SSP shell, and you want the snippet at the top of `<head>` — usually directly above the `<title>` tag. |
| `Modules/.../shell.tpl` or `shell.html` | If your build has a flat shell template that defines `<head>` directly. |

Search the codebase for `<head>` and pick the file that defines it
**outermost** — that's the SSP shell. If multiple files have it (e.g.
a desktop shell and a mobile shell), put the snippet in **both** — SCA
serves different shells based on User-Agent.

## What about Project JavaScript?

Optimizely's "Project JavaScript" pane is a code field inside the
Optimizely UI whose contents are inlined into the snippet bundle
itself. So:

- Anything you put in Project JavaScript runs as part of the snippet,
  before any variation code, with `window.optimizely.utils` available
  immediately.
- This is where the **companion** goes (see
  `3-companion-installation.md`). The companion's source pasted into
  Project JS means you don't have to change the SCA template at all
  beyond the `<script src=…>` line above. Everything else lives in
  the snippet bundle.

Tradeoff: Project JavaScript code is bundled into a file Optimizely's
CDN serves. Cache behavior is controlled by Optimizely, not by your
build pipeline. Changes can take a few minutes to propagate after you
hit "Publish."

## Verification after install

DevTools → Network → filter "optimizely". On every page load you
should see exactly one request to `cdn.optimizely.com/js/{id}.js`
with status 200. If you see it firing twice (snippet src + GTM), pull
the GTM version. If you see no request at all, the snippet tag is in
the wrong template.

DevTools → Console:

```js
window.optimizely?.initialized
// → true within a few hundred ms of page load
```

If it stays `undefined`, the snippet didn't load (network error, CSP
blocking the source). If it stays `false` indefinitely, the snippet
loaded but couldn't initialize (project misconfiguration; check the
log via `localStorage.setItem('optimizely_log','{"enabled":true}')` and
reload).

## CSP note

Optimizely's snippet loads additional scripts inline. If you have a
strict Content Security Policy on the storefront, you'll need:

- `script-src cdn.optimizely.com` (the snippet itself + extra modules)
- `script-src 'unsafe-inline'` OR per-snippet nonces (the snippet
  emits inline scripts as part of normal operation)
- `connect-src logx.optimizely.com` (event API endpoint for impressions
  and conversions)
- `img-src cdn.optimizely.com` (variation image assets)

Most SCA installations don't ship with a strict CSP by default;
if Mystery Ranch has added one, those four directives are the
minimum.
