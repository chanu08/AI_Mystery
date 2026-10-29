export function validateMystery(c) {
  if (!c.suspects.some(s => s.suspectId === c.solution.culpritSuspectId)) throw new Error('Culprit must be a listed suspect.');
  if (c.solution.keyClues.length < 3) throw new Error('At least three clues are required.');
  if (new Set(c.solution.keyClues.map(x=>x.evidenceId)).size < 3) throw new Error('Clues must be independent evidence items.');
  if (c.solution.redHerrings.length < 2) throw new Error('At least two explainable red herrings are required.');
  if (!c.suspects.every(s => s.suspectId)) throw new Error('Every suspect needs an ID.');
  if (!c.evidence || c.evidence.length < 7) throw new Error('Evidence set is incomplete.');
  const types = c.evidence.reduce((counts,item)=>{counts[item.type]=(counts[item.type]||0)+1;return counts;},{});
  for (const type of ['chat','image','cctv','document']) if (!types[type]) throw new Error(`At least one ${type} evidence item is required.`);
  for (const clue of c.solution.keyClues) if (!c.evidence.some(e=>e.id===clue.evidenceId)) throw new Error('Clue references missing evidence.');
  for (const herring of c.solution.redHerrings) if (!c.suspects.some(s=>s.suspectId===herring.suspectId) || !herring.evidenceIds.every(id=>c.evidence.some(e=>e.id===id))) throw new Error('Red herring must point to a suspect and existing evidence.');
  if (!c.solution.timeline.every(item=>item.evidenceIds.every(id=>c.evidence.some(e=>e.id===id)))) throw new Error('Timeline references missing evidence.');
  return true;
}
