import {
  gzipSync,
  gunzipSync,
  brotliCompressSync,
  brotliDecompressSync,
  constants,
} from "node:zlib";
import { createHash } from "node:crypto";
import { AuthError } from "./service.mjs";
const allowed =
  /^(arowgo\.(profile\.v1|slice\.v1|level\.[a-z0-9-]+\.v1|lesson\.keys\.v1)(\.(backup|content-\d+))?|arowgo\.(sound\.v1|motion\.v1|tutorial\.(keys\.v1|snake\.v2)|lesson\.(keys|anchors|kegs)))$/;
export function validateSnapshot(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.gameId !== "arowgo" ||
    value.trust !== "unverified-local" ||
    !Array.isArray(value.entries) ||
    value.entries.length > 500
  )
    throw new AuthError(400, "invalid-save");
  const seen = new Set();
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      !allowed.test(entry.key) ||
      seen.has(entry.key) ||
      typeof entry.raw !== "string"
    )
      throw new AuthError(400, "invalid-save");
    seen.add(entry.key);
  }
  const clean = {
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries: value.entries
      .map(({ key, raw }) => ({ key, raw }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
  if (Buffer.byteLength(JSON.stringify(clean)) > 512 * 1024)
    throw new AuthError(413, "save-too-large");
  return clean;
}
export function packSnapshot(value) {
  const snapshot = validateSnapshot(value);
  const json = JSON.stringify(snapshot);
  const packed = {
    encoding: "gzip-base64",
    data: gzipSync(json, { level: 9 }).toString("base64"),
    hash: createHash("sha256").update(json).digest("hex"),
  };
  if (Buffer.byteLength(JSON.stringify(packed)) > 8000) {
    packed.encoding = "brotli-base64";
    packed.data = brotliCompressSync(json, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
    }).toString("base64");
  }
  if (Buffer.byteLength(JSON.stringify(packed)) > 8000) {
    packed.data = brotliCompressSync(json, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).toString("base64");
  }
  if (Buffer.byteLength(JSON.stringify(packed)) > 150000)
    throw new AuthError(413, "save-too-large");
  return packed;
}
export function unpackSnapshot(packed) {
  try {
    if (
      !["gzip-base64", "brotli-base64"].includes(packed?.encoding) ||
      typeof packed.data !== "string" ||
      packed.data.length > 160000
    )
      throw Error();
    const decode =
      packed.encoding === "brotli-base64" ? brotliDecompressSync : gunzipSync;
    const json = decode(Buffer.from(packed.data, "base64"), {
      maxOutputLength: 512 * 1024,
    }).toString();
    if (createHash("sha256").update(json).digest("hex") !== packed.hash)
      throw Error();
    return validateSnapshot(JSON.parse(json));
  } catch {
    throw new AuthError(502, "invalid-cloud-save");
  }
}
export function cloudProvider({
  titleId,
  request = fetch,
  testNamespace = false,
}) {
  const name = testNamespace ? "arowgo-sync-probe-v1" : "arowgo-save-v1";
  const previousName = testNamespace
    ? "arowgo-sync-probe-previous-v1"
    : "arowgo-save-previous-v1";
  const overflowName = testNamespace
    ? "arowgo-sync-probe-overflow-v1"
    : "arowgo-save-overflow-v1";
  async function call(path, body, headers) {
    try {
      const response = await request(
        `https://${titleId}.playfabapi.com/${path}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok || result.code !== 200)
        throw new AuthError(
          result.error === "EntityProfileVersionMismatch" ? 409 : 502,
          result.error === "EntityProfileVersionMismatch"
            ? "save-conflict"
            : "cloud-unavailable",
        );
      return result.data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(502, "cloud-unavailable");
    }
  }
  async function entity(ticket) {
    const data = await call(
      "Authentication/GetEntityToken",
      {},
      { "X-Authorization": ticket },
    );
    if (
      data?.Entity?.Type !== "title_player_account" ||
      !data.Entity.Id ||
      !data.EntityToken
    )
      throw new AuthError(502, "cloud-unavailable");
    return data;
  }
  function reassemble(rawRecord, targetName, allObjects) {
    if (!rawRecord) return null;
    if (rawRecord.snapshot?.overflow !== true) return rawRecord;
    if (
      Number.isSafeInteger(rawRecord.snapshot?.chunkCount) &&
      rawRecord.snapshot.chunkCount >= 1
    ) {
      if (rawRecord.snapshot.chunkCount > 30)
        throw new AuthError(502, "invalid-cloud-save");
      let fullData = rawRecord.snapshot.data;
      for (let i = 1; i <= rawRecord.snapshot.chunkCount; i++) {
        const chunk = allObjects?.[`${targetName}-chunk-${i}`]?.DataObject;
        if (
          chunk?.schemaVersion !== 1 ||
          chunk?.operationId !== rawRecord.operationId ||
          chunk?.chunkIndex !== i ||
          typeof chunk?.data !== "string" ||
          chunk.data.length > 7500
        )
          throw new AuthError(502, "invalid-cloud-save");
        fullData += chunk.data;
      }
      const { overflow: marker, chunkCount, ...snapshot } = rawRecord.snapshot;
      return {
        ...rawRecord,
        snapshot: { ...snapshot, data: fullData },
      };
    }
    const overflow = allObjects?.[overflowName]?.DataObject;
    const tail = overflow?.records?.[rawRecord.operationId];
    if (
      overflow?.schemaVersion !== 1 ||
      typeof tail !== "string" ||
      tail.length > 4000
    )
      throw new AuthError(502, "invalid-cloud-save");
    const { overflow: marker, ...snapshot } = rawRecord.snapshot;
    return {
      ...rawRecord,
      snapshot: { ...snapshot, data: snapshot.data + tail },
    };
  }
  async function read(e) {
    const data = await call(
      "Object/GetObjects",
      { Entity: e.Entity, EscapeObject: false },
      { "X-EntityToken": e.EntityToken },
    );
    if (!Number.isSafeInteger(data?.ProfileVersion) || data.ProfileVersion < 0)
      throw new AuthError(502, "invalid-cloud-save");
    const allObjects = data.Objects || {};
    let record = reassemble(allObjects[name]?.DataObject, name, allObjects);
    if (
      record &&
      (record.schemaVersion !== 1 ||
        typeof record.operationId !== "string" ||
        typeof record.savedAt !== "string")
    )
      throw new AuthError(502, "invalid-cloud-save");
    if (record) unpackSnapshot(record.snapshot);
    return { version: data.ProfileVersion, record };
  }
  function view(current) {
    return {
      version: current.version,
      save: current.record
        ? {
            savedAt: current.record.savedAt,
            operationId: current.record.operationId,
            snapshot: unpackSnapshot(current.record.snapshot),
          }
        : null,
    };
  }
  return {
    async load(ticket) {
      return view(await read(await entity(ticket)));
    },
    async save(ticket, { expectedVersion, operationId, snapshot }) {
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          operationId ?? "",
        )
      )
        throw new AuthError(400, "invalid-request");
      const packed = packSnapshot(snapshot),
        e = await entity(ticket),
        current = await read(e);
      if (current.record?.operationId === operationId) {
        if (current.record.snapshot.hash !== packed.hash)
          throw new AuthError(409, "save-conflict");
        return view(current);
      }
      if (current.version !== expectedVersion)
        throw new AuthError(409, "save-conflict");
      const record = {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        operationId,
        snapshot: packed,
      };
      // Keep complete generations within atomic entity objects. Fragments are
      // written under the same ExpectedProfileVersion, never in separate requests.
      const objects = [];
      const overflow = { schemaVersion: 1, records: {} };
      const fragment = (value, prefix) => {
        if (Buffer.byteLength(JSON.stringify(value)) <= 8000) return value;
        const data = value.snapshot.data;
        const head = data.slice(0, 7000);
        const remaining = data.slice(7000);
        if (
          remaining.length <= 4000 &&
          Buffer.byteLength(JSON.stringify(overflow)) + remaining.length + 100 <=
            8000
        ) {
          overflow.records[value.operationId] = remaining;
          return {
            ...value,
            snapshot: {
              ...value.snapshot,
              data: head,
              overflow: true,
            },
          };
        }
        const chunkSize = 7000;
        const chunkCount = Math.ceil(remaining.length / chunkSize);
        if (chunkCount > 30) throw new AuthError(413, "save-too-large");
        for (let i = 1; i <= chunkCount; i++) {
          const chunkData = remaining.slice((i - 1) * chunkSize, i * chunkSize);
          objects.push({
            ObjectName: `${prefix}-chunk-${i}`,
            DataObject: {
              schemaVersion: 1,
              operationId: value.operationId,
              chunkIndex: i,
              data: chunkData,
            },
          });
        }
        return {
          ...value,
          snapshot: {
            ...value.snapshot,
            data: head,
            overflow: true,
            chunkCount,
          },
        };
      };
      objects.push({ ObjectName: name, DataObject: fragment(record, name) });
      // Preserve the previous complete save with the same atomic profile-version update.
      if (current.record)
        objects.push({
          ObjectName: previousName,
          DataObject: fragment(current.record, previousName),
        });
      if (Object.keys(overflow.records).length)
        objects.push({ ObjectName: overflowName, DataObject: overflow });
      for (const object of objects)
        if (Buffer.byteLength(JSON.stringify(object.DataObject)) > 8000)
          throw new AuthError(413, "save-too-large");
      if (objects.length > 70) throw new AuthError(413, "save-too-large");
      const result = await call(
        "Object/SetObjects",
        {
          Entity: e.Entity,
          ExpectedProfileVersion: expectedVersion,
          Objects: objects,
        },
        { "X-EntityToken": e.EntityToken },
      );
      if (
        !Number.isSafeInteger(result?.ProfileVersion) ||
        result.ProfileVersion <= expectedVersion
      )
        throw new AuthError(502, "cloud-unavailable");
      const verified = await read(e);
      if (
        verified.record?.operationId !== operationId ||
        verified.record?.snapshot?.hash !== packed.hash
      )
        throw new AuthError(409, "save-conflict");
      return view(verified);
    },
  };
}
