# @zetro/provider-config

Dependency-free, secret-safe provider configuration loader and doctor CLI for ZETRO.

## Features

- **Dependency-Free**: Implemented entirely with Node.js built-ins (`node:fs`, `node:path`, `node:process`, `node:util`).
- **WeakMap Credential Isolation**: Zero secret storage properties or symbols on configuration objects. Credentials are held exclusively in a module-scoped `WeakMap`, ensuring that `util.inspect(config, { showHidden: true })`, `Object.getOwnPropertySymbols()`, and `JSON.stringify()` never expose API keys.
- **Fail-Closed Strict Booleans**: Evaluates `'1'`, `'true'`, `1`, and `true` as `true`; `'0'`, `'false'`, `0`, and `false` as `false`. Malformed or unrecognized flag values (e.g. `ZETRO_FREE_ONLY=typo`) retain restrictive safe defaults and block readiness (`mode: 'invalid-config'`).
- **Complete Numeric Parsing**: Rejects partial strings (`'1abc'`), non-finite values (`NaN`, `Infinity`), and negative numbers. Enforces bounded worker concurrency `[1, 5]` and zero-cost ceiling under free-only policy.
- **Canonical Names & Strict Precedence**:
  - `ZETRO_PROVIDER` (default `'fake'`)
  - `ZETRO_LIVE_INFERENCE_ENABLED` (canonical false overrides any legacy alias)
  - `ZETRO_ALLOW_REMOTE_SOURCE` (canonical false overrides any legacy alias)
  - `ZETRO_APPROVED_PROVIDERS` (provider-specific list; mismatch blocks readiness)
  - `ZETRO_MAX_CONCURRENT_WORKERS` (bounded integer)
  - `ZETRO_FREE_ONLY` (default true)
  - `ZETRO_MODEL`
- **Model Catalog Verification (No Fake Proof)**: Distinguishes requested policy from verified model eligibility. Verifies models against official free tier catalogs (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `glm-5.3-flash-free`, `deepseek-v4.1-flash-free`, `:free` variants). Definitely-paid models (e.g. `openai/gpt-4o`) fail catalog verification and block live readiness.
- **Doctor Diagnostic CLI**: Standalone `zetro-provider-doctor` executable reporting independent checks for configuration integrity, provider selection, model catalog verification, free-only policy, concurrency, and readiness.

## Usage

### Programmatic API

```javascript
import { loadProviderConfig, getDoctorReport } from '@zetro/provider-config';

// Load active configuration (respects process.env and optional synthetic .env files)
const config = loadProviderConfig();

// Inspect safe public configuration
console.log(config.getPublicConfig());

// Internal runtime secret retrieval (accessible exclusively via runtime method)
const apiKey = config.getApiKey('groq');
```

### CLI Doctor

```bash
# Human-readable diagnostic checklist
npm run doctor:provider
# or: npx zetro-provider-doctor

# Machine-readable JSON output
npm run doctor:provider -- --json
```
