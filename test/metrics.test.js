/**
 * Tests de lo que es determinístico.
 *
 * Se testea lo que tiene una respuesta correcta: el conteo de muletillas, las palabras por
 * minuto derivadas de los bytes de audio, y el guard que rechaza los dispositivos de loopback.
 * Lo que juzga el LLM no se testea contra un valor esperado — no lo tiene — y fingir que sí
 * daría un test verde que no significa nada.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { medirRespuesta, contarRellenos, promediar, BYTES_POR_SEGUNDO } = require('../src/metrics');
const { elegirSalida, esLoopback } = require('../src/audioPlayer');
const { pareceMismaPregunta } = require('../src/server');
const { armarSet, PREGUNTAS } = require('../src/questionBank');
const { parsearEvaluacion, limpiarParaVoz } = require('../src/agents');
const { mensajeDeTurno, MAX_SEGUIMIENTOS } = require('../src/prompts/interviewer');

// ── métricas ──────────────────────────────────────────────────────────────────

test('wpm sale de los bytes de audio, no del reloj', () => {
  // 30 palabras en exactamente 15 s → 120 wpm
  const texto = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  const m = medirRespuesta({ texto, bytesAudio: BYTES_POR_SEGUNDO * 15 });
  assert.equal(m.palabras, 30);
  assert.equal(m.segundos, 15);
  assert.equal(m.wpm, 120);
});

test('sin audio no se inventa un wpm', () => {
  const m = medirRespuesta({ texto: 'hello there', bytesAudio: 0 });
  assert.equal(m.wpm, null);
  assert.equal(m.segundos, 0);
});

test('cuenta muletillas de una palabra y de frase sin contarlas dos veces', () => {
  const { total, detalle } = contarRellenos('So um you know the thing is like basically fine');
  assert.equal(detalle['you know'], 1);
  assert.equal(detalle['the thing is'], 1);
  assert.equal(detalle.um, 1);
  assert.equal(detalle.like, 1);
  assert.equal(detalle.basically, 1);
  // "you know" no debe sumar además como "know" suelto
  assert.equal(detalle.know, undefined);
  assert.equal(total, 6);  // so, um, you know, the thing is, like, basically
});

test('detecta fugas al español', () => {
  const { detalle } = contarRellenos('the pipeline was o sea complicated entonces we changed it');
  assert.equal(detalle['o sea'], 1);
  assert.equal(detalle.entonces, 1);
});

test('la densidad de muletillas alta levanta bandera de alerta', () => {
  const texto = 'um uh like basically um so you know the pipeline works';
  const m = medirRespuesta({ texto, bytesAudio: BYTES_POR_SEGUNDO * 6 });
  assert.ok(m.densidadRellenos > 0.08);
  assert.ok(m.banderas.some((b) => b.clave === 'rellenos_altos' && b.nivel === 'alerta'));
});

test('hablar demasiado rápido levanta bandera aunque el texto sea perfecto', () => {
  const texto = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
  const m = medirRespuesta({ texto, bytesAudio: BYTES_POR_SEGUNDO * 30 }); // 200 wpm
  assert.equal(m.wpm, 200);
  assert.ok(m.banderas.some((b) => b.clave === 'ritmo_rapido'));
});

test('una respuesta de dos palabras se marca como muy corta', () => {
  const m = medirRespuesta({ texto: 'yes exactly', bytesAudio: BYTES_POR_SEGUNDO * 2 });
  assert.ok(m.banderas.some((b) => b.clave === 'muy_corta'));
});

test('promediar ignora respuestas vacías', () => {
  const a = medirRespuesta({ texto: 'one two three four', bytesAudio: BYTES_POR_SEGUNDO * 2 });
  const b = medirRespuesta({ texto: '', bytesAudio: 0 });
  const r = promediar([a, b, null]);
  assert.equal(r.respuestas, 1);
  assert.equal(r.palabrasTotales, 4);
});

// ── guard de salida de audio ──────────────────────────────────────────────────

test('los dispositivos de loopback se reconocen por nombre', () => {
  for (const n of ['BlackHole 2ch', 'blackhole 16ch', 'Loopback Audio', 'VB-Cable', 'VoiceMeeter Input']) {
    assert.equal(esLoopback(n), true, n);
  }
  for (const n of ['MacBook Pro Speakers', 'External Headphones', 'Studio Display Speakers']) {
    assert.equal(esLoopback(n), false, n);
  }
});

test('elegirSalida rechaza el loopback y deja pasar los parlantes', () => {
  assert.throws(() => elegirSalida('BlackHole 16ch'), /audio virtual/);
  assert.equal(elegirSalida('MacBook Pro Speakers'), 'MacBook Pro Speakers');
  assert.equal(elegirSalida(''), null);        // vacío = default del sistema
});

// ── entrevistador ─────────────────────────────────────────────────────────────

test('reconoce la pregunta planificada aunque el modelo la reformule', () => {
  const planificada = 'Walk me through a data pipeline you built end to end. Where did the data come from and where did it land?';
  const reformulada = 'Sure. Could you walk me through a data pipeline you built, end to end — where the data came from and where it landed?';
  assert.equal(pareceMismaPregunta(reformulada, planificada), true);
});

test('una repregunta no se confunde con la pregunta planificada', () => {
  const planificada = 'How do you decide between batch and streaming for a given ingestion problem?';
  const repregunta = 'You mentioned Kafka there — what was the alternative you ruled out, and why?';
  assert.equal(pareceMismaPregunta(repregunta, planificada), false);
});

test('con el tope de repreguntas usado, el mensaje de turno pide avanzar', () => {
  // Es lo que manda el servidor en la entrevista con apoyo, donde no hay repreguntas.
  const m = mensajeDeTurno({ preguntaPlanificada: 'Next?', ultimaRespuesta: 'An answer.', seguimientosUsados: MAX_SEGUIMIENTOS });
  assert.match(m, /move on to the next planned question/);
  assert.doesNotMatch(m, /ask ONE follow-up/);
});

test('limpiarParaVoz saca el prefijo de rol y el markdown', () => {
  assert.equal(limpiarParaVoz('Interviewer: **Tell me** about it.'), 'Tell me about it.');
  assert.equal(limpiarParaVoz('"So, what happened next?"'), 'So, what happened next?');
});

// ── banco de preguntas ────────────────────────────────────────────────────────

test('un set tiene la forma de una entrevista real y no repite preguntas', () => {
  const set = armarSet();
  assert.equal(set.length, 7);
  assert.equal(set[0].fase, 'screening');
  assert.equal(set[set.length - 1].fase, 'cierre');
  assert.equal(set.filter((p) => p.fase === 'tecnica').length, 3);
  assert.equal(new Set(set.map((p) => p.id)).size, set.length);
});

test('excluirIds evita repetir lo que ya practicaste hoy', () => {
  const ids = PREGUNTAS.filter((p) => p.fase === 'screening').map((p) => p.id).slice(0, 3);
  const set = armarSet({ excluirIds: ids });
  assert.ok(!set.some((p) => ids.includes(p.id)));
});

test('sin difíciles solo entran preguntas de calentamiento', () => {
  const set = armarSet({ incluirDificiles: false });
  assert.ok(!set.some((p) => p.dificil));
});

test('los ids del banco son únicos', () => {
  assert.equal(new Set(PREGUNTAS.map((p) => p.id)).size, PREGUNTAS.length);
});

// ── parseo del evaluador ──────────────────────────────────────────────────────

test('el evaluador tolera JSON envuelto en fences', () => {
  const e = parsearEvaluacion('```json\n{"contenido":{"nota":4,"comentario":"ok"},"reescritura":"Better."}\n```');
  assert.equal(e.contenido.nota, 4);
  assert.equal(e.reescritura, 'Better.');
  assert.equal(e.degradado, false);
});

test('si el evaluador no devuelve JSON, el feedback se muestra igual en vez de perderse', () => {
  const e = parsearEvaluacion('Tu respuesta estuvo bien pero fue vaga.');
  assert.equal(e.degradado, true);
  assert.match(e.contenido.comentario, /vaga/);
});
