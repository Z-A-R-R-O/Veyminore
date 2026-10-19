import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

export const workspaceRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 180);

export async function inspectWorkspace() {
  const productRoot = join(workspaceRoot, 'products/zetro');
  const [agr, ocr, dashboard] = await Promise.all([
    readDispatch(join(productRoot,'docs/execution/DISPATCH.json'), 'agents'),
    readDispatch(join(productRoot,'docs/execution/ocr/DISPATCH.json'), 'workers'),
    checkDashboard()
  ]);
  const workers = [...agr.workers,...ocr.workers];
  return {
    name:'vym',version:'0.1.0',aliases:['vym','veyminore'],checkedAt:new Date().toISOString(),
    workspace:workspaceRoot,products:[{id:'zetro',installed:await exists(join(productRoot,'package.json')),dashboard}],
    node:process.versions.node,workers,sources:[{name:'AGR dispatch',available:agr.available},{name:'OCR dispatch',available:ocr.available}],
    nextAction:dashboard.available ? 'Open http://127.0.0.1:4317 to inspect live observations.' : 'Start the ZETRO control-center server to connect the dashboard.',
    boundaries:{readOnly:true,providerCalls:0,workerDispatch:false},
    checks:[{name:'Node.js 22.5+',passed:Number(process.versions.node.split('.')[0])>22 || (Number(process.versions.node.split('.')[0])===22 && Number(process.versions.node.split('.')[1])>=5)},
      {name:'ZETRO installed',passed:await exists(join(productRoot,'package.json'))},
      {name:'AGR saved dispatch readable',passed:agr.available},{name:'OCR saved dispatch readable',passed:ocr.available}]
  };
}

async function readDispatch(path, key) {
  try {
    const data=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
    const workers=Object.entries(data[key] || {}).filter(([name])=>/^(AGR|OCR)-[1-5]$/.test(name)).map(([name,w])=>({
      name,dispatch:safe(w.status || 'unknown'),task:safe(w.assignment?.taskId || w.taskRevision || w.taskId),
      acceptedIncrement:Boolean(w.acceptedTask || w.acceptance),source:'saved dispatch - not live execution'
    }));
    return {available:true,workers};
  } catch { return {available:false,workers:[]}; }
}

async function checkDashboard() {
  try {
    const response=await fetch('http://127.0.0.1:4317/',{signal:AbortSignal.timeout(1200),redirect:'error'});
    const html=await response.text();
    return {url:'http://127.0.0.1:4317',available:response.ok && html.includes('ZETRO') && html.includes('worker-dialog')};
  } catch { return {url:'http://127.0.0.1:4317',available:false}; }
}
async function exists(path) { try {await access(path);return true;} catch {return false;} }
