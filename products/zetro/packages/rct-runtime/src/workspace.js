import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function cleanRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) throw new Error('Invalid relative path');
  const segments = value.split('/');
  if (path.posix.isAbsolute(value) || segments.some(x => !x || x === '.' || x === '..' || x.startsWith('.'))) throw new Error('Invalid relative path');
  if (segments.some(x => x.includes(':'))) throw new Error('Invalid relative path');
  return segments.join('/');
}

function freezeSet(set) {
  set.add = () => { throw new Error('Cannot mutate frozen Set'); };
  set.delete = () => { throw new Error('Cannot mutate frozen Set'); };
  set.clear = () => { throw new Error('Cannot mutate frozen Set'); };
  return Object.freeze(set);
}

export class ScopedWorkspace {
  constructor(root, allowedPaths, limits = {}, options = {}) {
    if (!path.isAbsolute(root)) throw new Error('Workspace root must be absolute');
    this.root = path.resolve(root);

    this.admission = options.admission || limits.admission || limits.workspaceAdmission || null;
    const rawBaseline = options.sourceBaselineRoot || limits.sourceBaselineRoot || this.admission?.sourceBaselineRoot || null;
    this.sourceBaselineRoot = rawBaseline ? path.resolve(rawBaseline) : null;

    if (Array.isArray(allowedPaths)) {
      const cleaned = allowedPaths.map(cleanRelative);
      this.allowed = freezeSet(new Set(cleaned));
      this.writePaths = freezeSet(new Set(cleaned));
      this.readPaths = freezeSet(new Set(cleaned));
    } else {
      const reads = (allowedPaths.readPaths || []).map(cleanRelative);
      const writes = (allowedPaths.writePaths || []).map(cleanRelative);
      const creates = (allowedPaths.createPaths || []).map(cleanRelative);
      this.allowed = freezeSet(new Set([...reads, ...writes, ...creates]));
      this.writePaths = freezeSet(new Set(writes));
      this.readPaths = freezeSet(new Set(reads));
    }

    if (!this.allowed.size) throw new Error('At least one allowed file is required');
    this.maxReadBytes = limits.maxReadBytes ?? 8192;
    this.maxWriteBytes = limits.maxWriteBytes ?? 8192;
    this.readBytes = 0;
    this.searchBytes = 0;
    this.writeBytes = 0;
  }

  async resolveFile(relative, write = false) {
    const name = cleanRelative(relative);
    if (!this.allowed.has(name)) throw new Error('Path outside assignment scope');
    if (write && !this.writePaths.has(name)) throw new Error('Path not in write scope');

    if (this.admission?.scope) {
      if (write && !this.admission.scope.writePaths.includes(name)) {
        throw new Error('Path not in write scope');
      }
      const admittedAll = [
        ...this.admission.scope.readPaths,
        ...this.admission.scope.writePaths,
        ...(this.admission.scope.createPaths || [])
      ];
      if (!admittedAll.includes(name)) {
        throw new Error('Path outside assignment scope');
      }
    }

    const rootReal = await realpath(this.root);
    let current = rootReal;
    for (const segment of name.split('/')) {
      current = path.join(current, segment);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
    }
    const resolved = await realpath(current);
    if (!resolved.startsWith(rootReal + path.sep)) throw new Error('Path escaped workspace');

    if (this.sourceBaselineRoot) {
      const sourceReal = await realpath(this.sourceBaselineRoot).catch(() => this.sourceBaselineRoot);
      if (resolved === sourceReal || resolved.startsWith(sourceReal + path.sep)) {
        throw new Error('Baseline escape denied: target resolves into source baseline repository');
      }
    }

    const stat = await lstat(resolved);
    if (!stat.isFile()) throw new Error('Only regular files are allowed');
    return resolved;
  }

  async listPaths() {
    const found = [];
    for (const name of [...this.allowed].sort()) {
      try { await this.resolveFile(name); found.push(name); } catch { /* inaccessible files are not exposed */ }
    }
    return found;
  }

  async readSlice(relative, rawStart = 0, rawLength = 2048) {
    let start = rawStart;
    if (start === undefined || start === null || start === '') {
      start = 0;
    } else if (typeof start === 'string' && /^\s*-?\d+\s*$/.test(start)) {
      start = Number(start.trim());
    }

    let length = rawLength;
    if (length === undefined || length === null || length === '') {
      length = 2048;
    } else if (typeof length === 'string' && /^\s*-?\d+\s*$/.test(length)) {
      length = Number(length.trim());
    }

    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length < 1) {
      throw new Error('Invalid slice');
    }

    length = Math.min(length, 4096);
    const file = await this.resolveFile(relative);
    const bytes = await readFile(file);
    if (bytes.length > 65536) throw new Error('File exceeds pilot size limit');
    const end = Math.min(bytes.length, start + length);
    const slice = bytes.subarray(start, end);
    if (this.readBytes + slice.length > this.maxReadBytes) throw new Error('Read budget exhausted');
    this.readBytes += slice.length;
    return { path: cleanRelative(relative), start, end, totalBytes: bytes.length, sha256: sha256(bytes), content: slice.toString('utf8') };
  }

  async search(term) {
    if (typeof term !== 'string' || term.length < 2 || term.length > 100) throw new Error('Invalid search term');
    const hits = [];
    for (const name of await this.listPaths()) {
      const file = await this.resolveFile(name);
      const bytes = await readFile(file);
      if (bytes.length > 65536) continue;
      if (this.searchBytes + bytes.length > this.maxReadBytes) throw new Error('Search budget exhausted');
      this.searchBytes += bytes.length;
      const content = bytes.toString('utf8');
      let from = 0;
      while (hits.length < 20) {
        const index = content.indexOf(term, from);
        if (index < 0) break;
        hits.push({ path: name, offset: index });
        from = index + term.length;
      }
      if (hits.length === 20) break;
    }
    return hits;
  }

  async proposePatch(relative, expectedSha256, content, signal = null) {
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (typeof content !== 'string' || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Invalid patch');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > 65536 || this.writeBytes + bytes.length > this.maxWriteBytes) throw new Error('Write budget exhausted');
    const file = await this.resolveFile(relative, true);
    if (this.sourceBaselineRoot) {
      const sourceReal = await realpath(this.sourceBaselineRoot).catch(() => path.resolve(this.sourceBaselineRoot));
      if (file === sourceReal || file.startsWith(sourceReal + path.sep)) {
        throw new Error('Baseline mutation denied: cannot write to source baseline repository');
      }
    }
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    const before = await readFile(file);
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (sha256(before) !== expectedSha256) throw new Error('Stale preimage');
    if (before.equals(bytes)) return { path: cleanRelative(relative), before: expectedSha256, after: expectedSha256, bytes: bytes.length, applied: false, reason: 'no_change' };
    // Recheck the path before writing. The pilot only runs in a private snapshot;
    // hostile concurrent filesystem mutation is not a supported security boundary.
    if (await this.resolveFile(relative, true) !== file) throw new Error('Path changed');
    if (signal?.aborted) {
      const err = new Error('Operation aborted');
      err.name = 'AbortError';
      throw err;
    }
    await writeFile(file, bytes, { flag: 'w', signal: signal || undefined });
    this.writeBytes += bytes.length;
    return { path: cleanRelative(relative), before: expectedSha256, after: sha256(bytes), bytes: bytes.length, applied: true };
  }
}
