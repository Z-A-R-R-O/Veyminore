# RCT provider research

Checked: 2026-10-17. These findings come from official documentation, not account access or performance benchmarks.
No authenticated inference calls were made. Recheck models, prices, quotas, and data terms before execution.

## Recommended evaluation order

| Order | Candidate | Current free status | RCT use |
| --- | --- | --- | --- |
| 1 | Groq | Free plan with request/token limits | Preserve existing adapter and benchmark tool reliability |
| 2 | OpenCode Console, formerly Zen | Selected free models, often limited-time | Evaluate explicitly priced-zero coding models |
| 3 | OpenRouter | Free variants with account limits | Pin tool-capable models for reproducible trials |
| 4 | Gemini Developer API | Selected models within free limits | Compare coding quality and token efficiency |
| 5 | Mistral API | Free mode with included account usage | Optional independent provider after conformance tests |
| Local | Ollama | No hosted fee for local models | Optional local path with hardware-dependent speed |

This order reflects integration effort and eligibility. It does not declare a quality winner.

## Groq

The published free table lists GPT-OSS 120B, GPT-OSS 20B, and Qwen 3.8 27B.
For GPT-OSS 120B, it shows 30 RPM, 1,000 RPD, 8,000 TPM, and 200,000 TPD.
Actual organization limits can differ. All worker slots share the account quota.
Inference content is not retained by default, with documented reliability and abuse exceptions.
Sources: [limits](https://console.groq.com/docs/rate-limits), [data](https://console.groq.com/docs/your-data).
Key: `GROQ_API_KEY`.

## OpenCode

The old Zen documentation now redirects to OpenCode Console models.
Current chat examples use `https://opencode.ai/inference/openai/v1/chat/completions`.
Free candidates include GLM-5.3-Flash Free, DeepSeek V4.1 Flash Free, and Space Bunny Free.
Free offers can end. Confirm model availability, zero pricing, and tool support before each benchmark campaign.
Data terms vary by model. Some free models permit improvement use, while selected others document zero retention.
A structured-decision model is not automatically a coding worker.
Source: [official models, pricing, and privacy](https://opencode.ai/v2/docs/console/models/).
Key: `OPENCODE_API_KEY`.

## OpenRouter

OpenRouter offers free variants and a free router. Its pricing page lists a free-plan daily allowance.
Its limits API reports account-specific free usage and remaining allowance.
The rendered limits page omits some numeric table values. Do not guess a higher quota.
Pin model and provider route for benchmarks. Verify tool support, zero pricing, and provider data terms.
Additional keys do not increase account capacity.
Sources: [pricing](https://openrouter.ai/pricing/), [limits](https://openrouter.ai/docs/api_reference/limits), [free routing](https://openrouter.ai/discover).
Key: `OPENROUTER_API_KEY`.

## Gemini

Google offers free access to selected models within account limits.
The free-tier pricing states that submitted content can be used to improve products.
Keep initial trials synthetic. Repository-source use requires an explicit provider and data choice.
Sources: [pricing](https://ai.google.dev/gemini-api/docs/pricing), [limits](https://ai.google.dev/gemini-api/docs/rate-limits).
Key: `GEMINI_API_KEY`.

## Mistral

Mistral documents Free mode with included monthly usage and per-model request/token limits.
Check the organization's Limits page for actual eligibility and capacity.
Verify data terms before repository tasks. Keep paid usage disabled.
Source: [usage and limits](https://docs.mistral.ai/admin/billing-usage/usage-limits).
Key: `MISTRAL_API_KEY`.

## Excluded from an always-free pool

Cerebras documents a $5 trial after adding a verified payment method, expiring after 30 days.
It explicitly states that no permanently renewing free tier exists.
Source: [Cerebras trial and limits](https://inference-docs.cerebras.ai/support/rate-limits).
Optional trial key: `CEREBRAS_API_KEY`.

Hugging Face currently lists no inference credits for Free Users.
Paid subscriptions and provider-specific keys use different billing rules.
Source: [Hugging Face pricing](https://huggingface.co/docs/inference-providers/pricing).
Optional token: `HF_TOKEN`.

## Local models

Ollama supports tool calls with compatible models. Performance depends on hardware and model selection.
Local models consume compute, storage, and electricity. Cloud models and web search have separate boundaries.
Source: [Ollama tool support](https://ollama.com/blog/tool-support).

## Keys and integration status

Paste selected keys into the ignored `products/zetro/.env`. Do not paste credentials into worker messages.
The adjacent `.env.example` contains names and offline defaults.
Legacy commands do not all load this file or honor the new settings yet.
The provider-loader milestone must implement these controls before general live execution.
Key presence alone never authorizes inference, paid fallback, or source transmission.
