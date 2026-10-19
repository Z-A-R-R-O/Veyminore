import { appendFile, readFile, mkdir, stat, open, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Append-only JSON Lines (JSONL) journal for task lifecycle events.
 *
 * Durability and Architectural Limitations:
 * 1. Process Concurrency: appendFile does not acquire OS-level advisory or mandatory
 *    file locks (e.g. LockFileEx on Windows or flock on POSIX). Concurrent writes from
 *    multiple processes will interleave or tear records.
 * 2. Crash Consistency: Standard Node fs.appendFile flushes to the OS buffer cache but
 *    does not call fsync/fdatasync. Sudden power failure or kernel panics can truncate
 *    recent writes or leave trailing partial lines without newline framing.
 * 3. Integrity: JSONL lacks cryptographic framing, length prefixes, or per-record checksums
 *    (such as CRC32 or SHA-256). Truncation or bit-corruption is detected solely through
 *    JSON parse syntax errors.
 * 4. Scan Cost: Replay requires an O(N) sequential scan and in-memory parse of all historic lines.
 *    Without snapshotting or log compaction, memory consumption and startup time grow linearly
 *    with total task volume.
 * 5. Atomicity: Multi-event operations are not transactional across records; compensation
 *    events are required to reconcile partial states.
 */
export class Journal {
  constructor(filepath) {
    this.filepath = filepath;
    this.corruptLines = [];
    this.quarantinePath = null;
  }

  async repairFraming() {
    try {
      const fileStat = await stat(this.filepath);
      if (fileStat.size === 0) return;
      const fh = await open(this.filepath, 'r+');
      try {
        const buf = Buffer.alloc(1);
        await fh.read(buf, 0, 1, fileStat.size - 1);
        if (buf[0] !== 0x0A) { // 0x0A is '\n'
          await fh.write(Buffer.from('\n'), 0, 1, fileStat.size);
        }
      } finally {
        await fh.close();
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async quarantine() {
    try {
      const quarantinePath = `${this.filepath}.quarantine.${Date.now()}`;
      await copyFile(this.filepath, quarantinePath);
      this.quarantinePath = quarantinePath;
      return quarantinePath;
    } catch (err) {
      this.quarantineError = err.message;
      return null;
    }
  }

  async init() {
    await mkdir(dirname(this.filepath), { recursive: true });
    await this.repairFraming();
    this.corruptLines = [];
    this.quarantinePath = null;
    try {
      const content = await readFile(this.filepath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      const events = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          const parsed = JSON.parse(line);
          events.push({ ...parsed, _lineIndex: i });
        } catch (err) {
          this.corruptLines.push({
            lineIndex: i,
            raw: line,
            error: err.message,
            isTail: (i === lines.length - 1)
          });
        }
      }
      if (this.corruptLines.length > 0) {
        await this.quarantine();
      }
      return events;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return [];
    }
  }

  async append(event) {
    await this.repairFraming();
    await appendFile(this.filepath, JSON.stringify({ ...event, timestamp: Date.now() }) + '\n');
  }
}
