import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LiveObservations } from './live.mjs';
import { requirements } from './requirements.mjs';

export class WorkspaceProjection {
  constructor(root, live = new LiveObservations(root)) { this.root = root; this.live = live; }

  async snapshot() {
    const [agr, ocr, coordinator, ocrLog] = await Promise.all([
      this.read('docs/execution/DISPATCH.json', true),
      this.read('docs/execution/ocr/DISPATCH.json', true),
      this.read('docs/execution/COORDINATOR.md'),
      this.read('docs/execution/ocr/COORDINATOR.md')
    ]);
    const workers = [
      ...Object.entries(agr.value?.agents || {}).map(([name, entry]) => this.worker(name, 'AGR', entry)),
      ...Object.entries(ocr.value?.workers || {}).map(([name, entry]) => this.worker(name, 'OCR', entry))
    ];
    const live = await this.live.snapshot(agr.value);
    for (const worker of workers) worker.live = live.workers[worker.name] || {state:'unavailable',source:'Status source unavailable'};
    workers.push(...Array.from({length:5}, (_, index) => ({
      name:`RCT-${index + 1}`,group:'RCT',taskId:'Awaiting persistent runtime connection',
      objective:'Built-in coding worker slot. Connect an authenticated persistent runtime before dispatching tasks.',
      dispatch:'not_connected',ownedPaths:[],acceptance:null,paused:false,
      live:{state:'not_connected',source:'No persistent RCT worker service connected'}
    })));
    return {
      live,
      generatedAt: new Date().toISOString(),
      evidenceUpdatedAt: this.latest([agr, ocr, coordinator, ocrLog]),
      workspace: 'Veyminore / ZETRO',
      sourceMode: 'saved-evidence',
      agrPaused: agr.value?.agrPause?.paused === true,
      workers:workers.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true})), requirements,
      activity: this.activity(coordinator.value, 'Coordinator').concat(this.activity(ocrLog.value, 'OCR')).slice(0, 14),
      sources: [agr, ocr, coordinator, ocrLog].map(({ path, updatedAt, available }) => ({ path, updatedAt, available })),
      boundaries: { readOnly: true, liveInference: false, nativeDesktopVerified: false, safeApplyAvailable: false }
    };
  }

  async read(path, json = false) {
    try {
      const location = join(this.root, path);
      const [content, info] = await Promise.all([readFile(location, 'utf8'), stat(location)]);
      return { path, value: json ? JSON.parse(content.replace(/^\uFEFF/, '')) : content, updatedAt: info.mtime.toISOString(), available: true };
    } catch {
      return { path, value: json ? null : '', updatedAt: null, available: false };
    }
  }

  worker(name, group, entry) {
    const acceptance = entry.acceptedTask || entry.acceptance || entry.partialAcceptance;
    return {
      name, group,
      taskId: entry.assignment?.taskId || entry.taskRevision || entry.taskId || 'Assignment pending',
      objective: entry.assignment?.objective || null,
      dispatch: entry.status || 'unknown',
      submittedAt: entry.submittedAt || entry.sentAt || null,
      acceptance: acceptance ? { evidence: acceptance.evidence || '', limits: acceptance.limits || '', status: acceptance.status || 'reviewed increment', taskId:acceptance.taskId || null } : null,
      paused: entry.dispatchPaused === true,
      ownedPaths: entry.assignment?.ownedPaths || (entry.ownedPath ? [entry.ownedPath] : []),
      review: entry.review || entry.reviewOutcome?.status || null
    };
  }

  latest(items) {
    return items.map(item => item.updatedAt).filter(Boolean).sort().at(-1) || null;
  }

  activity(markdown, team) {
    return String(markdown).split(/^## /m).slice(1).reverse().slice(0, 8).map(section => {
      const [title, ...body] = section.split('\n');
      return { title: title.trim(), text: body.join(' ').replace(/\s+/g, ' ').trim().slice(0, 520), team };
    });
  }
}
