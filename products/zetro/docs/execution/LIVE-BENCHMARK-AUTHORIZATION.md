# Synthetic provider benchmark authorization

Date: 2026-10-17. Authority: the user's direct request in this chat.

The user supplied available API keys and authorized small free tests to compare providers for RCT.
This authorizes one bounded synthetic benchmark campaign, not general repository-source transmission.

Present key fields: GROQ_API_KEY, OPENROUTER_API_KEY, and HF_TOKEN.
Other provider fields are empty. Do not request unavailable paid keys.
Never print, log, forward, or persist credential values in benchmark artifacts.
Only the benchmark harness may load credentials internally for their intended provider endpoints.

The delegated benchmark uses a frozen copy of the existing RCT runtime.
It compares Groq GPT-OSS 120B and 20B, plus up to two discovered zero-price OpenRouter tool models.
Use two small generated public file-edit fixtures and up to three trials per model and fixture.
Limits: 24 trials, 60 inference requests, 25,000 input tokens, and 6,000 output tokens for the campaign.
Each trial is bounded by three turns, 2,000 input tokens, 400 output tokens, and 30 seconds.
Counters use measured provider usage. Unknown usage is recorded rather than reported as zero cost or efficiency.
Stop a provider on authentication, quota, paid-eligibility, or uncertain-cost failure.
No credit purchases, provider-key rotation, paid fallback, or repository-source prompts.

Hugging Face receives an authentication check only. Its documented free-account credit status excludes inference here.
Missing providers remain untested. No keys are copied to Antigravity conversations.
The general configuration remains offline until separately changed through the approved integration path.

Results belong in docs/verification/2026-10-17-provider-benchmark.json and .md.
Rank verified results first, then total usage and time including failed attempts.
Any winner is provisional for these tiny fixtures until broader representative tasks pass.
Do not launch a duplicate campaign from the heartbeat while this benchmark is in progress.
