# Edge Delivery + Hydration Reinforcement — Training Pack

Five documents and one folder of drop-in source. Start with
`0-how-it-works.md`, then jump to the doc for your role.

```
0-how-it-works.md                ← READ THIS FIRST. Architecture
                                   diagram, edge-side step-by-step,
                                   client-side step-by-step, data
                                   contract between them, what
                                   changes vs the snippet-only setup.
                                   ≈ 5 minutes. Everyone reads this.

1-customer-summary.md            ← if you are the customer
                                   (eng leader, product owner,
                                    experimentation lead)
                                   What this is, what your team has
                                   to do, what you get back.
                                   ≈ 1 page.

2-engineering-handbook.md        ← if you are on the customer's
                                   engineering team
                                   What to install and where.
                                   Five parts: edge worker, browser
                                   client, verification, adding a
                                   framework adapter, bundle/perf.
                                   ≈ 3 pages.

3-solutions-architect-playbook.md ← if you are the Optimizely
                                   Solutions Architect running this
                                   engagement
                                   The end-to-end coordination
                                   playbook: discovery questions,
                                   the exact code to give engineering,
                                   validation steps, common pitfalls.
                                   ≈ 4 pages.

4-deployment-routing.md          ← OPERATIONAL. Read after install.
                                   How to filter out asset / non-HTML
                                   requests so the worker only runs
                                   where it can deliver value.
                                   Three-layer model (_routes.json,
                                   shouldProcess() helper, content-
                                   type check). Verification + cost
                                   framing.
                                   ≈ 3 pages.
```

All three docs reference one shared folder of drop-in source files:

```
code/                            ← the entire reinforcement layer.
                                   Six files, no npm package.
                                   Copy this folder verbatim into
                                   the customer's repo.
                                   See code/README.md for the
                                   file-by-file walkthrough.
```

The longer reference (`reinforcement-layer/CUSTOMER-GUIDE.md`) is the
1,300-line deep-dive. Read it only if the training-pack docs leave you
with a specific unanswered question.

The runnable lab that everything below describes is in this same
repository under `edge-del-v2/`. Live URL:
<https://edge-del-v2-target.pages.dev/>.
