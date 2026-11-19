import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {validateLevel} from '../../src/domain/rules';
import {newSession,resolve} from '../../src/application/session';
test('Cove home has a dedicated illustration with no repeated map or overflow',async({page})=>{
 const saves=Array.from({length:20},(_,i)=>{const level=validateLevel(JSON.parse(readFileSync(`content/levels/bloom-${String(i+1).padStart(2,'0')}.json`,'utf8')));let s=newSession(level,'seed');for(const id of level.solution)s=resolve(level,s,{id,attemptId:'seed',type:'select',arrowId:id}).state;return [i===0?'arowgo.slice.v1':`arowgo.level.${level.levelId}.v1`,JSON.stringify(s)];});
 await page.addInitScript(values=>{for(const [k,v] of values)localStorage.setItem(k,v);},saves);
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,800]]){
  await page.setViewportSize({width,height});await page.goto('/#home');
  const hero=page.locator('.bloom-home-island');await expect(hero).toHaveAttribute('src','/assets/generated/verdant-cove-home-v1.png');
  await expect.poll(()=>hero.evaluate(e=>(e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.cove-scenery picture')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  for(const control of await page.locator('.hub-header > *').all()){const b=(await control.boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width);}
  await page.screenshot({path:`docs/verification/cove-home-${width}.png`,scale:'css'});
 }
});
