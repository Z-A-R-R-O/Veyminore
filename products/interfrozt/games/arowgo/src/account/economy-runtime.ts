import { WebAccountApi } from "./web-api";
import {
  EconomyClient,
  economyRequest,
  type EconomyState,
} from "./economy-api";
import type { Profile } from "../storage/profile";
import type { Session } from "../application/session";
export const ECONOMY_BINDING = "arowgo.economy.binding.v1";
let owner: string | null = null;
let current: EconomyState | null = null;
let client: EconomyClient;
let message = "";
const listeners = new Set<() => void>();
export const economyOwner = () => owner;
export const economyState = () => current;
export const economyMessage = () => message;
export const subscribeEconomy = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const emit = () => listeners.forEach((fn) => fn());
export const gameStorage = {
  getItem: (key: string) =>
    localStorage.getItem(owner ? `arowgo.economy.${owner}.save.${key}` : key),
  setItem: (key: string, value: string) =>
    localStorage.setItem(
      owner ? `arowgo.economy.${owner}.save.${key}` : key,
      value,
    ),
};
export async function refreshEconomy() {
  if (!owner) return;
  const next = (await economyRequest(owner, {
    action: "wallet",
  })) as EconomyState;
  if (next.accountId !== owner || !next.wallet || !next.migration)
    throw Error("migration-required");
  if (!current || next.wallet.revision >= current.wallet!.revision)
    current = next;
  emit();
}
export async function initializeEconomy() {
  const bound = localStorage.getItem(ECONOMY_BINDING);
  if (!bound) return;
  if (!import.meta.env.DEV)
    throw Error("Account wallet preview requires the development server.");
  if (!/^[a-f0-9]{1,64}$/i.test(bound))
    throw Error("Invalid account wallet binding.");
  const session = await new WebAccountApi(true).session();
  if (session.account?.id !== bound)
    throw Error(
      "Sign in to the account used for this wallet before continuing.",
    );
  owner = bound;
  client = new EconomyClient(owner, localStorage, (input) =>
    economyRequest(owner!, input),
  );
  await refreshEconomy();
  message = "Account wallet connected";
}
export function accountProfile(profile: Profile): Profile {
  if (!current?.wallet) return profile;
  return {
    ...profile,
    gems: current.wallet.gems,
    lastReward: current.lastReward ?? profile.lastReward,
    owned: current.inventory,
    equipped: current.inventory.includes(profile.equipped)
      ? profile.equipped
      : "classic",
    gemGiftClaimed: current.claims.includes("gem-gift"),
    welcomeClaimed: current.claims.includes("welcome-chest"),
  };
}
export async function walletAction(input: Record<string, unknown>) {
  if (!owner) throw Error("wallet-not-connected");
  try {
    const result = await client.run("purchase", input, true);
    await refreshEconomy();
    client.acknowledge("purchase");
    message = "Wallet saved";
    emit();
    return result;
  } catch (e) {
    message =
      "Wallet request needs attention. Retry the same action to recover its receipt.";
    emit();
    throw e;
  }
}
async function attempt(state: Session) {
  return client.run(
    `begin-${state.attemptId}`,
    { action: "begin", levelId: state.levelId },
    true,
  );
}
export async function timeBoost(state: Session) {
  const a = await attempt(state);
  const result = await client.run(
    `boost-${state.attemptId}`,
    { action: "boost", attemptId: a.attemptId },
    true,
  );
  await refreshEconomy();
  return result.granted === true;
}
async function submitCompletion(state: Session) {
  if (!owner || state.mode !== "story" || state.status !== "complete") return;
  const queueKey = `arowgo.economy.${owner}.completion.${state.attemptId}`;
  if (current?.cleared.includes(state.levelId)) {
    localStorage.removeItem(queueKey);
    return;
  }
  if (!state.moveLog?.length) return;
  localStorage.setItem(queueKey, JSON.stringify(state));
  message = "Verifying completion reward…";
  emit();
  try {
    const a = await attempt(state);
    const r = await client.run(
      `complete-${state.attemptId}`,
      { action: "complete", attemptId: a.attemptId, moves: state.moveLog },
      true,
    );
    await refreshEconomy();
    localStorage.removeItem(queueKey);
    message = r.awarded
      ? `+${r.awarded} coins saved to your account`
      : "Level verified; first-clear reward already collected";
    emit();
  } catch {
    message = "Reward pending. Keep this save and reconnect to retry safely.";
    emit();
  }
}

export function hasBoostReceipt(state: Session) {
  if (!owner) return false;
  try {
    const record = JSON.parse(
      localStorage.getItem(
        `arowgo.economy.${owner}.operation.boost-${state.attemptId}`,
      ) ?? "null",
    );
    return record?.result?.granted === true;
  } catch {
    return false;
  }
}

let flushing = false;
export async function flushCompletions(states: Session[]) {
  if (!owner || flushing) return;
  flushing = true;
  try {
    for (const state of states)
      if (
        state.status === "complete" &&
        state.mode === "story" &&
        state.moveLog?.length &&
        !current?.cleared.includes(state.levelId)
      )
        localStorage.setItem(
          `arowgo.economy.${owner}.completion.${state.attemptId}`,
          JSON.stringify(state),
        );
    const prefix = `arowgo.economy.${owner}.completion.`;
    const queued = Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .map((k) => JSON.parse(localStorage.getItem(k)!));
    for (const state of queued) await submitCompletion(state);
  } catch {
    message = "Reward recovery needs attention. Your local save has been kept.";
    emit();
  } finally {
    flushing = false;
  }
}
