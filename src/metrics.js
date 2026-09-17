/**
 * Métricas de una respuesta hablada — calculadas con aritmética, no con el LLM.
 *
 * Por qué no se las pedimos al modelo: contar muletillas y calcular palabras por minuto son
 * operaciones determinísticas. Un LLM al que le pedís "contá cuántas veces dijo 'um'" inventa
 * el número, y el error no es aleatorio: tiende a redondear hacia lo que suena razonable. Si
 * la métrica que usás para medir tu progreso alucina, el progreso que ves es ruido.
 *
 * La división es la misma que se usa en evaluación de RAG: la parte objetiva se mide, la parte
 * subjetiva la juzga el modelo. Acá lo medible vive en este archivo y lo opinable en
 * `evaluator.js`. Cuando las dos coinciden, el feedback es creíble.
 *
 * Lo que estas métricas NO dicen (escrito acá para que nadie lo olvide leyendo el número):
 * - WPM alto no es mejor. Un hispanohablante nervioso acelera; 190 wpm en inglés suele ser
 *   atropellado, no fluido. La banda cómoda para una entrevista técnica es 130–160.
 * - La densidad de muletillas todavía cuenta algún uso legítimo: "like" y "actually" suman
 *   aunque estén bien usadas. Los casos peores ("so", "well", "right") ya están acotados a la
 *   apertura de la respuesta, pero el número sigue sirviendo para ver la TENDENCIA entre
 *   sesiones, no para juzgar una respuesta suelta.
 * - El tiempo hasta la primera palabra mide duda, pero también mide que estés pensando. Tres
 *   segundos antes de una respuesta de arquitectura está bien; tres antes de "where are you
 *   from" no.
 */

'use strict';

// PCM 16-bit mono a 16 kHz = 32.000 bytes por segundo. Es la constante que deja medir
// duración real desde los bytes capturados, sin confiar en timestamps de red.
const BYTES_POR_SEGUNDO = 16000 * 2;

/**
 * Muletillas y rellenos típicos de un hispanohablante hablando inglés.
 * Multi-palabra primero: se buscan como frase antes de tokenizar.
 */
const RELLENOS_FRASE = [
  'you know', 'i mean', 'kind of', 'sort of', 'or something', 'and stuff',
  'how do you say', 'how to say', 'let me think', 'the thing is',
];

/**
 * Cuentan en cualquier posición. Son o bien sonidos sin contenido ("um"), o bien palabras
 * cuyo uso legítimo es tan raro en habla técnica que el falso positivo no molesta ("literally").
 */
const RELLENOS_PALABRA = [
  'um', 'uh', 'ehm', 'eh', 'mmm', 'hmm', 'ah', 'er',
  'like', 'basically', 'actually', 'literally', 'obviously',
];

/**
 * Cuentan SOLO al abrir la respuesta.
 *
 * Esta separación salió de un test que fallaba. Estaban en la lista de arriba y se contaban
 * siempre, lo que inflaba el número con usos perfectamente correctos: "it works **well**",
 * "the **right** answer", "**so** we migrated it" — ahí "so" es una conjunción, no una
 * muletilla. Arrancar la respuesta con "So…" o "Well…" sí es el tic que querés ver bajar.
 * Sin esta distinción la métrica medía vocabulario en vez de fluidez.
 */
const RELLENOS_APERTURA = ['so', 'well', 'okay', 'ok', 'right', 'anyway', 'yeah', 'yes'];

/** Palabras en español que se cuelan cuando falta vocabulario — señal útil, no falta grave. */
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
 * @param {string} p.texto            transcript de lo que dijo el usuario
 * @param {number} p.bytesAudio       bytes de PCM capturados mientras hablaba
 * @param {number} [p.msHastaPrimera] ms entre el fin de la pregunta y su primera palabra
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

/**
 * Traduce los números a observaciones accionables. Los umbrales son referencias de entrevista
 * técnica hablada, no reglas universales — están acá arriba y se cambian en un lugar.
 */
function banderas({ wpm, densidad, nPalabras, segundos, msHastaPrimera }) {
  const out = [];

  if (wpm !== null) {
    if (wpm > 175) out.push({ nivel: 'aviso', clave: 'ritmo_rapido', texto: `${wpm} wpm: vas acelerado. En inglés bajo presión eso se oye como nervios y se te entiende peor. Apuntá a 130–160.` });
    else if (wpm < 100 && segundos > 8) out.push({ nivel: 'aviso', clave: 'ritmo_lento', texto: `${wpm} wpm: muy pausado. Suele ser que estás traduciendo mentalmente en vez de pensar en inglés.` });
    else out.push({ nivel: 'ok', clave: 'ritmo', texto: `${wpm} wpm: ritmo de conversación normal.` });
  }

  if (densidad > 0.08) out.push({ nivel: 'alerta', clave: 'rellenos_altos', texto: `${(densidad * 100).toFixed(1)}% de muletillas. Arriba de 8% el entrevistador lo nota. Una pausa en silencio se oye mejor que un "um".` });
  else if (densidad > 0.04) out.push({ nivel: 'aviso', clave: 'rellenos_medios', texto: `${(densidad * 100).toFixed(1)}% de muletillas: aceptable, pero hay margen.` });
  else out.push({ nivel: 'ok', clave: 'rellenos', texto: `${(densidad * 100).toFixed(1)}% de muletillas: limpio.` });

  if (nPalabras < 25 && segundos > 0) out.push({ nivel: 'aviso', clave: 'muy_corta', texto: 'Respuesta muy corta. En una entrevista técnica una respuesta de 30–45 s con un ejemplo concreto rinde más que una frase.' });
  if (nPalabras > 220) out.push({ nivel: 'aviso', clave: 'muy_larga', texto: 'Respuesta larga. Pasando el minuto y medio el entrevistador pierde el hilo y no puede repreguntar.' });

  if (msHastaPrimera !== null && msHastaPrimera > 6000) {
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
  RELLENOS_PALABRA,
  RELLENOS_APERTURA,
  RELLENOS_FRASE,
  FUGAS_ES,
};
