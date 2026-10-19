export const requirements = [
  ['R01', 'A task that survives a restart', 'Lifecycle', 'reviewed', 'Durable tasks, attempts, events and cancellation have passed scoped offline reviews.'],
  ['R02', 'Tools with clear boundaries', 'Tools', 'reviewed', 'File editing, checks and read-only Git have verified scope and output-budget increments.'],
  ['R03', 'Permission at every effect', 'Authority', 'progress', 'Root-bound grants are reviewed. Immutable admission still needs full integration.'],
  ['R04', 'Context that stays useful', 'Context', 'planned', 'Connect context budgets, compaction and preserved constraints to the complete agent.'],
  ['R05', 'Bounded work and repair', 'Execution', 'reviewed', 'Offline execution and repair have passed the integrated synthetic workflow.'],
  ['R06', 'Proof beyond the worker’s claim', 'Verification', 'progress', 'Independent verification exists; exact evidence bindings remain under review.'],
  ['R07', 'A patch you can trust', 'Review', 'progress', 'Patch export and durable review must reject stale sources and unrelated evidence.'],
  ['R08', 'Apply with your approval', 'Apply', 'planned', 'Safe apply is unavailable until baseline, digest and recovery gates pass.'],
  ['R09', 'A qualified free provider', 'Providers', 'progress', 'OpenRouter / Cohere is a provisional candidate. Live qualification is pending.'],
  ['R10', 'Usage with nothing hidden', 'Efficiency', 'reviewed', 'Reviewed increments retain retries, failed requests, unknown usage and cancellation costs.'],
  ['R11', 'See what is really happening', 'Experience', 'progress', 'This preview shows saved evidence. Authenticated task controls come next.'],
  ['R12', 'Scale after one works', 'Concurrency', 'planned', 'Qualify one complete worker before measured two- and five-worker execution.'],
  ['R13', 'Research and extensions', 'Extensions', 'planned', 'Bounded research, MCP and delegation must preserve authority and data scope.'],
  ['R14', 'Ready on your machine', 'Release', 'planned', 'A clean install, supported runtime, packaged desktop app and final end-to-end checks remain.']
].map(([id, title, area, state, detail]) => ({ id, title, area, state, detail }));
