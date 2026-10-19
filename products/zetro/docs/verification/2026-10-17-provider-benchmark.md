# Public synthetic provider benchmark: 2026-10-17

## Decision

OpenRouter Cohere is the only tested candidate with verified results. It is not ready as a general RCT default.

The corrected request passed the numeric fixture three times. It failed the greeting fixture three times. This sample cannot establish a broad model winner.

## Access checks

| Provider | Result | Inference |
| --- | --- | --- |
| Groq | HTTP401 on model listing | None. Both GPT-OSS models remain untested. |
| OpenRouter | Authenticated, free tier, 50 free requests remaining at initial check | Pinned zero-price models only |
| Hugging Face | Authenticated | None |

Hugging Face currently lists no monthly inference credits for free accounts. See [official pricing](https://huggingface.co/docs/inference-providers/pricing).

## Method

The harness copied legacy RCT source into a private temporary directory before import. The JSON report records each source hash.

Each trial used a fresh source fixture and an isolated RCT snapshot. The worker used read_slice and propose_patch.

Independent equals checks determined success. Auto-finalization removed a redundant receipt call. Every trial also checked that original source bytes remained unchanged.

The greeting fixture changed hello to hello world. The numeric fixture changed an exported constant from 1 to 2.

Trial limits were three turns, 2,000 input tokens, 400 output tokens, and 30 seconds. Each request allowed at most 200 output tokens.

The total authorization allowed 24 trials, 60 requests, 25,000 input tokens, and 6,000 output tokens.

## Request phases

The initial 12 trials used pinned free models, zero-price routing, no fallback, and strict parameter support. All returned HTTP404.

Public endpoint metadata showed no support for parallel_tool_calls. The second phase removed that field and preserved all price guards.

Cohere then returned HTTP200. Poolside still returned HTTP404. These failures remain in the denominator.

No paid model, credential rotation, or automatic fallback was used. The [free variant documentation](https://openrouter.ai/docs/guides/routing/model-variants/free) describes availability limits.

## Results

| Pinned model | All trials verified | Corrected phase | Reported input/output tokens | Requests | Total trial wall time |
| --- | --- | --- | --- | --- | --- |
| cohere/north-mini-code:free | 3/12 | 3/6 | 3,087 / 1,240 | 18 | 22.273 seconds |
| poolside/laguna-xs-2.1:free | 0/12 | 0/6 | Unreported | 12 | 1.582 seconds |

The harness made 30 inference API requests. HTTP200 responses reported 4,327 total tokens. Eighteen HTTP404 responses did not report usage.

Cohere used 1,442.3 reported tokens per verified result, including failed trials. It used 7.424 seconds per verified result, including failures.

These token figures are reported-usage lower bounds. Unreported HTTP404 usage is not measured zero.

All 24 trials preserved original source bytes. No transport uncertainty, HTTP429, or paid-eligibility error occurred during inference.

The initial OpenRouter check showed 50 remaining free requests. No post-run quota check was made. Numeric inference rate-limit headers were absent.

## Limits and next action

The harness retained greeting errors only as worker_or_tool_error. It cannot distinguish a tool-contract error from a model error afterward.

The running second batch completed six repeated Poolside HTTP404 attempts before the coordinator stop instruction could take effect.

The full 24-trial budget is complete. No further inference calls were made.

Correct the Groq key before testing either GPT-OSS model. Do not select a Groq winner from this report.

Keep Cohere as a provisional synthetic-test candidate. Before setting a default, add safe failure classifications and verify the greeting task.

The result does not validate private-source work, general coding, computer tools, or production reliability.

See the adjacent JSON report for individual trials, frozen source hashes, request caps, and sources.

## Fixture audit

The JSON includes original bytes, expected bytes, SHA-256 hashes, exact acceptance checks, and individual trial outcomes.

Cohere median trial wall time was 1555 milliseconds across both phases. Poolside median was 115 milliseconds.

Only OpenRouter inference could be exercised. Cohere is the provisional best-tested model within this limited sample.
