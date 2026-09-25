/**
 * Métricas de una respuesta hablada, calculadas con aritmética y no con el LLM.
 *
 * Contar muletillas y calcular palabras por minuto es determinístico: el código da el mismo
 * número cada vez. El evaluador (prompts/evaluator.js) las recibe ya calculadas.
 *
 * Qué no dicen estos números, y cómo se mide la duración: README, «Qué mide, y qué no».
 */

'use strict';

// PCM 16-bit mono a 16 kHz = 32.000 bytes por segundo. Convierte los bytes capturados en segundos.
const BYTES_POR_SEGUNDO = 16000 * 2;

/**
 * Umbrales de las banderas: referencias para una entrevista técnica hablada, no reglas
 * universales. scripts/report.js usa los mismos valores.
 */
const UMBRALES = {
  wpmComodo: [130, 160],   // banda de referencia; el reporte mide la distancia a ella
  wpmRapido: 175,
  wpmLento: 100,
  segundosMinLento: 8,     // el ritmo lento solo se marca en respuestas más largas que esto
  rellenosAlto: 0.08,
  rellenosMedio: 0.04,
  palabrasCorta: 25,
  palabrasLarga: 220,
  msArranqueLento: 6000,
};

/**
 * Muletillas y rellenos típicos de un hispanohablante hablando inglés.
 * Multi-palabra primero: se buscan como frase antes de tokenizar.
 */
const RELLENOS_FRASE = [
  'you know', 'i mean', 'kind of', 'sort of', 'or something', 'and stuff',
  'how do you say', 'how to say', 'let me think', 'the thing is',
];

/**
 * Cuentan en cualquier posición: sonidos sin contenido ("um") y palabras que en habla técnica
 * casi siempre son relleno ("literally"). "like" y "actually" dan algún falso positivo.
 */
const RELLENOS_PALABRA = [
  'um', 'uh', 'ehm', 'eh', 'mmm', 'hmm', 'ah', 'er',
  'like', 'basically', 'actually', 'literally', 'obviously',
];

/**
 * Cuentan SOLO al abrir la respuesta. En medio de una frase suelen ser uso normal ("it works
 * well", "the right answer", "so we migrated it"); abrir con "So…" o "Well…" es el tic que se
 * quiere medir.
 */
const RELLENOS_APERTURA = ['so', 'well', 'okay', 'ok', 'right', 'anyway', 'yeah', 'yes'];

/** Palabras en español que se cuelan cuando falta vocabulario. */
const FUGAS_ES = [
  'entonces', 'osea', 'o sea', 'digamos', 'este', 'bueno', 'pues', 'claro',
  'verdad', 'no sé', 'como que', 'por ejemplo',
];

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizar(texto) {
  const t = normalizar(texto);
  return t ? t.split(' ') : [];
}

/**
 * Cuenta ocurrencias de cada término. Las frases se buscan sobre el texto normalizado y se
 * remueven antes de tokenizar, para que "you know" no sume también como "know" suelto.
 */
function contarRellenos(texto) {
  let t = ` ${normalizar(texto)} `;
  const detalle = {};
  let total = 0;

  // Apertura: se mira la primera palabra del texto original, antes de remover frases.
  const primera = normalizar(texto).split(' ')[0];
  if (primera && RELLENOS_APERTURA.includes(primera)) {
    detalle[primera] = (detalle[primera] || 0) + 1;
    total += 1;
    t = t.replace(new RegExp(`^\\s${primera}\\s`), ' ');
  }

  for (const frase of [...RELLENOS_FRASE, ...FUGAS_ES]) {
    const re = new RegExp(`\\s${frase.replace(/\s+/g, '\\s+')}\\s`, 'g');
    const n = (t.match(re) || []).length;
    if (n > 0) {
      detalle[frase] = n;
      total += n;
      t = t.replace(re, ' ');
    }
  }

  const tokens = t.trim() ? t.trim().split(' ') : [];
  for (const palabra of RELLENOS_PALABRA) {
    const n = tokens.filter((x) => x === palabra).length;
    if (n > 0) { detalle[palabra] = n; total += n; }
  }

  return { total, detalle };
}

/**
 * Calcula las métricas de una respuesta.
 *
 * @param {object} p
 * @param {string} p.texto            transcript de la respuesta
 * @param {number} p.bytesAudio       bytes de PCM de la respuesta, ya sin el silencio inicial
 * @param {number} [p.msHastaPrimera] ms desde que se abrió el micrófono hasta el primer resultado de Deepgram
 * @returns {object} métricas + banderas, todas derivadas por aritmética
 */
function medirRespuesta({ texto, bytesAudio = 0, msHastaPrimera = null }) {
  const palabras = tokenizar(texto);
  const nPalabras = palabras.length;
  const segundos = bytesAudio > 0 ? bytesAudio / BYTES_POR_SEGUNDO : 0;

  const wpm = segundos > 0 ? Math.round((nPalabras / segundos) * 60) : null;
  const rellenos = contarRellenos(texto);
  const densidad = nPalabras > 0 ? rellenos.total / nPalabras : 0;

  // Vocabulario distinto sobre total: baja mucho cuando alguien se repite por falta de léxico.
  const unicas = new Set(palabras).size;
  const riqueza = nPalabras > 0 ? unicas / nPalabras : 0;

  return {
    palabras: nPalabras,
    segundos: Number(segundos.toFixed(1)),
    wpm,
    rellenos: rellenos.total,
    rellenosDetalle: rellenos.detalle,
    densidadRellenos: Number(densidad.toFixed(3)),
    riquezaLexica: Number(riqueza.toFixed(3)),
    msHastaPrimera,
    banderas: banderas({ wpm, densidad, nPalabras, segundos, msHastaPrimera }),
  };
}

/** Traduce los números a observaciones accionables, con los umbrales de UMBRALES. */
function banderas({ wpm, densidad, nPalabras, segundos, msHastaPrimera }) {
  const U = UMBRALES;
  const [min, max] = U.wpmComodo;
  const pct = (densidad * 100).toFixed(1);
  const out = [];

  if (wpm !== null) {
    if (wpm > U.wpmRapido) out.push({ nivel: 'aviso', clave: 'ritmo_rapido', texto: `${wpm} wpm: vas acelerado. En inglés bajo presión eso se oye como nervios y se te entiende peor. Apunta a ${min}–${max}.` });
    else if (wpm < U.wpmLento && segundos > U.segundosMinLento) out.push({ nivel: 'aviso', clave: 'ritmo_lento', texto: `${wpm} wpm: muy pausado. Suele ser que estás traduciendo mentalmente en vez de pensar en inglés.` });
    else out.push({ nivel: 'ok', clave: 'ritmo', texto: `${wpm} wpm: ritmo de conversación normal.` });
  }

  if (densidad > U.rellenosAlto) out.push({ nivel: 'alerta', clave: 'rellenos_altos', texto: `${pct}% de muletillas, sobre el ${Math.round(U.rellenosAlto * 100)}%. Una pausa en silencio se oye mejor que un "um".` });
  else if (densidad > U.rellenosMedio) out.push({ nivel: 'aviso', clave: 'rellenos_medios', texto: `${pct}% de muletillas: aceptable, pero hay margen.` });
  else out.push({ nivel: 'ok', clave: 'rellenos', texto: `${pct}% de muletillas: limpio.` });

  if (nPalabras < U.palabrasCorta && segundos > 0) out.push({ nivel: 'aviso', clave: 'muy_corta', texto: 'Respuesta muy corta. En una entrevista técnica rinde más una respuesta con un ejemplo concreto que una sola frase.' });
  if (nPalabras > U.palabrasLarga) out.push({ nivel: 'aviso', clave: 'muy_larga', texto: 'Respuesta larga. Cuesta seguirla y le deja poco espacio al entrevistador para repreguntar.' });

  if (msHastaPrimera !== null && msHastaPrimera > U.msArranqueLento) {
    out.push({ nivel: 'aviso', clave: 'arranque_lento', texto: `${(msHastaPrimera / 1000).toFixed(1)} s antes de empezar. Está bien pensar, pero decir "let me think about that for a second" en voz alta compra el tiempo sin que parezca que te trabaste.` });
  }

  return out;
}

/** Promedia métricas de varias respuestas. Se usa para el resumen de sesión y el reporte. */
function promediar(lista) {
  const conDatos = lista.filter((m) => m && m.palabras > 0);
  if (!conDatos.length) return null;
  const avg = (f) => {
    const vals = conDatos.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const wpm = avg((m) => m.wpm);
  const dens = avg((m) => m.densidadRellenos);
  return {
    respuestas: conDatos.length,
    palabrasTotales: conDatos.reduce((a, m) => a + m.palabras, 0),
    segundosTotales: Number(conDatos.reduce((a, m) => a + m.segundos, 0).toFixed(1)),
    wpmPromedio: wpm === null ? null : Math.round(wpm),
    densidadRellenosPromedio: dens === null ? null : Number(dens.toFixed(3)),
    riquezaLexicaPromedio: Number((avg((m) => m.riquezaLexica) ?? 0).toFixed(3)),
  };
}

module.exports = {
  medirRespuesta,
  promediar,
  contarRellenos,
  tokenizar,
  BYTES_POR_SEGUNDO,
  UMBRALES,
  RELLENOS_PALABRA,
  RELLENOS_APERTURA,
  RELLENOS_FRASE,
  FUGAS_ES,
};
