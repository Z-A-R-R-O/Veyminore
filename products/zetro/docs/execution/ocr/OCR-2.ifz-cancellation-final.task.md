# OCR-2 IFZ cancellation final correction

Independent rerun now passes 14/15. One failure remains: reconcile with a different cancellationId returns identity_mismatch, but the public contract and test require cancellation_id_mismatch.

Keep full identity binding checks. Handle cancellationId mismatch through the dedicated CANCELLATION_ID_MISMATCH path before generic binding mismatch during reconcile/resend. Do not weaken the assertion. Run or honestly request coordinator rerun, and append result to OCR-2.md.
