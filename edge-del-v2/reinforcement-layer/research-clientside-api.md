# Optimizely Client-Side JS API — Reference for Reinforcement Layer Design

**Scope.** This document covers the standard client-side Optimizely Web Experimentation snippet (the JavaScript file customers paste in the page `<head>`), NOT Edge Delivery. Where edge behavior diverges meaningfully, the difference is called out.

**Primary sources of ground truth.**

1. Live snippet at `https://cdn.optimizely.com/js/5953372780494848.js`, cached at `/tmp/optly-snippet.js` (306 KB, single-line minified, fetched 2026-05-14).
2. `@optimizely/edge-delivery` npm package at `/tmp/edge-delivery-pkg/package/dist/` (TypeScript declarations + compiled `index.js`).
3. Optimizely developer docs at `docs.developers.optimizely.com` (the pages are JS-rendered, so deep-link content is partially extractable via WebFetch; cited where available).
4. Optimizely support knowledge base at `support.optimizely.com`.
5. Third-party customer write-ups where they corroborate or contradict the official docs.

**Convention.** Where the snippet's minified code is quoted, source line context is given via grep-extracted patterns; identifiers like `a`, `t`, `o` are the minifier's local renames and have no semantic meaning.

---

## 1. DOM markers added by visual changes

### 1.1 What the snippet writes to the DOM

The live snippet writes **exactly one** distinct `data-*` attribute to the DOM under normal change application:

| Attribute name | Value format | When written | Persistence |
|---|---|---|---|
| `data-optly-persist-id` | Random hex token (e.g. `f3a2b9c1e0...`) generated per inserted node | Only when an `insert_html` style change calls the internal `persistHtml(html, selector, placement)` helper to inject DOM nodes | Persists on the inserted element. Read back on reapply / undo to find the previously-inserted nodes. NOT keyed to changeId. |

**Source.** From `/tmp/optly-snippet.js` (minified):

```js
function(n){
  var t=document.createElement("div"); t.innerHTML=n;
  var e=[];
  Array.prototype.forEach.call(t.childNodes,(function(n){
    if(n.nodeType===Node.ELEMENT_NODE){
      var t=r();           // r() === 3818.generate() — random hex
      e.push(t);
      n.setAttribute("data-optly-persist-id",t)
    }
  }));
  return{taggedHtml:t.innerHTML,ids:e}
}(n)
```

A grep of every `setAttribute(...)` call site in the snippet (sorted, unique) returns only:

```
setAttribute("data-optly-persist-id", t)
setAttribute("tabindex", "-1")           // for the internal preview iframe
setAttribute("title", "Optimizely Internal Frame")  // for the internal preview iframe
```

There are no other `data-*` attributes the snippet writes during regular change application. The snippet does NOT decorate the elements it modifies (text-change, class-change, attribute-change, style-change, etc.) with a per-change marker.

### 1.2 The `CHANGE_ID_ATTRIBUTE_PREFIX` constant — present but unused in the bundle we have

The snippet defines a constant `CHANGE_ID_ATTRIBUTE_PREFIX:"data-optly-"`:

```js
n.exports={
  SELECTOR_POLLING_MAX_TIME:2e3,
  CHANGE_DATA_KEY:"optimizelyChangeData",
  CHANGE_ID_ATTRIBUTE_PREFIX:"data-optly-"
}
```

…in module `6774`. **However**, that string is referenced exactly once across the entire 306 KB bundle (its own definition site). Grep `grep -c CHANGE_ID_ATTRIBUTE_PREFIX /tmp/optly-snippet.js` returns `1`. **The constant is defined but no module in this snippet bundle reads it.** The standard client-side snippet therefore does NOT tag DOM elements with `data-optly-<changeId>` per change.

By contrast, the Edge Delivery SDK actively uses `CHANGE_ID_ATTRIBUTE_PREFIX` to tag elements at the CDN. From `/tmp/edge-delivery-pkg/package/dist/index.js`:

```js
// constants.d.ts equivalent:
CHANGE_ID_ATTRIBUTE_PREFIX:"data-optly-"

// usage during HTMLRewriter element handler:
element.setAttribute(s.CHANGE_ID_ATTRIBUTE_PREFIX + r.change.id, "")
```

So the marker pattern `data-optly-<changeId>=""` that previous research identified for Edge Delivery is **edge-specific**. It is NOT applied by the standard client-side snippet.

### 1.3 What the docs claim about "tagging with UUIDs"

The official React-SSR doc states:

> "If set to run immediately, the Optimizely snippet applies visual changes based on active experiments, **tagging modified elements with a unique UUID**." […] "During reactivation, the snippet recognizes that those elements do not have the UUID and reapplies the visual changes."
> — *Implement Optimizely with React SSR and hydration*, docs.developers.optimizely.com

This claim is **partially supported and partially contradicted** by the snippet code:

- The `data-optly-persist-id` mechanism does tag *inserted* elements with a random hex ID, but only those, and it does so to find them on reapply/undo, not to gate per-change reapplication for all change types.
- For changes that mutate existing elements (text, class, attribute, style, etc.), the bundle we audited does NOT tag the element. The snippet appears to track applied-action state in JavaScript memory (`actionState[actionId]`) rather than via DOM markers.

The docs' phrasing about "UUID tagging" is either marketing-grade imprecision, or refers to internal in-memory state, or refers to a code path not active in the standard snippet build (5953372780494848.js).

### 1.4 Customer-authored markers (orthogonal to snippet-written markers)

A separate Optimizely doc, *"Control experiment activation with markers in React"* (docs.developers.optimizely.com/web-experimentation/docs/use-markers-for-controlled-activation), describes **customer-authored** markers:

> "Data attributes — More versatile and less likely to conflict with existing CSS. Use `data-optimizely-page="my-experiment"` or similar attributes."

These are markers the customer puts in their React/Vue JSX/templates so that Optimizely's `MutationObserver` or customer-written `useEffect` hooks can detect when an element is ready and then call `window.optimizely.push({type:'page',pageName:'…'})`. Optimizely **reads** these via DOM observation; it does **not** write them.

### 1.5 Summary for reinforcement-layer design

- **Per-change DOM markers (`data-optly-<changeId>`)**: Edge Delivery only. NOT available on the standard client-side snippet.
- **Inserted-node markers (`data-optly-persist-id`)**: Available client-side, but only on `insert_html`-style changes. Value is a random hex, not the changeId.
- **Generic per-element markers tied to experiment/variation IDs**: Not added by the snippet for in-place mutations.
- A reinforcement layer attempting to use DOM markers as the primary "what was applied" signal cannot rely on the client-side snippet to produce them. The reinforcement layer would have to inject its own markers (around each change replay) or rely entirely on the JS-state APIs in §3.

---

## 2. Event listeners on `window.optimizely`

### 2.1 The listener registration API

The public listener API is `addListener` (also reachable via `push({type:'addListener', filter:{…}, handler:fn})`).

**Source.** From `/tmp/optly-snippet.js`:

```js
addListener=function(n){
  if("function"!=typeof n.handler) throw new Error("A handler function must be supplied");
  (n=i.omit(n,"type")).publicOnly=!0,
  n.emitErrors=!0;
  var t=n.handler;
  n.handler=function(n){
    try{return t(n)}catch(e){throw new M(e)}
  },
  m.on(n)
}

removeListener=function(n){
  if(!n.token) throw new Error("Must supply a token to removeListener");
  m.off(n.token)
}
```

The wrapper sets `publicOnly:true` and `emitErrors:true` on the registration object before passing to the internal `m.on()`, which mutates the object to add `n.token = i.generate()`. After registration the caller's `n.token` is populated; the caller passes that token back to `removeListener({token})` to unregister.

**Important consequence**: the internal `getHandlers` function filters out `publicOnly:true` handlers when emitting with the "internal-only" flag set:

```js
getHandlers:function(n,t){
  var e=[null,{type:n.type},{type:n.type,name:n.name}],i=[],r=this;
  return e.forEach((function(n){
    var t=o(n),e=r.nn.handlers[t];
    e&&(i=i.concat(e))
  })),
  t&&(i=i.filter((function(n){return!n.publicOnly}))),
  i
}
```

When the emitter is called as `emit(event, true)`, only non-public handlers receive the event. **There is exactly one event emitted as internal-only**: the `activate` lifecycle event:

```js
emitActivateEvent=function(){
  o.emit({type:a.TYPES.LIFECYCLE,name:"activate"},!0)
}
```

So public `addListener` cannot observe `activate`. All other emit calls in the snippet pass no second argument, so they go to public handlers too.

### 2.2 The TYPES enum

The filter `type` field accepts one of four string values, from constant module:

```js
TYPES:{ACTION:"action", ANALYTICS:"analytics", EDITOR:"editor", LIFECYCLE:"lifecycle"}
```

`EDITOR` is reserved for Optimizely's own preview/editor frame and isn't used in customer-facing events.

### 2.3 Complete catalog of emitted (type, name) combinations

Extracted from the snippet by grepping every `type:…,name:"…"` literal at an emit site:

| Filter `type` | Filter `name` | Public? | Source emit function | Payload shape (top-level fields under `event.data`) |
|---|---|---|---|---|
| `lifecycle` | `initialized` | yes | `emitInitializedEvent` | `{}` (no data field of significance; the event has just `type` and `name`). The function also sets `window.optimizely.initialized=true` as a side effect. |
| `lifecycle` | `originsSynced` | yes | `emitOriginsSyncedEvent` | `{}` |
| `lifecycle` | `activate` | **NO (internal only)** | `emitActivateEvent` | not addressable from `addListener` |
| `lifecycle` | `activated` | yes | `emitActivatedEvent` | `{}` |
| `lifecycle` | `layerDecided` | yes | `emitLayerDecided(n)` | `{… spread of decisionTicket/decision/layerId, audiences:[{id,name}]}` |
| `lifecycle` | `campaignDecided` | yes | `emitLayerDecided` → `translateLayerEventToCampaignEvent` (alias of `layerDecided` with campaign-flavored field renames; both events fire together) | `{campaign, decisionTicket, decision, audiences}` where `campaign` is the layer with `layerId`→`campaignId`, `isLayerHoldback`→`isCampaignHoldback`, and `changes` arrays dereferenced |
| `lifecycle` | `viewActivated` | yes | `emitViewActivated(n)` | View metadata (id, apiName, activationType, conditions, etc.) |
| `lifecycle` | `pageActivated` | yes | translation of `viewActivated`: `{page: <view object>}` | `{page: viewObject}` |
| `lifecycle` | `viewsActivated` | yes | `emitViewsActivated` | Array/object of all views currently active |
| `lifecycle` | `pageDeactivated` | yes | `emitPageDeactivated` | View/page object |
| `action` | `applied` | yes | `emitActionAppliedEvent(action)` | See §2.4 below — this is the per-action change-applied event |
| `action` | `appliedAllForDecision` | yes | `emitActionsForDecisionAppliedEvent(decision, actions)` | `{decision, actions: Action[]}` — fires once per layer decision after all its actions apply |
| `analytics` | `trackEvent` | yes | `emitAnalyticsEvent(n)` | The internal event object: `{name, apiName, type:"custom"|"pageview", category, tags, metrics, properties}` |
| `analytics` | `sendEvents` | yes | `emitSendEvents` | `{}` — fires when queued events are released |
| `analytics` | `maybeSendEvents` | yes | `emitMaybeSendEvents` | `{}` — internal signal to attempt to flush |
| `analytics` | `holdEvents` | yes | `emitHoldEvents` | `{}` — fires when event queueing is enabled |
| `error` | `Error` (or custom error name) | yes | `emitError(err, metadata, ...)` | `{error, metadata}` |

**Verification grep:**

```sh
$ grep -oE 'type:a\.TYPES\.LIFECYCLE,name:"[a-zA-Z]+"|type:a\.TYPES\.ACTION,name:"[a-zA-Z]+"|type:a\.TYPES\.ANALYTICS,name:"[a-zA-Z]+"|type:"lifecycle",name:"[a-zA-Z]+"|type:"action",name:"[a-zA-Z]+"|type:"analytics",name:"[a-zA-Z]+"' /tmp/optly-snippet.js | sort -u

type:"analytics",name:"trackEvent"
type:"lifecycle",name:"activate"
type:"lifecycle",name:"activated"
type:"lifecycle",name:"campaignDecided"
type:"lifecycle",name:"pageActivated"
type:"lifecycle",name:"pageDeactivated"
type:"lifecycle",name:"viewsActivated"
type:a.TYPES.ACTION,name:"applied"
type:a.TYPES.ACTION,name:"appliedAllForDecision"
type:a.TYPES.ANALYTICS,name:"holdEvents"
type:a.TYPES.ANALYTICS,name:"maybeSendEvents"
type:a.TYPES.ANALYTICS,name:"sendEvents"
type:a.TYPES.LIFECYCLE,name:"activate"
type:a.TYPES.LIFECYCLE,name:"activated"
type:a.TYPES.LIFECYCLE,name:"initialized"
type:a.TYPES.LIFECYCLE,name:"layerDecided"
type:a.TYPES.LIFECYCLE,name:"originsSynced"
type:a.TYPES.LIFECYCLE,name:"pageDeactivated"
type:a.TYPES.LIFECYCLE,name:"viewActivated"
type:a.TYPES.LIFECYCLE,name:"viewsActivated"
```

Items appearing in both string-form and constant-form (e.g. `activate`, `viewsActivated`, etc.) are emitted from both legacy and current code paths in the snippet but are the same logical event.

### 2.4 The `applied` event payload — full shape

This is the event most relevant to a reinforcement layer. From the snippet:

```js
emitActionAppliedEvent=function(n){
  var t={
    type:n.type,             // the change-type/action-type — string like "page" or "redirect"
    campaignId:n.layerId,
    pageId:n.pageId,
    experimentId:n.experimentId,
    variationId:n.variationId
  };
  u.defineProperty(t,"changes",(function(){
    return s(n).changeSet
  }),"actionAppliedEvent");
  var e={type:a.TYPES.ACTION, name:"applied", data:t};
  o.emit(e)
}
```

The `changes` field is a **lazy getter** (`defineProperty(...)`) that returns the action's change-set with each change projected through:

```js
function s(n){
  var t=["type","selector","attributes","value"];
  var e=i.extend({},n);
  e.changeSet = n.changeSet.map((function(n){
    return i.pick(c.dereferenceChangeId(n), t)
  }));
  return e
}
```

So each entry in `event.data.changes` is a `pick(change, ["type","selector","attributes","value"])`. The change **id** is **not** included in the public projection. The change must be matched back to a manifest by `(type, selector, attributes, value)` tuple, or by ordering, or by combining with the `experimentId`/`variationId` from the same event.

Net listener-payload shape for `applied`:

```ts
{
  type: "action",
  name: "applied",
  data: {
    type: string,            // action type (e.g. "page", "redirect")
    campaignId: string,
    pageId: string | null,
    experimentId: string,
    variationId: string,
    changes: Array<{
      type: string,          // "custom_code"|"attribute"|"append"|"rearrange"|"redirect"|"widget"
      selector: string | null,
      attributes: object | null,    // sub-keys can be "html","text","class","href","src","srcset","style","hide","remove"
      value: any | null
    }>
  }
}
```

The `appliedAllForDecision` event has the same per-action shape but inside `event.data.actions[]` and includes the full `decision` object.

### 2.5 Per-change vs per-action vs per-decision granularity

There is **no** `change.applied` event at per-change granularity. Optimizely emits at the **action** level — an action is one variation's set of changes for one page. If a variation has 5 visual changes on one page, the listener fires once for the action with all 5 changes in `data.changes[]`.

There is also no documented `change.reverted` event. When a page deactivates (`pageDeactivated`), the snippet undoes changes but does not emit a per-change revert notification.

### 2.6 Ordering of events

From the snippet's emit functions and the documented "snippet order of activation" (support.optimizely.com/hc/en-us/articles/4410289779853):

1. Snippet executes (top of `<head>`). Project JS runs. (No public event yet.)
2. `lifecycle.initialized` fires once.
3. `lifecycle.originsSynced` fires after origin/sticky-edge data sync.
4. For each page that activates: page-activation conditions are evaluated → `lifecycle.viewActivated` → `lifecycle.pageActivated` (the snippet emits both — `pageActivated` is a translation of `viewActivated` for legacy compatibility).
5. After all triggered pages activate: `lifecycle.viewsActivated` (singular emit summarizing the batch).
6. Decisions are made per layer: `lifecycle.layerDecided` and the campaign-flavored alias `lifecycle.campaignDecided` fire (both, simultaneously — they wrap the same data).
7. Changes are applied for each decided/active action. After each action's changes apply: `action.applied`.
8. After all actions for a decision apply: `action.appliedAllForDecision`.
9. `lifecycle.activated` fires once after the first activation cycle completes.
10. (Subsequent SPA reactivations re-run the relevant subset, starting again from step 4 for affected pages.)
11. `lifecycle.pageDeactivated` fires when a page's targeting condition stops matching (only relevant with Dynamic Websites enabled).

Analytics events (`analytics.trackEvent`, `sendEvents`, etc.) can fire at any time after step 1.

**Note on `activate` vs `activated`.** `activate` is internal-only (cannot be subscribed to). `activated` is the public "snippet has finished its first activation pass" signal.

### 2.7 What's documented publicly

Optimizely's public `addListener` reference page (`docs.developers.optimizely.com/web-experimentation/reference/add-listener`) is JS-rendered; the WebFetch tool returns only the page header. Adobe Analytics integration docs (cited by community sources) show the `campaignDecided` listener idiom:

```js
optimizely.push({
  type: 'addListener',
  filter: { type: 'lifecycle', name: 'campaignDecided' },
  handler: function (event) {
    var state = optimizely.get('state');
    var decisionString = state.getDecisionString({ campaignId: event.data.campaign.id });
  }
});
```

— from *Integrate Adobe Analytics with Optimizely Web Experimentation* (docs.developers.optimizely.com / via optipilot.com mirror).

Most listener documentation publicly published focuses on `campaignDecided` (for analytics integration) and `trackEvent` (for event capture). Public docs do **not** publish the full event catalog or the `action.applied` shape. The catalog in §2.3 was extracted from the snippet itself.

---

## 3. JavaScript API for enumerating experiments and changes

### 3.1 Entry-point selectors

- `window.optimizely.push([...])` / `window.optimizely.push({...})` — fire-and-forget commands.
- `window.optimizely.get(<moduleName>)` — synchronous getter returning the named module.
- `window.optimizely.initialized === true` after the snippet has finished initial setup.

The four documented module names accessible via `get`:

| Module | Purpose | Source |
|---|---|---|
| `state` | Current runtime state of experiments/campaigns/pages | docs.developers.optimizely.com/web-experimentation/reference/state |
| `data` | Static project configuration (campaigns, experiments, pages, events, audiences) | docs.developers.optimizely.com/web-experimentation/reference/data |
| `visitor` | Current visitor attributes/data | "Get Started with Optimizely Web Experimentation JavaScript API" |
| `custom` | Custom modules registered via `registerApiModule` | "Get Started with Optimizely Web Experimentation JavaScript API" |

The snippet registers two additional named modules at runtime via `registerApiModule(...)`:

```
registerApiModule("behavior", …)
registerApiModule("recommender", …)
```

so `window.optimizely.get('behavior')` and `window.optimizely.get('recommender')` are also valid (these are domain-specific and orthogonal to reinforcement-layer concerns).

### 3.2 The `state` module — exhaustive method catalog

Extracted from `/tmp/optly-snippet.js` by grepping every `getXxx:function(...){...}` member of the state module factory. The following table shows the full signatures and behaviors:

| Method | Returns | Parameter shape |
|---|---|---|
| `getAccountId()` | account id (string) | — |
| `getActionsForDecision(config)` | actions whose campaign matches `config.campaignId` (array of action objects with their change-sets) | `{campaignId}` |
| `getActionState(actionId)` | the per-action state object (lazy reference; see §3.4) | `actionId` |
| `getActivationId()` | activation-cycle id (changes per activation pass) | — |
| `getActiveExperimentIds()` | array of experiment IDs that are currently active | — |
| `getActiveViewIds()` | array of view (page) IDs currently active | — |
| `getActiveViewStates()` | array of full view-state objects for active views | — |
| `getActiveViewTags()` | flattened metadata object aggregating `metadata` from all active views | — |
| `getCampaignStates(filter)` | map of `campaignId → CampaignState` (see §3.3) | optional `{isActive: true}` |
| `getCampaignStateLists(filter)` | same as above but with arrays per id (used for offer-consistency cases where one campaign id can yield multiple states) | optional `{isActive: true}` |
| `getDecisionObject(config)` | object combining experiment/variation/campaign names+ids truncated for analytics use | `{campaignId, maxLength?, shouldCleanString?}` |
| `getDecisionString(config)` | single string concatenating experiment/variation/campaign info | `{campaignId, maxLength?, shouldCleanString?}` |
| `getExperimentStates(filter)` | map of `experimentId → ExperimentState` (subset of CampaignState with experiment fields hoisted up) | optional `{isActive: true}` |
| `getPageStates(filter)` | map of `pageId → PageState` with `isActive, metadata, id, name, apiName, category, staticConditions, tags` | optional filter fn |
| `getRedirectInfo()` | `{experimentId, variationId, referrer}` if a redirect variation ran on the previous page; otherwise null | — |
| `getVariationMap()` | map of `experimentId → {id, name, index}` for every bucketed experiment | — |

There are additional internal getters (`getLayerState`, `getLayerStates`, `getViewState`, etc.) reachable through nested accesses but not part of the documented public surface.

### 3.3 The `CampaignState` shape

From the body of the internal `f(...)` function that builds each entry in `getCampaignStates()`:

```js
{
  id: layerId,
  campaignName: c.name || null,
  experiment: { id, name, campaignName } | null,
  audiences: Array<{id, name}>,
  allExperiments: Array<{id, name}>,
  variation: { id, name } | null,
  reason: <decision reason string>,
  isActive: boolean,
  visitorRedirected: boolean,
  isInCampaignHoldback: boolean,
  // optional, only present for offer-consistency campaigns:
  pageId?: string
}
```

The `experimentState` returned by `getExperimentStates()` is a derived projection:

```js
{
  id: experimentId,
  experimentName: <name>,
  audiences: Array<{id, name}>,
  variation: { id, name },
  reason: <string>,
  visitorRedirected: boolean,
  isActive: boolean,
  isInExperimentHoldback: boolean   // renamed from isInCampaignHoldback
}
```

### 3.4 The `actionState` map — closest thing to a "what was applied" registry

The snippet maintains an internal map at `state.nn.actionState[actionId]` of per-action state. `getActionState(actionId)` returns a `safeReference(...)` to it. The `actionState` entries contain `changeApplier:` references in state `APPLIED | APPLYING | UNAPPLIED | UNDOING`:

```js
changeApplierState: { APPLIED: null, APPLYING: null, UNAPPLIED: null, UNDOING: null }
```

This map is the in-memory ledger the snippet uses to know what's already applied versus pending. The richness of what's directly inspectable from `getActionState(actionId)` depends on the runtime state — the `safeReference` wrapper returns the live mutable object, so a consumer can in principle introspect each change's state, but this is **not part of the public documented API** and could change between snippet versions.

### 3.5 The `data` module — project configuration

`window.optimizely.get('data')` returns the static project configuration, with top-level keys derived from the user's project. From the official "Getting Started" doc and the snippet's internal getters:

| Top-level key | Shape |
|---|---|
| `campaigns` | map of `campaignId → Campaign` (see `getCampaignsMap`) |
| `experiments` | map of `experimentId → Experiment` (see `getExperimentsMap`); each Experiment has `changes:[]` arrays |
| `pages` | map of `pageId → View` |
| `events` | map of `eventId → Event` (see `getEventsMap`) |
| `audiences` | map of `audienceId → Audience` (see `getAudiencesMap`) |
| `projectId`, `accountId`, `revision`, `clientName`, `clientVersion`, `anonymizeIP` | various scalars |
| `dcpServiceId`, `dcpKeyfieldLocators` | data-platform config |
| `views`, `groups`, `integrationSettings`, `visitorIdLocator` | additional config |

The shape mirrors the `ExperienceConfig` class in the Edge Delivery SDK (`/tmp/edge-delivery-pkg/package/dist/models.d.ts`), which is the same datafile format the snippet consumes — see §5 below.

### 3.6 The `change` object shape in `data`

From the Edge Delivery SDK's `Change` class declaration (which both client-side and edge consume from the same datafile):

```ts
declare class Change {
  id: string | number;
  src?: string | null;
  dest?: string | null;
  name?: string | null;
  type: string | null;          // "custom_code" | "attribute" | "append" | "rearrange" | "redirect" | "widget"
  dependencies: any[];
  css?: {} | null;
  attributes?: {} | null;       // sub-keys: text, class, html, href, src, srcset, style, hide, remove
  selector?: string | null;
  transform: Experimentation.Transform[];
  preserveParameters?: boolean;
  allowAdditionalRedirect?: boolean;
  value?: any;
}
```

So a customer can enumerate all changes for a variation via:

```js
const data = window.optimizely.get('data');
const exp = data.experiments[experimentId];
// exp.variations[i].actions[j].changes  // for variation-level changes
// exp.changes                            // for experiment-level changes (legacy)
```

This is the **change manifest** equivalent of what the Edge Delivery datafile exposes server-side.

### 3.7 What public docs confirm

- `getActivePages` — "describes pages active on the page, indexed by page ID, and includes descriptions for URL-targeted experiments" (search snippet of docs.developers.optimizely.com/performance-edge/reference/getactivepages).
- `getCampaignStates` — "Gets active Experiment IDs and their Variation IDs for both Optimizely experiments and Personalization Campaigns" (docs.developers.optimizely.com/web/edit/state).
- `getActiveExperiments` (edge variant) — Performance Edge version of `getCampaignStates` simplified for SDK-only use (docs.developers.optimizely.com/performance-edge/reference/getactiveexperiments).
- `getRedirectInfo` — "If a redirect variation was executed on the previous page, all the details of that experiment are accessible on the next page through getRedirectInfo()" (docs.developers.optimizely.com/performance-edge/reference/getredirectinfo).

### 3.8 Push commands worth knowing

From the snippet code and public docs:

| Command (push payload) | Effect |
|---|---|
| `{type:"addListener", filter:{…}, handler:fn}` | Register listener; mutates the passed object to add `.token` |
| `{type:"page", pageName:"…", tags?:{…}, isActive?:bool}` | Manually activate or deactivate a page (e.g. for SPA reactivation: push isActive:false then push without isActive to reactivate) — *Implement Optimizely Web Experimentation on dynamic websites*, docs.developers.optimizely.com |
| `{type:"event", eventName:"…", tags?:{…}}` | Track a custom event |
| `["trackEvent", "eventName"]` | Legacy array form of the above |
| `{type:"user", attributes:{…}}` | Update visitor attributes |
| `{type:"holdEvents"}` / `{type:"sendEvents"}` | Pause / resume event dispatch — *Control the timing of Optimizely Web Experimentation Event dispatch*, support.optimizely.com |
| `{type:"activate"}` | Manually activate the snippet (used when auto-activation is disabled) |
| `{type:"bucketVisitor", …}` | Override variation assignment |

### 3.9 Helper utilities exposed

The snippet exposes a `utils` namespace (the customer-facing helper toolkit):

```js
return {
  observeSelector: r,    // wrapper around MutationObserver for a CSS selector
  onUrlChange: o,        // listen for history.pushState / popstate URL changes
  persistHtml: a,        // inject HTML, tag with data-optly-persist-id, manage reapply
  poll: u,               // poll a predicate at intervalMs until true
  Promise: i,
  waitForElement: c,     // promise that resolves when a selector exists in DOM
  waitUntil: s           // promise that resolves when a predicate returns truthy
}
```

These are accessible via `window.optimizely.get('utils')` (per docs.developers.optimizely.com/web-experimentation/docs/dynamic-websites — "The observerSelector utility function acts as a wrapper for the MutationObserver Web API.").

**Important caveat.** Per the helper-functions support article (docs.developers.optimizely.com/web-experimentation/docs/helper-functions): "*The `get` function for accessing utilities is not available before the Optimizely snippet executes or in Project JavaScript. It is available in all other custom code.*"

---

## 4. Dynamic SPA mode

### 4.1 Terminology

Optimizely's official term is **"Support for Dynamic Websites"** (sometimes abbreviated DSW or DSWA in customer materials; the acronym "DSPA" appears informally but is not the official label). The feature toggles whether the snippet treats single-page-application navigation as page-activation triggers.

### 4.2 How it's enabled

From *Dynamic websites and Single-page Applications* (support.optimizely.com/hc/en-us/articles/4410283578893):

> "Go to **Settings > Implementation**. Select **Enable Support for Dynamic Websites**."

This is a **project-level** toggle in the Optimizely dashboard. There is no per-experiment, per-page, or snippet-level override. Once enabled, all pages in the project can use SPA-aware activation triggers.

There is also a backed boolean `dynamicWebsiteSupport?: boolean` on the `ExperienceConfig` datafile object (`/tmp/edge-delivery-pkg/package/dist/models.d.ts` line 32), so the flag flows from project settings → datafile → snippet runtime.

### 4.3 The six page-activation trigger types

From *Activate pages in Optimizely Experimentation and Optimizely Personalization* (support.optimizely.com/hc/en-us/articles/4410283345677) and *Implement Optimizely Web Experimentation on dynamic websites* (docs.developers.optimizely.com/experimentation/v10.0.0-web/docs/dynamic-websites):

| Trigger type | Fires when | Mechanism | Requires DSW? |
|---|---|---|---|
| **Immediately** | Snippet activates (initial page load) | Default behavior — checks targeting at snippet boot | No |
| **URL Change** | URL changes without full reload | "Optimizely uses a runtime patch of the History API to detect when the URL changes and fire the trigger" — *Implement Optimizely Web Experimentation on dynamic websites* | **Yes** |
| **DOM Change** | Any DOM mutation matches | "Optimizely uses a `MutationObserver` to detect when an element is inserted, removed, or modified" — same source | **Yes** |
| **Polling (JavaScript Condition)** | A boolean JS expression evaluates true | "Polls every 50 milliseconds for a JavaScript predicate to return true… stops polling two seconds after DOM is ready" — *Activate pages* | No |
| **Callback** | The customer's JS function calls the supplied `activate(...)` callback | Function-form code: `function(activate, options) { … }` — *Page activation in Optimizely Web Experimentation* | No |
| **Manual** | Customer code calls `window.optimizely.push({type:"page",pageName:"…"})` | API-driven | Recommended (Performance Edge requires DSW even for Manual) |

Activation type strings used internally include `dom_changed` and other lowercase tokens visible in the snippet's strings table (`grep -oE '"dom_changed"' /tmp/optly-snippet.js` returns one match). The activation type also flows from project config to the snippet via the `View.activationType` field on the datafile (per `/tmp/edge-delivery-pkg/package/dist/models.d.ts` line 113).

### 4.4 How DOM-change reapplication works

From *Dynamic websites and single-page applications*:

> "MutationObserver provides hooks into DOM mutations and enables Optimizely Web Experimentation's snippet to know when a DOM node is inserted, destroyed, or modified to apply (or reapply) changes at the right moment."

> "When an experiment or campaign activates, and a visitor is bucketed into the experiment, MutationObserver checks the DOM while the page is active, and applies (and reapplies) changes as appropriate."

There are **two levels** of reapply behavior, documented in the same article:

> "Optimizely Web Experimentation has different levels of support for changes: **Insert HTML and insert image changes**, which are only reapplied when new elements display. **Everything else**, which is reapplied when new elements display and when previously modified elements are mutated."

This means: text/class/attribute/style changes are reapplied on mutation; insert_html changes are reapplied only on new-element insertion (since the inserted elements either still exist or have been removed entirely).

### 4.5 Page deactivation and undo

> "Only one instance of a page can be active at a time. If you'd like to activate a page multiple times in a given context, you'll need to deactivate it before activating it again." — *Implement Optimizely Web Experimentation on dynamic websites*

Manual deactivation/reactivation pattern (the React SSR docs explicitly recommend this):

```js
window.optimizely.push({ type:'page', pageName:'…', isActive:false });
window.optimizely.push({ type:'page', pageName:'…' });
```

**Performance Edge limitation on undo** (from *Support for Dynamic Websites*, docs.developers.optimizely.com/performance-edge/docs/support-for-dynamic-websites):

> "When deactivating pages, Custom JavaScript **cannot be reverted** — only visual changes and CSS modifications can be undone."

### 4.6 Documented failure modes

From the official React SSR doc (*Implement Optimizely with React SSR and hydration*, docs.developers.optimizely.com/web-experimentation/docs/react-server-side-rendering-and-hydration):

> "The interaction between Optimizely's DOM manipulation and React's hydration process can cause technical challenges."

> "React detects discrepancies. It attempts to reconcile the DOM to match its virtual DOM, often overwriting Optimizely's changes. This conflict typically manifests as flickering or flashing and lost or inconsistent changes."

> "React hydration often involves rapid, batched DOM updates. MutationObservers might not capture all subtle changes, leading to missed reapplications."

> "When substantial changes occur, flicker may occur as React hydrates first, and then Optimizely reacts to the subsequent DOM mutations."

From the Performance Edge SPA support page (docs.developers.optimizely.com/performance-edge/docs/support-for-dynamic-websites):

> "Two seconds is often not enough time to capture when an element loads on a single-page application."

(Refers to the 2-second polling cap.)

> "Original content may appear briefly before variation content loads. The documentation includes detailed tables showing when flashing is 'guaranteed' based on trigger and condition combinations."

From the SPA limitations doc (support.optimizely.com/hc/en-us/articles/4410283578893):

> "Optimizely Web Experimentation does not currently support **rearrange tests** (tests that swap the positions of nodes) on dynamic websites."

> "Optimizely Performance Edge does not support custom snippets."

From a third-party customer write-up (Cro Metrics, *CRO with React & Optimizely*, crometrics.com/blog/cro-with-react-optimizely):

> "The framework wipes away DOM changes applied via javascript manipulation… [workaround requires] code that observes React updates and reapplies modifications using `requestAnimationFrame`."

> "React form elements don't let us apply values via javascript [because React maintains its own state separately from the DOM]. Solutions include simulating real inputs with jQuery alternatives or directly editing the React state."

> "Optimizely lacks native SPA support [when stronger than DSW], requiring custom code to detect logical page transitions. The recommended approach patches the React root component to broadcast page-end and page-start events, then signals Optimizely to reactivate experiments."

From a Medium article on SPA checkout flows (Dan Shapiro, medium.com/@dan.shapiro1210/...):

> "The built-in 2-second timeout makes it almost ensures that the polling function will timeout before a visitor reaches that final page" (in multi-step flows).

### 4.7 Relationship between DSW and the `addListener` events

DSW does not introduce new event types. The events emitted are the same `lifecycle.pageActivated` / `lifecycle.pageDeactivated` / `action.applied` / `action.appliedAllForDecision` events documented in §2.3.

When the snippet performs a **reapply** (because MutationObserver detected the modified element was re-rendered), the snippet's behavior is to call the change applier again. Whether this re-emits `action.applied` is not explicitly documented; empirical inspection of the snippet shows `emitActionAppliedEvent` is called from the action's apply pipeline and is not guarded against repeated firing. So in practice listeners should expect `action.applied` to fire multiple times for the same `actionId` over the lifetime of a page if the change is reapplied. This is **not documented publicly** and would need verification at runtime.

There is **no explicit `change.reapplied` event**. The only signal a reinforcement layer has, that "Optimizely just reapplied a change because the DOM was overwritten", is to observe the same `(experimentId, variationId, changes[i])` tuple arrive in a fresh `action.applied` event after a previous one.

### 4.8 Summary for reinforcement layer design

- DSW provides the snippet's own answer to the "framework overwrote my change" problem. Its primary mechanism is MutationObserver-driven reapplication.
- The known reliability gaps are: (a) batched/rapid hydration drops mutations, (b) React's state-controlled form elements resist direct DOM mutation, (c) flashing/flicker during the hydration window, (d) rearrange-type tests are unsupported on SPAs, (e) custom JavaScript cannot be reverted on deactivation.
- For a reinforcement layer, the natural design is to observe `action.applied` events as the ground-truth signal of "Optimizely just applied (or reapplied) these changes", then back the snippet up with our own MutationObserver that knows the change manifest (from `optimizely.get('data')` or from the original Edge Delivery manifest) and forces reapplication on mutations the snippet missed.
- The reinforcement layer should NOT rely on per-change DOM markers from the snippet — those don't exist client-side. It must derive identity from `(experimentId, variationId, selector, change.type, attributes/value)` tuples.

---

## 5. Visual change types supported client-side

### 5.1 The two-layer change-type vocabulary

There are two enums to know:

**(a) `changeType` enum — the top-level action/change category**, from both the snippet and the Edge SDK:

```js
changeType: {
  CUSTOM_CODE: "custom_code",
  ATTRIBUTE:   "attribute",
  APPEND:      "append",
  REARRANGE:   "rearrange",
  REDIRECT:    "redirect",
  WIDGET:      "widget"
}
```

Source (snippet): `/tmp/optly-snippet.js` module 741. Source (edge SDK): same enum literal in `/tmp/edge-delivery-pkg/package/dist/index.js`.

**(b) `selectorChangeType` enum — sub-types under the `attribute` change-type**, identical in snippet and edge SDK:

```js
selectorChangeType: {
  CLASS:  "class",
  HTML:   "html",
  HREF:   "href",
  SRC:    "src",
  SRCSET: "srcset",
  STYLE:  "style",
  TEXT:   "text",
  HIDE:   "hide",
  REMOVE: "remove"
}
```

So when the Visual Editor surfaces a "text change" or a "class change" or a "remove element" change, the resulting Change object has `change.type === "attribute"` and the actual sub-operation is keyed under `change.attributes`. For example a text-edit on a heading produces:

```json
{
  "type": "attribute",
  "selector": "h1#hero-title",
  "attributes": { "text": "New headline copy" },
  "value": null
}
```

A "remove element" change:

```json
{ "type": "attribute", "selector": "#banner", "attributes": { "remove": true } }
```

A class-list change:

```json
{ "type": "attribute", "selector": ".cta", "attributes": { "class": "btn btn-large btn-primary" } }
```

An HTML replacement (innerHTML edit):

```json
{ "type": "attribute", "selector": "main", "attributes": { "html": "<…new innerHTML…>" } }
```

A `href` change:

```json
{ "type": "attribute", "selector": "a.cta", "attributes": { "href": "/new-target" } }
```

### 5.2 Full change-type matrix

| Top-level `change.type` | Sub-key on `change.attributes` | Operation | Reapply support (per docs) |
|---|---|---|---|
| `attribute` | `text` | Set element's text content | Reapplied on mutation |
| `attribute` | `html` | Set element's innerHTML (or replace outerHTML in some forms) | Reapplied on mutation |
| `attribute` | `class` | Set the class list | Reapplied on mutation |
| `attribute` | `href` | Set the href attribute (links) | Reapplied on mutation |
| `attribute` | `src` | Set the src attribute (img, video, audio, iframe) | Reapplied on mutation |
| `attribute` | `srcset` | Set the srcset attribute (img with responsive sources) | Reapplied on mutation |
| `attribute` | `style` | Set inline style | Reapplied on mutation |
| `attribute` | `hide` | Hide via display:none | Reapplied on mutation |
| `attribute` | `remove` | Remove element from DOM | Reapplied on new-element insertion of a matching selector |
| `append` | `value` (HTML string) | Insert new HTML at a position relative to selector (uses `persistHtml` internally, see §1.1) | "Reapplied only when new elements display" — *Dynamic websites and single-page applications* |
| `custom_code` | `value` (JS function or code string) | Run arbitrary JavaScript | **CANNOT be reverted** on Performance Edge (*Support for Dynamic Websites*); on Web Experimentation, customer responsibility |
| `rearrange` | `src`, `dest` (selectors) | Move element from `src` selector to `dest` selector | **NOT supported on dynamic websites** at all — "Optimizely Web Experimentation does not currently support rearrange tests… on dynamic websites" (*Dynamic websites and single-page applications*) |
| `redirect` | `dest`, `preserveParameters`, `allowAdditionalRedirect` | Redirect the browser to a different URL | Once-only; redirect info available on next page via `getRedirectInfo()` |
| `widget` | various | Insert an Optimizely-managed widget (banners, modals, etc. from the Optimizely template library) | Implementation-defined per widget |

Note: in the `Change` object shape (`models.d.ts`), `selector` is the operation target; `src`/`dest` are used for `rearrange` and `redirect`; `css` is used for older custom-CSS changes that aren't sub-keyed under `attributes`; `value` is the catch-all for `append`-style changes.

### 5.3 Edge Delivery vs client-side: support delta

The Edge Delivery SDK supports the same `changeType` enum as the client-side snippet (verified by greps against both `/tmp/optly-snippet.js` and `/tmp/edge-delivery-pkg/package/dist/index.js`). However, edge delivery is a strict subset of operational support:

| Change type | Client-side snippet | Edge Delivery | Notes |
|---|---|---|---|
| `attribute` with `text`/`class`/`html`/`href`/`src`/`srcset`/`style`/`hide`/`remove` | yes | yes (via HTMLRewriter; subject to CSS selector limitations) | Edge runtimes (Cloudflare HTMLRewriter and Akamai EdgeWorkers) have limited CSS selector support — see `/tmp/edge-delivery-pkg/package/dist/utils/selector.d.ts`: "Cloudflare: Does not support sibling combinators (~, +), pseudo-elements, and selected pseudo-classes; Akamai: Does not support sibling combinators (~, +) or any pseudo-classes/pseudo-elements" |
| `append` (insert HTML) | yes | yes | Edge SDK uses HTMLRewriter to insert content |
| `custom_code` | yes | **Limited** | Edge cannot execute arbitrary client-side JS at the CDN; custom-code changes typically pass through unmodified to be applied by the follow-on client-side snippet, OR they are excluded from the edge variation set |
| `rearrange` | yes (but not on DSW) | Less straightforward | Edge can rearrange HTML when the DOM is well-formed |
| `redirect` | yes | yes | Edge can issue 302/307 directly at request time |
| `widget` | yes | Implementation-defined | Optimizely widgets are JS-driven so edge-side widget changes typically reduce to passing widget descriptors through to the client snippet |

### 5.4 Differences from previous research's documented vocabulary

Previous research notes the following types: `append`, `prepend`, `attribute`, `class`, `text`, `remove`, `customCSS`, `customCode`, `href`, `src`, `srcset`, `redirect`.

Reconciliation:

- `append` and `prepend` are both real — `prepend` is the inverse-position form of an `append` change. (Edge SDK has `DOMInsertionType: { AFTER: "after", APPEND: "append", BEFORE: "before", PREPEND: "prepend" }`.)
- `class`, `text`, `remove`, `href`, `src`, `srcset` are all sub-keys under `attribute`, not top-level change types. Both layers are valid to reference depending on context (the Visual Editor's "Change List" exposes them as separate user-facing operations).
- `customCSS` is not a top-level type in the enum — it's an `attribute` change with a `style` sub-key (or stored in the older `change.css` field).
- `customCode` corresponds to the top-level `custom_code` type.
- `redirect` is a top-level type.
- The previous research did not include `widget` (a top-level type) or `rearrange` (a top-level type). Both are real.

### 5.5 What's NOT supported and where

- **Rearrange on dynamic websites**: explicitly unsupported (*Dynamic websites and single-page applications*).
- **Custom code revert on Performance Edge**: explicitly unsupported.
- **Custom snippets on Performance Edge**: explicitly unsupported.
- **Polling beyond 2 seconds**: not supported by built-in polling trigger (use callback or DOM-change instead).
- **More than one active instance of the same page**: not supported — must deactivate before reactivating.

---

## 6. Gaps and unknowns

Items the public documentation does not authoritatively cover, AND the snippet code does not unambiguously settle, AND therefore would require either (a) reaching out to Optimizely engineering, (b) further runtime experimentation, or (c) careful reverse-engineering of a live page:

1. **Whether `action.applied` re-fires on MutationObserver-driven reapply.** The emit call is not idempotent in the snippet but its dispatch context is gated by `actionState[actionId]` which transitions through `APPLYING → APPLIED`. Whether the snippet bumps the state back to `APPLYING` (and thus re-emits) on a reapply, or whether it just re-runs the applier silently, was not determinable from static reading. **Needs runtime verification.**

2. **Whether the snippet exposes a stable token for re-identifying a previously-applied change across reapplies.** The `applied` event projects `{type, selector, attributes, value}` per change but strips the change id. The change id is preserved internally (`dereferenceChangeId` is called before the projection), so it's plausible Optimizely engineering could add a `changeId` field to the projection in future, but as of the audited snippet build, the public payload does not include it. **A reinforcement layer must compute its own change-identity from the projected fields plus `experimentId+variationId`.**

3. **Whether `data-optly-<changeId>` markers (active on Edge Delivery) ever appear on the client-side DOM when a page is served via Edge Delivery and then re-rendered.** Hypothetically the edge-injected markers persist into the live DOM until React/Vue hydration overwrites them. If they survive, a client-side reinforcement layer could read them as a primary signal during the hydration → reapply window. This is **not documented**; it depends on whether the framework's hydration preserves unknown attributes. **Empirical test needed** for each customer framework version.

4. **The `actionState[actionId]` map's stability across snippet versions.** It is accessible via `getActionState(actionId)` but Optimizely classifies it as internal. A reinforcement layer that reads `actionState` for live "currently APPLIED vs UNAPPLIED" introspection accepts vendor-API drift risk.

5. **The exact contents of `event.data` for `viewActivated`, `pageActivated`, and `layerDecided`.** The snippet emits these with `data: <internal object>` where the internal object is built from datafile + runtime state. The shape mirrors `View` (for view events) and `LayerState`/`Decision` (for layerDecided), but the public docs do not enumerate the fields. The fields used internally are visible in the snippet (`getViewState` returns `{id, name, apiName, category, staticConditions, tags, isActive, metadata}`; `layerState.decision` has `experimentId, variationId, isLayerHoldback, reason, apiName, viewId`), and these are likely what the listener sees, but the **public contract is not pinned**.

6. **Whether `addListener` returns a token directly.** The snippet's `addListener` does not `return n.token` explicitly; instead `m.on(n)` mutates the input object to add `n.token`. Callers must read it from their original registration object after the call. The docs imply token is returned, but the actual return value is `undefined`. **Minor — confirmable via console testing.**

7. **The complete catalog of `change.attributes` sub-keys.** `selectorChangeType` lists `class, html, href, src, srcset, style, text, hide, remove`. The Visual Editor may expose additional sub-keys in some product configurations (e.g. `value` for form inputs, `placeholder`, `aria-*` etc.) that map to a generic attribute-set path. **Not exhaustively documented publicly.**

8. **Whether the snippet emits any event when a change cannot be applied** (e.g. selector matches nothing, or `waitForElement` times out). Internal log lines per *Read the Optimizely Experimentation log* include `"Failed to apply change"` and `"Failed to activate view"` but it is unclear whether these surface as `error`-typed `addListener` events. The snippet has `emitError(...)` but its public exposure was not pinned during this research. **Worth subscribing to `{type:'error'}` filter in a live test.**

9. **Order between `applied` and `appliedAllForDecision` when multiple actions span asynchronous element-wait timing.** Source order suggests `applied` per action, then `appliedAllForDecision` after all; but if one action waits on `waitForElement` while another's elements are immediately present, the `appliedAllForDecision` might fire on a partial subset. **Needs runtime verification with a deliberately-deferred selector.**

10. **The snippet's behavior with respect to the `dynamicWebsiteSupport` flag.** The flag flows from project config to the snippet, but the code path differences when it is `false` (no DSW) vs `true` (DSW) are not fully traced. Specifically: with DSW off, does the snippet still emit `pageDeactivated`? Does it install MutationObservers at all? **Worth tracing.**

11. **Whether `optimizely.get('utils').observeSelector` is a stable, documented public surface.** It is exported from the utils namespace and documented in the *Dynamic websites* doc, but the function signature is not specified in any reference page that WebFetch could reach.

12. **What "applied" means for `redirect`-type actions.** A redirect doesn't really "apply" in a DOM sense — it navigates. Whether `action.applied` fires for redirect actions before the navigation occurs, with what payload, is not documented. The snippet's behavior is likely "emit, then redirect" but timing relative to event-queue flush during navigation is racy. **Empirical test needed.**

---

## Sources

### Optimizely developer docs (docs.developers.optimizely.com)
- Add a listener — `/web-experimentation/reference/add-listener`
- Get — `/web-experimentation/reference/get`
- State — `/web-experimentation/reference/state` (and `/performance-edge/reference/state`)
- Get state — `/web/edit/state`, `/web/docs/state`
- Get data — `/web-experimentation/reference/data`
- Get Started — `/web-experimentation/docs/getting-started`, `/web/docs/getting-started`
- Implement Optimizely Web Experimentation on dynamic websites — `/experimentation/v10.0.0-web/docs/dynamic-websites`, `/web-experimentation/docs/dynamic-websites`
- Support for Dynamic Websites — `/performance-edge/docs/support-for-dynamic-websites`
- Implement Optimizely with React SSR and hydration — `/web-experimentation/docs/react-server-side-rendering-and-hydration`
- JavaScript execution timing in Optimizely Web Experimentation — `/web-experimentation/docs/javascript-execution`
- Page activation in Optimizely Web Experimentation — `/web-experimentation/docs/page-activation`, `/web/docs/page-activation`
- Control experiment activation with markers in React — `/web-experimentation/docs/use-markers-for-controlled-activation`
- Advanced experiment configuration — `/web-experimentation/docs/advanced-experiment-configuration`, `/web/docs/advanced-experiment-configuration`
- Helper functions in Optimizely Web Experimentation — `/web-experimentation/docs/helper-functions`
- getCampaignStates / getActiveExperiments / getRedirectInfo / getActivePages — `/performance-edge/reference/{getcampaignstates,getactiveexperiments,getredirectinfo,getactivepages}`
- Add Listener (Performance Edge) — `/performance-edge/reference/add-listeners`
- Custom code in an experiment — `/performance-edge/docs/custom-code`
- Frequently asked questions — `/performance-edge/docs/faq`

### Optimizely support knowledge base (support.optimizely.com)
- Dynamic websites and single-page applications — `/hc/en-us/articles/4410283578893`
- Activate pages in Optimizely Experimentation and Optimizely Personalization — `/hc/en-us/articles/4410283345677`
- Snippet order of activation — `/hc/en-us/articles/4410289779853`
- Read the Optimizely Experimentation log — `/hc/en-us/articles/4410289485709`
- Control the timing of Optimizely Web Experimentation Event dispatch — `/hc/en-us/articles/4410289767309`
- Custom events — `/hc/en-us/articles/4410288960909`
- Get started with Optimizely Web Experimentation — `/hc/en-us/articles/4410288109197`
- Optimizely Web Experimentation JavaScript snippet — `/hc/en-us/articles/4410284311565`

### Ground-truth code
- `/tmp/optly-snippet.js` — live snippet from `https://cdn.optimizely.com/js/5953372780494848.js`, minified, 306 KB (cached 2026-05-14)
- `/tmp/edge-delivery-pkg/package/dist/models.d.ts` — Edge Delivery TypeScript declarations
- `/tmp/edge-delivery-pkg/package/dist/index.js` — Edge Delivery compiled JS (constants enum, change applier dispatch logic)
- `/tmp/edge-delivery-pkg/package/dist/utils/selector.d.ts` — CSS selector support constraints per edge runtime

### Third-party customer write-ups
- Cro Metrics, *CRO with React & Optimizely* — `crometrics.com/blog/cro-with-react-optimizely/`
- Dan Shapiro, *Using Optimizely's Conditional Activation with a SPA Checkout Flow* — `medium.com/@dan.shapiro1210/using-optimizelys-conditional-activation-with-a-spa-checkout-flow-4bb1118b9c80`
- BrillMark, *How to Run A/B Tests on Dynamic Pages or SPAs on Optimizely and Google Optimize* — `brillmark.com/how-to-run-a-b-tests-on-dynamic-pages-or-single-page-applications-spas-on-optimizely-and-google-optimize/`
- Optipilot.com mirror of Adobe Analytics integration guide — `optipilot.com/web-experimentation/integrations/adobe-analytics`

### Optimizely GitHub
- `github.com/optimizely/snippet-inspector` (archived 2023) — tool that introspects what a snippet contains; confirms snippet introspection is a recognized pattern
- `github.com/optimizely/library` — extensions, integrations, project-JS templates
- `github.com/optimizely/snippet-config` — illustrative use of Full Stack to configure a Web snippet
