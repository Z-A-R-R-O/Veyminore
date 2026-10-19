import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProviderConfig, KNOWN_PROVIDERS, DEFAULT_MODELS } from '../src/loader.js';
import { createCatalogSnapshotPort } from '../src/catalog-validator.js';

// Synthetic catalog snapshot for testing without live network or external imports
const SYNTHETIC_CATALOG = Object.freeze({
  groq: {
    'openai/gpt-oss-120b': {
      isFree: true,
      pricing: { inputCostPerM: 0, outputCostPerM: 0 },
      pricingProof: 'Groq official free tier (30 RPM, 1000 RPD, 8000 TPM, 200k TPD)'
    },
    'openai/gpt-4o': {
      isFree: false,
      pricing: { inputCostPerM: 5, outputCostPerM: 15 },
      pricingProof: null // definitely paid / absent free proof
    }
  },
  opencode: {
    'glm-5.3-flash-free': {
      isFree: true,
      pricing: { inputCostPerM: 0, outputCostPerM: 0 },
      pricingProof: 'OpenCode Console models pricing documentation (free tier)'
    }
  },
  openrouter: {
    'openai/gpt-oss-120b:free': {
      isFree: true,
      pricing: { inputCostPerM: 0, outputCostPerM: 0 },
      pricingProof: 'OpenRouter :free variant zero-cost routing'
    }
  }
});

const syntheticPort = createCatalogSnapshotPort(SYNTHETIC_CATALOG);

test('loadProviderConfig canonical template names and precedence invariants', async (t) => {
  await t.test('honors canonical template names with injected catalog port', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-oss-120b',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'fake, groq',
        ZETRO_MAX_CONCURRENT_WORKERS: '2',
        ZETRO_FREE_ONLY: '1',
        GROQ_API_KEY: 'gsk_synthetic_key_canonical'
      },
      catalogPort: syntheticPort
    });

    assert.strictEqual(config.provider, 'groq');
    assert.strictEqual(config.model, 'openai/gpt-oss-120b');
    assert.strictEqual(config.liveAllowed, true);
    assert.strictEqual(config.sourceSharingApproved, true);
    assert.strictEqual(config.providerApproved, true);
    assert.strictEqual(config.concurrency, 2);
    assert.strictEqual(config.freeOnly, true);
    assert.strictEqual(config.status.ready, true);
    assert.strictEqual(config.status.mode, 'live-approved');
  });

  await t.test('conflict resolution: canonical false overrides conflicting legacy true', () => {
    // Review requirement: "Existing canonical false must override any legacy alias."
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        GROQ_API_KEY: 'gsk_synthetic_key',
        // Canonical false vs Legacy true:
        ZETRO_LIVE_INFERENCE_ENABLED: '0',
        ZETRO_ALLOW_LIVE: '1',
        // Canonical false vs Legacy true:
        ZETRO_ALLOW_REMOTE_SOURCE: 'false',
        ZETRO_APPROVE_SOURCE: 'true',
        // Canonical mismatch vs Legacy true:
        ZETRO_APPROVED_PROVIDERS: 'opencode', // does not include groq!
        ZETRO_APPROVE_PROVIDER: '1'
      },
      catalogPort: syntheticPort
    });

    // Canonical false MUST WIN
    assert.strictEqual(config.liveAllowed, false, 'Canonical false must override legacy true for live inference');
    assert.strictEqual(config.sourceSharingApproved, false, 'Canonical false must override legacy true for remote source');
    assert.strictEqual(config.providerApproved, false, 'Canonical approved list excluding provider must override legacy true');

    // Status must be unready
    assert.strictEqual(config.status.ready, false);
    assert.strictEqual(config.status.mode, 'unready');
    assert.ok(config.status.reasons.some(r => r.includes('Approved-provider mismatch')));
  });

  await t.test('ZETRO_LIVE_SMOKE must never authorize general live inference or source transmission', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_SMOKE: '1' // Smoke flag only
      },
      catalogPort: syntheticPort
    });

    assert.strictEqual(config.liveAllowed, false, 'ZETRO_LIVE_SMOKE must never authorize live inference');
    assert.strictEqual(config.sourceSharingApproved, false, 'ZETRO_LIVE_SMOKE must never authorize source sharing');
  });

  await t.test('process env overrides synthetic file values', () => {
    const fileContent = `
ZETRO_PROVIDER=groq
ZETRO_MAX_CONCURRENT_WORKERS=3
GROQ_API_KEY=file_key_111
`;
    const env = {
      ZETRO_PROVIDER: 'opencode',
      GROQ_API_KEY: 'env_key_222'
    };

    const config = loadProviderConfig({ env, syntheticEnvContent: fileContent });
    assert.strictEqual(config.provider, 'opencode');
    assert.strictEqual(config.concurrency, 3); // file value used when env absent
    assert.strictEqual(config.getApiKey('groq'), 'env_key_222'); // env overrides file
  });
});

test('loadProviderConfig invalid and typo flag handling (P1 regression tests)', async (t) => {
  await t.test('ZETRO_FREE_ONLY=typo retains restrictive default (true) and blocks readiness', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_FREE_ONLY: 'typo'
      }
    });

    // Protection MUST NOT be disabled
    assert.strictEqual(config.freeOnly, true, 'ZETRO_FREE_ONLY=typo must retain restrictive default true');
    // Invalid flag must be captured
    assert.ok(config.invalidFlags.length > 0);
    assert.match(config.invalidFlags[0], /Invalid boolean value 'typo'/);
    // Readiness must be blocked
    assert.strictEqual(config.status.ready, false);
    assert.strictEqual(config.status.mode, 'invalid-config');
  });

  await t.test('invalid boolean values on security flags block readiness', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_LIVE_INFERENCE_ENABLED: 'invalid_boolean'
      }
    });

    assert.strictEqual(config.liveAllowed, false);
    assert.strictEqual(config.status.ready, false);
    assert.strictEqual(config.status.mode, 'invalid-config');
  });

  await t.test('malformed numeric values block readiness', () => {
    // Partial integer (parseInt hazard '1abc')
    const configPartial = loadProviderConfig({
      env: { ZETRO_MAX_CONCURRENT_WORKERS: '1abc' }
    });
    assert.strictEqual(configPartial.concurrency, 1);
    assert.strictEqual(configPartial.status.ready, false);
    assert.strictEqual(configPartial.status.mode, 'invalid-config');
    assert.ok(configPartial.invalidFlags.some(f => f.includes('Malformed integer string')));

    // Out of bounds huge concurrency
    const configHuge = loadProviderConfig({
      env: { ZETRO_MAX_CONCURRENT_WORKERS: '99999' }
    });
    assert.strictEqual(configHuge.status.ready, false);
    assert.strictEqual(configHuge.status.mode, 'invalid-config');

    // Negative cost
    const configNegativeCost = loadProviderConfig({
      env: { ZETRO_MAX_COST_USD: '-5' }
    });
    assert.strictEqual(configNegativeCost.status.ready, false);
    assert.strictEqual(configNegativeCost.status.mode, 'invalid-config');

    // Non-zero cost while freeOnly is true
    const configNonZeroFree = loadProviderConfig({
      env: {
        ZETRO_FREE_ONLY: '1',
        ZETRO_MAX_COST_USD: '10.00'
      }
    });
    assert.strictEqual(configNonZeroFree.status.ready, false);
    assert.strictEqual(configNonZeroFree.status.mode, 'invalid-config');
  });
});

test('loadProviderConfig model catalog verification and injected evidence (P1 rework invariants)', async (t) => {
  await t.test('external provider without injected catalog port remains unverified and blocked', () => {
    // No catalog port injected: external model must NEVER invent proof
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-oss-120b',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      }
      // No catalogPort provided
    });

    assert.strictEqual(config.modelVerification.verified, false);
    assert.strictEqual(config.modelVerification.eligible, false);
    assert.strictEqual(config.modelVerification.pricingProof, null);
    assert.match(config.modelVerification.reason, /No catalog validator port provided/);
    assert.strictEqual(config.status.ready, false);
    assert.strictEqual(config.status.mode, 'unready');
  });

  await t.test('never invents proof for unverified suffixes (-free or :free) without catalog evidence', () => {
    // Review requirement: "catalog-validator invents proof for any OpenCode -free or OR :free suffix; invented models become live-ready."
    // Verify that fabricated suffix trust is completely eliminated!
    const configOpenCode = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'opencode',
        ZETRO_MODEL: 'invented-fake-model-free', // fabricated suffix!
        OPENCODE_API_KEY: 'oc_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'opencode'
      },
      catalogPort: syntheticPort // model not in synthetic catalog
    });
    assert.strictEqual(configOpenCode.modelVerification.verified, false);
    assert.strictEqual(configOpenCode.modelVerification.eligible, false);
    assert.strictEqual(configOpenCode.status.ready, false);

    const configOpenRouter = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'openrouter',
        ZETRO_MODEL: 'arbitrary-model:free', // fabricated suffix!
        OPENROUTER_API_KEY: 'or_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'openrouter'
      },
      catalogPort: syntheticPort
    });
    assert.strictEqual(configOpenRouter.modelVerification.verified, false);
    assert.strictEqual(configOpenRouter.modelVerification.eligible, false);
    assert.strictEqual(configOpenRouter.status.ready, false);
  });

  await t.test('strictly validates injected proof boolean types (no Boolean string hazard)', () => {
    // Adversarial port returning string 'false' for booleans
    const adversarialPort = () => ({
      verified: 'false', // string 'false' must NOT evaluate to true via Boolean('false')!
      eligible: 'false',
      isFree: 'false',
      pricingProof: 'fake-proof'
    });

    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-oss-120b',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq'
      },
      catalogPort: adversarialPort
    });

    assert.strictEqual(config.modelVerification.verified, false, "String 'false' must strictly parse as false");
    assert.strictEqual(config.modelVerification.eligible, false, "String 'false' must strictly parse as false");
    assert.strictEqual(config.status.ready, false);
  });

  await t.test('absent or empty pricing proof cannot be verified', () => {
    // Port claiming verified: true but with empty pricingProof
    const emptyProofPort = () => ({
      verified: true,
      eligible: true,
      isFree: true,
      pricingProof: '   ' // empty/whitespace proof
    });

    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-oss-120b',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq'
      },
      catalogPort: emptyProofPort
    });

    assert.strictEqual(config.modelVerification.pricingProof, null);
    assert.strictEqual(config.modelVerification.verified, false, 'Absent pricing proof cannot be verified');
    assert.strictEqual(config.status.ready, false);
  });
});

test('loadProviderConfig paid mode (freeOnly=false) requirements (P1 regression tests)', async (t) => {
  await t.test('paid mode with $0.00 budget cannot execute and blocks readiness', () => {
    // Review requirement: "paid mode with 0 budget cannot execute."
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-4o',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '0', // paid mode requested
        ZETRO_MAX_COST_USD: '0' // $0 budget
      },
      catalogPort: () => ({
        verified: true,
        eligible: true,
        isFree: false,
        pricingProof: 'Commercial rates apply'
      })
    });

    assert.strictEqual(config.freeOnly, false);
    assert.strictEqual(config.maxCostUsd, 0);
    assert.strictEqual(config.status.ready, false, 'Paid mode with $0.00 budget must block readiness');
    assert.ok(config.status.reasons.some(r => r.includes('Paid mode requires an explicit finite budget > $0.00')));
  });

  await t.test('paid mode with unknown/ineligible model blocks readiness', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'completely-unknown-model',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '0',
        ZETRO_MAX_COST_USD: '10.00'
      },
      catalogPort: () => ({
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: 'Model not registered in paid catalog'
      })
    });

    assert.strictEqual(config.status.ready, false);
    assert.ok(config.status.reasons.some(r => r.includes('Model eligibility failure')));
  });

  await t.test('paid mode with verified eligible model and explicit positive budget succeeds', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'commercial-model',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '0',
        ZETRO_MAX_COST_USD: '25.00'
      },
      catalogPort: () => ({
        verified: true,
        eligible: true,
        isFree: false,
        pricingProof: 'Commercial token pricing schedule',
        reason: 'Authorized under paid quota'
      })
    });

    assert.strictEqual(config.status.ready, true);
    assert.strictEqual(config.status.mode, 'live-approved');
    assert.strictEqual(config.modelVerification.eligible, true);
    assert.strictEqual(config.maxCostUsd, 25.0);
  });
});

test('loadProviderConfig approved-provider mismatch detection', async (t) => {
  await t.test('approved list excluding active provider blocks readiness', () => {
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        GROQ_API_KEY: 'gsk_key',
        ZETRO_APPROVED_PROVIDERS: 'opencode, openrouter' // groq is omitted
      }
    });

    assert.strictEqual(config.providerApproved, false);
    assert.strictEqual(config.status.ready, false);
    assert.ok(config.status.reasons.some(r => r.includes('Approved-provider mismatch')));
  });

  await t.test('fake provider is allowed by default with empty or matching list', () => {
    const configDefault = loadProviderConfig({ env: {} });
    assert.strictEqual(configDefault.provider, 'fake');
    assert.strictEqual(configDefault.providerApproved, true);
    assert.strictEqual(configDefault.status.ready, true);
  });
});

test('createCatalogSnapshotPort complete price evidence and contradictory metadata (W2R3 regression tests)', async (t) => {
  await t.test('rejects contradictory metadata: inputCostPerM 0 but outputCostPerM 99', () => {
    const contradictoryCatalog = {
      groq: {
        'openai/gpt-partial-zero': {
          isFree: true,
          pricing: { inputCostPerM: 0, outputCostPerM: 99 },
          pricingProof: 'Claimed free input but paid output'
        }
      }
    };
    const port = createCatalogSnapshotPort(contradictoryCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-partial-zero', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Contradictory metadata (input: 0, output: 99) must be rejected');
    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.isFree, false);
    assert.strictEqual(result.pricingProof, null);
    assert.match(result.reason, /contradictory metadata/i);

    // Using it in loadProviderConfig under free-only blocks readiness
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-partial-zero',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      },
      catalogPort: port
    });
    assert.strictEqual(config.modelVerification.verified, false);
    assert.strictEqual(config.status.ready, false);
  });

  await t.test('rejects contradictory metadata: isFree true but prices 5+5', () => {
    const contradictoryCatalog = {
      groq: {
        'openai/gpt-claimed-free': {
          isFree: true,
          pricing: { inputCostPerM: 5, outputCostPerM: 5 },
          pricingProof: 'Claimed free flag with paid prices'
        }
      }
    };
    const port = createCatalogSnapshotPort(contradictoryCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-claimed-free', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Contradictory metadata (isFree: true, input: 5, output: 5) must be rejected');
    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.isFree, false);
    assert.match(result.reason, /contradictory metadata/i);

    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-claimed-free',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      },
      catalogPort: port
    });
    assert.strictEqual(config.modelVerification.verified, false);
    assert.strictEqual(config.status.ready, false);
  });

  await t.test('rejects contradictory metadata: isFree false but explicit zero pricing (0+0)', () => {
    const contradictoryCatalog = {
      groq: {
        'openai/gpt-claimed-paid-zero': {
          isFree: false,
          pricing: { inputCostPerM: 0, outputCostPerM: 0 },
          pricingProof: 'Marked not-free but priced at zero'
        }
      }
    };
    const port = createCatalogSnapshotPort(contradictoryCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-claimed-paid-zero', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Contradictory metadata (isFree: false, input: 0, output: 0) must be rejected');
    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.isFree, false);
    assert.match(result.reason, /contradictory metadata/i);
  });

  await t.test('rejects missing pricing metadata object', () => {
    const missingPricingCatalog = {
      groq: {
        'openai/gpt-no-pricing': {
          isFree: true,
          pricingProof: 'Proof without pricing numbers'
        }
      }
    };
    const port = createCatalogSnapshotPort(missingPricingCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-no-pricing', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Missing pricing metadata must be rejected');
    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.isFree, false);
    assert.match(result.reason, /missing pricing metadata/i);
  });

  await t.test('rejects missing or non-boolean isFree flag', () => {
    const invalidIsFreeCatalog = {
      groq: {
        'openai/gpt-string-free': {
          isFree: 'true', // string instead of boolean
          pricing: { inputCostPerM: 0, outputCostPerM: 0 },
          pricingProof: 'String boolean proof'
        }
      }
    };
    const port = createCatalogSnapshotPort(invalidIsFreeCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-string-free', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Non-boolean isFree flag must be rejected');
    assert.strictEqual(result.eligible, false);
    assert.match(result.reason, /missing or non-boolean isFree flag/i);
  });

  await t.test('rejects non-zero request cost under isFree true', () => {
    const requestCostCatalog = {
      groq: {
        'openai/gpt-request-cost': {
          isFree: true,
          pricing: { inputCostPerM: 0, outputCostPerM: 0, requestCost: 0.05 },
          pricingProof: 'Per-request fee applies'
        }
      }
    };
    const port = createCatalogSnapshotPort(requestCostCatalog);
    const result = port({ provider: 'groq', model: 'openai/gpt-request-cost', freeOnly: true, maxCostUsd: 0 });

    assert.strictEqual(result.verified, false, 'Non-zero request cost under isFree=true must be rejected as contradictory');
    assert.strictEqual(result.eligible, false);
  });

  await t.test('shares flat @zetro/model-providers contract structure directly', () => {
    // Exactly matches AGR-4 FREE_MODEL_CATALOG contract (flat object keyed by model ID with priceEvidence)
    const flatAgr4Catalog = {
      'openai/gpt-oss-120b': {
        id: 'openai/gpt-oss-120b',
        provider: 'groq',
        displayName: 'GPT-OSS 120B',
        isFree: true,
        pricing: { inputCostPerM: 0, outputCostPerM: 0 },
        priceEvidence: 'Groq official free tier rate limits table'
      }
    };
    const port = createCatalogSnapshotPort(flatAgr4Catalog);
    const config = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-oss-120b',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      },
      catalogPort: port
    });

    assert.strictEqual(config.modelVerification.verified, true);
    assert.strictEqual(config.modelVerification.eligible, true);
    assert.strictEqual(config.modelVerification.isFree, true);
    assert.strictEqual(config.modelVerification.pricingProof, 'Groq official free tier rate limits table');
    assert.strictEqual(config.status.ready, true);
    assert.strictEqual(config.status.mode, 'live-approved');
  });

  await t.test('validates paid model under paid mode and rejects it under free-only', () => {
    const paidCatalog = {
      groq: {
        'openai/gpt-4o': {
          isFree: false,
          pricing: { inputCostPerM: 5, outputCostPerM: 15 },
          pricingProof: 'Commercial token pricing schedule'
        }
      }
    };
    const port = createCatalogSnapshotPort(paidCatalog);

    // Free-only rejection
    const freeConfig = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-4o',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '1'
      },
      catalogPort: port
    });
    assert.strictEqual(freeConfig.modelVerification.verified, false);
    assert.strictEqual(freeConfig.modelVerification.eligible, false);
    assert.strictEqual(freeConfig.status.ready, false);

    // Paid mode acceptance with positive budget
    const paidConfig = loadProviderConfig({
      env: {
        ZETRO_PROVIDER: 'groq',
        ZETRO_MODEL: 'openai/gpt-4o',
        GROQ_API_KEY: 'gsk_synthetic_key',
        ZETRO_LIVE_INFERENCE_ENABLED: '1',
        ZETRO_ALLOW_REMOTE_SOURCE: '1',
        ZETRO_APPROVED_PROVIDERS: 'groq',
        ZETRO_FREE_ONLY: '0',
        ZETRO_MAX_COST_USD: '20.00'
      },
      catalogPort: port
    });
    assert.strictEqual(paidConfig.modelVerification.verified, true);
    assert.strictEqual(paidConfig.modelVerification.eligible, true);
    assert.strictEqual(paidConfig.modelVerification.isFree, false);
    assert.strictEqual(paidConfig.modelVerification.pricingProof, 'Commercial token pricing schedule');
    assert.strictEqual(paidConfig.status.ready, true);
    assert.strictEqual(paidConfig.status.mode, 'live-approved');
  });
});

