import { WebAccountApi } from "./web-api";
import type { Profile, Reward } from "../storage/profile";
export type Wallet = { coins: number; gems: number; revision: number };
export type EconomyState = {
  accountId: string;
  wallet: Wallet | null;
  inventory: Profile["owned"];
  cleared: string[];
  claims: string[];
  migration: null | { backupHash: string };
  transactions: unknown[];
  lastReward?: Reward | null;
  progress?: Array<{ levelId: string; bestStars: number }>;
  preference?: { equipped: Profile["equipped"]; revision: number };
};
export async function economyRequest(
  accountId: string,
  input: Record<string, unknown>,
): Promise<any> {
  const session = await new WebAccountApi(true).session();
  if (session.account?.id !== accountId) throw Error("account-changed");
  const response = await fetch("/api/arowgo/v1/account/economy", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": session.csrfToken,
    },
    body: JSON.stringify({ ...input, expectedAccountId: accountId }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "economy-unavailable");
  return result;
}
/** Persist intent before sending. An uncertain response is retried with the same ID. */
export class EconomyClient {
  constructor(
    readonly accountId: string,
    private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private request: (input: Record<string, unknown>) => Promise<any>,
    private id = () => crypto.randomUUID(),
  ) {}
  private busy = false;
  pending(key: string): Record<string, unknown> | undefined {
    const raw = this.storage.getItem(
      `arowgo.economy.${this.accountId}.operation.${key}`,
    );
    return raw ? JSON.parse(raw).input : undefined;
  }
  acknowledge(key: string) {
    this.storage.removeItem(
      `arowgo.economy.${this.accountId}.operation.${key}`,
    );
  }
  async run(
    key: string,
    input: Record<string, unknown>,
    retain = false,
  ): Promise<any> {
    if (this.busy) throw Error("operation-pending");
    this.busy = true;
    const path = `arowgo.economy.${this.accountId}.operation.${key}`;
    try {
      const raw = this.storage.getItem(path);
      const record = raw ? JSON.parse(raw) : { operationId: this.id(), input };
      if (JSON.stringify(record.input) !== JSON.stringify(input))
        throw Error("pending-operation-differs");
      if (record.result) return record.result;
      this.storage.setItem(path, JSON.stringify(record));
      const result = await this.request({
        ...input,
        operationId: record.operationId,
      });
      if (retain)
        this.storage.setItem(path, JSON.stringify({ ...record, result }));
      else this.storage.removeItem(path);
      return result;
    } catch (error) {
      if (
        error instanceof Error &&
        [
          "insufficient-funds",
          "invalid-purchase",
          "already-claimed",
          "invalid-attempt",
          "level-locked",
          "preference-conflict",
          "skin-not-owned",
          "invalid-preference",
        ].includes(error.message)
      )
        this.storage.removeItem(path);
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
export type EconomyReward = Reward;
