# OCR-1 IFZ computer projection rework

Independent tests pass 28/28, but source review found two contract blockers. Correct only projection.js, projection.test.js, README, package.json if needed, and OCR-1.md.

1. Every update must carry and exactly match taskId, runId, conversationId, workerId, workspaceId, sessionId, targetId, authorityId, and observationId. Reject missing/mismatched identity before state change.
2. Terminal/expiry precedence must win over verification. An expired, stopped, cancelled, failed, or disconnected run/session cannot become verified_completion from a verification update or completion field. Change the existing expired-but-verified test, which currently asserts verified completion, to assert the terminal/uncertain projection. Add stopped/cancelled cases.
Preserve worker-report non-verification, authority confinement, privacy, deterministic clock, frozen bounded output. Run if possible or request coordinator rerun honestly.
