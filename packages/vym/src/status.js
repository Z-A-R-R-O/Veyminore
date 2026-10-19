export const help = `
  VYM / VEYMINORE

  01  DISCOVER
      vym products             Installed product registry
      vym status               Workspace and dashboard status
      vym doctor               Check local requirements
      vym workers              Saved worker assignments

  02  ZETRO
      vym zetro                Product overview and console address
      vym zetro status         Product status
      vym zetro workers        Saved AGR / OCR assignments

  03  OPTIONS
      --json                   Structured output, no animation
      --no-animation           Static brand introduction
      --watch                  Refresh status every 5 seconds; Ctrl+C stops

  Both vym and veyminore accept the same commands.
  Read-only commands. No agents or inference are started.
`;

export function renderStatus(data, command) {
  const rows=['','  VEYMINORE / '+command.toUpperCase(),'','  Checked '+new Date(data.checkedAt).toLocaleTimeString(),''];
  if(command==='doctor') for(const check of data.checks) rows.push(`  ${check.passed?'PASS':'FAIL'}   ${check.name}`);
  else if(command==='workers') {
    rows.push('  SAVED ASSIGNMENTS - not live execution','');
    for(const w of data.workers) rows.push(`  ${w.name.padEnd(7)} ${w.dispatch}\n          ${w.task || 'No assignment recorded'}\n`);
    if(!data.workers.length) rows.push('  No readable worker records.');
  } else {
    for(const p of data.products) rows.push(`  01  ${p.id.toUpperCase()}       ${p.installed?'Installed':'Missing'}`,`      Dashboard   ${p.dashboard.available?'Reachable':'Offline'}`,`      Console     ${p.dashboard.url}`,'');
    rows.push(`  02  WORKSPACE   ${data.workspace}`,`      Workers     ${data.workers.length} saved assignments`,'',`  NEXT  ${data.nextAction}`);
  }
  rows.push('','  Read-only · no worker dispatch · no provider calls','');
  return rows.join('\n')+'\n';
}
