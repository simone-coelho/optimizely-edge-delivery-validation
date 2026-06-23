# AE FAQ — answering customer questions about Edge Delivery + hydration

Crib sheet for Optimizely Account Executives selling Edge Delivery to
customers running hydrating SSR frameworks (React 18 / Next.js,
Vue 3.5 / Nuxt 3, Svelte, etc.).

Each question is followed by the line the AE can say in conversation,
plus an *internal note* the AE should know but probably shouldn't
volunteer unless pressed.

Companion reference for the technical answers: `AGENTS.md` in this
folder.

---

## Analytics

### Q: How do we validate analytics consistency between edge and client-side execution?

Edge and client-side execution share bucketing state through the same
Optimizely cookies (`OPTY$$…$$VMAP`). The visitor is bucketed once.
Whichever side fires the decision first, the other side sees the
cookie and doesn't double-count. Validation is empirical: run the
experiment, confirm unique-visitor count matches decision-event count
in the Results API.

> **AE-internal:** if pressed on "how do we prove it", we can produce
> a back-to-back trace showing the cookie set on the edge response
> and read on the client-side request, with one decision event
> emitted per visitor.

---

## Engineering — hydration

### Q: Does Edge Delivery interfere with hydration?

On hydrating frameworks (React 18, Vue 3.5, Next.js, Nuxt 3), the edge
applies the variation server-side and the framework's hydration step
has to accept it. We ship a small companion script — inlined in the
SSR response, no extra HTTP request, under 2 KB gzipped — that
re-applies the variation after hydration completes. End user sees the
variation at first paint and it stays.

> **AE-internal:** without the companion, hydrating frameworks can
> silently undo edge variations. The companion is the answer to every
> hydration question. It's deployed today in the validation lab;
> productisation roadmap exists. Don't promise a GA date without
> talking to product first.

### Q: If edge rewrites HTML, are React hydration mismatches possible?

Yes, briefly. React 18 logs a console warning in dev and falls back
to client-side rendering for the mismatched subtree in production.
Our companion intercepts after hydration completes and re-applies the
variation. The end user never sees the disappearance.

### Q: How does Optimizely guarantee hydration consistency?

The companion replays the variation after the framework's
"mount complete" signal (`app:mounted` in Nuxt, post-`useEffect` in
React, etc.). The companion stamps idempotency markers on every
element it touches so it never double-applies.

### Q: What happens if server HTML differs from client React tree?

React 18 in production discards the server subtree and re-renders
from the client tree. The companion catches that and replays the
variation on the freshly rendered tree. Net result: variation
present.

### Q: Are React checksum mismatches possible?

React 16 used checksums; React 17+ uses node-by-node reconciliation.
Either way, mismatches log warnings but don't break the page. The
companion is the user-facing fix.

### Q: How are client-side React state transitions handled?

Re-renders that touch variation content get replayed when the
companion's idempotency check runs on the next navigation or hook.
The companion stays subscribed for the session.

---

## Engineering — SPA navigation

### Q: In SPA navigation, subsequent route changes may not hit the edge.

Correct. They don't — the client-side router handles them in the
browser. Our companion hooks the browser's History API (`pushState`,
`replaceState`, `popstate`) and replays the variation on every route
change. Same coverage whether it's Next.js App Router, Pages Router,
Nuxt Router, or React Router.

### Q: Does experimentation persist across client-side routing?

Yes. The companion is subscribed to navigation events for the entire
session. Variation persists.

### Q: Must client-side Optimizely Web still run after hydration?

No. The companion replaces what the legacy snippet's MutationObserver
did. Customers pick one model — edge + companion — without needing to
run both.

### Q: How are App Router transitions handled?

Same as any other router. `next/navigation` triggers
`history.pushState` internally; our companion is hooked at that
level. No App Router-specific code needed.

---

## Privacy / data

### Q: What customer/user data passes through Optimizely infrastructure?

At the edge worker (which runs in the customer's own Cloudflare
account, not ours): the request cookies for bucketing, the request
URL for targeting. Outbound from the worker, the only thing that goes
to Optimizely is a fetch to `cdn.optimizely.com` for the project
manifest plus the standard decision-event ping (visitor ID,
experiment ID, variation ID). No HTML body, no customer cookies, no
PII leaves the customer's edge.

### Q: Is PII processed at the edge?

Not by Optimizely's code. The edge reads the visitor's Optimizely
cookies (anonymous IDs we set) for bucketing. If the customer's
audiences reference customer-defined cookies/headers, those are read
in memory for the decision and discarded.

### Q: Is HTML logged?

No. HTML streams through the worker, gets modified in flight, and
goes to the visitor. It's never buffered to any log on Optimizely's
side.

### Q: Are cookies inspected/stored?

Inspected: yes, for bucketing — same as the legacy snippet. Stored:
only Optimizely's own visitor/profile/VMAP cookies, set on the
customer's domain. Customer cookies are read, never stored on
Optimizely infrastructure.

---

## Reliability

### Q: What happens during outages?

The worker is wrapped in a `try/catch` around `applyExperiments()`.
On error or timeout, it falls open — returns the unmodified SSR
response from origin. Visitor sees the page without the experiment.
Page itself works.

### Q: If Optimizely edge fails: origin fail open or fail closed?

Fail open by default. Customers can flip to fail closed if their
security model requires it, but fail open is the recommendation —
don't let an experimentation outage break the customer's site.

### Q: Can traffic bypass experimentation?

Three ways: audience/URL targeting that excludes the visitor;
holdback that exposes a baseline cohort; a worker-side kill-switch
(typically a query-string or env flag the customer wires to their
feature-flag system).

### Q: Is there a graceful degradation mode?

Yes. On SDK error the worker falls open and stamps a diagnostic
response header so the customer's ops/SRE team sees the failure in
observability without users seeing anything. Headers like
`x-optly-edge: sdk-error=…` are documented for monitoring.

---

## PoC questions — these are OURS to ask THEM

These four belong on a discovery call as questions for the customer,
not the other way around. Suggested framing the AE can use:

### Q: What will make a successful PoC?

Ask them to define one or two metrics. Concrete examples to seed:

- "Variation is in the SSR response — verifiable via View Source on
  critical pages."
- "No hydration warnings in production for variation-eligible pages."
- "Decision-event volume matches unique-visitor volume within ±2%
  over the PoC window."
- "Page-render budget held — Core Web Vitals within X% of control."

### Q: How are you scoring?

What tools? Lighthouse / Core Web Vitals for performance, synthetic
monitoring (Datadog Synthetics, Checkly) for variation presence,
Results API for bucketing fidelity, RUM for end-user experience.

### Q: Who determines success?

Two sign-offs needed: their experimentation lead (validates
experiments work as authored) and their engineering lead (validates
the deploy doesn't regress page health). Get both names on the
kickoff.

### Q: How long will the PoC run?

Recommend 2–4 weeks. Enough for one full experiment cycle (launch →
meaningful traffic → results check), short enough to keep urgency. If
they want longer than 6 weeks, that's a scope problem — push back.

---

## Where to go next

| Audience | Document |
|---|---|
| AE wanting deeper technical context before a call | `AGENTS.md` (this folder) |
| Customer's engineering team | `training-pack/2-engineering-handbook.md` |
| Customer's business/eng leadership | `training-pack/1-customer-summary.md` |
| Solutions Architect running the engagement | `training-pack/3-solutions-architect-playbook.md` |
| Anyone — diagrams + how it works | `training-pack/0-how-it-works.md` |

Live demo: <https://edge-del-v2-target.pages.dev/> — toggle between
control, edge variation only, and edge + companion via query string.
Useful screen-share artifact during a sales call.
