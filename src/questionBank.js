/**
 * Banco de preguntas para entrevistas de Data / AI Engineer, en inglés.
 *
 * Las preguntas no son inventadas: están derivadas de requisitos reales de avisos de
 * Data Engineer, AI Engineer y Data Architect remotos publicados en 2026 (RAG en producción,
 * pipelines batch y streaming, evaluación de modelos, orquestación multi-modelo, arquitecturas
 * de agentes). La idea es practicar contra lo que de verdad te van a preguntar, no contra un
 * listado genérico de "tell me about yourself".
 *
 * Cada pregunta trae:
 *   id        estable, para poder comparar sesiones entre sí
 *   fase      screening | tecnica | profundidad | comportamiento | cierre
 *   area      etiqueta temática, para filtrar por lo que quieres practicar
 *   texto     la pregunta, tal como la haría un entrevistador
 *   dificil   si conviene dejarla para cuando ya estés cómodo
 *
 * Un "set" es una entrevista armada: arranca liviano, sube a técnico, pega una de profundidad
 * y cierra. Es la forma real de una entrevista de 30–40 minutos.
 */

'use strict';

const PREGUNTAS = [
  // ── screening ────────────────────────────────────────────────────────────────
  { id: 'scr-01', fase: 'screening', area: 'perfil', dificil: false,
    texto: 'Tell me a bit about yourself and what you have been working on recently.' },
  { id: 'scr-02', fase: 'screening', area: 'perfil', dificil: false,
    texto: 'What kind of role are you looking for, and why are you looking to move?' },
  { id: 'scr-03', fase: 'screening', area: 'perfil', dificil: false,
    texto: 'Walk me through the project you are most proud of. What was your specific contribution?' },
  { id: 'scr-04', fase: 'screening', area: 'remoto', dificil: false,
    texto: 'You would be working remotely across time zones. How do you keep a distributed team in sync?' },

  // ── técnica: data engineering ────────────────────────────────────────────────
  { id: 'de-01', fase: 'tecnica', area: 'pipelines', dificil: false,
    texto: 'Walk me through a data pipeline you built end to end. Where did the data come from and where did it land?' },
  { id: 'de-02', fase: 'tecnica', area: 'pipelines', dificil: false,
    texto: 'How do you decide between batch and streaming for a given ingestion problem?' },
  { id: 'de-03', fase: 'tecnica', area: 'modelado', dificil: false,
    texto: 'How do you structure a warehouse into layers, and what belongs in each one?' },
  { id: 'de-04', fase: 'tecnica', area: 'calidad', dificil: false,
    texto: 'A downstream dashboard shows numbers that look wrong. How do you find out where it broke?' },
  { id: 'de-05', fase: 'tecnica', area: 'costos', dificil: true,
    texto: 'Your warehouse bill doubled this month and nobody knows why. What do you look at first?' },
  { id: 'de-06', fase: 'tecnica', area: 'modelado', dificil: true,
    texto: 'How do you handle a breaking schema change in a table that twenty downstream jobs depend on?' },
  { id: 'de-07', fase: 'tecnica', area: 'streaming', dificil: true,
    texto: 'How would you guarantee exactly-once semantics in a streaming pipeline, and when is it not worth it?' },

  // ── técnica: IA / LLM ────────────────────────────────────────────────────────
  { id: 'ai-01', fase: 'tecnica', area: 'rag', dificil: false,
    texto: 'Describe a RAG system you have built. What retrieves, what ranks, and what generates?' },
  { id: 'ai-02', fase: 'tecnica', area: 'rag', dificil: false,
    texto: 'How do you chunk documents for retrieval, and how did you decide on that strategy?' },
  { id: 'ai-03', fase: 'tecnica', area: 'evaluacion', dificil: false,
    texto: 'How do you know your RAG system got better after a change, instead of just different?' },
  { id: 'ai-04', fase: 'tecnica', area: 'evaluacion', dificil: true,
    texto: 'Walk me through your evaluation setup. What do you measure, and what does each metric miss?' },
  { id: 'ai-05', fase: 'tecnica', area: 'alucinacion', dificil: true,
    texto: 'How do you handle the case where the answer simply is not in your corpus?' },
  { id: 'ai-06', fase: 'tecnica', area: 'agentes', dificil: true,
    texto: 'When would you reach for an agent with tool calling instead of a single prompt?' },
  { id: 'ai-07', fase: 'tecnica', area: 'costos', dificil: true,
    texto: 'How do you keep latency and model spend under control in a production LLM feature?' },
  { id: 'ai-08', fase: 'tecnica', area: 'voz', dificil: true,
    texto: 'What is hard about a real-time voice agent that is not hard about a chat interface?' },

  // ── profundidad: seguimiento sobre lo que ya contó ───────────────────────────
  { id: 'dep-01', fase: 'profundidad', area: 'tradeoffs', dificil: true,
    texto: 'What would you do differently if you had to build that again from scratch?' },
  { id: 'dep-02', fase: 'profundidad', area: 'tradeoffs', dificil: true,
    texto: 'What is the part of that system you are least happy with, and why is it still like that?' },
  { id: 'dep-03', fase: 'profundidad', area: 'escala', dificil: true,
    texto: 'What breaks first if the traffic on that system goes up ten times tomorrow?' },
  { id: 'dep-04', fase: 'profundidad', area: 'tradeoffs', dificil: true,
    texto: 'You mentioned a trade-off there. What was the alternative, and why did you reject it?' },

  // ── comportamiento ───────────────────────────────────────────────────────────
  { id: 'beh-01', fase: 'comportamiento', area: 'conflicto', dificil: false,
    texto: 'Tell me about a time you disagreed with a technical decision. What did you do?' },
  { id: 'beh-02', fase: 'comportamiento', area: 'error', dificil: false,
    texto: 'Tell me about something you shipped that broke in production. How did you handle it?' },
  { id: 'beh-03', fase: 'comportamiento', area: 'comunicacion', dificil: false,
    texto: 'How do you explain a technical trade-off to someone who is not technical?' },
  { id: 'beh-04', fase: 'comportamiento', area: 'autonomia', dificil: false,
    texto: 'Tell me about a time you had to make a call without enough information.' },

  // ── cierre ───────────────────────────────────────────────────────────────────
  { id: 'clo-01', fase: 'cierre', area: 'cierre', dificil: false,
    texto: 'What questions do you have for me?' },
  { id: 'clo-02', fase: 'cierre', area: 'cierre', dificil: false,
    texto: 'Is there anything we did not cover that you think I should know about you?' },
];

const FORMA_SET = [
  { fase: 'screening', cuantas: 1 },
  { fase: 'tecnica', cuantas: 3 },
  { fase: 'profundidad', cuantas: 1 },
  { fase: 'comportamiento', cuantas: 1 },
  { fase: 'cierre', cuantas: 1 },
];

function barajar(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Arma una entrevista.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.incluirDificiles=true]  false deja solo las de calentamiento
 * @param {string[]} [opts.areas]                 filtra por área (ej. ['rag','evaluacion'])
 * @param {string[]} [opts.excluirIds]            ids ya practicados hoy, para no repetir
 * @returns {Array} preguntas en orden de entrevista
 */
function armarSet({ incluirDificiles = true, areas = null, excluirIds = [] } = {}) {
  const excluidas = new Set(excluirIds);
  const disponibles = PREGUNTAS.filter((p) => {
    if (excluidas.has(p.id)) return false;
    if (!incluirDificiles && p.dificil) return false;
    if (areas && areas.length && p.fase === 'tecnica' && !areas.includes(p.area)) return false;
    return true;
  });

  const set = [];
  for (const { fase, cuantas } of FORMA_SET) {
    const pool = barajar(disponibles.filter((p) => p.fase === fase));
    set.push(...pool.slice(0, cuantas));
  }
  return set;
}

/** Todas las áreas técnicas disponibles, para poblar el selector de la UI. */
function areasTecnicas() {
  return [...new Set(PREGUNTAS.filter((p) => p.fase === 'tecnica').map((p) => p.area))].sort();
}

module.exports = { PREGUNTAS, armarSet, areasTecnicas, barajar };
