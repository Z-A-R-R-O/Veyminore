export class ModelContractError extends Error {
  constructor(message, errors = [], contract = 'computer-session-model.v0') {
    super(message);
    this.name = 'ModelContractError';
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.contract = contract;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ModelContractError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      contract: this.contract,
      errors: this.errors
    };
  }
}

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ERRORS = 20;

export const SESSION_STATES = Object.freeze({
  OFF: 'off',
  OBSERVING: 'observing',
  REQUESTING_CONTROL: 'requesting_control',
  ACTING: 'acting',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  DISCONNECTED: 'disconnected',
  EXPIRED: 'expired'
});

export const SESSION_EVENT_TYPES = Object.freeze({
  OBSERVATION_STARTED: 'observation_started',
  CONTROL_REQUESTED: 'control_requested',
  CONTROL_GRANTED: 'control_granted',
  CONTROL_DENIED: 'control_denied',
  AUTHORITY_REVOKED: 'authority_revoked',
  AUTHORITY_RESTORED: 'authority_restored',
  SESSION_PAUSED: 'session_paused',
  SESSION_RESUMED: 'session_resumed',
  SESSION_STOPPED: 'session_stopped',
  SESSION_EXPIRED: 'session_expired',
  DISCONNECTED: 'disconnected',
  CONNECTION_RESTORED: 'connection_restored'
});

const EVENT_KEYS = ['type', 'sessionId', 'targetId', 'sequence', 'timestamp', 'authorityGranted'];
const MODEL_KEYS = [
  'sessionId',
  'targetId',
  'sequence',
  'timestamp',
  'expiry',
  'authorityGranted',
  'observationOnly',
  'simulation',
  'nativeAccess',
  'status',
  'actingTargetId',
  'captureIndicator'
];
const TERMINAL_STATES = [SESSION_STATES.STOPPED, SESSION_STATES.EXPIRED];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEpochMs(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isId(value) {
  return typeof value === 'string' && ID_REGEX.test(value);
}

function push(errors, message) {
  if (errors.length < MAX_ERRORS) {
    errors.push(message);
  }
}

function sameKeys(value, allowed) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) {
    return false;
  }
  return keys.every(key => allowed.includes(key));
}

export function isSessionViewModel(value) {
  if (!isPlainObject(value) || !sameKeys(value, MODEL_KEYS)) {
    return false;
  }
  if (!isId(value.sessionId) || !isId(value.targetId)) {
    return false;
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) {
    return false;
  }
  if (!isEpochMs(value.timestamp) || !isEpochMs(value.expiry)) {
    return false;
  }
  if (typeof value.authorityGranted !== 'boolean') {
    return false;
  }
  if (typeof value.observationOnly !== 'boolean') {
    return false;
  }
  if (typeof value.simulation !== 'boolean') {
    return false;
  }
  if (value.nativeAccess !== false) {
    return false;
  }
  if (typeof value.status !== 'string' || !Object.values(SESSION_STATES).includes(value.status)) {
    return false;
  }
  if (value.actingTargetId !== null && !isId(value.actingTargetId)) {
    return false;
  }
  if (typeof value.captureIndicator !== 'boolean') {
    return false;
  }
  return true;
}

export function createSessionViewModel(config) {
  if (!isPlainObject(config)) {
    throw new ModelContractError('config must be a plain object', ['config must be a plain object']);
  }
  const errors = [];
  for (const key of Object.keys(config)) {
    if (!MODEL_KEYS.includes(key) || key === 'nativeAccess' || key === 'status' || key === 'actingTargetId' || key === 'captureIndicator') {
      if (!['sessionId','targetId','sequence','timestamp','expiry','authorityGranted','observationOnly','simulation'].includes(key)) {
        push(errors, `unknown field '${key}' is not allowed`);
      }
    }
  }
  if (!isId(config.sessionId)) {
    push(errors, 'sessionId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!isId(config.targetId)) {
    push(errors, 'targetId must be a string matching ^[a-zA-Z0-9_-]{1,64}$');
  }
  if (!Number.isSafeInteger(config.sequence) || config.sequence < 0) {
    push(errors, 'sequence must be a non-negative safe integer');
  }
  if (!isEpochMs(config.timestamp)) {
    push(errors, 'timestamp must be a positive finite epoch ms integer');
  }
  if (!isEpochMs(config.expiry)) {
    push(errors, 'expiry must be a positive finite epoch ms integer');
  }
  if (typeof config.authorityGranted !== 'boolean') {
    push(errors, 'authorityGranted must be a boolean');
  }
  if (typeof config.observationOnly !== 'boolean') {
    push(errors, 'observationOnly must be a boolean');
  }
  if (config.simulation !== undefined && typeof config.simulation !== 'boolean') {
    push(errors, 'simulation must be a boolean');
  }
  if (errors.length > 0) {
    throw new ModelContractError(
      `Validation failed for computer-session-model: ${errors.join('; ')}`,
      errors
    );
  }

  const expired = config.timestamp >= config.expiry;
  return Object.freeze({
    sessionId: config.sessionId,
    targetId: config.targetId,
    sequence: config.sequence,
    timestamp: config.timestamp,
    expiry: config.expiry,
    authorityGranted: expired ? false : config.authorityGranted,
    observationOnly: config.observationOnly,
    simulation: config.simulation === undefined ? false : config.simulation,
    nativeAccess: false,
    status: expired ? SESSION_STATES.EXPIRED : SESSION_STATES.OFF,
    actingTargetId: null,
    captureIndicator: false
  });
}

function grantControl(model) {
  if (model.observationOnly) {
    return { error: 'observation-only session cannot be granted control' };
  }
  if (model.authorityGranted !== true) {
    return { error: 'session configuration does not allow authority (authorityGranted must be true)' };
  }
  return {
    next: {
      status: SESSION_STATES.ACTING,
      authorityGranted: true,
      actingTargetId: model.targetId,
      captureIndicator: model.captureIndicator
    }
  };
}

function requestControl(model) {
  if (model.observationOnly) {
    return { error: 'observation-only session cannot request control' };
  }
  return { next: { status: SESSION_STATES.REQUESTING_CONTROL } };
}

function revoked(statusOverride) {
  return model => ({
    next: {
      status: statusOverride === undefined ? model.status : statusOverride,
      authorityGranted: false,
      actingTargetId: null,
      captureIndicator: false
    }
  });
}

function stopped() {
  return {
    next: {
      status: SESSION_STATES.STOPPED,
      authorityGranted: false,
      actingTargetId: null,
      captureIndicator: false
    }
  };
}

function disconnected() {
  return {
    next: {
      status: SESSION_STATES.DISCONNECTED,
      authorityGranted: false,
      actingTargetId: null,
      captureIndicator: false
    }
  };
}

function transition(model, type) {
  if (type === SESSION_EVENT_TYPES.AUTHORITY_RESTORED) {
    return { next: { authorityGranted: true } };
  }
  const state = model.status;
  if (state === SESSION_STATES.OFF) {
    if (type === SESSION_EVENT_TYPES.OBSERVATION_STARTED) {
      return { next: { status: SESSION_STATES.OBSERVING, captureIndicator: true } };
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
    if (type === SESSION_EVENT_TYPES.DISCONNECTED) {
      return disconnected();
    }
  } else if (state === SESSION_STATES.OBSERVING) {
    if (type === SESSION_EVENT_TYPES.OBSERVATION_STARTED) {
      return { next: { status: SESSION_STATES.OBSERVING, captureIndicator: true } };
    }
    if (type === SESSION_EVENT_TYPES.CONTROL_REQUESTED) {
      return requestControl(model);
    }
    if (type === SESSION_EVENT_TYPES.CONTROL_GRANTED) {
      return grantControl(model);
    }
    if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      return revoked()(model);
    }
    if (type === SESSION_EVENT_TYPES.SESSION_PAUSED) {
      return { next: { status: SESSION_STATES.PAUSED } };
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
    if (type === SESSION_EVENT_TYPES.DISCONNECTED) {
      return disconnected();
    }
  } else if (state === SESSION_STATES.REQUESTING_CONTROL) {
    if (type === SESSION_EVENT_TYPES.CONTROL_GRANTED) {
      return grantControl(model);
    }
    if (type === SESSION_EVENT_TYPES.CONTROL_DENIED) {
      return { next: { status: SESSION_STATES.OBSERVING } };
    }
    if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      return revoked(SESSION_STATES.OBSERVING)(model);
    }
    if (type === SESSION_EVENT_TYPES.SESSION_PAUSED) {
      return { next: { status: SESSION_STATES.PAUSED } };
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
    if (type === SESSION_EVENT_TYPES.DISCONNECTED) {
      return disconnected();
    }
  } else if (state === SESSION_STATES.ACTING) {
    if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      return revoked(SESSION_STATES.OBSERVING)(model);
    }
    if (type === SESSION_EVENT_TYPES.SESSION_PAUSED) {
      return { next: { status: SESSION_STATES.PAUSED } };
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
    if (type === SESSION_EVENT_TYPES.DISCONNECTED) {
      return disconnected();
    }
  } else if (state === SESSION_STATES.PAUSED) {
    if (type === SESSION_EVENT_TYPES.SESSION_RESUMED) {
      return {
        next: {
          status: model.actingTargetId !== null
            ? SESSION_STATES.ACTING
            : SESSION_STATES.OBSERVING
        }
      };
    }
    if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      return revoked()(model);
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
    if (type === SESSION_EVENT_TYPES.DISCONNECTED) {
      return disconnected();
    }
  } else if (state === SESSION_STATES.DISCONNECTED) {
    if (type === SESSION_EVENT_TYPES.CONNECTION_RESTORED) {
      return { next: { status: SESSION_STATES.OFF } };
    }
    if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      return revoked()(model);
    }
    if (type === SESSION_EVENT_TYPES.SESSION_STOPPED) {
      return stopped();
    }
  }
  return { error: `event '${type}' is not allowed in state '${state}'` };
}

function expired() {
  return {
    status: SESSION_STATES.EXPIRED,
    authorityGranted: false,
    actingTargetId: null,
    captureIndicator: false
  };
}

export function reduceSessionEvent(model, event, options = {}) {
  const errors = [];
  const fail = () => Object.freeze({ ok: false, model, errors: Object.freeze([...errors]) });
  const pass = next =>
    Object.freeze({ ok: true, model: Object.freeze(next), errors: Object.freeze([]) });

  if (!isSessionViewModel(model)) {
    push(errors, 'model is not a valid session view model');
    return fail();
  }
  if (!isPlainObject(event)) {
    push(errors, 'event must be a plain object');
    return fail();
  }
  for (const key of Object.keys(event)) {
    if (!EVENT_KEYS.includes(key)) {
      push(errors, `unknown field '${key}' is not allowed`);
    }
  }
  for (const key of Object.keys(options)) {
    if (key !== 'now') {
      push(errors, `unknown option '${key}' is not allowed`);
    }
  }
  if (
    typeof event.type !== 'string' ||
    !Object.values(SESSION_EVENT_TYPES).includes(event.type)
  ) {
    push(errors, `event.type must be one of: ${Object.values(SESSION_EVENT_TYPES).join(', ')}`);
  }
  if (event.sessionId !== model.sessionId) {
    push(errors, `sessionId mismatch: event '${event.sessionId}' vs model '${model.sessionId}'`);
  }
  if (event.targetId !== model.targetId) {
    push(errors, `targetId mismatch: event '${event.targetId}' vs model '${model.targetId}'`);
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 0) {
    push(errors, 'sequence must be a non-negative safe integer');
  } else if (event.sequence <= model.sequence) {
    push(errors, `sequence ${event.sequence} is not greater than current ${model.sequence}`);
  }
  if (!isEpochMs(event.timestamp)) {
    push(errors, 'timestamp must be a positive finite epoch ms integer');
  } else {
    if (event.timestamp < model.timestamp) {
      push(errors, `timestamp ${event.timestamp} is older than current ${model.timestamp}`);
    }
    if (options.now !== undefined) {
      if (!isEpochMs(options.now)) {
        push(errors, 'now must be a positive finite epoch ms integer');
      } else if (event.timestamp > options.now) {
        push(errors, `timestamp ${event.timestamp} is beyond the supplied now ${options.now}`);
      }
    }
  }

  const type = event.type;
  const isKnownType = Object.values(SESSION_EVENT_TYPES).includes(type);
  const isAuthorityEvent =
    type === SESSION_EVENT_TYPES.CONTROL_GRANTED ||
    type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED ||
    type === SESSION_EVENT_TYPES.AUTHORITY_RESTORED;
  if (isKnownType && isAuthorityEvent) {
    if (typeof event.authorityGranted !== 'boolean') {
      push(errors, `${type} requires an explicit boolean authorityGranted`);
    } else if (type === SESSION_EVENT_TYPES.AUTHORITY_REVOKED) {
      if (event.authorityGranted !== false) {
        push(errors, 'authority_revoked requires authorityGranted === false');
      }
    } else if (event.authorityGranted !== true) {
      push(
        errors,
        `${type} requires authorityGranted === true (explicit authority input; never derived from a button press)`
      );
    }
  } else if (event.authorityGranted !== undefined) {
    push(
      errors,
      'authorityGranted is only allowed on control_granted/authority_restored/authority_revoked events'
    );
  }

  if (errors.length > 0) {
    return fail();
  }

  if (model.status === SESSION_STATES.STOPPED || model.status === SESSION_STATES.EXPIRED) {
    push(errors, `event rejected: session is ${model.status} (terminal)`);
    return fail();
  }

  const base = { ...model, sequence: event.sequence, timestamp: event.timestamp };

  if (type === SESSION_EVENT_TYPES.SESSION_EXPIRED || event.timestamp >= model.expiry) {
    return pass({ ...base, ...expired() });
  }

  const result = transition(model, type);
  if (result.error) {
    push(errors, result.error);
    return fail();
  }
  return pass({ ...base, ...result.next });
}
