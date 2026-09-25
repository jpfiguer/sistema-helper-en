/**
 * Los dos agentes LLM del sistema, sobre Groq.
 *
 *   entrevistar()  hace la próxima pregunta, en inglés, y decide si repregunta
 *   evaluar()      juzga la respuesta que ya diste, en español, y la reescribe
 *
 * Están separados a propósito, con historiales distintos. El entrevistador no ve el feedback
 * (si lo viera, empezaría a corregirte en vivo) y el evaluador no ve el resto de la entrevista:
 * juzga una respuesta contra su pregunta.
 *
 * Temperaturas distintas por la misma razón: el entrevistador conviene variado (0.7) para que
 * no haga siempre la misma repregunta; el evaluador conviene estable (0.2) para que la misma
 * respuesta no saque notas distintas en dos corridas.
 */

'use strict';

const Groq = require('groq-sdk');
const { promptEntrevistador, mensajeDeTurno } = require('./prompts/interviewer');
const { promptEvaluador, mensajeDeEvaluacion } = require('./prompts/evaluator');

// groq-sdk exporta la clase como default (interop CommonJS: require() puede dar el namespace).
const GroqClient = Groq.default || Groq.Groq || Groq;

// Groq retira modelos de su catálogo. Si el default deja de existir, `npm run check` muestra
// el error de la API, y /v1/models tiene la lista vigente.
const MODELO = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const MODELO_EVAL = process.env.GROQ_MODEL_EVAL || MODELO;
const MAX_TURNOS_HISTORIAL = 8;

let cliente = null;
function getCliente() {
  if (!cliente) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('Falta GROQ_API_KEY en .env');
    cliente = new GroqClient({ apiKey });
  }
  return cliente;
}

/**
 * Produce lo próximo que dice el entrevistador.
 *
 * @param {object} p
 * @param {string} p.preguntaPlanificada  la del banco, si toca avanzar
 * @param {string} [p.ultimaRespuesta]    transcript de lo último que dijo el candidato
 * @param {number} [p.seguimientosUsados] cuántas repreguntas van sobre este tema
 * @param {Array}  [p.historial]          [{role, content}] de turnos previos
 * @returns {Promise<string>} lo que dice el entrevistador, listo para TTS
 */
async function entrevistar({
  preguntaPlanificada,
  ultimaRespuesta = '',
  seguimientosUsados = 0,
  historial = [],
}) {
  const messages = [
    { role: 'system', content: promptEntrevistador() },
    ...historial.slice(-MAX_TURNOS_HISTORIAL * 2),
    { role: 'user', content: mensajeDeTurno({ preguntaPlanificada, ultimaRespuesta, seguimientosUsados }) },
  ];

  const res = await getCliente().chat.completions.create({
    model: MODELO,
    messages,
    temperature: 0.7,
    max_tokens: 160,   // una pregunta hablada: 2–3 oraciones
  });

  const texto = res.choices?.[0]?.message?.content?.trim() || '';
  if (!texto) throw new Error('El entrevistador devolvió una respuesta vacía');
  return limpiarParaVoz(texto);
}

/**
 * Evalúa una respuesta ya dicha. Devuelve el objeto del prompt, o un objeto degradado con el
 * texto crudo si el modelo no devolvió JSON válido. Los errores de la API (red, clave, modelo)
 * sí se propagan: server.js los muestra como aviso y la sesión sigue.
 *
 * @param {object} p
 * @param {string} p.pregunta
 * @param {string} p.respuesta   transcript de lo que dijo el candidato
 * @param {object} p.metricas    salida de metrics.medirRespuesta()
 */
async function evaluar({ pregunta, respuesta, metricas }) {
  if (!respuesta || !respuesta.trim()) return null;

  const res = await getCliente().chat.completions.create({
    model: MODELO_EVAL,
    messages: [
      { role: 'system', content: promptEvaluador() },
      { role: 'user', content: mensajeDeEvaluacion({ pregunta, respuesta, metricas }) },
    ],
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  });

  const crudo = res.choices?.[0]?.message?.content?.trim() || '';
  return parsearEvaluacion(crudo);
}

/**
 * Parsea la evaluación con tolerancia. Aun con response_format algunos modelos devuelven el
 * JSON envuelto en ```json. Si no se puede parsear, devolvemos el texto crudo en el comentario
 * de contenido: es mejor mostrar algo imperfecto que tragarse el feedback.
 */
function parsearEvaluacion(crudo) {
  if (!crudo) return null;
  const limpio = crudo.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const obj = JSON.parse(limpio);
    return {
      contenido: obj.contenido || { nota: null, comentario: '' },
      ingles: obj.ingles || { nota: null, comentario: '', correcciones: [] },
      entrega: obj.entrega || { comentario: '' },
      reescritura: obj.reescritura || '',
      una_cosa: obj.una_cosa || '',
      degradado: false,
    };
  } catch {
    return {
      contenido: { nota: null, comentario: limpio.slice(0, 1200) },
      ingles: { nota: null, comentario: '', correcciones: [] },
      entrega: { comentario: '' },
      reescritura: '',
      una_cosa: '',
      degradado: true,
    };
  }
}

/**
 * Saca del texto lo que no se debe pronunciar: markdown, comillas de apertura/cierre que el
 * TTS lee raro, y prefijos tipo "Interviewer:" que el modelo agrega de vez en cuando.
 */
function limpiarParaVoz(texto) {
  return texto
    .replace(/^(interviewer|hiring manager|you)\s*:\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { entrevistar, evaluar, parsearEvaluacion, limpiarParaVoz, MODELO };
