import { fileURLToPath } from 'node:url';
import { normalize } from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AGENT_NAMES, type AgentConfig, type AgentName } from './config.js';
import { discoverEndpoints, type Endpoint } from './discovery.js';
import { resolveExecutable, runAgentApi, type AgentApiResponse } from './agentapi.js';

export interface VerifiedAgent {
  agent: AgentName;
  conversationId: string;
  projectId: string;
  workspace: string;
  connected: true;
  source: Endpoint['source'];
}

export interface AgentCheck {
  agent: AgentName;
  conversationId: string;
  connected: boolean;
  projectId?: string;
  workspace?: string;
  source?: Endpoint['source'];
  error?: string;
}

export interface AgentObservation extends AgentCheck {
  state: 'idle' | 'running' | 'unknown';
  stepCount: number;
  lastActivity?: string;
  confidence: 'diagnostic_fallback';
}

export interface SubmitResult {
  agent: AgentName;
  conversationId: string;
  delivery: 'submitted';
  verification: 'not_requested';
}

export interface AdapterOptions {
  discoveryTimeoutMs?: number;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  cacheTtlMs?: number;
}

export interface AdapterDependencies {
  discover(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Endpoint[]>;
  executable(): Promise<string>;
  run(
    executable: string,
    endpoint: Endpoint,
    command: 'get-conversation-metadata' | 'send-message',
    args: string[],
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AgentApiResponse>;
  diagnosticFallback?: (conversationId: string) => Promise<{ state: 'idle' | 'running' | 'unknown'; stepCount: number; lastActivity?: string }>;
}

const defaultDependencies: AdapterDependencies = {
  discover: discoverEndpoints,
  executable: resolveExecutable,
  run: runAgentApi,
};

function sameWorkspace(actualUri: string, expectedPath: string): boolean {
  try {
    const actual = normalize(fileURLToPath(actualUri));
    const expected = normalize(expectedPath);
    return process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  } catch {
    return false;
  }
}

function readMetadata(response: AgentApiResponse): Record<string, unknown> {
  const outer = response.response;
  if (!outer || typeof outer !== 'object') throw new Error('Missing metadata response');
  const conversation = (outer as Record<string, unknown>).conversationMetadata;
  if (!conversation || typeof conversation !== 'object') throw new Error('Missing conversation metadata');
  const metadata = (conversation as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object') throw new Error('Missing metadata body');
  return metadata as Record<string, unknown>;
}

function isTransportFailure(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  if (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return true;
  }
  return (
    msg.includes('Metadata request timed out') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('Connection refused') ||
    msg.includes('connection dropped') ||
    msg.includes('connect ECONNREFUSED') ||
    msg.includes('ETIMEDOUT')
  );
}

export class AntigravityAdapter {
  private readonly options: Required<AdapterOptions>;
  private cachedEndpoints: Endpoint[] | undefined;
  private cacheTimestamp = 0;
  private isFreshDiscovery = false;

  constructor(
    private readonly config: AgentConfig,
    private readonly deps: AdapterDependencies = defaultDependencies,
    options?: AdapterOptions,
  ) {
    const envTotal = process.env.ZETRO_ADAPTER_TOTAL_TIMEOUT_MS ? Number(process.env.ZETRO_ADAPTER_TOTAL_TIMEOUT_MS) : undefined;
    const envRequest = process.env.ZETRO_ADAPTER_REQUEST_TIMEOUT_MS ? Number(process.env.ZETRO_ADAPTER_REQUEST_TIMEOUT_MS) : undefined;
    const envDiscovery = process.env.ZETRO_ADAPTER_DISCOVERY_TIMEOUT_MS ? Number(process.env.ZETRO_ADAPTER_DISCOVERY_TIMEOUT_MS) : undefined;
    const envCacheTtl = process.env.ZETRO_ADAPTER_CACHE_TTL_MS ? Number(process.env.ZETRO_ADAPTER_CACHE_TTL_MS) : undefined;

    this.options = {
      discoveryTimeoutMs: options?.discoveryTimeoutMs ?? envDiscovery ?? 5000,
      requestTimeoutMs: options?.requestTimeoutMs ?? envRequest ?? 3000,
      totalTimeoutMs: options?.totalTimeoutMs ?? envTotal ?? 10000,
      cacheTtlMs: options?.cacheTtlMs ?? envCacheTtl ?? 30000,
    };
  }

  private async getEndpoints(signal?: AbortSignal): Promise<Endpoint[]> {
    const now = Date.now();
    if (this.cachedEndpoints && (now - this.cacheTimestamp < this.options.cacheTtlMs)) {
      this.isFreshDiscovery = false;
      return this.cachedEndpoints;
    }
    this.cachedEndpoints = await this.deps.discover({
      timeoutMs: this.options.discoveryTimeoutMs,
      signal,
    });
    this.cacheTimestamp = Date.now();
    this.isFreshDiscovery = true;
    return this.cachedEndpoints;
  }

  private invalidateCache() {
    this.cachedEndpoints = undefined;
    this.cacheTimestamp = 0;
    this.isFreshDiscovery = false;
  }

  private async verifyOn(
    endpoint: Endpoint,
    executable: string,
    agent: AgentName,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<VerifiedAgent> {
    const conversationId = this.config.agents[agent];
    const raw = await this.deps.run(
      executable,
      endpoint,
      'get-conversation-metadata',
      [conversationId],
      { timeoutMs: timeoutMs ?? this.options.requestTimeoutMs, signal },
    );
    const metadata = readMetadata(raw);
    if (metadata.rootConversationId !== conversationId) throw new Error('Root conversation ID mismatch');
    if (metadata.projectId !== this.config.projectId) throw new Error('Antigravity project ID mismatch');
    const workspaces = Array.isArray(metadata.workspaces) ? metadata.workspaces : [];
    const matched = workspaces.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const uri: unknown = (item as Record<string, unknown>).workspaceFolderAbsoluteUri;
      return typeof uri === 'string' && sameWorkspace(uri, this.config.workspace);
    });
    if (!matched) throw new Error('Antigravity workspace mismatch');
    return {
      agent,
      conversationId,
      projectId: this.config.projectId,
      workspace: this.config.workspace,
      connected: true,
      source: endpoint.source,
    };
  }

  private async findEndpoint(
    agent: AgentName,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<{ endpoint: Endpoint; executable: string; verified: VerifiedAgent }> {
    let wasFresh = false;
    let endpoints = await this.getEndpoints(signal);
    if (endpoints.length === 0) {
      if (!this.isFreshDiscovery) {
        this.invalidateCache();
        endpoints = await this.getEndpoints(signal);
        wasFresh = true;
      }
      if (endpoints.length === 0) throw new Error('No live Antigravity language server found');
    }

    const executable = await this.deps.executable();
    let lastError = 'No endpoint returned matching conversation metadata';

    for (const endpoint of endpoints) {
      if (signal?.aborted) throw new Error('Operation timed out');
      try {
        const verified = await this.verifyOn(endpoint, executable, agent, signal, timeoutMs);
        return { endpoint, executable, verified };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown connection error';
      }
    }

    // If initial endpoints were cached (not fresh in this attempt), invalidate and retry once
    if (!this.isFreshDiscovery && !wasFresh) {
      this.invalidateCache();
      endpoints = await this.getEndpoints(signal);
      for (const endpoint of endpoints) {
        if (signal?.aborted) throw new Error('Operation timed out');
        try {
          const verified = await this.verifyOn(endpoint, executable, agent, signal, timeoutMs);
          return { endpoint, executable, verified };
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown connection error';
        }
      }
    }

    throw new Error(lastError);
  }

  async verify(agent: AgentName, options?: { timeoutMs?: number }): Promise<VerifiedAgent> {
    const timeout = options?.timeoutMs ?? this.options.requestTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Operation timed out')), timeout);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      return (await this.findEndpoint(agent, controller.signal, timeout)).verified;
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyAll(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<AgentCheck[]> {
    const totalTimeoutMs = options?.timeoutMs ?? this.options.totalTimeoutMs;
    const deadline = Date.now() + totalTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Operation timed out (total timeout exceeded)'));
    }, totalTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), { once: true });
      }
    }

    try {
      let endpoints: Endpoint[];
      let executable: string;
      try {
        endpoints = await this.getEndpoints(controller.signal);
        if (endpoints.length === 0) {
          if (!this.isFreshDiscovery) {
            this.invalidateCache();
            endpoints = await this.getEndpoints(controller.signal);
          }
          if (endpoints.length === 0) throw new Error('No live Antigravity language server found');
        }
        executable = await this.deps.executable();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown connection error';
        const isAbort = controller.signal.aborted;
        return AGENT_NAMES.map((agent) => ({
          agent,
          conversationId: this.config.agents[agent],
          connected: false,
          error: isAbort ? 'Operation timed out (total timeout exceeded)' : message,
        }));
      }

      const results: AgentCheck[] = [];
      let preferred: Endpoint | undefined;
      const quarantinedEndpoints = new Set<string>();

      for (const agent of AGENT_NAMES) {
        if (controller.signal.aborted || Date.now() >= deadline) {
          results.push({
            agent,
            conversationId: this.config.agents[agent],
            connected: false,
            error: 'Operation timed out (total timeout exceeded)',
          });
          continue;
        }

        let verified: VerifiedAgent | undefined;
        let errorText = 'No endpoint returned matching conversation metadata';
        const remainingMs = Math.max(1, deadline - Date.now());
        const perAgentTimeout = Math.min(remainingMs, this.options.requestTimeoutMs);
        const agentController = new AbortController();
        const agentTimer = setTimeout(() => agentController.abort(new Error('Request timed out')), perAgentTimeout);
        if (typeof agentTimer.unref === 'function') agentTimer.unref();

        const onAbort = () => agentController.abort(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });

        try {
          const candidates = (preferred ? [preferred, ...endpoints.filter((item) => item !== preferred)] : endpoints)
            .filter((item) => !quarantinedEndpoints.has(item.address));

          if (candidates.length === 0) {
            errorText = 'No reachable endpoint for this workspace';
          }

          for (const endpoint of candidates) {
            if (agentController.signal.aborted) break;
            try {
              verified = await this.verifyOn(endpoint, executable, agent, agentController.signal, perAgentTimeout);
              preferred = endpoint;
              break;
            } catch (error) {
              errorText = error instanceof Error ? error.message : 'Unknown connection error';
              // Identity mismatches are agent-specific; quarantine ONLY genuine transport failures
              if (isTransportFailure(error)) {
                quarantinedEndpoints.add(endpoint.address);
              }
            }
          }
        } finally {
          clearTimeout(agentTimer);
          controller.signal.removeEventListener('abort', onAbort);
        }

        if (verified) {
          results.push(verified);
        } else {
          results.push({
            agent,
            conversationId: this.config.agents[agent],
            connected: false,
            error: controller.signal.aborted ? 'Operation timed out (total timeout exceeded)' : errorText,
          });
        }
      }
      return results;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readDiagnosticFallback(conversationId: string): Promise<{ state: 'idle' | 'running' | 'unknown'; stepCount: number; lastActivity?: string }> {
    try {
      // Use node:sqlite natively available in Node 22.5.0+ as a version-specific diagnostic fallback
      const { DatabaseSync } = await import('node:sqlite');
      const dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const stmt = db.prepare('SELECT status, not_fully_idle, step_count, last_modified_time FROM conversation_summaries WHERE conversation_id = ?');
      const row = stmt.get(conversationId) as { status: string; not_fully_idle: number; step_count: number; last_modified_time: string } | undefined;
      db.close();

      if (!row) return { state: 'unknown', stepCount: 0 };
      const state = row.not_fully_idle ? 'running' : 'idle';
      return { state, stepCount: row.step_count || 0, lastActivity: row.last_modified_time };
    } catch {
      return { state: 'unknown', stepCount: 0 };
    }
  }

  /**
   * Observes the state of an agent by verifying its metadata identity and reading
   * diagnostic fallbacks (like local sqlite) for state/step count within one aggregate deadline.
   * Returns explicit confidence levels since the agent API only gives identity verification.
   */
  async observe(agent: AgentName, options?: { timeoutMs?: number }): Promise<AgentObservation> {
    const totalTimeoutMs = options?.timeoutMs ?? this.options.totalTimeoutMs;
    const deadline = Date.now() + totalTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Operation timed out (total timeout exceeded)')), totalTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const remainingForVerify = Math.max(1, deadline - Date.now());
      const { verified } = await this.findEndpoint(
        agent,
        controller.signal,
        Math.min(remainingForVerify, this.options.requestTimeoutMs),
      );

      if (controller.signal.aborted || Date.now() >= deadline) {
        return {
          ...verified,
          state: 'unknown',
          stepCount: 0,
          confidence: 'diagnostic_fallback',
          error: 'Operation timed out (total timeout exceeded)',
        };
      }

      const remainingForDiag = Math.max(1, deadline - Date.now());
      let diagnostic: { state: 'idle' | 'running' | 'unknown'; stepCount: number; lastActivity?: string };
      try {
        diagnostic = await Promise.race([
          this.deps.diagnosticFallback
            ? this.deps.diagnosticFallback(verified.conversationId)
            : this.readDiagnosticFallback(verified.conversationId),
          new Promise<{ state: 'idle' | 'running' | 'unknown'; stepCount: number; lastActivity?: string }>((_, reject) => {
            const diagTimer = setTimeout(() => reject(new Error('Diagnostic timed out')), remainingForDiag);
            if (typeof diagTimer.unref === 'function') diagTimer.unref();
            controller.signal.addEventListener('abort', () => {
              clearTimeout(diagTimer);
              reject(new Error('Operation timed out'));
            }, { once: true });
          }),
        ]);
      } catch {
        diagnostic = { state: 'unknown', stepCount: 0 };
      }

      return {
        ...verified,
        state: diagnostic.state,
        stepCount: diagnostic.stepCount,
        lastActivity: diagnostic.lastActivity,
        confidence: 'diagnostic_fallback',
        error: controller.signal.aborted ? 'Operation timed out (total timeout exceeded)' : undefined,
      };
    } catch (error) {
      const isTimeout = controller.signal.aborted || (error instanceof Error && error.message.includes('timed out'));
      return {
        agent,
        conversationId: this.config.agents[agent],
        connected: false,
        state: 'unknown',
        stepCount: 0,
        confidence: 'diagnostic_fallback',
        error: isTimeout ? 'Operation timed out (total timeout exceeded)' : (error instanceof Error ? error.message : 'Unknown connection error'),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async observeAll(options?: { timeoutMs?: number }): Promise<AgentObservation[]> {
    const totalTimeoutMs = options?.timeoutMs ?? this.options.totalTimeoutMs;
    const deadline = Date.now() + totalTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Operation timed out (total timeout exceeded)'));
    }, totalTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const remainingForVerify = Math.max(1, deadline - Date.now());
      const checks = await this.verifyAll({ timeoutMs: remainingForVerify, signal: controller.signal });

      return await Promise.all(
        checks.map(async (check) => {
          if (controller.signal.aborted || Date.now() >= deadline) {
            return {
              ...check,
              state: 'unknown',
              stepCount: 0,
              confidence: 'diagnostic_fallback',
              error: check.error ?? 'Operation timed out (total timeout exceeded)',
            };
          }
          const remainingForDiag = Math.max(1, deadline - Date.now());
          try {
            const diagnostic = await Promise.race([
              this.deps.diagnosticFallback
                ? this.deps.diagnosticFallback(check.conversationId)
                : this.readDiagnosticFallback(check.conversationId),
              new Promise<{ state: 'idle' | 'running' | 'unknown'; stepCount: number; lastActivity?: string }>((_, reject) => {
                const diagTimer = setTimeout(() => reject(new Error('Diagnostic timed out')), remainingForDiag);
                if (typeof diagTimer.unref === 'function') diagTimer.unref();
                controller.signal.addEventListener('abort', () => {
                  clearTimeout(diagTimer);
                  reject(new Error('Operation timed out'));
                }, { once: true });
              }),
            ]);
            return {
              ...check,
              state: diagnostic.state,
              stepCount: diagnostic.stepCount,
              lastActivity: diagnostic.lastActivity,
              confidence: 'diagnostic_fallback',
            };
          } catch {
            return {
              ...check,
              state: 'unknown',
              stepCount: 0,
              confidence: 'diagnostic_fallback',
              error: controller.signal.aborted ? (check.error ?? 'Operation timed out (total timeout exceeded)') : check.error,
            };
          }
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async send(agent: AgentName, content: string, options?: { timeoutMs?: number }): Promise<SubmitResult> {
    if (!content.trim()) throw new Error('Message content is empty');
    if (content.length > 100_000) throw new Error('Message exceeds 100,000 characters');

    const totalTimeoutMs = options?.timeoutMs ?? (20000 + this.options.requestTimeoutMs);
    const deadline = Date.now() + totalTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Send operation timed out')), totalTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const remainingForPreflight = Math.max(1, deadline - Date.now());
      const { endpoint, executable } = await this.findEndpoint(
        agent,
        controller.signal,
        Math.min(remainingForPreflight, this.options.requestTimeoutMs),
      );

      const remainingForSend = Math.max(1, deadline - Date.now());
      try {
        const response = await this.deps.run(
          executable,
          endpoint,
          'send-message',
          [this.config.agents[agent], content],
          { timeoutMs: remainingForSend, signal: controller.signal },
        );
        if (!response || !response.response || response.error) {
          throw new Error(
            response?.error
              ? `Delivery unknown: Antigravity reported an error: ${typeof response.error === 'string' ? response.error : JSON.stringify(response.error)}`
              : 'Delivery unknown: no acknowledgement from Antigravity',
          );
        }
      } catch (error) {
        // Invalidate cache on failure just in case the endpoint died
        this.invalidateCache();
        throw error;
      }

      return {
        agent,
        conversationId: this.config.agents[agent],
        delivery: 'submitted',
        verification: 'not_requested',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
