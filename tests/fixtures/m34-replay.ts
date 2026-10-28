// Synthetic sidecar only; this helper never freezes actual study data.
import {studyInput} from './m34-results';
import {prepareStudy} from '../../scripts/m34-study';
import {evaluateStudy,inspectStudy,renderStudyReport} from '../../scripts/m34-results';
import {verifyReplay} from '../../scripts/m34-replay-core';
export const replayTools={prepareStudy,inspectStudy,renderStudyReport};
export function replayFixture(current=studyInput()){
 const original=structuredClone(current);original.observations=[];original.blocks.forEach(b=>{b.unblinded_at=null;});
 const preparations=original.blocks.map(b=>{const p=b.prepared;return {case_id:p.participantId+'/'+p.block,input:{participantId:p.participantId,block:p.block,consentId:p.consentId,consented:true,seed:'synthetic-study',enrollmentIndex:Number(p.participantId.slice(1))-1,engineVersion:p.engineVersion,policyVersion:'training-fit/1',evidenceRevision:p.evidenceRevision,officialRevision:p.officialRevision,min:p.range[0],max:p.range[1],target:p.target,themes:p.themes,goal:p.goal,eligiblePool:[...p.baseline,...p.personalized],personalizedIds:p.personalized.map(x=>x.id),eligibilitySource:p.eligibilitySource}};});
 const freeze={version:'m34-freeze/1',rules:{preparation:'study-preparation/1',results:'m34-results/1',criteria:'m34-observation/1'},preparations,frozen:original};
 const artifact=evaluateStudy(current),markdown=renderStudyReport(artifact);return {freeze,current,artifact,markdown};
}
export const refreshArtifact=(v:ReturnType<typeof replayFixture>)=>{v.artifact=evaluateStudy(v.current);v.markdown=renderStudyReport(v.artifact);};
export const replay=(v= replayFixture())=>verifyReplay(v.freeze,v.current,v.artifact,v.markdown,replayTools);
