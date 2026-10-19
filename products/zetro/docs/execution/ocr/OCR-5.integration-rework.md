Actual integration review: all four tests in actual-integration.test.js FAIL.
Happy path fails at actual-integration.js:286: stop failed: session_stopped.
Negative suite at line405 expects session_revoked but receives undefined during authority-await revocation.
Read actual ComputerSession response and lifecycle semantics. Adapt only the conformance harness.
Use explicit authority-start/release/completion barriers. Assert terminal state and zero observer effects after revocation.
Handle already stopped sessions honestly. Do not suppress assertions or replace actual packages with fake implementations.
Keep actual imports. No sibling edits, environment, network or shell. Maximum10 tool calls.
Mark tests NOT RUN for coordinator rerun and update your receipt.
