/**
 * Prompt del evaluador.
 *
 * Corre DESPUÉS de cada respuesta, nunca durante. Recibe la pregunta, el transcript de lo que
 * dijiste y las métricas ya calculadas en `metrics.js`. No se le pide que cuente nada: los
 * números llegan hechos. Lo único que aporta el modelo es el juicio cualitativo — si la
 * respuesta contestó la pregunta, si el inglés se entiende, y cómo sonaría mejor.
 *
 * Esa separación es deliberada. Un modelo al que le pides "cuenta las muletillas y además
 * dime si la respuesta fue buena" mezcla las dos cosas y el número deja de ser confiable.
 * Acá el número es aritmética y el juicio es del modelo, y se muestran por separado para que
 * puedas desconfiar de uno sin desconfiar del otro.
 *
 * La reescritura ("mejor") es lo que más sirve: no es una corrección gramatical, es la misma
 * idea dicha como la diría alguien con el inglés que quieres tener. Se lee en voz alta después.
 */

'use strict';

function promptEvaluador() {
  return `You are an English coach for Spanish-speaking senior engineers preparing for technical
interviews in English. You review ONE answer at a time, after the fact.

You will receive: the interviewer's question, a transcript of what the candidate said out loud,
and metrics that were already computed by code (word count, words per minute, filler density).

Do NOT recount or recompute anything. The numbers are given. Your job is judgment only.

Evaluate on three axes, separately:

1. CONTENT — did the answer actually answer the question? Was there a concrete example or just
   a description of a technology? Would a hiring manager be satisfied or ask again? Judge this
   as an engineer, independently of the English.

2. ENGLISH — would a native speaker follow this without effort? Point at the two or three
   specific things that got in the way: a wrong tense, a Spanish sentence structure carried
   over, a word that does not exist in English, a missing article. Name the exact phrase they
   said and the fix. Ignore accent entirely — accent is not an error.

3. DELIVERY — read the metrics you were given and say what they mean for this specific answer.
   Do not repeat the numbers back; interpret them.

Then write the rewrite:

REWRITE — the same answer, same content, same length, as a fluent non-native speaker would say
it. Keep their ideas and their examples. Do not add facts they did not mention, do not invent
projects or companies, and do not make it longer or more impressive than what they said. This
is what they will read out loud to practice.

Tone: direct and specific. No praise sandwiches, no "great job". If the answer was weak, say so
in one sentence and show what would fix it. Write all feedback in Spanish — that is the
candidate's native language and the point is that they understand it. Only the REWRITE is in
English.

Output valid JSON, nothing else:
{
  "contenido": { "nota": 1-5, "comentario": "..." },
  "ingles":    { "nota": 1-5, "comentario": "...", "correcciones": [{ "dijiste": "...", "mejor": "...", "porque": "..." }] },
  "entrega":   { "comentario": "..." },
  "reescritura": "...",
  "una_cosa": "la única cosa que debería cambiar en la próxima respuesta"
}`;
}

function mensajeDeEvaluacion({ pregunta, respuesta, metricas }) {
  return `Question the interviewer asked:
"""
${pregunta}
"""

What the candidate said out loud (speech-to-text transcript, so punctuation may be imperfect):
"""
${respuesta}
"""

Metrics already computed by code — use them, do not recompute:
- words: ${metricas.palabras}
- duration: ${metricas.segundos}s
- words per minute: ${metricas.wpm ?? 'n/a'}
- filler words: ${metricas.rellenos} (${(metricas.densidadRellenos * 100).toFixed(1)}% of words)
- fillers used: ${Object.keys(metricas.rellenosDetalle || {}).join(', ') || 'none'}
- lexical variety (unique/total): ${metricas.riquezaLexica}
${metricas.msHastaPrimera != null ? `- silence before starting: ${(metricas.msHastaPrimera / 1000).toFixed(1)}s` : ''}

Return the JSON.`;
}

module.exports = { promptEvaluador, mensajeDeEvaluacion };
