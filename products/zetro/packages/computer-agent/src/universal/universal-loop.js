import { createExecutionJournal } from './execution-journal.js';
import { validateComputerAction } from '../../../model-gateway/src/contracts/action-contract.js';

export class UniversalAgentLoopError extends Error {
  constructor(message, details = {}) { super(`[UniversalAgentLoop] ${message}`); this.name='UniversalAgentLoopError'; this.details=details; }
}

// Every awaited port shares one cancellation/deadline boundary.
async function bounded(call, signal, timeoutMs) {
  if (signal.aborted) throw signal.reason || new Error('Cancelled');
  let timer, abort;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Port deadline exceeded')),timeoutMs);
        abort=()=>reject(signal.reason || new Error('Cancelled'));
        signal.addEventListener('abort',abort,{once:true});
      })
    ]);
  } finally { clearTimeout(timer); signal.removeEventListener('abort',abort); }
}
const targetKey = target => target && JSON.stringify([target.windowHandle??target.hwnd,target.processId,target.processStartedAt??target.generation]);

export async function runUniversalComputerAgent({goal,router,actionDispatcher,observer=null,screenCapturer=null,
  journal=null,policyGate=null,verifier=null,overlayBridge=null,maxSteps=30,maxWallMs=120000,
  portTimeoutMs=10000,maxObservationAgeMs=5000,session=null,onStep=null,onHumanTakeover=null,
  onApprovalNeeded=null,signal=null}={}) {
  if(typeof goal!=='string'||!goal.trim()||goal.length>16000) throw new UniversalAgentLoopError('A bounded goal is required');
  if(!router?.proposeWithFallback||!actionDispatcher?.dispatch) throw new UniversalAgentLoopError('Router and dispatcher are required');
  for(const [key,value,max] of [['maxSteps',maxSteps,1000],['maxWallMs',maxWallMs,3600000],['portTimeoutMs',portTimeoutMs,60000],['maxObservationAgeMs',maxObservationAgeMs,60000]]) {
    if(!Number.isSafeInteger(value)||value<1||value>max) throw new UniversalAgentLoopError(`Invalid ${key}`);
  }
  const execJournal=journal||createExecutionJournal({taskGoal:goal});
  const controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason||new Error('Cancelled'));
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) abort();
  const wall=setTimeout(()=>controller.abort(new Error('Campaign deadline exceeded')),maxWallMs);
  const context={...session,signal:controller.signal};
  if(session?.intent && typeof overlayBridge?.setIntent==='function' && !overlayBridge.hasIntent) {
    overlayBridge.setIntent(session.intent);
  }
  if(session?.smartStatus && typeof overlayBridge?.setSmartStatus==='function' && !overlayBridge.hasSmartStatus) {
    overlayBridge.setSmartStatus(session.smartStatus);
  }
  if(session?.taskId && overlayBridge && !overlayBridge.taskId) {
    overlayBridge.taskId = session.taskId;
  }
  let steps=0,uncertain=false;
  const history=[];
  let overlayTarget=session?.targetId, overlayDisplay=session?.displayBounds;
  const emit=(state,data={})=>overlayBridge?.transition?.(state,{sessionId:session?.sessionId,targetId:overlayTarget,display:overlayDisplay,...data});
  const invoke=fn=>bounded(fn,controller.signal,portTimeoutMs);
  const fresh=observation=>{
    const time=observation?.timestamp??observation?.observedAt;
    if(!observation||!Number.isFinite(time)||time>Date.now()+100||Date.now()-time>maxObservationAgeMs) throw new Error('Missing or stale observation');
    if(observation.error||observation.success===false) throw new Error('Observation failed');
    return observation;
  };
  const observe=async()=>{
    emit('observing');
    const result=observer?.observe ? await invoke(()=>observer.observe(context)) : screenCapturer ? {timestamp:Date.now(),imageBuffer:await invoke(()=>screenCapturer(context))} : await invoke(()=>actionDispatcher.dispatch({type:'observe'},context));
    const observed=fresh(result?.observation || result);
    overlayTarget=observed.target?.targetId||session?.targetId;
    overlayDisplay=observed.target?.displayBounds||observed.displayBounds||session?.displayBounds;
    emit('observing',{pointer:observed.pointer||null});
    return observed;
  };
  const checkSession=()=>{
    if(controller.signal.aborted) throw controller.signal.reason||new Error('Cancelled');
      if(!session?.sessionId||!session.targetId||!Number.isFinite(session.expiresAt)||Date.now()>=session.expiresAt) throw new Error('Missing or expired execution session');
  };
  const done=(status,summary,extra={})=>{
    emit('stopped',{activity:{phase:status,verified:extra.verified===true}});
    return {success:status==='completed',status,summary,steps,journal:execJournal,...extra};
  };
  try {
    if(controller.signal.aborted) return done('cancelled','Cancelled before observation');
    let observation=await observe();
    if(session?.intent && overlayBridge?.hasIntent) {
      emit('intention',{pointer:observation.pointer||null});
    }
    while(steps<maxSteps) {
      steps++;
      fresh(observation);
      emit('thinking');
      const proposal=await invoke(()=>router.proposeWithFallback({prompt:goal,observation,screenshotBuffer:observation.imageBuffer||null,history:history.slice(-20),signal:controller.signal}));
      const action=validateComputerAction(proposal?.action);
      const modelId=proposal.modelId||'unknown';
      if(action.type==='finish') {
        emit('thinking',{activity:{phase:'checking'}});
        const result=verifier?.verifyGoal ? await invoke(()=>verifier.verifyGoal({goal,action,observation,session,history,signal:controller.signal})) : null;
        const verified=action.success!==false&&result?.verified===true;
        execJournal.appendStep({modelId,action,observationBefore:observation,verificationResult:result,status:verified?'success':'rejected'});
        return done(verified?'completed':'blocked',verified?'Goal independently verified':'Planner completion is not independently verified',{verified});
      }
      if(action.type==='requestApproval') return done('blocked','Planner requests clarification or approval',{approvalNeeded:true});
      if(action.type==='observe') {observation=await observe();continue;}
      checkSession();
      if(!policyGate?.evaluate) return done('blocked','An effect-time authority port is required');
      const needsApproval=['consequential','critical'].includes(action.riskLevel);
      if(needsApproval && (!onApprovalNeeded || await invoke(()=>onApprovalNeeded(action))!==true)) return done('blocked','Explicit approval required',{approvalNeeded:true});
      const authority=await invoke(()=>policyGate.evaluate({action,observation,session,signal:controller.signal}));
      checkSession();fresh(observation);
      if(authority?.allowed!==true) return done('blocked','Authority denied action');
      const target=observation.target;
      if(!target||!Number.isSafeInteger(target.windowHandle??target.hwnd)||(target.windowHandle??target.hwnd)<=0||!Number.isSafeInteger(target.processId)||target.processId<=0||!(target.processStartedAt??target.generation)) return done('blocked','Exact native target identity is required');
      if(session.targetId&&target.targetId!==session.targetId) return done('blocked','Target is outside the admitted session');
      if(session.target && targetKey(session.target)!==targetKey(target)) return done('blocked','Target identity changed');
      const pointer=['mouseMove','click','scroll'].includes(action.type)?action.target||action.anchor:observation.pointer||null;
      emit('acting',{targetId:target.targetId,pointer,activity:{phase:'acting',actionType:action.type}});
      let result;
      execJournal.appendStep({modelId,action,observationBefore:observation,status:'intent'});
      uncertain=true;
      result=await invoke(()=>actionDispatcher.dispatch(action,{...context,authority,observation,target,
        targetHwnd:target.windowHandle??target.hwnd,expectedPid:target.processId,
        expectedStart:target.processStartedAt??target.generation,isApproved:needsApproval,
        grantExpiry:session.expiresAt}));
      uncertain=false;
      if(result?.interrupted||result?.code==='HUMAN_TAKEOVER_INTERRUPTED') {
        execJournal.appendStep({modelId,action,observationBefore:observation,executionResult:result,status:'interrupted'});
        onHumanTakeover?.();return done('interrupted','Human takeover detected',{interrupted:true});
      }
      if(result?.uncertain===true || result?.status==='uncertain') return done('uncertain','Effect outcome unknown; action was not retried');
      const ok=result?.success===true||result?.status==='succeeded';
      if(!ok) return done('failed','Native effect did not report success');
      execJournal.appendStep({modelId,action,observationBefore:observation,executionResult:result,status:'executed'});
      checkSession();
      uncertain=true;
      const after=await observe();
      if(targetKey(after.target)!==targetKey(target)) return done('uncertain','Target changed after effect');
      emit('thinking',{activity:{phase:'checking'}});
      const verification=verifier?.verifyStep?await invoke(()=>verifier.verifyStep({action,before:observation,after,result,session,signal:controller.signal})):null;
      uncertain=false;
      execJournal.appendStep({modelId,action,observationBefore:observation,observationAfter:after,executionResult:result,verificationResult:verification,status:verification?.verified===true?'success':'unverified'});
      history.push({role:'user',content:JSON.stringify({action:action.type,verified:verification?.verified===true,observation:{timestamp:after.timestamp,target:after.target,text:typeof after.text==='string'?after.text.slice(0,4000):undefined}})});
      if(verification?.verified!==true) return done('blocked','Effect requires independent verification before continuing');
      if (overlayBridge?.hasSmartStatus) {
        emit('thinking', { activity: { phase: 'checking', actionType: action.type, verified: true, stepId: `step-${steps}` } });
      }
      onStep?.({stepIndex:steps,action,modelId,executionResult:result});
      observation=after;
    }
    return done('blocked','Step budget exhausted');
  } catch(error) {
    const status=uncertain?'uncertain':controller.signal.aborted?'cancelled':'failed';
    execJournal.appendStep({modelId:'none',action:{type:'error'},status,error});
    return done(status,uncertain?'Effect outcome unknown; no automatic retry':String(error.message).slice(0,200));
  } finally {
    controller.abort(new Error('Agent run ended'));
    clearTimeout(wall);signal?.removeEventListener('abort',abort);
    try { emit('stopped'); } finally { overlayBridge?.close?.(); }
  }
}
