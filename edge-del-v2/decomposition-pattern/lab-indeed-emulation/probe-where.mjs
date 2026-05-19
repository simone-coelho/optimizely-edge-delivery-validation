// Where in the DOM did the variation roots actually land?
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto(`https://edge-del-v2-target.pages.dev/hire/cs/pricing?t=${Date.now()}`, { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

const state = await p.evaluate(() => {
  const ancestor = (el) => {
    const path = [];
    let cur = el;
    while (cur && cur !== document.documentElement) {
      const tag = cur.tagName?.toLowerCase() || '?';
      const id = cur.id ? `#${cur.id}` : '';
      const cls = (cur.className && typeof cur.className === 'string') ? `.${cur.className.split(' ').filter(Boolean).slice(0,2).join('.')}` : '';
      path.unshift(tag + id + cls);
      cur = cur.parentElement;
    }
    return path.join(' > ');
  };
  const opt1445 = document.getElementById('opt-1445');
  const opt1399 = document.querySelector('.opt-moo-1399');
  const allOptlyMarked = Array.from(document.querySelectorAll('*')).filter(el =>
    Array.from(el.attributes).some(a => a.name.startsWith('data-optly-')));
  const edgeApplied = Array.from(document.querySelectorAll('[data-edge-applied]'));
  return {
    opt1445Path: opt1445 ? ancestor(opt1445) : null,
    opt1399Path: opt1399 ? ancestor(opt1399) : null,
    optlyMarkedCount: allOptlyMarked.length,
    optlyMarkedPaths: allOptlyMarked.slice(0, 5).map(ancestor),
    edgeAppliedCount: edgeApplied.length,
    edgeAppliedSample: edgeApplied.slice(0, 5).map(el => ({
      mark: el.getAttribute('data-edge-applied'),
      tag: el.tagName,
      id: el.id || null,
      class: el.className?.toString().slice(0, 50) || null,
      path: ancestor(el)
    })),
    bodyChildren: Array.from(document.body.children).slice(0, 5).map(c => ({
      tag: c.tagName, id: c.id || null, class: c.className?.toString().slice(0, 50) || null
    }))
  };
});
console.log(JSON.stringify(state, null, 2));
await b.close();
