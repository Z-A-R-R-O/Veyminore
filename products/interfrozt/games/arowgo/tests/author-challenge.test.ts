import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {beforeChallengeLevels as levels} from '../src/domain/campaignBeforeChallenge';
import {generatePuzzle,evaluateDifficulty} from '../src/domain/generator';
import {solve,validateLevel,dependencies,type Level} from '../src/domain/rules';
it('authors challenging campaign candidates without promotion',()=>{
 if(process.env.AROWGO_CHALLENGE!=='1')return;
 mkdirSync('content/candidates/challenge',{recursive:true});const report=[];
 for(let i=4;i<40;i++){
  const old=levels[i],number=i+1,before=evaluateDifficulty(old);
  const target=number>=39?before.score+9:Math.max(before.score+18,110+Math.round((number-5)*1.6));
  const cached='content/candidates/challenge/level-'+number+'.json';
  if(existsSync(cached)){const l=validateLevel(JSON.parse(readFileSync(cached,'utf8')));report.push({number,before,after:evaluateDifficulty(l),arrows:l.arrows.length});continue;}
  console.log("Seeking",number,"baseline",before.score,"target",target);
  let chosen;
  for(let retry=0;retry<60;retry++){
   try{chosen=generatePuzzle(151126+number*997+retry*131,Math.min(19,18+Math.floor((number-5)/12)),target,old.levelId,{connectedPlacement:true,openingMoves:[1,5],depthRange:[5,16],scoreRange:[target-8,target+100],keyLockPairs:old.arrows.some(a=>a.requires)?1:0});break;}catch(e){if(!(e instanceof Error)||!e.message.startsWith('Generation budget'))throw e;}
  }
  if(!chosen)throw Error('No candidate for '+number);
  const level:Level={...chosen,contentVersion:8,arrows:chosen.arrows.map(a=>({...a}))};
  const roles=()=>new Set(level.arrows.filter(a=>a.requires||a.anchorRequires||a.deadline).flatMap(a=>[a.id,a.requires,a.anchorRequires].filter(Boolean)));
  const anchorCount=old.arrows.filter(a=>a.anchorRequires).length;
  if(anchorCount){
   const order=solve(level)!,graph=dependencies(level),used=roles();
   const source=order.find((id,index)=>!used.has(id)&&order.slice(index+1).filter(b=>!used.has(b)&&!graph.get(b)!.has(id)).length>=anchorCount);
   if(!source)throw Error('No anchor source '+number);
   for(const id of order.slice(order.indexOf(source)+1).filter(id=>!used.has(id)&&!graph.get(id)!.has(source)).slice(0,anchorCount))level.arrows.find(a=>a.id===id)!.anchorRequires=source;
  }
  const kegCount=old.arrows.filter(a=>a.deadline).length;
  let order=solve(level)!;
  for(let k=0;k<kegCount;k++){
   const used=roles();const index=order.findIndex((id,index)=>index>=3+k*4&&!used.has(id));
   if(index<0)throw Error('No keg slot '+number);
   level.arrows.find(a=>a.id===order[index])!.deadline=index+1+(number<35?2:1);
  }
  level.solution=solve(level)!;validateLevel(level);expect(level.solution).toHaveLength(level.arrows.length);
  const after=evaluateDifficulty(level);expect(after.score).toBeGreaterThan(before.score);
  const out={...level,generation:{...chosen.generation,challengeVersion:1,difficulty:after}};
  writeFileSync('content/candidates/challenge/level-'+number+'.json',JSON.stringify(out,null,2)+'\n');
  report.push({number,before,after,arrows:level.arrows.length});console.log(number,before.score,'->',after.score,'open',after.initialChoices,'depth',after.depth);
 }

 for(const [start,end] of [[5,10],[12,13],[15,16],[22,23],[25,30],[32,36],[37,40]]){
  const group=Array.from({length:end-start+1},(_,i)=>JSON.parse(readFileSync('content/candidates/challenge/level-'+(start+i)+'.json','utf8'))).sort((a,b)=>evaluateDifficulty(a).score-evaluateDifficulty(b).score);
  group.forEach((l,i)=>{l.levelId=levels[start+i-1].levelId;writeFileSync('content/candidates/challenge/level-'+(start+i)+'.json',JSON.stringify(l,null,2)+'\n');});
 }
 report.length=0;for(let n=5;n<=40;n++){const l=validateLevel(JSON.parse(readFileSync('content/candidates/challenge/level-'+n+'.json','utf8')));report.push({number:n,before:evaluateDifficulty(levels[n-1]),after:evaluateDifficulty(l),arrows:l.arrows.length});}
 writeFileSync('content/candidates/challenge/report.json',JSON.stringify(report,null,2)+'\n');
},600000);
