import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const powershell = 'C:/Users/sunda/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';

export class LiveObservations {
  constructor(root) { this.root = root; this.cached = null; this.pending = null; }

  async snapshot(agents) {
    if (this.cached && Date.now() - this.cached.time < 10000) return this.cached.value;
    if (this.pending) return this.pending;
    this.pending = this.collect(agents).finally(() => { this.pending = null; });
    return this.pending;
  }

  async collect(agents) {
    const [agr, ocr] = await Promise.all([this.agr(agents), this.ocr()]);
    const value = { observedAt:new Date().toISOString(), workers:{...agr.workers,...ocr.workers}, sources:[agr.source,ocr.source] };
    this.cached = {time:Date.now(),value};
    return value;
  }

  async agr(dispatch) {
    let db;
    try {
      db = new DatabaseSync(join(process.env.USERPROFILE, '.gemini/antigravity/conversation_summaries.db'), {readOnly:true});
      const query = db.prepare('SELECT conversation_id, project_id, workspace_uris, status, step_count, last_modified_time FROM conversation_summaries WHERE conversation_id = ?');
      const workers = {};
      for (const [name, entry] of Object.entries(dispatch?.agents || {})) {
        const row = query.get(entry.conversationId);
        const workspaces = JSON.parse(row?.workspace_uris || '[]').map(uri => decodeURIComponent(uri).toLowerCase().replaceAll('\\','/'));
        if (!row || row.project_id !== dispatch.projectId || !workspaces.includes('file:///e:/veyminore/products/zetro')) continue;
        workers[name] = {state:String(row.status || 'unknown').replace(/^CASCADE_RUN_STATUS_/, '').toLowerCase(),steps:row.step_count,updatedAt:row.last_modified_time,source:'Antigravity local status'};
      }
      return {workers,source:{name:'AGR',available:true}};
    } catch { return {workers:{},source:{name:'AGR',available:false}}; }
    finally { db?.close(); }
  }

  async ocr() {
    try {
      const script = join(this.root,'docs/execution/ocr/bridge.ps1').replaceAll("'","''");
      const {stdout} = await execute(powershell, ['-NoProfile','-NonInteractive','-Command', `& '${script}' -Action status | ConvertTo-Json -Depth 5 -Compress`], {timeout:25000,maxBuffer:65536,windowsHide:true});
      const rows = JSON.parse(stdout.replace(/^\uFEFF/,''));
      const workers = {};
      for (const row of [rows].flat()) {
        if (!/^OCR-[1-5]$/.test(row.worker)) continue;
        workers[row.worker] = {state:row.runtime || 'idle',observation:row.observed,files:row.files,source:'OpenCode authenticated bridge'};
      }
      return {workers,source:{name:'OCR',available:true}};
    } catch { return {workers:{},source:{name:'OCR',available:false}}; }
  }
}
