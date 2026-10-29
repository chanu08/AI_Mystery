import { randomUUID } from 'node:crypto';
import { validateMystery } from './validators.js';
import { scoreCase } from './scoring.js';
import { generateMystery, geminiConfigured } from './gemini/generateMystery.js';
import { CaseRecord } from '../models/CaseRecord.js';

const cases = new Map();
export const findCase = id => cases.get(id);
export const listCases = guestId => [...cases.values()].filter(c => !guestId || c.guestId === guestId).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
export const caseStatus = c => ({ status:c.status, stage:c.stage, progress:c.progress, errorCode:c.errorCode || null, errorMessage:c.status==='failed'?c.failureReason||'Case generation failed.':null });

export async function initializeCases(){
  if(CaseRecord.db.readyState!==1)return;
  try{
    const saved=await CaseRecord.find({}).lean();
    for(const doc of saved){const c=doc.payload;if(c?.id)cases.set(c.id,c);}
    console.info(`Restored ${saved.length} case(s) from MongoDB.`);
  }catch(error){console.error('MongoDB case restore failed:',JSON.stringify({name:error.name||null,code:error.code||null}));}
}

export async function persistCase(c){
  if(CaseRecord.db.readyState!==1)return false;
  const expiresAt=new Date(Date.parse(c.createdAt)+7*86400000);
  const update={$set:{guestId:c.guestId,payload:c,createdAt:new Date(c.createdAt),expiresAt}};
  if(c.shareToken)update.$set.shareToken=c.shareToken;
  else update.$unset={shareToken:1};
  try{await CaseRecord.updateOne({caseId:c.id},update,{upsert:true});return true;}
  catch(error){console.error('MongoDB case save failed:',JSON.stringify({name:error.name||null,code:error.code||null}));return false;}
}

function safeGenerationError(error){
  const status=Number(error.status||error.code||0);
  if(/Gemini is not configured/i.test(error.message||''))return 'Gemini is missing GEMINI_API_KEY or GEMINI_TEXT_MODEL in server/.env.';
  if(status===503||status===502||status===504)return 'Gemini is temporarily unavailable. Please retry in a moment.';
  if(status===429)return 'Gemini rate limit reached. Please retry in a moment.';
  if(status===401||status===403)return 'Gemini rejected the configured credentials or API permissions.';
  if(status===400)return 'Gemini rejected the request. Check the configured model name and request settings.';
  if(status===404)return 'Gemini could not find the configured model. Check GEMINI_TEXT_MODEL.';
  const networkCode=error.cause?.code||error.code;
  if(networkCode&&typeof networkCode==='string')return `Could not reach Gemini (${networkCode}). Check the server’s outbound network access.`;
  if(error.name==='TypeError')return 'Could not reach Gemini. Check the server’s outbound network access.';
  if(error.name==='AbortError'||/gateway timeout|timed out|request timeout|\btimeout\b/i.test(error.message||''))return 'Gemini timed out before returning the case. The server will retry; if it persists, try again shortly.';
  if(error.message?.startsWith('Gemini returned an invalid case'))return 'Gemini responded, but its case failed validation after three attempts.';
  if(/Culprit must be|At least|Clues must|Every suspect|Evidence set|references missing evidence|Red herring must|Timeline references/.test(error.message||''))return `Generated case failed a consistency check: ${error.message}`;
  if(error.name==='ZodError')return 'Gemini returned data that did not match the required case format.';
  return 'Case generation could not be completed. Check the server log for the failure code.';
}

function safeErrorDetails(error,input){
  let message=String(error?.message||'No error message');
  const inferredStatus=/gateway timeout|timed out|request timeout/i.test(message)?504:/service unavailable|temporarily unavailable/i.test(message)?503:0;
  for(const secret of [process.env.GEMINI_API_KEY,process.env.MONGODB_URI,input?.seed])if(secret)message=message.split(secret).join('[redacted]');
  message=message.replace(/AIza[\w-]{20,}/g,'[redacted-key]').replace(/(?:https?|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,'[redacted-uri]');
  return {name:error?.name||null,httpStatus:error?.status||inferredStatus||null,code:error?.code||error?.cause?.code||null,causeName:error?.cause?.name||null,causeCode:error?.cause?.code||null,message:message.slice(0,240)};
}

function makeDemo(seed, difficulty) {
  const culprit = { suspectId:'s2', name:'Mira Sen', age:34, occupation:'Event coordinator', relationshipToIncident:'Managed the gallery schedule', personality:'Precise, warm, hard to read', publicStatement:'I stayed by the stage until the toast.', alibiClaim:'At the stage from 8:10 to 8:30.' };
  const suspects = [
    { suspectId:'s1',name:'Arjun Mehta',age:29,occupation:'Photographer',relationshipToIncident:'Hired for the event',personality:'Observant and restless',publicStatement:'I was sorting photos in the west hall.',alibiClaim:'The camera roll places me in the hall.' },
    culprit,
    { suspectId:'s3',name:'Leena Rao',age:41,occupation:'Family friend',relationshipToIncident:'Borrowed the display key earlier',personality:'Charming and impulsive',publicStatement:'I never went near the gallery.',alibiClaim:'I was speaking with guests in the lobby.' },
    { suspectId:'s4',name:'Dev Khanna',age:52,occupation:'Venue manager',relationshipToIncident:'Controlled the building access',personality:'Methodical and guarded',publicStatement:'I was checking the service corridor.',alibiClaim:'A maintenance log records my rounds.' }
  ];
  const evidence = [
    { id:'e1',type:'chat',title:'Event crew group chat',description:'Messages from the evening of the incident.',relatedSuspectIds:['s1','s2'],chat:{groupName:'Orchid Hall crew',participants:['Arjun','Mira'],messages:[{sender:'Mira',text:'Can someone keep the west gallery lights on until the toast?',timestamp:'20:06'},{sender:'Arjun',text:'Already on. Your badge opened the side door at 20:14 btw',timestamp:'20:18'},{sender:'Mira',text:'Wrong badge maybe, I was on stage the whole time',timestamp:'20:20'}]} },
    { id:'e2',type:'document',title:'Gallery access log',description:'A copied entry from the venue access register.',relatedSuspectIds:['s2','s4'],document:{kind:'log',body:'20:14 — Gallery side door opened with coordinator badge M.S.\n20:19 — Door closed from inside.'} },
    { id:'e3',type:'image',title:'A photograph from the reception',description:'A candid frame captured near the gallery.',relatedSuspectIds:['s2'],image:{url:'',altText:'A blurred figure near a side doorway; a silver ribbon is visible on the handle.',capturedAt:'20:17',location:'West gallery'} },
    { id:'e4',type:'cctv',title:'West corridor camera',description:'Four still frames from the corridor camera.',relatedSuspectIds:['s2','s3'],cctv:{cameraName:'West corridor',location:'Orchid Hall',frames:[{timecode:'20:12:04',caption:'Corridor empty'},{timecode:'20:14:22',caption:'A figure enters the gallery carrying a folded event schedule'},{timecode:'20:19:10',caption:'Figure exits without the schedule'},{timecode:'20:21:02',caption:'Guests begin moving toward the gallery'}]} },
    { id:'e5',type:'document',title:'Service receipt',description:'A receipt found beside the display case.',relatedSuspectIds:['s3'],document:{kind:'receipt',body:'Lobby tea service — 20:11. Signed for by a guest. A red herring: the signature resembles Leena’s, but the venue runner confirms she was hosting the toast.'} }
  ];
  const solution = { culpritSuspectId:'s2',motive:'Mira planned to sell the heirloom after discovering her contract would not be renewed.',method:'She used her coordinator badge during a scheduled lighting distraction and hid the item in a folded event schedule.',opportunity:'The side gallery door log and corridor frames place her there during the disputed alibi window.',timeline:[{time:'20:06',event:'Mira asks that the gallery lights stay on.',evidenceIds:['e1']},{time:'20:14',event:'Her badge opens the side door.',evidenceIds:['e2']},{time:'20:19',event:'The figure leaves with the folded schedule.',evidenceIds:['e4']}],keyClues:[{evidenceId:'e2',explanation:'The badge record contradicts the claim that Mira stayed on stage.'},{evidenceId:'e4',explanation:'The camera shows the schedule used to conceal the item.'},{evidenceId:'e1',explanation:'Mira denies being at the door despite the access record.'}],redHerrings:[{suspectId:'s3',explanation:'The tea receipt looked like Leena’s, but it only places her in the lobby.',evidenceIds:['e5']}],hints:['Compare the access record with the stage alibi.','The west corridor frames show someone carrying a folded schedule.','Leena’s receipt is a distraction; check who had access to the coordinator badge.'] };
  return { title:`The ${seed.toLowerCase().includes('jewel')?'Orchid Heirloom':'West Gallery'} Case`,tagline:'A quiet room. One missing object. Four stories that do not quite fit.',brief:{setting:'A private reception at Orchid Hall',date:new Date().toISOString().slice(0,10),location:'Orchid Hall, Pune',victimOrIncident:seed,summary:'An heirloom vanished during the reception. The gallery was closed to guests, yet the access log and a corridor camera tell a different story.'},suspects,evidence,solution,difficulty,tone:'noir' };
}

export async function createCase(input, guestId='local-guest') {
  const id=randomUUID(); const c={id,...(geminiConfigured()?{}:makeDemo(input.seed,input.difficulty)),seed:input.seed,guestId,status:'generating',stage:'blueprint',progress:8,createdAt:new Date().toISOString(),hintsUsed:0,attemptsUsed:0,maxAttempts:Number(process.env.MAX_ATTEMPTS||2),difficulty:input.difficulty,tone:input.tone};
  cases.set(id,c);
  await persistCase(c);
  setImmediate(async()=>{ try { if(geminiConfigured()){c.stage='blueprint';c.progress=15;Object.assign(c,await generateMystery(input));} validateMystery(c);c.status='ready';c.stage='finalize';c.progress=100; } catch(e) { c.status='failed';c.errorCode='GENERATION_FAILED';c.failureReason=safeGenerationError(e);console.error('Case generation failed:',JSON.stringify({reason:c.failureReason,details:safeErrorDetails(e,input)}));c.progress=0; } await persistCase(c); });
  return c;
}
export function revealCase(c) { return { status:c.status, solution:c.solution, evidence:c.evidence }; }
export function resolveAccusation(c,suspectId,reasoning='') {
  if(c.status!=='ready') return {error:{code:'CASE_NOT_ACTIVE',message:'This case is no longer active.'}};
  c.attemptsUsed++; const isCorrect=suspectId===c.solution.culpritSuspectId;
  const result={isCorrect,attemptsRemaining:Math.max(0,c.maxAttempts-c.attemptsUsed),score:isCorrect?scoreCase(c,reasoning):0,status:c.status};
  if(isCorrect) c.status='solved'; else if(c.attemptsUsed>=c.maxAttempts) c.status='failed_attempts';
  result.status=c.status; if(c.status!=='ready') result.reveal=revealCase(c); return result;
}
