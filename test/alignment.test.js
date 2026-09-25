/**
 * Tests de la alineación lectura-vs-transcripción.
 *
 * Igual que en metrics.test.js: se testea lo que tiene respuesta correcta. Que una palabra
 * mal pronunciada se detecte es determinístico dado el transcript; si Deepgram la oyó bien
 * o mal no lo es, y eso no se finge acá.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compararFrase, palabrasATrabajar, tokenizar, normalizar,
} = require('../src/alignment');

/** Helper: arma words[] estilo Deepgram con confianza uniforme. */
function oidas(frase, conf = 0.99) {
  return frase.split(/\s+/).filter(Boolean).map((w, i) => ({
    word: w, confidence: conf, start: i * 0.3, end: i * 0.3 + 0.25,
  }));
}

// ── normalización ─────────────────────────────────────────────────────────────

test('las contracciones se expanden en ambos lados', () => {
  assert.equal(normalizar("I don't know"), 'i do not know');
  assert.equal(normalizar('I do not know'), 'i do not know');
});

test('una contracción con apóstrofo curvo también se expande', () => {
  assert.equal(normalizar('I don’t know'), 'i do not know');
  assert.equal(normalizar('It’s what we’re measuring'), 'it is what we are measuring');
});

test('leer bien una contracción con apóstrofo curvo no cuenta como error', () => {
  const r = compararFrase('I don’t run it', oidas("i don't run it"));
  assert.equal(r.resumen.precision, 1);
  assert.equal(r.problemas.length, 0);
  assert.equal(r.resumen.agregada, 0);
});

test('una contracción no cuenta como omitida más agregada', () => {
  const r = compararFrase("I don't run Kubernetes", oidas('i do not run kubernetes'));
  assert.equal(r.resumen.omitida, 0);
  assert.equal(r.resumen.agregada, 0);
  assert.equal(r.resumen.ok, 5);
});

test('la puntuación no cambia el resultado', () => {
  const r = compararFrase('Two layers, deliberately separate.', oidas('two layers deliberately separate'));
  assert.equal(r.resumen.ok, 4);
  assert.equal(r.resumen.cambiada, 0);
});

// ── los tres tipos de problema ────────────────────────────────────────────────

test('una palabra que se convirtió en otra se marca cambiada, con lo que se oyó', () => {
  const r = compararFrase('we ship it every week', oidas('we sheep it every week'));
  const cambiada = r.items.find((i) => i.tipo === 'cambiada');
  assert.ok(cambiada, 'debería haber una palabra cambiada');
  assert.equal(cambiada.esperada, 'ship');
  // el reporte tiene que decir QUÉ se oyó, no solo que estuvo mal
  assert.equal(cambiada.oida, 'sheep');
});

test('un par mínimo de vocal larga y corta se detecta en cualquier sentido', () => {
  const r = compararFrase('the queue is full', oidas('the queue is fool'));
  const cambiada = r.items.find((i) => i.tipo === 'cambiada');
  assert.equal(cambiada.esperada, 'full');
  assert.equal(cambiada.oida, 'fool');
});

test('una palabra comida se marca omitida', () => {
  const r = compararFrase('the evaluation layer is mine', oidas('the layer is mine'));
  const om = r.items.filter((i) => i.tipo === 'omitida');
  assert.equal(om.length, 1);
  assert.equal(om[0].esperada, 'evaluation');
});

test('una repetición se marca agregada y no ensucia la precisión', () => {
  const r = compararFrase('the golden dataset', oidas('the the golden dataset'));
  assert.equal(r.resumen.agregada, 1);
  assert.equal(r.resumen.ok, 3);
  assert.equal(r.resumen.precision, 1); // las agregadas no bajan la precisión
});

test('confianza baja marca dudosa aunque la palabra sea la correcta', () => {
  const r = compararFrase('threshold blocks the merge', oidas('threshold blocks the merge', 0.42));
  assert.equal(r.resumen.dudosa, 4);
  assert.equal(r.resumen.ok, 0);
  assert.equal(r.resumen.precision, 0);
});

test('sin confianza en los datos no se inventan dudosas', () => {
  const r = compararFrase('threshold blocks the merge', ['threshold', 'blocks', 'the', 'merge']);
  assert.equal(r.resumen.dudosa, 0);
  assert.equal(r.resumen.ok, 4);
});

// ── números: la trampa que haría inútil el reporte ────────────────────────────

test('los números escritos con dígitos no se penalizan', () => {
  // el texto dice "2,700" y se lee "twenty seven hundred": las dos son correctas
  const r = compararFrase('about 2,700 Dataform models', oidas('about twenty seven hundred dataform models'));
  assert.equal(r.resumen.cambiada, 0, 'un número leído en palabras no es un error');
  assert.ok(r.resumen['sin-evaluar'] >= 1);
});

test('un porcentaje tampoco se penaliza', () => {
  const r = compararFrase('cost dropped 50%', oidas('cost dropped fifty percent'));
  assert.equal(r.resumen.cambiada, 0);
});

// ── frase perfecta ────────────────────────────────────────────────────────────

test('una frase leída bien da precisión 1 y ningún problema', () => {
  const frase = 'I build the evaluation layer';
  const r = compararFrase(frase, oidas('i build the evaluation layer'));
  assert.equal(r.resumen.precision, 1);
  assert.equal(r.problemas.length, 0);
});

test('frase vacía no revienta', () => {
  const r = compararFrase('', []);
  assert.equal(r.resumen.precision, null);
  assert.equal(r.problemas.length, 0);
});

// ── agregación entre frases ───────────────────────────────────────────────────

test('palabrasATrabajar ordena por cuántas veces costó la misma palabra', () => {
  const c1 = compararFrase('the threshold is clear', oidas('the treshold is clear'));
  const c2 = compararFrase('a threshold blocks it', oidas('a treshold blocks it'));
  const c3 = compararFrase('the schedule is tight', oidas('the shedule is tight'));
  const lista = palabrasATrabajar([c1, c2, c3]);
  assert.equal(lista[0].palabra, 'threshold');
  assert.equal(lista[0].veces, 2);
  assert.ok(lista[0].oidaComo.length >= 1, 'guarda cómo se oyó, para poder mostrarlo');
});

test('palabrasATrabajar con lista vacía devuelve vacío', () => {
  assert.deepEqual(palabrasATrabajar([]), []);
  assert.deepEqual(palabrasATrabajar(null), []);
});

// ── tokenizar ─────────────────────────────────────────────────────────────────

test('tokenizar deja solo palabras comparables', () => {
  assert.deepEqual(tokenizar('Well — the system, actually.'), ['well', 'the', 'system', 'actually']);
});

// ── set de lectura ────────────────────────────────────────────────────────────

const { LECTURAS, armarLectura, contarFrases, rondas } = require('../src/lecturas');

test('los ids del set de lectura son únicos', () => {
  const ids = LECTURAS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('ninguna frase pasa de 20 palabras', () => {
  // El endpointing de Deepgram parte las frases largas y la alineación queda a medias,
  // culpando a palabras que sí dijiste. El límite está documentado en lecturas.js.
  for (const l of LECTURAS) {
    for (const f of l.frases) {
      const n = f.split(/\s+/).filter(Boolean).length;
      assert.ok(n <= 20, `"${f.slice(0, 40)}…" tiene ${n} palabras`);
    }
  }
});

test('ninguna lectura queda sin frases', () => {
  for (const l of LECTURAS) assert.ok(l.frases.length > 0, l.id);
});

test('armarLectura filtra por ronda y respeta el orden de ids', () => {
  const r = rondas()[0];
  const soloUna = armarLectura({ ronda: r });
  assert.ok(soloUna.length > 0);
  assert.ok(soloUna.every((l) => l.ronda === r));

  const porIds = armarLectura({ ids: ['lec-03', 'lec-01'] });
  assert.deepEqual(porIds.map((l) => l.id), ['lec-03', 'lec-01']);
});

test('armarLectura sin filtros devuelve todo, y contarFrases cuadra', () => {
  const todas = armarLectura();
  assert.equal(todas.length, LECTURAS.length);
  assert.equal(contarFrases(todas), LECTURAS.reduce((a, l) => a + l.frases.length, 0));
});

test('un id inexistente se ignora en vez de romper', () => {
  assert.deepEqual(armarLectura({ ids: ['no-existe'] }), []);
});

// ── comparación entre intentos ────────────────────────────────────────────────

const { compararIntentos } = require('../src/alignment');

test('arreglar más de lo que rompes es mejorar', () => {
  const a = compararFrase('the threshold blocks the merge', oidas('the treshold blocs the merge'));
  const b = compararFrase('the threshold blocks the merge', oidas('the threshold blocks the merge'));
  const c = compararIntentos(a, b);
  assert.equal(c.veredicto, 'mejor');
  assert.ok(c.arregladas.length >= 1);
  assert.equal(c.empeoradas.length, 0);
  assert.ok(c.delta > 0);
});

test('romper lo que estaba bien es empeorar', () => {
  const a = compararFrase('the threshold blocks the merge', oidas('the threshold blocks the merge'));
  const b = compararFrase('the threshold blocks the merge', oidas('the treshold blocs the merge'));
  const c = compararIntentos(a, b);
  assert.equal(c.veredicto, 'peor');
  assert.ok(c.empeoradas.length >= 1);
});

test('cambiar unos errores por otros NO es mejorar, aunque la precisión sea igual', () => {
  // misma cantidad de fallos, palabras distintas: el porcentaje engaña, el veredicto no
  const a = compararFrase('the threshold blocks the merge', oidas('the treshold blocks the merge'));
  const b = compararFrase('the threshold blocks the merge', oidas('the threshold blocs the merge'));
  const c = compararIntentos(a, b);
  assert.equal(c.delta, 0);
  assert.equal(c.veredicto, 'igual');
  assert.deepEqual(c.arregladas, ['threshold']);
  assert.deepEqual(c.empeoradas, ['blocks']);
});

test('lo que sigue fallando se reporta aparte', () => {
  const a = compararFrase('the threshold blocks it', oidas('the treshold blocs it'));
  const b = compararFrase('the threshold blocks it', oidas('the treshold blocks it'));
  const c = compararIntentos(a, b);
  assert.deepEqual(c.persisten, ['threshold']);
  assert.deepEqual(c.arregladas, ['blocks']);
});

test('comparar contra un intento vacío no revienta', () => {
  const b = compararFrase('the threshold blocks it', oidas('the threshold blocks it'));
  const c = compararIntentos(null, b);
  assert.equal(c.precisionAntes, null);
  assert.equal(c.delta, null);
});
