import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {beforeChallengeLevels as oldLevels} from '../src/domain/campaignBeforeChallenge';
import {validateLevel,solve,safeArrows} from '../src/domain/rules';
import {evaluateDifficulty} from '../src/domain/generator';
import {newSession,resolve,parseSession} from '../src/application/session';
import {SaveStore} from '../src/storage/save';
const candidates=Array.from({length:36},(_,i)=>validateLevel(JSON.parse(readFileSync(`content/candidates/challenge/level-${i+5}.json`,'utf8'))));
it('all challenge candidates are harder, distinct and solver-safe without stacked badges',()=>{
 expect(new Set(candidates.map(l=>JSON.stringify(l.arrows))).size).toBe(36);
 candidates.forEach((l,i)=>{
  const old=oldLevels[i+4],d=evaluateDifficulty(l);expect(d.score).toBeGreaterThan(evaluateDifficulty(old).score);expect(d.initialChoices).toBeLessThanOrEqual(5);expect(d.depth).toBeGreaterThanOrEqual(5);
  for(const a of l.arrows)expect([!!a.requires,!!a.anchorRequires,a.deadline!==undefined,l.arrows.some(b=>b.requires===a.id),l.arrows.some(b=>b.anchorRequires===a.id)].filter(Boolean).length).toBeLessThanOrEqual(1);
  for(let route=0;route<3;route++){let s=newSession(l,'test');while(s.active.length){const choices=safeArrows(l,s.active);expect(choices.length).toBeGreaterThan(0);const id=choices[(route+s.active.length)%choices.length];s=resolve(l,s,{id,attemptId:'test',type:'select',arrowId:id}).state;expect(s.status).not.toBe('failed');expect(parseSession(JSON.stringify(s),l)).toEqual(s);}expect(s.coins).toBe(25);}
 });
},120000);
it('migrates every replaced board without losing awards or duplicating first-clear coins',()=>{
 candidates.forEach((next,i)=>{
  const old=oldLevels[i+4];let complete=newSession(old,'old');for(const id of old.solution)complete=resolve(old,complete,{id,attemptId:'old',type:'select',arrowId:id}).state;
  for(const prior of [complete,newSession(old,'practice','practice',complete),newSession(old,'unfinished')]){
   const raw=JSON.stringify(prior),data=new Map([['save',raw]]);const store=new SaveStore({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}},next,'save',old);
   const migrated=store.load().state!;expect(migrated).toMatchObject({contentVersion:8,coins:prior.coins,bestStars:prior.bestStars,claimed:prior.claimed,mode:prior.mode,status:'playing'});expect(data.get('save.content-'+old.contentVersion)).toBe(raw);
   let s=newSession(next,'finish','story',migrated);for(const id of solve(next)!)s=resolve(next,s,{id,attemptId:'finish',type:'select',arrowId:id}).state;expect(s.coins).toBe(25);expect(s.reward).toBe(prior.claimed?0:25);
  }
 });
},120000);

it('archives the validated challenge edition and preserves its first four levels',async()=>{
 const {beforePlanningLevels:levels}=await import('../src/domain/campaignBeforePlanning');
 expect(levels.slice(0,4)).toEqual(oldLevels.slice(0,4));
 expect(levels.slice(4)).toEqual(candidates);
});
