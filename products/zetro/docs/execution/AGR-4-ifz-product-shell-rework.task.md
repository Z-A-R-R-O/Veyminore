# AGR-4 rework: truthful shell defaults and focus behavior

Independent review rejects acceptance until these findings are fixed within your existing owned files only.

1. `projectTopMenu` treats missing `state.connected` as Connected. Missing, malformed, or stale connection evidence must display Unknown or Unavailable with no active pulse.
2. The shell invents `E:/Veyminore/products/zetro`, `workspace-local`, `Local workspace`, `initialWorkerCount=10`, and IFZ active state when the caller supplies no evidence. Use neutral Unknown or empty values. Do not show a count badge without a supplied nonnegative integer.
3. Add focused tests for omitted, false, true, malformed, and stale connection observations, omitted workspace fields, omitted worker/run counts, and explicit valid evidence.
4. Panel/menu Escape must return focus to the control that opened it. Add a focused component or reducer-level test if practical without integrating the live app.
5. Preserve all earlier scope boundaries. Do not edit live app/build/generated/shared files or add dependencies.

Run the focused navigation test and syntax bundle check. Update `docs/execution/AGR-4-ifz-product-shell.md` with the correction and exact proof limits.
