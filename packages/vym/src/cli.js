#!/usr/bin/env node
import { showBanner } from './banner.js';
import { renderConsole } from './console.js';
import { inspectWorkspace } from './workspace.js';
import { help, renderStatus } from './status.js';

const args=process.argv.slice(2);
const options=new Set(args.filter(arg=>arg.startsWith('--')));
const words=args.filter(arg=>!arg.startsWith('--'));
const command=words[0]==='zetro' ? (words[1] || 'status') : (words[0] || 'home');
const allowed=new Set(['home','status','doctor','workers','products','help','version']);
const unknownOption=[...options].find(option=>!['--json','--no-animation','--watch','--help','--version'].includes(option));
if(unknownOption || !allowed.has(command) || words.length>(words[0]==='zetro'?2:1)) {
  process.stderr.write('Unknown command or option. Run vym help.\n');process.exitCode=2;
} else if(options.has('--help') || command==='help') {
  process.stdout.write(options.has('--json') ? JSON.stringify({help})+'\n' : help);
} else if(options.has('--version') || command==='version') {
  process.stdout.write(options.has('--json') ? '{"version":"0.1.0"}\n' : 'VYM / VEYMINORE 0.1.0\n');
} else {
  const print=async()=>{
    const data=await inspectWorkspace();
    if(options.has('--json')) process.stdout.write(JSON.stringify(data)+'\n');
    else if(command==='home') {
      process.stdout.write(renderConsole({color:Boolean(process.stdout.isTTY && process.env.TERM!=='dumb' && process.env.NO_COLOR===undefined),columns:process.stdout.columns||88}));
      process.stdout.write(renderStatus(data,'status'));
    } else process.stdout.write(renderStatus(data,command));
    if(command==='doctor' && data.checks.some(c=>!c.passed)) process.exitCode=1;
  };
  if(!options.has('--json') && command==='home') await showBanner({animate:!options.has('--no-animation')});
  await print();
  if(options.has('--watch')) {
    let running=false;
    const timer=setInterval(async()=>{if(running)return;running=true;try{await print();}catch{process.stderr.write('Status refresh unavailable.\n');}finally{running=false;}},5000);
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{clearInterval(timer);});
  }
}
