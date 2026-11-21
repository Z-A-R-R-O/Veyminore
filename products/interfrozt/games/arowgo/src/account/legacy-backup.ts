/** Raw recovery copy only: it is not validated progress or a currency entitlement. */
export interface LegacyBackup {
  schemaVersion: 1;
  gameId: "arowgo";
  trust: "unverified-local";
  entries: ReadonlyArray<{ key: string; raw: string }>;
}

interface ReadableStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export class LegacyBackupError extends Error {
  constructor(public readonly code: "unavailable" | "changed" | "too-large") {
    super(`Local backup failed: ${code}`);
    this.name = "LegacyBackupError";
  }
}

function allowed(key: string): boolean {
  return (
    /^(arowgo\.profile\.v1|arowgo\.slice\.v1|arowgo\.level\.[a-z0-9-]+\.v1|arowgo\.lesson\.keys\.v1)(\.(backup|content-\d+))?$/.test(
      key,
    ) ||
    /^arowgo\.(sound\.v1|motion\.v1|tutorial\.(keys\.v1|snake\.v2)|lesson\.(keys|anchors|kegs))$/.test(
      key,
    )
  );
}

/** No writes, resets or migrations. Malformed known saves are retained verbatim for recovery. */
export function captureLegacyBackup(storage: ReadableStorage): LegacyBackup {
  function keys(): string[] {
    const result = new Set<string>();
    const count = storage.length;
    for (let i = 0; i < count; i++) {
      const key = storage.key(i);
      if (key && allowed(key)) result.add(key);
    }
    return [...result].sort();
  }
  try {
    const before = keys();
    let bytes = 0;
    const entries = before.map((key) => {
      const raw = storage.getItem(key);
      if (raw === null) throw new LegacyBackupError("changed");
      bytes += new TextEncoder().encode(key + raw).byteLength;
      if (bytes > 4 * 1024 * 1024) throw new LegacyBackupError("too-large");
      return { key, raw };
    });
    if (
      JSON.stringify(keys()) !== JSON.stringify(before) ||
      entries.some(({ key, raw }) => storage.getItem(key) !== raw)
    ) {
      throw new LegacyBackupError("changed");
    }
    // Best-effort change detection, not a cross-tab transaction or durable backup receipt.
    return {
      schemaVersion: 1,
      gameId: "arowgo",
      trust: "unverified-local",
      entries,
    };
  } catch (error) {
    if (error instanceof LegacyBackupError) throw error;
    throw new LegacyBackupError("unavailable");
  }
}
