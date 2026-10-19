# AGR-5 IFZ Work page rework 2

Focused tests pass, but independent UI review found four remaining truthful-default violations. Fix only your Work page/model/CSS/tests.

- DEFAULT_UNVERIFIED_STATE must not invent "Default Workspace" or claim "Bounded to current workspace" without admitted workspace evidence. Use neutral unavailable wording/null.
- Manual mode with zero selected workers must be invalid and disable/reject send. Never silently fall back to AGR-1.
- Empty-state example cards must be clearly labeled examples or remove exact AGR/RCT/OCR route claims until a real planner supplies evidence.
- Ensure the page renders no connected/worker/route claims from the default no-fixture state.
Add focused tests for all four. Preserve dev-only fixtures, SVG icons, deterministic clock/IDs, IFZ recipient and dry-run boundary. Append exact results to your receipt.
