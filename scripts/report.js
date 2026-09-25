#!/usr/bin/env node
/**
 * Progreso entre sesiones.
 *
 *   npm run reporte
 *
 * Lee los JSONL de `sesiones/` y muestra cómo se movieron las métricas en el tiempo. No llama a
 * ningún modelo: ritmo, muletillas y léxico son los números que calculó metrics.js en cada
 * respuesta, y las notas de contenido e inglés son las que puso el evaluador (un LLM) en su
 * momento. El reporte las promedia por sesión, y la nota de inglés entra en la comparación
 * marcada como juicio del modelo.
 *
 * Las sesiones de entrevista con apoyo van en una tabla aparte y no entran en la comparación:
 * ahí la respuesta se lee en pantalla, y su ritmo y sus muletillas no son comparables con los de
 * una respuesta improvisada.
 *
 * Desde la cuarta sesión compara el promedio de las primeras contra el de las últimas: dos contra
 * dos con cuatro o cinco sesiones, tres contra tres desde la sexta.
 *
 * Opciones:
 *   --n=20        cuántas sesiones mostrar por tabla (por defecto 15)
 *   --json        salida JSON en vez de tabla, para graficarlo aparte
 */

'use strict';

// quiet: dotenv 17 escribe un aviso en stdout, y --json tiene que salir limpio para jq.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { promediar } = require('../src/metrics');

const DIR = process.env.SESSION_DIR || path.join(__dirname, '..', 'sesiones');
const NEG = '\x1b[1m'; const GRIS = '\x1b[90m'; const FIN = '\x1b[0m';
const VERDE = '\x1b[32m'; const ROJO = '\x1b[31m'; const AMAR = '\x1b[33m';

function args() {
  const a = { n: 15, json: false };
  for (const x of process.argv.slice(2)) {
    if (x === '--json') a.json = true;
    else if (x.startsWith('--n=')) a.n = Math.max(1, Number(x.slice(4)) || 15);
  }
  return a;
}

/** Lee un JSONL tolerando líneas corruptas: un archivo truncado no debe romper el reporte. */
function leerSesion(file) {
  const lineas = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const eventos = [];
  for (const l of lineas) {
    try { eventos.push(JSON.parse(l)); } catch { /* línea a medio escribir */ }
  }
  const meta = eventos.find((e) => e.type === 'session') || {};
  const metricas = eventos.filter((e) => e.type === 'respuesta' && e.metricas).map((e) => e.metricas);
  if (!metricas.length) return null;

  const resumen = promediar(metricas);
  const notas = eventos
    .filter((e) => e.type === 'evaluacion' && e.evaluacion)
    .map((e) => e.evaluacion);

  const prom = (sel) => {
    const v = notas.map(sel).filter((x) => typeof x === 'number');
    return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)) : null;
  };

  return {
    archivo: path.basename(file),
    fecha: path.basename(file).slice(0, 10),
    // Los logs sin el campo `guiada` se reconocen por sus eventos 'pronunciacion', que solo se
    // escriben en la entrevista con apoyo.
    guiada: meta.guiada === true || eventos.some((e) => e.type === 'pronunciacion'),
    ...resumen,
    notaContenido: prom((e) => e.contenido?.nota),
    notaIngles: prom((e) => e.ingles?.nota),
  };
}

function cargar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .map((f) => { try { return leerSesion(path.join(DIR, f)); } catch { return null; } })
    .filter(Boolean);
}

function pad(s, n, der = false) {
  const t = String(s ?? '—');
  return der ? t.padStart(n) : t.padEnd(n);
}

/** Para wpm no existe "más es mejor": la banda cómoda es 130–160 y se juzga por distancia. */
function flechaWpm(a, b) {
  if (a == null || b == null) return '';
  const dist = (x) => (x < 130 ? 130 - x : x > 160 ? x - 160 : 0);
  const d = dist(a) - dist(b);
  if (Math.abs(d) < 4) return `${GRIS}=${FIN}`;
  return d > 0 ? `${VERDE}▲${FIN}` : `${ROJO}▼${FIN}`;
}

function flechaMenosEsMejor(a, b, umbral) {
  if (a == null || b == null) return '';
  const d = a - b;
  if (Math.abs(d) < umbral) return `${GRIS}=${FIN}`;
  return d > 0 ? `${VERDE}▲${FIN}` : `${ROJO}▼${FIN}`;
}

function flechaMasEsMejor(a, b, umbral) {
  if (a == null || b == null) return '';
  const d = b - a;
  if (Math.abs(d) < umbral) return `${GRIS}=${FIN}`;
  return d > 0 ? `${VERDE}▲${FIN}` : `${ROJO}▼${FIN}`;
}

function plural(n) {
  return `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;
}

function tabla(titulo, sesiones, n) {
  const ult = sesiones.slice(-n);
  const recorte = sesiones.length > ult.length ? `${GRIS} (últimas ${ult.length})${FIN}` : '';
  console.log(`\n${NEG}${titulo}${FIN}${recorte}\n`);
  console.log(`  ${GRIS}${pad('fecha', 12)}${pad('resp', 6, true)}${pad('min', 7, true)}${pad('wpm', 6, true)}${pad('muletillas', 12, true)}${pad('léxico', 8, true)}${pad('contenido', 11, true)}${pad('inglés', 8, true)}${FIN}`);

  for (const s of ult) {
    console.log(
      `  ${pad(s.fecha, 12)}${pad(s.respuestas, 6, true)}${pad((s.segundosTotales / 60).toFixed(1), 7, true)}` +
      `${pad(s.wpmPromedio ?? '—', 6, true)}${pad(`${(s.densidadRellenosPromedio * 100).toFixed(1)}%`, 12, true)}` +
      `${pad(s.riquezaLexicaPromedio?.toFixed(2) ?? '—', 8, true)}${pad(s.notaContenido ?? '—', 11, true)}${pad(s.notaIngles ?? '—', 8, true)}`,
    );
  }
}

/** Primeras contra últimas, con k = 2 hasta cinco sesiones y k = 3 desde la sexta. */
function comparar(sesiones) {
  if (sesiones.length < 4) {
    console.log(`\n${AMAR}  Con ${plural(sesiones.length)} todavía no hay tendencia que leer.${FIN}`);
    console.log(`${GRIS}  Desde la cuarta el reporte compara las primeras contra las últimas.${FIN}`);
    return;
  }

  const k = Math.min(3, Math.floor(sesiones.length / 2));
  const prom = (lista, sel) => {
    const v = lista.map(sel).filter((x) => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const ini = sesiones.slice(0, k);
  const fin = sesiones.slice(-k);

  const wpmA = prom(ini, (s) => s.wpmPromedio); const wpmB = prom(fin, (s) => s.wpmPromedio);
  const mulA = prom(ini, (s) => s.densidadRellenosPromedio); const mulB = prom(fin, (s) => s.densidadRellenosPromedio);
  const lexA = prom(ini, (s) => s.riquezaLexicaPromedio); const lexB = prom(fin, (s) => s.riquezaLexicaPromedio);
  const ingA = prom(ini, (s) => s.notaIngles); const ingB = prom(fin, (s) => s.notaIngles);

  console.log(`\n${NEG}Primeras ${k} vs últimas ${k}${FIN}\n`);
  const fmt = (a, b, f, unidad = '') => `${a == null ? '—' : a.toFixed(unidad === '%' ? 1 : unidad === 'n' ? 1 : 0)}${unidad === '%' ? '%' : ''} → ${b == null ? '—' : b.toFixed(unidad === '%' ? 1 : unidad === 'n' ? 1 : 0)}${unidad === '%' ? '%' : ''}  ${f}`;
  console.log(`  ${pad('ritmo (wpm)', 18)}${fmt(wpmA, wpmB, flechaWpm(wpmA, wpmB))}   ${GRIS}cómodo: 130–160${FIN}`);
  console.log(`  ${pad('muletillas', 18)}${fmt(mulA == null ? null : mulA * 100, mulB == null ? null : mulB * 100, flechaMenosEsMejor(mulA, mulB, 0.005), '%')}   ${GRIS}objetivo: bajo 4%${FIN}`);
  console.log(`  ${pad('léxico', 18)}${fmt(lexA, lexB, flechaMasEsMejor(lexA, lexB, 0.01), 'n')}   ${GRIS}único/total, sube al dejar de repetirte${FIN}`);
  console.log(`  ${pad('nota de inglés', 18)}${fmt(ingA, ingB, flechaMasEsMejor(ingA, ingB, 0.2), 'n')}   ${GRIS}juicio del modelo, no aritmética${FIN}`);

  console.log(`\n${GRIS}  Cada fila es un día, y el cansancio, el tema y la hora la mueven. La comparación\n  promedia varias sesiones por lado.${FIN}`);
}

function main() {
  const { n, json } = args();
  const todas = cargar();

  if (!todas.length) {
    console.log(`\n  No hay sesiones en ${DIR}.\n  Practica una con ${NEG}npm start${FIN} y vuelve.\n`);
    return;
  }

  if (json) {
    console.log(JSON.stringify(todas, null, 2));
    return;
  }

  const improvisadas = todas.filter((s) => !s.guiada);
  const conApoyo = todas.filter((s) => s.guiada);

  if (improvisadas.length) {
    tabla(`Progreso: ${plural(improvisadas.length)} de entrevista`, improvisadas, n);
    comparar(improvisadas);
  } else {
    console.log(`\n  Todavía no hay sesiones de entrevista sin apoyo, que son las que muestran tendencia.`);
  }

  if (conApoyo.length) {
    tabla(`Con apoyo: ${plural(conApoyo.length)}`, conApoyo, n);
    console.log(`\n${GRIS}  Respuestas leídas en pantalla: no entran en la comparación.${FIN}`);
  }

  console.log('');
}

if (require.main === module) main();

module.exports = { leerSesion, cargar };
