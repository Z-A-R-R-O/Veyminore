/**
 * Model Providers - Qualification Summary Validator for Measured Provider Eligibility
 *
 * Evaluates measured candidate eligibility summaries against strict zero-cost routing,
 * exact provider/model identity, fresh metadata snapshots, bounded campaigns, complete
 * token usage accounting, mandatory itemized trial evidence, and zero paid fallbacks.
 */

import { FreeRoutingViolationError } from './errors.js';
import { APPROVED_ENDPOINTS, normalizeModelId } from './metadata.js';
import { validateModelSnapshot } from './validator-port.js';

/**
 * Validates a measured qualification summary for a candidate model provider.
 *
 * @param {unknown} summary The qualification summary to validate.
 * @param {object} [options]
 * @param {boolean} [options.strict=false] Whether to throw FreeRoutingViolationError on failure.
 * @param {object} [options.snapshot=null] Optional model snapshot to validate against.
 * @param {number} [options.maxAgeMs=null] Optional maximum summary age in milliseconds.
 * @param {number} [options.minTrials=1] Minimum required planned trials.
 * @returns {{
 *   qualified: boolean,
 *   provider: string | null,
 *   model: string | null,
 *   reason: string | null,
 *   violations: string[],
 *   metrics: object | null
 * }}
 */
export function validateQualificationSummary(summary, options = {}) {
  const {
    strict = false,
    snapshot: optionsSnapshot = null,
    maxAgeMs = null,
    minTrials = 1
  } = options;

  const violations = [];

  function record(violation) {
    violations.push(violation);
  }

  // 1. Structure check
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    const reason = 'Qualification summary must be a valid non-null plain object';
    if (strict) throw new FreeRoutingViolationError(reason);
    return {
      qualified: false,
      provider: null,
      model: null,
      reason,
      violations: [reason],
      metrics: null
    };
  }

  // 2. Exact Provider Identity
  let normProvider = null;
  if (typeof summary.provider !== 'string' || summary.provider.trim() === '') {
    record("Missing or invalid 'provider' string in qualification summary");
  } else {
    normProvider = summary.provider.toLowerCase().trim();
    if (!APPROVED_ENDPOINTS[normProvider]) {
      record(
        `Provider '${summary.provider}' is not approved. Approved providers: ${Object.keys(APPROVED_ENDPOINTS).join(', ')}`
      );
    }
  }

  // 3. Exact Model Identity
  let normModel = null;
  if (typeof summary.model !== 'string' || summary.model.trim() === '') {
    record("Missing or invalid 'model' string in qualification summary");
  } else {
    normModel = summary.model.trim();
    if (normProvider === 'openrouter' && !normModel.endsWith(':free')) {
      record(`OpenRouter model '${normModel}' must end with ':free' suffix to guarantee zero-cost routing`);
    }
  }

  // 4. Fresh Validated Snapshot & Trust Disagreement Check
  let activeSnapshot = optionsSnapshot;
  if (optionsSnapshot && summary.snapshot) {
    // Both supplied: check for disagreement rather than silently overriding
    const optProv = (optionsSnapshot.provider || '').toLowerCase().trim();
    const sumProv = (summary.snapshot.provider || '').toLowerCase().trim();
    if (optProv !== sumProv) {
      record(
        `Summary snapshot provider '${summary.snapshot.provider}' disagrees with trusted options.snapshot provider '${optionsSnapshot.provider}'`
      );
    }
    const optId = normalizeModelId(optionsSnapshot.id || '', optProv || normProvider);
    const sumId = normalizeModelId(summary.snapshot.id || '', sumProv || normProvider);
    if (optId !== sumId) {
      record(
        `Summary snapshot model '${summary.snapshot.id}' disagrees with trusted options.snapshot model '${optionsSnapshot.id}'`
      );
    }
    if (summary.snapshot.source && optionsSnapshot.source && summary.snapshot.source !== optionsSnapshot.source) {
      record(
        `Summary snapshot source '${summary.snapshot.source}' disagrees with trusted options.snapshot source '${optionsSnapshot.source}'`
      );
    }
    if (
      summary.snapshot.expiresAt !== undefined &&
      optionsSnapshot.expiresAt !== undefined &&
      summary.snapshot.expiresAt !== optionsSnapshot.expiresAt
    ) {
      record(
        `Summary snapshot expiresAt (${summary.snapshot.expiresAt}) disagrees with trusted options.snapshot expiresAt (${optionsSnapshot.expiresAt})`
      );
    }
    activeSnapshot = optionsSnapshot; // trusted options.snapshot takes precedence
  } else if (!activeSnapshot) {
    activeSnapshot = summary.snapshot;
  }

  if (!activeSnapshot) {
    record('Missing required fresh metadata snapshot for qualification summary verification');
  } else {
    const snapResult = validateModelSnapshot(activeSnapshot, { strict: false, allowExpired: false });
    if (!snapResult.valid) {
      record(`Metadata snapshot invalid or expired: ${snapResult.reason}`);
    } else {
      if (normProvider && snapResult.provider !== normProvider) {
        record(
          `Snapshot provider '${snapResult.provider}' does not match summary provider '${normProvider}'`
        );
      }
      if (normModel && normProvider) {
        const expectedModel = normalizeModelId(normModel, normProvider);
        const snapshotModel = normalizeModelId(snapResult.modelId || activeSnapshot.id, normProvider);
        if (expectedModel !== snapshotModel) {
          record(
            `Snapshot model '${snapResult.modelId || activeSnapshot.id}' does not match summary model '${normModel}'`
          );
        }
      }
    }
  }

  // 5. Explicit Zero Pricing & No Nonzero/NaN/String Costs
  if (summary.pricing !== undefined && summary.pricing !== null) {
    if (typeof summary.pricing !== 'object' || Array.isArray(summary.pricing)) {
      record('Pricing must be a plain object');
    } else {
      const p = summary.pricing;
      if (typeof p.inputCostPerM !== 'number' || !Number.isFinite(p.inputCostPerM) || p.inputCostPerM !== 0 || Object.is(p.inputCostPerM, -0)) {
        record(`Explicit zero input pricing required; got ${p.inputCostPerM}`);
      }
      if (typeof p.outputCostPerM !== 'number' || !Number.isFinite(p.outputCostPerM) || p.outputCostPerM !== 0 || Object.is(p.outputCostPerM, -0)) {
        record(`Explicit zero output pricing required; got ${p.outputCostPerM}`);
      }
      if (p.requestCost !== undefined && (typeof p.requestCost !== 'number' || !Number.isFinite(p.requestCost) || p.requestCost !== 0 || Object.is(p.requestCost, -0))) {
        record(`Explicit zero request pricing required; got ${p.requestCost}`);
      }
    }
  }

  if (summary.routing !== undefined && summary.routing !== null) {
    if (typeof summary.routing !== 'object' || Array.isArray(summary.routing)) {
      record('Routing specification must be a plain object');
    } else {
      const r = summary.routing;
      if (r.maxPromptPrice !== undefined && (typeof r.maxPromptPrice !== 'number' || !Number.isFinite(r.maxPromptPrice) || r.maxPromptPrice !== 0)) {
        record(`maxPromptPrice must be literal 0; got ${r.maxPromptPrice}`);
      }
      if (r.maxCompletionPrice !== undefined && (typeof r.maxCompletionPrice !== 'number' || !Number.isFinite(r.maxCompletionPrice) || r.maxCompletionPrice !== 0)) {
        record(`maxCompletionPrice must be literal 0; got ${r.maxCompletionPrice}`);
      }
      if (r.allowFallbacks !== undefined && r.allowFallbacks !== false) {
        record(`routing.allowFallbacks must be literal boolean false; got ${typeof r.allowFallbacks === 'boolean' ? r.allowFallbacks : typeof r.allowFallbacks}`);
      }
      if (r.paidFallback !== undefined && r.paidFallback !== false) {
        record(`routing.paidFallback must be literal boolean false; got ${r.paidFallback}`);
      }
    }
  }

  // 6. Paid Fallback Prohibition
  if (summary.allowFallbacks !== undefined && summary.allowFallbacks !== false) {
    record(`allowFallbacks must be literal boolean false; got ${typeof summary.allowFallbacks === 'boolean' ? summary.allowFallbacks : typeof summary.allowFallbacks}`);
  }
  if (summary.paidFallback !== undefined && summary.paidFallback !== false) {
    record(`paidFallback must be literal boolean false; got ${summary.paidFallback}`);
  }
  if (summary.freeOnly !== undefined && summary.freeOnly !== true) {
    record(`freeOnly must be literal boolean true; got ${summary.freeOnly}`);
  }

  // 7. Bounded Observed Campaign Counts
  const planned = summary.planned;
  if (typeof planned !== 'number' || !Number.isInteger(planned) || planned <= 0) {
    record(`Campaign planned trials must be a positive integer; got ${planned}`);
  } else if (planned < minTrials) {
    record(`Campaign planned trials (${planned}) below required minimum (${minTrials})`);
  }

  const attempted = summary.attempted;
  if (typeof attempted !== 'number' || !Number.isInteger(attempted) || attempted < 0) {
    record(`Campaign attempted trials must be a non-negative integer; got ${attempted}`);
  }

  const verified = summary.verified;
  if (typeof verified !== 'number' || !Number.isInteger(verified) || verified < 0) {
    record(`Campaign verified trials must be a non-negative integer; got ${verified}`);
  }

  const failures = summary.failures;
  if (typeof failures !== 'number' || !Number.isInteger(failures) || failures < 0) {
    record(`Campaign failures must be an explicit non-negative integer; got ${failures}`);
  }

  // Coherence: verified + failures === attempted
  if (Number.isInteger(attempted) && Number.isInteger(verified) && Number.isInteger(failures)) {
    if (verified + failures !== attempted) {
      record(
        `Campaign trial counts incoherent: verified (${verified}) + failures (${failures}) = ${verified + failures} != attempted (${attempted})`
      );
    }
  }

  // All Required Trials Verified Literal True (Zero Failures Allowed for Qualification)
  if (Number.isInteger(planned) && Number.isInteger(attempted) && Number.isInteger(verified)) {
    if (attempted < planned) {
      record(`Incomplete campaign: attempted (${attempted}) < planned (${planned})`);
    }
    if (failures > 0) {
      record(`Campaign has ${failures} recorded failure(s); qualification requires 0 failures`);
    }
    if (verified !== planned) {
      record(`Campaign verified trials (${verified}) does not match planned trials (${planned})`);
    }
  }

  // 8. Mandatory Explicit Itemized Trials Evidence
  if (!Array.isArray(summary.trials) || summary.trials.length === 0) {
    record(
      'Missing required non-empty trials array; aggregate self-declared counts without itemized trial evidence are prohibited'
    );
  } else {
    const trials = summary.trials;
    if (Number.isInteger(planned) && trials.length !== planned) {
      record(`Trials array length (${trials.length}) does not match planned trial count (${planned})`);
    }
    if (Number.isInteger(attempted) && trials.length !== attempted) {
      record(`Trials array length (${trials.length}) does not match attempted trial count (${attempted})`);
    }

    const seenIds = new Set();
    const summaryCampaign = summary.campaign || summary.campaignId;

    trials.forEach((t, idx) => {
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        record(`Trial #${idx} is not a valid non-null plain object`);
        return;
      }

      // Unique trial ID
      const trialId = (t.id !== undefined && t.id !== null && t.id !== '')
        ? t.id
        : (t.trialId !== undefined && t.trialId !== null && t.trialId !== '')
          ? t.trialId
          : null;

      if (trialId === null || trialId === undefined) {
        record(`Trial #${idx} missing required unique identifier (id or trialId)`);
      } else {
        const idKey = String(trialId);
        if (seenIds.has(idKey)) {
          record(`Duplicate trial ID '${trialId}' detected in trials array at index #${idx}`);
        }
        seenIds.add(idKey);
      }

      const idLabel = trialId !== null ? `'${trialId}'` : `#${idx}`;

      // Literal boolean true verified
      if (t.verified !== true) {
        record(
          `Trial ${idLabel} verification is not literal boolean true; got ${typeof t.verified === 'boolean' ? t.verified : typeof t.verified}`
        );
      }

      // Evidence binding to provider/model/campaign
      if (t.provider !== undefined && normProvider) {
        const trialProv = String(t.provider).toLowerCase().trim();
        if (trialProv !== normProvider) {
          record(
            `Trial ${idLabel} provider '${t.provider}' does not match campaign provider '${normProvider}'`
          );
        }
      }
      if (t.model !== undefined && normModel && normProvider) {
        const trialModel = normalizeModelId(String(t.model), normProvider);
        const expectedModel = normalizeModelId(normModel, normProvider);
        if (trialModel !== expectedModel) {
          record(
            `Trial ${idLabel} model '${t.model}' does not match campaign model '${normModel}'`
          );
        }
      }
      if (summaryCampaign && (t.campaign !== undefined || t.campaignId !== undefined)) {
        const trialCampaign = t.campaign ?? t.campaignId;
        if (trialCampaign !== summaryCampaign) {
          record(
            `Trial ${idLabel} campaign '${trialCampaign}' does not match summary campaign '${summaryCampaign}'`
          );
        }
      }
    });
  }

  // Strict verification of fixtures if present
  if (Array.isArray(summary.fixtures)) {
    summary.fixtures.forEach((f, idx) => {
      if (!f || typeof f !== 'object') {
        record(`Fixture #${idx} is not a valid object`);
      } else {
        if (typeof f.verified === 'boolean') {
          if (f.verified !== true) {
            record(`Fixture '${f.fixture || idx}' verified flag is not literal boolean true`);
          }
        } else if (typeof f.verified === 'number') {
          if (!Number.isInteger(f.verified) || f.verified !== f.attempted || f.verified <= 0) {
            record(`Fixture '${f.fixture || idx}' verified count (${f.verified}) does not match attempted count (${f.attempted})`);
          }
        } else {
          record(`Fixture '${f.fixture || idx}' verified status is invalid type: ${typeof f.verified}`);
        }
      }
    });
  }

  // 9. No Unknown Usage or Hidden Failed Attempts
  if (summary.usageComplete !== true) {
    record(
      `usageComplete must be literal boolean true; got ${typeof summary.usageComplete === 'boolean' ? summary.usageComplete : typeof summary.usageComplete}`
    );
  }
  if (summary.unknownUsage !== false) {
    record(
      `unknownUsage must be literal boolean false; got ${summary.unknownUsage === undefined ? 'undefined (missing)' : typeof summary.unknownUsage === 'boolean' ? summary.unknownUsage : typeof summary.unknownUsage}`
    );
  }
  if (summary.httpRejectionsWithUnreportedUsage !== undefined) {
    if (typeof summary.httpRejectionsWithUnreportedUsage !== 'number' || summary.httpRejectionsWithUnreportedUsage !== 0) {
      record(`httpRejectionsWithUnreportedUsage must be 0; got ${summary.httpRejectionsWithUnreportedUsage}`);
    }
  }

  // Token numbers validation
  const inputTokens = summary.inputTokens;
  if (typeof inputTokens !== 'number' || !Number.isInteger(inputTokens) || inputTokens < 0) {
    record(`Campaign inputTokens must be a non-negative integer; got ${inputTokens}`);
  }
  const outputTokens = summary.outputTokens;
  if (typeof outputTokens !== 'number' || !Number.isInteger(outputTokens) || outputTokens < 0) {
    record(`Campaign outputTokens must be a non-negative integer; got ${outputTokens}`);
  }

  // Requests count validation
  const requests = summary.requests;
  if (typeof requests !== 'number' || !Number.isInteger(requests) || requests < (attempted || 0)) {
    record(`Campaign requests must be an integer >= attempted trials (${attempted}); got ${requests}`);
  }

  // Wall time validation
  const wallMs = summary.totalWallMs ?? summary.wallMs;
  if (typeof wallMs !== 'number' || !Number.isFinite(wallMs) || wallMs < 0) {
    record(`Campaign totalWallMs must be a non-negative finite number; got ${wallMs}`);
  }

  // Omitted failed costs check
  if (failures > 0 && inputTokens === 0 && outputTokens === 0 && requests > 0) {
    record('Campaign reports 0 token usage despite recorded failed requests (omitted failed costs)');
  }

  // 10. Summary Freshness & Future Check
  const dateStr = summary.date || summary.createdAt;
  if (dateStr) {
    const timestamp = new Date(dateStr).getTime();
    if (!Number.isFinite(timestamp) || Number.isNaN(timestamp)) {
      record(`Qualification summary has invalid date/createdAt timestamp: ${dateStr}`);
    } else {
      if (timestamp > Date.now()) {
        record(`Qualification summary date (${dateStr}) is in the future. Future claims prohibited.`);
      }
      if (typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
        if (Date.now() - timestamp > maxAgeMs) {
          record(`Qualification summary date (${dateStr}) exceeds maximum allowed age (${maxAgeMs}ms)`);
        }
      }
    }
  }

  const qualified = violations.length === 0;
  const reason = qualified ? null : violations[0];

  const result = {
    qualified,
    provider: normProvider,
    model: normModel,
    reason,
    violations,
    metrics: qualified ? {
      planned,
      attempted,
      verified,
      failures,
      requests,
      inputTokens,
      outputTokens,
      wallMs
    } : null
  };

  if (strict && !qualified) {
    throw new FreeRoutingViolationError(reason || 'Qualification summary failed validation');
  }

  return result;
}
