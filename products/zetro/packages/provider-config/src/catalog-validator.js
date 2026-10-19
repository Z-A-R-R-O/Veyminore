/**
 * Model Catalog Validator & Eligibility Port
 *
 * Enforces strict, verified catalog evidence from an injected/shared port.
 * Never invents proof from suffixes (-free or :free) and never duplicates
 * model catalogs as independent fabricated trust.
 * Strictly checks boolean types on injected evidence (no Boolean('false') hazard).
 *
 * Owned by AGR-5.
 */

/**
 * Validates model eligibility and pricing evidence using an injected catalog port.
 *
 * @param {object} params
 * @param {string} params.provider - Provider name
 * @param {string} params.model - Model identifier
 * @param {boolean} params.freeOnly - Whether free-only routing is required
 * @param {number} params.maxCostUsd - Configured budget ceiling
 * @param {Function | object} [params.catalogPort] - Injected catalog validator function or port object
 * @returns {{ verified: boolean, eligible: boolean, isFree: boolean, pricingProof: string | null, reason: string }}
 */
export function validateModelEligibility({
  provider,
  model,
  freeOnly,
  maxCostUsd,
  catalogPort
}) {
  const normProvider = (provider || '').toLowerCase().trim();
  const normModel = (model || '').trim();

  // 1. Fake Provider: strictly offline in-memory simulation
  if (normProvider === 'fake') {
    if (normModel === 'fake-model' || normModel === '') {
      return {
        verified: true,
        eligible: true,
        isFree: true,
        pricingProof: 'In-memory deterministic offline simulation (zero cost)',
        reason: 'Offline fake model verified zero cost'
      };
    }
    return {
      verified: true,
      eligible: true,
      isFree: true,
      pricingProof: 'In-memory deterministic offline simulation (zero cost)',
      reason: `Offline simulated model '${normModel}' verified zero cost`
    };
  }

  // 2. Handle Injected Catalog Port / Validator Function
  let validatorFn = null;
  if (typeof catalogPort === 'function') {
    validatorFn = catalogPort;
  } else if (catalogPort && typeof catalogPort.validateModel === 'function') {
    validatorFn = catalogPort.validateModel.bind(catalogPort);
  }

  if (validatorFn) {
    try {
      const rawRes = validatorFn({
        provider: normProvider,
        model: normModel,
        freeOnly,
        maxCostUsd
      });

      if (!rawRes || typeof rawRes !== 'object') {
        return {
          verified: false,
          eligible: false,
          isFree: false,
          pricingProof: null,
          reason: 'Catalog port returned non-object response'
        };
      }

      // CRITICAL: Strictly validate boolean types. Never use Boolean(rawRes.verified)
      // because in JavaScript Boolean('false') === true!
      const verified = rawRes.verified === true;
      const eligible = rawRes.eligible === true;
      const isFree = rawRes.isFree === true;

      // Pricing proof must be a non-empty string
      let pricingProof = null;
      if (typeof rawRes.pricingProof === 'string' && rawRes.pricingProof.trim().length > 0) {
        pricingProof = rawRes.pricingProof.trim();
      }

      // Invariant: Missing or absent pricing proof cannot be considered verified
      const finalVerified = verified && pricingProof !== null;

      let reason = (typeof rawRes.reason === 'string' && rawRes.reason.trim())
        ? rawRes.reason.trim()
        : (finalVerified && eligible ? 'Validated by catalog port' : 'Rejected by catalog port');

      // Invariant: Free-only policy requires confirmed isFree === true
      if (freeOnly && !isFree) {
        return {
          verified: false,
          eligible: false,
          isFree: false,
          pricingProof,
          reason: `Model '${normModel}' is not free under free-only policy: ${reason}`
        };
      }

      // Invariant: Paid mode requires positive finite budget
      if (!freeOnly && maxCostUsd <= 0) {
        return {
          verified: false,
          eligible: false,
          isFree,
          pricingProof,
          reason: `Paid mode execution requires an explicit finite budget > $0.00 (configured: $${maxCostUsd.toFixed(2)})`
        };
      }

      return {
        verified: finalVerified,
        eligible: eligible && (freeOnly ? isFree : maxCostUsd > 0),
        isFree,
        pricingProof,
        reason
      };
    } catch (err) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Catalog validator error: ${err.message}`
      };
    }
  }

  // 3. No Injected Port for External Provider: Never fabricate trust or invent proof
  return {
    verified: false,
    eligible: false,
    isFree: false,
    pricingProof: null,
    reason: `No catalog validator port provided for provider '${normProvider}'; absent pricing proof`
  };
}

/**
 * Creates a model catalog validator port from a verified catalog snapshot.
 * Supports both provider-keyed and flat model catalogs (sharing the @zetro/model-providers contract).
 * Validates complete explicit zero input/output/request pricing for free models,
 * and strictly rejects missing, invalid, or contradictory metadata.
 *
 * @param {Record<string, Record<string, { pricing: { inputCostPerM: number, outputCostPerM: number, requestCost?: number, costPerRequest?: number }, isFree: boolean, pricingProof?: string, priceEvidence?: string }>> | Record<string, any>} catalogSnapshot
 * @returns {(params: { provider: string, model: string, freeOnly: boolean, maxCostUsd: number }) => object}
 */
export function createCatalogSnapshotPort(catalogSnapshot) {
  return function ({ provider, model, freeOnly, maxCostUsd }) {
    if (!catalogSnapshot || typeof catalogSnapshot !== 'object') {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: 'Catalog snapshot is empty or invalid'
      };
    }

    const normProvider = (provider || '').toLowerCase().trim();
    const normModel = (model || '').trim();

    // 1. Locate entry: supports provider-keyed snapshot or flat catalog (AGR-4 contract)
    let entry = null;
    const providerCatalog = catalogSnapshot[normProvider];
    if (providerCatalog && typeof providerCatalog === 'object') {
      entry = providerCatalog[normModel];
    }
    if (!entry && catalogSnapshot[normModel] && typeof catalogSnapshot[normModel] === 'object') {
      const candidate = catalogSnapshot[normModel];
      if (!candidate.provider || candidate.provider.toLowerCase().trim() === normProvider) {
        entry = candidate;
      }
    }

    if (!entry || typeof entry !== 'object') {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' not found in catalog snapshot for provider '${provider}'`
      };
    }

    // 2. Validate pricing object presence
    if (!entry.pricing || typeof entry.pricing !== 'object') {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' missing pricing metadata in catalog snapshot`
      };
    }

    // 3. Validate token pricing numbers: inputCostPerM and outputCostPerM must be finite non-negative numbers
    const { inputCostPerM, outputCostPerM, requestCost, costPerRequest } = entry.pricing;

    if (typeof inputCostPerM !== 'number' || !Number.isFinite(inputCostPerM) || inputCostPerM < 0 ||
        typeof outputCostPerM !== 'number' || !Number.isFinite(outputCostPerM) || outputCostPerM < 0) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has invalid or negative token pricing in catalog snapshot`
      };
    }

    if (requestCost !== undefined && (typeof requestCost !== 'number' || !Number.isFinite(requestCost) || requestCost < 0)) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has invalid requestCost in catalog snapshot`
      };
    }

    if (costPerRequest !== undefined && (typeof costPerRequest !== 'number' || !Number.isFinite(costPerRequest) || costPerRequest < 0)) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has invalid costPerRequest in catalog snapshot`
      };
    }

    // Complete explicit zero pricing across all token and request dimensions
    const hasExplicitZeroPricing =
      inputCostPerM === 0 &&
      outputCostPerM === 0 &&
      (requestCost === undefined || requestCost === 0) &&
      (costPerRequest === undefined || costPerRequest === 0);

    // 4. Validate isFree boolean flag
    if (typeof entry.isFree !== 'boolean') {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' missing or non-boolean isFree flag in catalog snapshot`
      };
    }

    // 5. Detect and reject contradictory metadata
    if (entry.isFree === true && !hasExplicitZeroPricing) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has contradictory metadata: marked isFree=true but pricing is non-zero (input: ${inputCostPerM}, output: ${outputCostPerM})`
      };
    }

    if (entry.isFree === false && hasExplicitZeroPricing) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has contradictory metadata: marked isFree=false but pricing is explicit zero`
      };
    }

    // 6. Pricing proof / evidence string validation
    const proof = (typeof entry.pricingProof === 'string' && entry.pricingProof.trim())
      ? entry.pricingProof.trim()
      : (typeof entry.priceEvidence === 'string' && entry.priceEvidence.trim() ? entry.priceEvidence.trim() : null);

    if (!proof) {
      return {
        verified: false,
        eligible: false,
        isFree: false,
        pricingProof: null,
        reason: `Model '${model}' has absent pricing proof in catalog snapshot`
      };
    }

    const isFree = entry.isFree && hasExplicitZeroPricing;
    const eligible = freeOnly ? isFree : (maxCostUsd > 0 || isFree);

    return {
      verified: true,
      eligible,
      isFree,
      pricingProof: proof,
      reason: `Model '${model}' verified in catalog snapshot`
    };
  };
}
