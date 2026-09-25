/**
 * Tests del reporte de progreso: qué sesiones entran en la comparación.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { leerSesion } = require('../scripts/report');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporte-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function escribir(nombre, eventos) {
  const f = path.join(dir, nombre);
  fs.writeFileSync(f, `${eventos.map((e) => JSON.stringify(e)).join('\n')}\n`);
  return f;
}

const respuesta = {
  type: 'respuesta',
  metricas: { palabras: 40, segundos: 20, wpm: 120, densidadRellenos: 0.05, riquezaLexica: 0.7 },
};

test('una entrevista con apoyo queda marcada como guiada', () => {
  const f = escribir('2026-09-20T10-00-00.jsonl', [{ type: 'session', modo: 'entrevista', guiada: true }, respuesta]);
  assert.equal(leerSesion(f).guiada, true);
});

test('una entrevista sin apoyo no, y conserva las notas del evaluador', () => {
  const f = escribir('2026-09-21T10-00-00.jsonl', [
    { type: 'session', modo: 'entrevista', guiada: false },
    respuesta,
    { type: 'evaluacion', evaluacion: { contenido: { nota: 4 }, ingles: { nota: 3 } } },
  ]);
  const s = leerSesion(f);
  assert.equal(s.guiada, false);
  assert.equal(s.notaContenido, 4);
  assert.equal(s.notaIngles, 3);
});

test('un log sin el campo guiada se reconoce por sus eventos de pronunciación', () => {
  const f = escribir('2026-09-19T10-00-00.jsonl', [
    { type: 'session', modelo: 'x' },
    respuesta,
    { type: 'pronunciacion', intento: 1 },
  ]);
  assert.equal(leerSesion(f).guiada, true);
});

test('una sesión sin respuestas no entra en el reporte', () => {
  const f = escribir('2026-09-18T10-00-00.jsonl', [{ type: 'session', modo: 'lectura' }, { type: 'lectura' }]);
  assert.equal(leerSesion(f), null);
});
