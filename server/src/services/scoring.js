export function scoreCase(c, reasoning='') {
  const base={easy:1000,medium:1500,hard:2000}[c.difficulty]||1500;
  const timePenalty=Math.min(base*.4,Math.max(0,Math.floor((Date.now()-Date.parse(c.createdAt)-300000)/10000)));
  const hints=150*(c.hintsUsed||0), attempts=(c.attemptsUsed>1?base*.25:0);
  const keys=c.solution.keyClues.map(x=>x.explanation.toLowerCase().split(/\W+/).filter(w=>w.length>5));
  const words=new Set(reasoning.toLowerCase().split(/\W+/));
  const bonus=keys.filter(k=>k.some(w=>words.has(w))).length>=2?base*.1:0;
  return Math.max(100,Math.round(base-hints-timePenalty-attempts+bonus));
}
