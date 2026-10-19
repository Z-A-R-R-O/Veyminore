# OCR-5 task: IFZ run timeline module

Read `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`.

Own only `E:/Veyminore/products/zetro/apps/control-center/public/task-timeline/` and append a new dated IFZ section to your existing receipt.

Extend the isolated task timeline into an IFZ run timeline source module.

Requirements:

- Render user prompt reference, IFZ route plan, worker request, public status, result, verification, handoff, question, failure, cancellation, and uncertain delivery.
- Show producing and requesting worker identities.
- Keep worker claim and independent verification visually distinct.
- Support parallel branches and collapsed delegation details.
- Never render raw HTML, private reasoning, secrets, full prompt text, or unbounded tool output.
- Include empty, loading, disconnected, running, partial-failure, uncertain, cancelled, and complete fixtures.
- Use semantic markup, keyboard expansion, visible focus, and reduced motion.
- Keep source standalone. Do not integrate the live app, add dependencies, call network, or edit shared files.

Run focused tests and record exact results and browser-integration limits.

