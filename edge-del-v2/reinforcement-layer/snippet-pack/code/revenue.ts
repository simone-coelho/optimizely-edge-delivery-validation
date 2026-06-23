// SuiteCommerce Advanced — revenue tracking helper.
//
// Reads the order total from LiveOrder.Model (or a dataLayer fallback)
// on the Thank-You page and pushes a single dedup'd revenue event to
// Optimizely's Web Experimentation snippet.
//
// Contract: read-only on the order data, fires late (after the snippet
// is initialized), idempotent across page refresh (sessionStorage
// dedup keyed by order ID), no PII in the event payload.
//
// See ../5-revenue-tracking.md for the full speaking-points list and
// integration discussion.

interface TrackRevenueOptions {
  // URL pattern that identifies the confirmation / Thank-You page.
  // Default catches /checkout/confirmation and /checkout/thankyou.
  thankYouUrlPattern?: RegExp;

  // Optimizely event API name. Must match the event configured in
  // the Optimizely project ("Events" tab → revenue event apiName).
  eventKey?: string;

  // Source preference. 'auto' tries LiveOrder.Model first, then
  // dataLayer, then URL params. Force one specific source if you
  // know the customer's build only exposes one.
  source?: 'auto' | 'live-order-model' | 'data-layer';

  // Currency string included in tags for audit. Does not affect the
  // numeric revenue value (Optimizely stores revenue in cents).
  currency?: string;

  // How long to wait for window.optimizely.initialized before giving
  // up. Default 5000 ms.
  waitForSnippetMs?: number;
}

declare global {
  interface Window {
    optimizely?: {
      initialized?: boolean;
      push?: (cmd: any) => void;
    };
    LiveOrder?: any;
    dataLayer?: any[];
    __EDGE_DEL_V2__?: {
      events: Array<{ at: number; kind: string; detail?: unknown }>;
    };
  }
}

function pulse(kind: string, detail?: unknown): void {
  const bus = (window as any).__EDGE_DEL_V2__;
  if (bus?.events) {
    bus.events.push({ at: performance.now(), kind, detail });
  }
}

// Wait briefly for Optimizely's snippet to initialize. Returns true
// when ready, false on timeout.
function waitForSnippet(timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    if ((window as any).optimizely?.initialized) { resolve(true); return; }
    const start = performance.now();
    const iv = setInterval(() => {
      if ((window as any).optimizely?.initialized) {
        clearInterval(iv); resolve(true); return;
      }
      if (performance.now() - start > timeoutMs) {
        clearInterval(iv); resolve(false);
      }
    }, 50);
  });
}

// Read the order ID from the most reliable source available.
function readOrderId(source: string): string | null {
  if (source === 'live-order-model' || source === 'auto') {
    try {
      const lo = (window as any).LiveOrder;
      const id = lo?.Model?.get?.('confirmation')?.orderId
              ?? lo?.Model?.get?.('orderId')
              ?? lo?.Model?.get?.('internalid');
      if (id) return String(id);
    } catch { /* fall through */ }
  }
  if (source === 'data-layer' || source === 'auto') {
    try {
      const dl = (window as any).dataLayer || [];
      for (let i = dl.length - 1; i >= 0; i--) {
        const event = dl[i];
        const id = event?.purchase?.transaction_id
                ?? event?.ecommerce?.transaction_id
                ?? event?.transaction_id;
        if (id) return String(id);
      }
    } catch { /* fall through */ }
  }
  // Last resort: query parameter on the confirmation URL.
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('orderid') || params.get('order_id') || params.get('confirmation');
    if (id) return id;
  } catch { /* fall through */ }
  return null;
}

// Read the order total. Returns integer cents, or null if unavailable.
function readOrderTotalCents(source: string): number | null {
  if (source === 'live-order-model' || source === 'auto') {
    try {
      const lo = (window as any).LiveOrder;
      const total = lo?.Model?.get?.('summary')?.total
                 ?? lo?.Model?.get?.('total')
                 ?? lo?.Model?.get?.('grandtotal');
      const n = parseFloat(String(total).replace(/[^0-9.\-]/g, ''));
      if (isFinite(n) && n > 0) return Math.round(n * 100);
    } catch { /* fall through */ }
  }
  if (source === 'data-layer' || source === 'auto') {
    try {
      const dl = (window as any).dataLayer || [];
      for (let i = dl.length - 1; i >= 0; i--) {
        const event = dl[i];
        const total = event?.purchase?.value
                   ?? event?.ecommerce?.value
                   ?? event?.transaction_total;
        const n = parseFloat(String(total).replace(/[^0-9.\-]/g, ''));
        if (isFinite(n) && n > 0) return Math.round(n * 100);
      }
    } catch { /* fall through */ }
  }
  return null;
}

export async function trackRevenue(opts: TrackRevenueOptions = {}): Promise<void> {
  const thankYouPattern = opts.thankYouUrlPattern
    || /\/checkout\/(confirmation|thankyou|thank-you)(\/|$|\?)/i;
  const eventKey = opts.eventKey || 'revenue';
  const source   = opts.source   || 'auto';
  const currency = opts.currency || 'USD';
  const waitMs   = typeof opts.waitForSnippetMs === 'number' ? opts.waitForSnippetMs : 5000;

  // 1. Confirm we're on the Thank-You page.
  if (!thankYouPattern.test(window.location.pathname + window.location.search)) {
    pulse('revenue:skip-non-confirmation');
    return;
  }

  // 2. Wait for the snippet.
  const ready = await waitForSnippet(waitMs);
  if (!ready) {
    pulse('revenue:skip-snippet-not-initialized');
    return;
  }

  // 3. Read the order ID.
  const orderId = readOrderId(source);
  if (!orderId) {
    pulse('revenue:skip-no-order-id');
    return;
  }

  // 4. Dedup.
  const dedupKey = `optly:revenue:${orderId}`;
  try {
    if (sessionStorage.getItem(dedupKey)) {
      pulse('revenue:skip-already-pushed', { orderId });
      return;
    }
  } catch { /* sessionStorage blocked — fall through, will push */ }

  // 5. Read the total.
  const revenueCents = readOrderTotalCents(source);
  if (revenueCents === null || revenueCents <= 0) {
    pulse('revenue:skip-no-total', { orderId });
    return;
  }

  // 6. Push.
  try {
    (window as any).optimizely.push({
      type: 'event',
      eventName: eventKey,
      tags: {
        revenue:  revenueCents,
        orderId:  orderId,
        currency: currency
      }
    });
  } catch (err) {
    pulse('revenue:push-failed', { orderId, error: String(err) });
    return;
  }

  // 7. Stamp dedup.
  try { sessionStorage.setItem(dedupKey, '1'); } catch { /* ignore */ }

  pulse('revenue:pushed', { orderId, revenueCents });
}
