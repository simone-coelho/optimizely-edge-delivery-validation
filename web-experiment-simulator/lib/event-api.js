/**
 * Optimizely Event API payload builder + sender.
 *
 * Endpoint (POST, NO auth token required — this is the same public ingestion
 * endpoint the browser snippet itself hits):
 *   US:  https://logx.optimizely.com/v1/events
 *   EU:  https://eu.logx.optimizely.com/v1/events
 *
 * Verified against Optimizely's docs + python-sdk (event_factory.py / payload.py):
 *   - impression/decision event key = "campaign_activated", entity_id = layer/campaign id
 *   - conversion event key = the event's api_name, entity_id = the event id
 *   - enrich_decisions:true enables decision attribution + Enriched Events export
 *   - timestamps are Unix epoch milliseconds
 *   - one JSON object must be <= 3.5 MB
 */
'use strict';

const ENDPOINTS = {
  US: 'https://logx.optimizely.com/v1/events',
  EU: 'https://eu.logx.optimizely.com/v1/events',
};

function endpointFor(region) {
  return ENDPOINTS[(region || 'US').toUpperCase()] || ENDPOINTS.US;
}

// One snapshot carrying the bucketing decision + the campaign_activated impression.
function activationSnapshot(m, variationId, ts, id) {
  return {
    decisions: [{
      campaign_id: String(m.campaign_id),
      experiment_id: String(m.experiment_id),
      variation_id: String(variationId),
    }],
    events: [{
      entity_id: String(m.campaign_id),
      key: 'campaign_activated',
      type: 'campaign_activated',
      timestamp: ts,
      uuid: id,
    }],
  };
}

// One snapshot carrying a single conversion event.
function conversionSnapshot(metric, ts, id, revenueCents) {
  const ev = {
    entity_id: String(metric.entity_id),
    key: metric.key,
    timestamp: ts,
    uuid: id,
  };
  if (revenueCents != null) ev.revenue = Math.round(revenueCents); // integer cents
  if (metric.tags) ev.tags = metric.tags;
  return { events: [ev] };
}

function buildVisitor(visitorId, snapshots, attributes) {
  return {
    visitor_id: String(visitorId),
    attributes: attributes || [],
    snapshots: snapshots,
  };
}

function buildBatch(m, visitors) {
  const batch = {
    account_id: String(m.account_id),
    anonymize_ip: m.anonymize_ip !== false,
    client_name: m.client_name || 'synthetic-data-harness',
    client_version: m.client_version || '1.0.0',
    enrich_decisions: true,
    visitors: visitors,
  };
  if (m.project_id) batch.project_id = String(m.project_id);
  return batch;
}

async function postBatch(endpoint, payload, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000);
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(function () { return ''; });
    return { ok: res.ok, status: res.status, ms: Date.now() - started, body: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ENDPOINTS, endpointFor,
  activationSnapshot, conversionSnapshot, buildVisitor, buildBatch, postBatch,
};
