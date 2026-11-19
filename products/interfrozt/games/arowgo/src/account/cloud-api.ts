import { WebAccountApi } from "./web-api";
import { validateBackup } from "./cloud-local";
import type { LegacyBackup } from "./legacy-backup";
export interface CloudState {
  accountId: string;
  version: number;
  save: null | { savedAt: string; operationId: string; snapshot: LegacyBackup };
}
export async function cloudRequest(
  accountId: string,
  action: "load" | "save",
  input: Record<string, unknown> = {},
): Promise<CloudState> {
  const session = await new WebAccountApi(true).session();
  if (session.account?.id !== accountId) throw Error("account-changed");
  const response = await fetch("/api/arowgo/v1/account/cloud", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(50000),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ ...input, accountId, action }),
  });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw Error(
      [
        "cloud-disabled",
        "save-conflict",
        "account-changed",
        "save-too-large",
        "invalid-cloud-save",
      ].includes(e.error)
        ? e.error
        : "cloud-unavailable",
    );
  }
  const result = await response.json();
  if (
    result.accountId !== accountId ||
    !Number.isSafeInteger(result.version) ||
    result.version < 0 ||
    (result.save !== null &&
      (typeof result.save?.savedAt !== "string" ||
        typeof result.save?.operationId !== "string"))
  )
    throw Error("invalid-cloud-save");
  if (result.save) result.save.snapshot = validateBackup(result.save.snapshot);
  return result;
}
