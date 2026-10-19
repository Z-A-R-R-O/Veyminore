# OCR-3 IFZ projection final correction

Independent rerun after your rework: 43/44 pass. Failure:
test "ifz: verified-complete requires evidence refs" expected EVENT_MALFORMED but accept() returned admitted with code null when verified-complete had no evidence.

Fix implementation so verified-complete requires at least one valid unique evidence ref before any state mutation. Do not weaken the test. Keep reported-complete unverified. Append exact correction and request rerun to OCR-3.md.
