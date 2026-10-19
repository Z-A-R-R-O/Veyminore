import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateQualificationSummary,
  createModelValidatorPort,
  FreeRoutingViolationError
} from '../src/index.js';

function createFreshSnapshot(overrides = {}) {
  const now = Date.now();
  return {
    provider: 'openrouter',
    id: 'cohere/north-mini-code:free',
    source: 'https://openrouter.ai/api/v1/chat/completions',
    checkedAt: new Date(now - 1000).toISOString(),
    ttlMs: 3600000,
    expiresAt: now + 3599000,
    toolCalling: true,
    supportedParameters: ['tools', 'max_tokens'],
    pricing: {
      inputCostPerM: 0,
      outputCostPerM: 0,
      requestCost: 0
    },
    ...overrides
  };
}

function createValidTrials(count = 12, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `trial-${i + 1}`,
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    campaign: 'camp-2026-10-17',
    verified: true,
    ...overrides
  }));
}

function createValidSummary(overrides = {}) {
  const planned = overrides.planned ?? 12;
  return {
    provider: 'openrouter',
    model: 'cohere/north-mini-code:free',
    campaign: 'camp-2026-10-17',
    planned,
    attempted: planned,
    verified: planned,
    failures: 0,
    requests: planned,
    inputTokens: 3000,
    outputTokens: 1200,
    totalWallMs: 4500,
    usageComplete: true,
    unknownUsage: false,
    allowFallbacks: false,
    freeOnly: true,
    pricing: {
      inputCostPerM: 0,
      outputCostPerM: 0,
      requestCost: 0
    },
    snapshot: createFreshSnapshot(),
    trials: createValidTrials(planned),
    ...overrides
  };
}

test('validateQualificationSummary: fully qualified valid candidate returns compact actionable success', () => {
  const summary = createValidSummary();
  const result = validateQualificationSummary(summary);

  assert.equal(result.qualified, true);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'cohere/north-mini-code:free');
  assert.equal(result.reason, null);
  assert.deepEqual(result.violations, []);
  assert.ok(result.metrics);
  assert.equal(result.metrics.planned, 12);
  assert.equal(result.metrics.attempted, 12);
  assert.equal(result.metrics.verified, 12);
  assert.equal(result.metrics.failures, 0);
  assert.equal(result.metrics.requests, 12);
  assert.equal(result.metrics.inputTokens, 3000);
  assert.equal(result.metrics.outputTokens, 1200);
  assert.equal(result.metrics.wallMs, 4500);
});

test('validateQualificationSummary: rejects stale or expired snapshot and future dates', () => {
  const expiredSnapshot = createFreshSnapshot({
    checkedAt: new Date(Date.now() - 7200000).toISOString(),
    ttlMs: 3600000,
    expiresAt: Date.now() - 1000
  });

  const staleResult = validateQualificationSummary(createValidSummary({ snapshot: expiredSnapshot }));
  assert.equal(staleResult.qualified, false);
  assert.match(staleResult.reason, /expired/i);
  assert.ok(staleResult.violations.some(v => /expired/i.test(v)));

  // Future date on summary
  const futureResult = validateQualificationSummary(createValidSummary({
    date: new Date(Date.now() + 60000).toISOString()
  }));
  assert.equal(futureResult.qualified, false);
  assert.match(futureResult.reason, /future/i);

  // Exceeding maxAgeMs
  const maxAgeResult = validateQualificationSummary(
    createValidSummary({ date: new Date(Date.now() - 50000).toISOString() }),
    { maxAgeMs: 10000 }
  );
  assert.equal(maxAgeResult.qualified, false);
  assert.match(maxAgeResult.reason, /exceeds maximum allowed age/i);
});

test('validateQualificationSummary: rejects NaN, non-integer, and negative counts', () => {
  // NaN planned
  const nanPlanned = validateQualificationSummary(createValidSummary({ planned: NaN }));
  assert.equal(nanPlanned.qualified, false);
  assert.match(nanPlanned.reason, /planned trials/i);

  // String attempted
  const strAttempted = validateQualificationSummary(createValidSummary({ attempted: '12' }));
  assert.equal(strAttempted.qualified, false);
  assert.match(strAttempted.reason, /attempted trials/i);

  // Negative verified
  const negVerified = validateQualificationSummary(createValidSummary({ verified: -1 }));
  assert.equal(negVerified.qualified, false);
  assert.match(negVerified.reason, /verified trials/i);

  // Float tokens
  const floatTokens = validateQualificationSummary(createValidSummary({ inputTokens: 100.5 }));
  assert.equal(floatTokens.qualified, false);
  assert.match(floatTokens.reason, /inputTokens/i);

  // NaN wallMs
  const nanWall = validateQualificationSummary(createValidSummary({ totalWallMs: NaN }));
  assert.equal(nanWall.qualified, false);
  assert.match(nanWall.reason, /totalWallMs/i);
});

test('validateQualificationSummary: strictly rejects string flags (stringflags)', () => {
  // String usageComplete
  const strUsage = validateQualificationSummary(createValidSummary({ usageComplete: 'true' }));
  assert.equal(strUsage.qualified, false);
  assert.match(strUsage.reason, /usageComplete must be literal boolean true/i);

  // String allowFallbacks
  const strFallback = validateQualificationSummary(createValidSummary({ allowFallbacks: 'false' }));
  assert.equal(strFallback.qualified, false);
  assert.match(strFallback.reason, /allowFallbacks must be literal boolean false/i);

  // String fixture verified flag
  const strFixture = validateQualificationSummary(createValidSummary({
    fixtures: [{ fixture: 'numeric', attempted: 3, verified: '3' }]
  }));
  assert.equal(strFixture.qualified, false);
  assert.match(strFixture.reason, /invalid type/i);
});

test('validateQualificationSummary: rejects omitted failed costs, hidden usage, and count incoherence', () => {
  // Omitted failures
  const omittedFailures = createValidSummary();
  delete omittedFailures.failures;
  const omittedRes = validateQualificationSummary(omittedFailures);
  assert.equal(omittedRes.qualified, false);
  assert.match(omittedRes.reason, /explicit non-negative integer/i);

  // Count incoherence: verified (10) + failures (0) != attempted (12)
  const incoherentRes = validateQualificationSummary(createValidSummary({
    verified: 10,
    failures: 0,
    attempted: 12
  }));
  assert.equal(incoherentRes.qualified, false);
  assert.ok(incoherentRes.violations.some(v => /incoherent/i.test(v)));

  // Hidden/incomplete usage
  const incompleteUsage = validateQualificationSummary(createValidSummary({ usageComplete: false }));
  assert.equal(incompleteUsage.qualified, false);
  assert.match(incompleteUsage.reason, /usageComplete must be literal boolean true/i);

  // HTTP rejections with unreported usage
  const httpUnreported = validateQualificationSummary(createValidSummary({ httpRejectionsWithUnreportedUsage: 2 }));
  assert.equal(httpUnreported.qualified, false);
  assert.match(httpUnreported.reason, /httpRejectionsWithUnreportedUsage must be 0/i);

  // Omitted failed costs: 0 tokens reported despite recorded failures and requests
  const omittedCosts = validateQualificationSummary(createValidSummary({
    planned: 12,
    attempted: 12,
    verified: 9,
    failures: 3,
    requests: 12,
    inputTokens: 0,
    outputTokens: 0,
    trials: Array.from({ length: 12 }, (_, i) => ({
      id: `trial-${i + 1}`,
      verified: i < 9
    }))
  }));
  assert.equal(omittedCosts.qualified, false);
  assert.ok(omittedCosts.violations.some(v => /omitted failed costs/i.test(v)));
});

test('validateQualificationSummary: rejects paid fallback, non-zero pricing, and non-free routing', () => {
  // Paid fallback enabled
  const paidFallback = validateQualificationSummary(createValidSummary({ allowFallbacks: true }));
  assert.equal(paidFallback.qualified, false);
  assert.match(paidFallback.reason, /allowFallbacks must be literal boolean false/i);

  // Non-zero input pricing
  const nonzeroPrice = validateQualificationSummary(createValidSummary({
    pricing: { inputCostPerM: 0.05, outputCostPerM: 0 }
  }));
  assert.equal(nonzeroPrice.qualified, false);
  assert.match(nonzeroPrice.reason, /explicit zero input pricing/i);

  // Non-zero routing prompt price
  const nonzeroRouting = validateQualificationSummary(createValidSummary({
    routing: { maxPromptPrice: 0.1, maxCompletionPrice: 0, allowFallbacks: false }
  }));
  assert.equal(nonzeroRouting.qualified, false);
  assert.match(nonzeroRouting.reason, /maxPromptPrice must be literal 0/i);

  // OpenRouter model missing :free suffix
  const missingFreeSuffix = validateQualificationSummary(createValidSummary({
    model: 'cohere/north-mini-code'
  }));
  assert.equal(missingFreeSuffix.qualified, false);
  assert.match(missingFreeSuffix.reason, /must end with ':free' suffix/i);
});

test('validateQualificationSummary: strict mode throws FreeRoutingViolationError on disqualification', () => {
  assert.throws(
    () => validateQualificationSummary(createValidSummary({ usageComplete: false }), { strict: true }),
    FreeRoutingViolationError
  );
});

test('createModelValidatorPort: exposes validateQualification delegating cleanly', () => {
  const port = createModelValidatorPort();
  const result = port.validateQualification(createValidSummary());
  assert.equal(result.qualified, true);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'cohere/north-mini-code:free');
});

// --- New Review-Driven Regressions ---

test('validateQualificationSummary: rejects absent, non-array, or empty trials array', () => {
  // Absent trials array: aggregate self-declared counts prohibited
  const absentTrials = createValidSummary();
  delete absentTrials.trials;
  const absentRes = validateQualificationSummary(absentTrials);
  assert.equal(absentRes.qualified, false);
  assert.ok(absentRes.violations.some(v => /aggregate self-declared counts/i.test(v)));

  // Empty trials array
  const emptyRes = validateQualificationSummary(createValidSummary({ trials: [] }));
  assert.equal(emptyRes.qualified, false);
  assert.ok(emptyRes.violations.some(v => /non-empty trials array/i.test(v)));

  // Non-array trials
  const nonArrayRes = validateQualificationSummary(createValidSummary({ trials: '12' }));
  assert.equal(nonArrayRes.qualified, false);
  assert.ok(nonArrayRes.violations.some(v => /non-empty trials array/i.test(v)));
});

test('validateQualificationSummary: rejects trial count mismatch vs planned/attempted', () => {
  // Fewer trials than planned (11 vs 12)
  const fewerRes = validateQualificationSummary(createValidSummary({
    trials: createValidTrials(11)
  }));
  assert.equal(fewerRes.qualified, false);
  assert.ok(fewerRes.violations.some(v => /Trials array length \(11\) does not match planned/i.test(v)));

  // Extra trials than planned (13 vs 12)
  const extraRes = validateQualificationSummary(createValidSummary({
    trials: createValidTrials(13)
  }));
  assert.equal(extraRes.qualified, false);
  assert.ok(extraRes.violations.some(v => /Trials array length \(13\) does not match planned/i.test(v)));
});

test('validateQualificationSummary: rejects duplicate or missing trial IDs', () => {
  // Duplicate trial ID
  const duplicateTrials = createValidTrials(12);
  duplicateTrials[1].id = duplicateTrials[0].id; // duplicate 'trial-1'
  const dupRes = validateQualificationSummary(createValidSummary({ trials: duplicateTrials }));
  assert.equal(dupRes.qualified, false);
  assert.ok(dupRes.violations.some(v => /Duplicate trial ID 'trial-1'/i.test(v)));

  // Missing trial ID
  const missingIdTrials = createValidTrials(12);
  delete missingIdTrials[2].id;
  const missingIdRes = validateQualificationSummary(createValidSummary({ trials: missingIdTrials }));
  assert.equal(missingIdRes.qualified, false);
  assert.ok(missingIdRes.violations.some(v => /missing required unique identifier/i.test(v)));
});

test('validateQualificationSummary: rejects non-literal verified boolean in individual trials', () => {
  // String 'true'
  const strVerifiedTrials = createValidTrials(12);
  strVerifiedTrials[3].verified = 'true';
  const strRes = validateQualificationSummary(createValidSummary({ trials: strVerifiedTrials }));
  assert.equal(strRes.qualified, false);
  assert.ok(strRes.violations.some(v => /verification is not literal boolean true/i.test(v)));

  // Number 1
  const numVerifiedTrials = createValidTrials(12);
  numVerifiedTrials[4].verified = 1;
  const numRes = validateQualificationSummary(createValidSummary({ trials: numVerifiedTrials }));
  assert.equal(numRes.qualified, false);
  assert.ok(numRes.violations.some(v => /verification is not literal boolean true/i.test(v)));

  // Literal false
  const falseVerifiedTrials = createValidTrials(12);
  falseVerifiedTrials[0].verified = false;
  const falseRes = validateQualificationSummary(createValidSummary({ trials: falseVerifiedTrials }));
  assert.equal(falseRes.qualified, false);
  assert.ok(falseRes.violations.some(v => /verification is not literal boolean true/i.test(v)));
});

test('validateQualificationSummary: verifies evidence binding to provider, model, and campaign', () => {
  // Trial provider mismatch
  const provMismatchTrials = createValidTrials(12);
  provMismatchTrials[0].provider = 'groq'; // expected openrouter
  const provRes = validateQualificationSummary(createValidSummary({ trials: provMismatchTrials }));
  assert.equal(provRes.qualified, false);
  assert.ok(provRes.violations.some(v => /provider 'groq' does not match campaign provider 'openrouter'/i.test(v)));

  // Trial model mismatch
  const modelMismatchTrials = createValidTrials(12);
  modelMismatchTrials[0].model = 'other/model:free';
  const modelRes = validateQualificationSummary(createValidSummary({ trials: modelMismatchTrials }));
  assert.equal(modelRes.qualified, false);
  assert.ok(modelRes.violations.some(v => /model 'other\/model:free' does not match campaign model/i.test(v)));

  // Trial campaign mismatch
  const campMismatchTrials = createValidTrials(12);
  campMismatchTrials[0].campaign = 'camp-alien-xyz';
  const campRes = validateQualificationSummary(createValidSummary({ trials: campMismatchTrials }));
  assert.equal(campRes.qualified, false);
  assert.ok(campRes.violations.some(v => /campaign 'camp-alien-xyz' does not match summary campaign/i.test(v)));
});

test('validateQualificationSummary: strictly requires explicit unknownUsage: false', () => {
  // Missing unknownUsage (undefined)
  const missingUnknown = createValidSummary();
  delete missingUnknown.unknownUsage;
  const missingRes = validateQualificationSummary(missingUnknown);
  assert.equal(missingRes.qualified, false);
  assert.ok(missingRes.violations.some(v => /unknownUsage must be literal boolean false/i.test(v)));

  // String 'false'
  const strUnknownRes = validateQualificationSummary(createValidSummary({ unknownUsage: 'false' }));
  assert.equal(strUnknownRes.qualified, false);
  assert.ok(strUnknownRes.violations.some(v => /unknownUsage must be literal boolean false/i.test(v)));

  // Literal true
  const trueUnknownRes = validateQualificationSummary(createValidSummary({ unknownUsage: true }));
  assert.equal(trueUnknownRes.qualified, false);
  assert.ok(trueUnknownRes.violations.some(v => /unknownUsage must be literal boolean false/i.test(v)));
});

test('validateQualificationSummary: rejects summary snapshot disagreeing with trusted options.snapshot', () => {
  const trustedSnapshot = createFreshSnapshot({
    provider: 'openrouter',
    id: 'cohere/north-mini-code:free',
    source: 'https://openrouter.ai/api/v1/chat/completions'
  });

  // Summary snapshot with different model ID
  const disagreeingSnapshot = createFreshSnapshot({
    provider: 'openrouter',
    id: 'nvidia/nemotron-3.5-super-vl:free',
    source: 'https://openrouter.ai/api/v1/chat/completions'
  });

  const disagreeRes = validateQualificationSummary(
    createValidSummary({ snapshot: disagreeingSnapshot }),
    { snapshot: trustedSnapshot }
  );
  assert.equal(disagreeRes.qualified, false);
  assert.ok(disagreeRes.violations.some(v => /disagrees with trusted options\.snapshot/i.test(v)));

  // Agreeing snapshots pass cleanly
  const agreeingSnapshot = createFreshSnapshot({
    provider: 'openrouter',
    id: 'cohere/north-mini-code:free',
    source: 'https://openrouter.ai/api/v1/chat/completions'
  });
  const agreeRes = validateQualificationSummary(
    createValidSummary({ snapshot: agreeingSnapshot }),
    { snapshot: agreeingSnapshot }
  );
  assert.equal(agreeRes.qualified, true);
});
