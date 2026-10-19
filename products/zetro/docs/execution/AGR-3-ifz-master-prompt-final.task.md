# AGR-3 IFZ Master Prompt final bound correction

Focused tests pass, but review found one remaining silent truncation: buildFreshWorkerPackage uses tools.slice(0, maxTools). Reject tools longer than maxTools instead of silently changing the requested package. Add one focused test. Preserve all passing structural-safety behavior. Run only the two IFZ Master Prompt/context tests and append result to your receipt.
