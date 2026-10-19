/**
 * @file ifz/worker-registry.js
 * Authoritative in-memory Worker Registry for IFZ Unified Architecture.
 *
 * Enforces:
 * 1. Unique worker identity: rejects duplicate registrations.
 * 2. Concurrency control: replace-by-exact-revision.
 * 3. Immutable returns: all query results are deep-cloned and frozen.
 * 4. Distinct effect capability queries (read, write, create, execute, external-send, inference, computer).
 * 5. Honest availability projections: includes observation timestamp, explicitly rejects completion implication.
 * 6. Hardened queries: enforces project, workspace, qualification, availability, and observation freshness.
 */

import {
  SCHEMA_VERSIONS,
  validateWorkerManifest,
  createWorkerManifest,
  deepClone,
  deepFreeze,
  IfzValidationError,
  IfzConflictError,
  WORKER_AVAILABILITY_STATUSES
} from './contracts.js';

export class WorkerRegistry {
  #workers = new Map();

  /**
   * Registers a new worker manifest.
   * Rejects duplicate worker identities.
   *
   * @param {object} manifestInput
   * @returns {object} Deeply frozen public WorkerManifest copy
   */
  register(manifestInput) {
    const candidate = (manifestInput && typeof manifestInput === 'object' && !Array.isArray(manifestInput) && !manifestInput.schemaVersion)
      ? createWorkerManifest(manifestInput)
      : validateWorkerManifest(manifestInput, { throwOnError: true });

    if (this.#workers.has(candidate.workerId)) {
      throw new IfzConflictError(
        `Worker '${candidate.workerId}' is already registered; use replace() for exact-revision updates`,
        { workerId: candidate.workerId }
      );
    }

    const record = deepFreeze(deepClone(candidate));
    this.#workers.set(candidate.workerId, record);
    return deepFreeze(deepClone(record));
  }

  /**
   * Replaces an existing worker manifest with exact revision gating.
   *
   * @param {object} manifestInput
   * @param {number} exactPreviousRevision - Expected revision currently in registry
   * @returns {object} Deeply frozen updated WorkerManifest copy
   */
  replace(manifestInput, exactPreviousRevision) {
    if (typeof exactPreviousRevision !== 'number' || !Number.isSafeInteger(exactPreviousRevision) || exactPreviousRevision < 1) {
      throw new IfzValidationError('exactPreviousRevision must be a positive safe integer');
    }

    const candidate = (manifestInput && typeof manifestInput === 'object' && !Array.isArray(manifestInput) && !manifestInput.schemaVersion)
      ? {
          schemaVersion: SCHEMA_VERSIONS.WORKER_MANIFEST,
          limits: { maxConcurrency: 1, maxDurationMs: 60000 },
          ...manifestInput
        }
      : manifestInput;
    const validated = validateWorkerManifest(candidate, { throwOnError: true });
    const existing = this.#workers.get(validated.workerId);

    if (!existing) {
      throw new IfzValidationError(`Worker '${validated.workerId}' is not registered; cannot replace`);
    }

    if (existing.revision !== exactPreviousRevision) {
      throw new IfzConflictError(
        `Revision conflict for worker '${validated.workerId}': expected ${exactPreviousRevision}, but current revision is ${existing.revision}`,
        { workerId: validated.workerId, expectedRevision: exactPreviousRevision, currentRevision: existing.revision }
      );
    }

    if (validated.revision <= exactPreviousRevision) {
      throw new IfzValidationError(
        `New manifest revision (${validated.revision}) must be strictly greater than previous revision (${exactPreviousRevision})`
      );
    }

    const record = deepFreeze(deepClone(validated));
    this.#workers.set(validated.workerId, record);
    return deepFreeze(deepClone(record));
  }

  /**
   * Checks whether a worker is registered.
   * @param {string} workerId
   * @returns {boolean}
   */
  has(workerId) {
    return typeof workerId === 'string' && this.#workers.has(workerId);
  }

  /**
   * Returns the count of registered workers.
   * @returns {number}
   */
  count() {
    return this.#workers.size;
  }

  /**
   * Retrieves an immutable copy of a worker manifest.
   * @param {string} workerId
   * @returns {object|null}
   */
  get(workerId) {
    if (typeof workerId !== 'string') return null;
    const worker = this.#workers.get(workerId);
    if (!worker) return null;
    return deepFreeze(deepClone(worker));
  }

  /**
   * Unregisters a worker.
   * @param {string} workerId
   * @returns {boolean}
   */
  unregister(workerId) {
    if (typeof workerId !== 'string') return false;
    return this.#workers.delete(workerId);
  }

  #matchesQualification(workerQual = {}, filterQual) {
    if (!filterQual) return true;

    const workerRoles = new Set(workerQual.roles || []);
    const workerCerts = new Set(workerQual.certifications || []);
    const workerTags = new Set(workerQual.tags || []);
    const allQualifications = new Set([...workerRoles, ...workerCerts, ...workerTags]);

    if (typeof filterQual === 'string') {
      return allQualifications.has(filterQual) || workerQual.level === filterQual;
    }

    if (Array.isArray(filterQual)) {
      return filterQual.every(q => allQualifications.has(q));
    }

    if (typeof filterQual === 'object') {
      if (Array.isArray(filterQual.roles) && !filterQual.roles.every(r => workerRoles.has(r))) {
        return false;
      }
      if (Array.isArray(filterQual.certifications) && !filterQual.certifications.every(c => workerCerts.has(c))) {
        return false;
      }
      if (Array.isArray(filterQual.tags) && !filterQual.tags.every(t => workerTags.has(t))) {
        return false;
      }
      if (filterQual.level && workerQual.level !== filterQual.level) {
        return false;
      }
      return true;
    }

    return false;
  }

  #matchesFreshness(worker, maxAgeMs, now = Date.now()) {
    if (maxAgeMs === undefined || maxAgeMs === null) return true;
    if (typeof maxAgeMs !== 'number' || maxAgeMs < 0) return false;

    const observedAt = worker.observation?.observedAt ?? worker.availability?.observedAt;
    if (typeof observedAt !== 'number' || observedAt <= 0) return false;

    return (now - observedAt) <= maxAgeMs;
  }

  /**
   * Lists registered worker manifests matching optional filters.
   * Returns array of immutable copies.
   *
   * @param {object} [filter]
   * @param {string} [filter.workerType]
   * @param {string} [filter.adapterId]
   * @param {string} [filter.projectId]
   * @param {string} [filter.workspaceId]
   * @param {string|Array<string>} [filter.availabilityStatus]
   * @param {string|Array<string>} [filter.status]
   * @param {string} [filter.hasEffect]
   * @param {string|Array<string>|object} [filter.qualification]
   * @param {number} [filter.observationFreshnessMs]
   * @param {number} [filter.maxAgeMs]
   * @param {number} [filter.now]
   * @returns {Array<object>}
   */
  list(filter = {}) {
    const results = [];
    const expectedStatus = filter.availabilityStatus || filter.status;
    const maxAgeMs = filter.observationFreshnessMs ?? filter.maxAgeMs ?? filter.freshnessMs;

    for (const worker of this.#workers.values()) {
      if (filter.workerType && worker.workerType !== filter.workerType) continue;
      if (filter.adapterId && worker.adapterId !== filter.adapterId) continue;
      if (filter.projectId && worker.projectId !== filter.projectId) continue;
      if (filter.workspaceId && worker.workspaceId !== filter.workspaceId) continue;

      if (expectedStatus) {
        const workerStatus = worker.observation?.status ?? worker.availability?.status;
        if (Array.isArray(expectedStatus)) {
          if (!expectedStatus.includes(workerStatus)) continue;
        } else if (workerStatus !== expectedStatus) {
          continue;
        }
      }

      if (filter.hasEffect && !worker.capabilities?.effects?.includes(filter.hasEffect)) {
        continue;
      }

      if (filter.qualification && !this.#matchesQualification(worker.qualification, filter.qualification)) {
        continue;
      }

      if (maxAgeMs !== undefined && !this.#matchesFreshness(worker, maxAgeMs, filter.now)) {
        continue;
      }

      results.push(deepFreeze(deepClone(worker)));
    }
    return results;
  }

  /**
   * Queries workers satisfying requested capabilities, project/workspace,
   * qualification, availability, and observation freshness.
   *
   * @param {object} query
   * @param {string} [query.projectId]
   * @param {string} [query.workspaceId]
   * @param {Array<string>} [query.effects] - Required effect classes (worker must support all)
   * @param {Array<string>} [query.actions] - Required action names (worker must support all)
   * @param {Array<string>} [query.contextTypes] - Required context types (worker must support all)
   * @param {boolean} [query.canDelegate] - Requires delegation support
   * @param {boolean} [query.supportsCancellation] - Requires cancellation support
   * @param {boolean} [query.supportsResume] - Requires resume support
   * @param {string|Array<string>|object} [query.qualification]
   * @param {string|Array<string>} [query.availabilityStatus]
   * @param {string|Array<string>} [query.status]
   * @param {number} [query.observationFreshnessMs]
   * @param {number} [query.maxAgeMs]
   * @param {number} [query.now]
   * @returns {Array<object>} Matching immutable worker manifests
   */
  queryCapabilities(query = {}) {
    const results = [];
    const expectedStatus = query.availabilityStatus || query.status;
    const maxAgeMs = query.observationFreshnessMs ?? query.maxAgeMs ?? query.freshnessMs;

    for (const worker of this.#workers.values()) {
      if (query.projectId && worker.projectId !== query.projectId) continue;
      if (query.workspaceId && worker.workspaceId !== query.workspaceId) continue;

      if (expectedStatus) {
        const workerStatus = worker.observation?.status ?? worker.availability?.status;
        if (Array.isArray(expectedStatus)) {
          if (!expectedStatus.includes(workerStatus)) continue;
        } else if (workerStatus !== expectedStatus) {
          continue;
        }
      }

      if (query.qualification && !this.#matchesQualification(worker.qualification, query.qualification)) {
        continue;
      }

      if (maxAgeMs !== undefined && !this.#matchesFreshness(worker, maxAgeMs, query.now)) {
        continue;
      }

      const caps = worker.capabilities || {};

      if (Array.isArray(query.effects) && query.effects.length > 0) {
        const workerEffects = new Set(caps.effects || []);
        const hasAllEffects = query.effects.every(eff => workerEffects.has(eff));
        if (!hasAllEffects) continue;
      }

      if (Array.isArray(query.actions) && query.actions.length > 0) {
        const workerActions = new Set(caps.actions || []);
        const hasAllActions = query.actions.every(act => workerActions.has(act));
        if (!hasAllActions) continue;
      }

      if (Array.isArray(query.contextTypes) && query.contextTypes.length > 0) {
        const workerContext = new Set(caps.contextTypes || []);
        const hasAllContext = query.contextTypes.every(ctx => workerContext.has(ctx));
        if (!hasAllContext) continue;
      }

      if (query.canDelegate === true && (caps.canDelegate !== true && worker.delegation?.canDelegate !== true)) {
        continue;
      }

      if (query.supportsCancellation === true && caps.supportsCancellation !== true) {
        continue;
      }

      if (query.supportsResume === true && caps.supportsResume !== true) {
        continue;
      }

      results.push(deepFreeze(deepClone(worker)));
    }
    return results;
  }

  /**
   * Unified query method supporting both capability and filtering criteria.
   * @param {object} criteria
   * @returns {Array<object>}
   */
  query(criteria = {}) {
    return this.queryCapabilities(criteria);
  }

  /**
   * Projects worker availability.
   * Availability includes observation timestamp and explicitly cannot imply task completion.
   *
   * @param {string} workerId
   * @returns {object} Immutable availability projection
   */
  getAvailability(workerId) {
    if (typeof workerId !== 'string') {
      throw new IfzValidationError('workerId must be a non-empty string');
    }
    const worker = this.#workers.get(workerId);
    if (!worker) {
      throw new IfzValidationError(`Worker '${workerId}' is not registered`);
    }

    const avail = worker.observation || worker.availability || {};
    const status = avail.status || 'unavailable';
    const isAvailable = status === 'available' || status === 'idle';

    return deepFreeze({
      workerId: worker.workerId,
      status,
      observedAt: avail.observedAt,
      isAvailable,
      canAcceptTask: isAvailable,
      impliesCompletion: false
    });
  }

  /**
   * Updates worker availability with verified observation timestamp.
   * Fails closed if status implies task completion.
   *
   * @param {string} workerId
   * @param {object} params
   * @param {string} params.status - Availability status
   * @param {number} [params.observedAt=Date.now()] - Timestamp of observation
   * @returns {object} Updated immutable availability projection
   */
  updateAvailability(workerId, params = {}) {
    if (typeof workerId !== 'string') {
      throw new IfzValidationError('workerId must be a non-empty string');
    }
    const worker = this.#workers.get(workerId);
    if (!worker) {
      throw new IfzValidationError(`Worker '${workerId}' is not registered`);
    }

    const status = params.status;
    if (typeof status !== 'string' || !WORKER_AVAILABILITY_STATUSES.includes(status)) {
      throw new IfzValidationError(
        `Invalid availability status '${status}'; allowed: ${WORKER_AVAILABILITY_STATUSES.join(', ')}; task completion cannot be implied`
      );
    }

    const observedAt = params.observedAt ?? Date.now();
    if (typeof observedAt !== 'number' || !Number.isSafeInteger(observedAt) || observedAt < 1) {
      throw new IfzValidationError('observedAt must be a positive integer timestamp');
    }

    const updated = deepClone(worker);
    updated.observation = {
      status,
      observedAt
    };
    updated.availability = {
      status,
      observedAt
    };

    const record = deepFreeze(updated);
    this.#workers.set(workerId, record);

    return this.getAvailability(workerId);
  }
}
