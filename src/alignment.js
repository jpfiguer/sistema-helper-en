/**
 * Alineación entre lo que ibas a leer y lo que Deepgram oyó.
 *
 * Esto es lo que hace posible el feedback de pronunciación, y solo funciona en modo lectura.
 * En una entrevista improvisada nadie sabe qué palabra intentaste decir, así que un transcript
 * raro puede ser una mala pronunciación o puede ser que cambiaste de idea a mitad de frase.
 * Cuando el texto esperado existe, la diferencia entre los dos es medible.
 *
 * QUÉ DETECTA Y QUÉ NO — leer esto antes de confiar en el número:
 *
 * Deepgram es un transcriptor, no un evaluador de pronunciación. nova-3 además "arregla" lo
 * que dices (ver deepgramListener.js), así que el sesgo es optimista. En concreto:
 *
 *   SÍ detecta  · palabras tan mal pronunciadas que se convierten en otra ("beach"→"bitch",
 *                 "focus"→"fuck us", "sheet"→"shit" — los clásicos del hispanohablante)
 *               · palabras que te comiste entera
 *               · palabras que el modelo apenas reconoció (confianza baja)
 *               · repeticiones y autocorrecciones ("the the", "I mean, the system")
 *
 *   NO detecta  · acento sobre la palabra correcta: si dices "development" con la sílaba
 *                 tónica corrida pero se entiende, pasa limpio
 *               · duración de vocales, schwa, entonación de la frase
 *               · la diferencia entre sonar entendible y sonar natural
 *
 * Para eso último hace falta una API de evaluación de pronunciación de verdad, que puntúa
 * fonema por fonema (Azure Speech tiene una). Esto cubre lo grueso sin agregar un cuarto
 * proveedor, y lo grueso es lo que te hace perder una entrevista.
 *
 * El umbral de confianza es una heurística, no una medida calibrada. Está acá arriba y se
 * cambia en un solo lugar.
 */

'use strict';

/** Debajo de esto, una palabra reconocida se marca como dudosa. Heurística, no ciencia. */
const CONFIANZA_DUDOSA = 0.85;

/**
 * Contracciones expandidas en ambos lados antes de comparar.
 * Deepgram a veces devuelve "do not" donde el texto dice "don't" y viceversa; sin esto
 * cada contracción aparecía como un par omitida+agregada y ensuciaba todo el reporte.
 */
const CONTRACCIONES = [
  ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'],
  ["won't", 'will not'], ["wouldn't", 'would not'], ["can't", 'can not'],
  ["couldn't", 'could not'], ["shouldn't", 'should not'], ["isn't", 'is not'],
  ["aren't", 'are not'], ["wasn't", 'was not'], ["weren't", 'were not'],
  ["haven't", 'have not'], ["hasn't", 'has not'], ["hadn't", 'had not'],
  ["i'm", 'i am'], ["i've", 'i have'], ["i'd", 'i would'], ["i'll", 'i will'],
  ["it's", 'it is'], ["that's", 'that is'], ["there's", 'there is'],
  ["we're", 'we are'], ["we've", 'we have'], ["they're", 'they are'],
  ["you're", 'you are'], ["let's", 'let us'], ["what's", 'what is'],
];

/** Números escritos con dígitos: no se evalúan. Ver nota en clasificar(). */
const ES_NUMERO = /^[\d.,%$]+$/;

function normalizar(texto) {
  let t = String(texto || '').toLowerCase();
  for (const [corta, larga] of CONTRACCIONES) {
    t = t.split(corta).join(larga);
  }
  return t
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s'%$.,]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto esperado → lista de tokens comparables. */
function tokenizar(texto) {
  const t = normalizar(texto);
  if (!t) return [];
  return t.split(' ').map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
}

/**
 * Palabras de Deepgram → tokens comparables, conservando confianza y tiempos.
 * Acepta tanto el formato crudo (`{word, confidence, start, end}`) como una lista de strings.
 */
function tokenizarOidas(palabras) {
  if (!Array.isArray(palabras)) return [];
  const out = [];
  for (const p of palabras) {
    const crudo = typeof p === 'string' ? p : (p.word ?? p.punctuated_word ?? '');
    const conf = typeof p === 'string' ? null : (typeof p.confidence === 'number' ? p.confidence : null);
    for (const tok of tokenizar(crudo)) {
      out.push({
        token: tok,
        confianza: conf,
        inicio: typeof p === 'string' ? null : (p.start ?? null),
        fin: typeof p === 'string' ? null : (p.end ?? null),
      });
    }
  }
  return out;
}

/**
 * Needleman-Wunsch sobre tokens: da el emparejamiento que minimiza ediciones.
 *
 * Se usa alineación global y no un diff por líneas porque lo que importa es qué palabra
 * concreta reemplazó a cuál. Un diff te dice "esta frase cambió"; esto te dice
 * "dijiste 'focus' y se oyó 'fuck us'", que es el feedback accionable.
 */
function alinearTokens(esperados, oidos) {
  const n = esperados.length;
  const m = oidos.length;
  const COSTO_HUECO = 1;
  const COSTO_CAMBIO = 1;

  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) d[i][0] = i * COSTO_HUECO;
  for (let j = 1; j <= m; j += 1) d[0][j] = j * COSTO_HUECO;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const igual = esperados[i - 1] === oidos[j - 1].token;
      d[i][j] = Math.min(
        d[i - 1][j - 1] + (igual ? 0 : COSTO_CAMBIO),
        d[i - 1][j] + COSTO_HUECO,
        d[i][j - 1] + COSTO_HUECO,
      );
    }
  }

  const pares = [];
  let i = n; let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const igual = esperados[i - 1] === oidos[j - 1].token;
      if (d[i][j] === d[i - 1][j - 1] + (igual ? 0 : COSTO_CAMBIO)) {
        pares.push({ esperada: esperados[i - 1], oida: oidos[j - 1] });
        i -= 1; j -= 1;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + COSTO_HUECO) {
      pares.push({ esperada: esperados[i - 1], oida: null });
      i -= 1;
      continue;
    }
    pares.push({ esperada: null, oida: oidos[j - 1] });
    j -= 1;
  }
  return pares.reverse();
}

/**
 * Clasifica un par alineado.
 *
 * Los números escritos con dígitos quedan fuera de la evaluación a propósito: el texto dice
 * "2,700" y tú dices "twenty-seven hundred" o "two thousand seven hundred", las dos correctas.
 * Penalizar eso convertía el reporte en ruido justo en las frases con tus métricas, que son
 * las que más te conviene practicar.
 */
function clasificar(par, umbral) {
  const { esperada, oida } = par;
  if (esperada && !oida) {
    return { tipo: ES_NUMERO.test(esperada) ? 'sin-evaluar' : 'omitida', esperada, oida: null, confianza: null };
  }
  if (!esperada && oida) {
    return { tipo: 'agregada', esperada: null, oida: oida.token, confianza: oida.confianza };
  }
  if (ES_NUMERO.test(esperada)) {
    return { tipo: 'sin-evaluar', esperada, oida: oida.token, confianza: oida.confianza };
  }
  if (esperada !== oida.token) {
    return { tipo: 'cambiada', esperada, oida: oida.token, confianza: oida.confianza };
  }
  if (oida.confianza !== null && oida.confianza < umbral) {
    return { tipo: 'dudosa', esperada, oida: oida.token, confianza: oida.confianza };
  }
  return { tipo: 'ok', esperada, oida: oida.token, confianza: oida.confianza };
}

/**
 * Compara una frase leída contra lo que se oyó.
 *
 * @param {string} esperado            la frase que tenía que leer
 * @param {Array} palabrasOidas        words[] de Deepgram, o lista de strings
 * @param {object} [opts]
 * @param {number} [opts.umbral]       confianza mínima para no marcar dudosa
 * @returns {{items: Array, resumen: object, problemas: Array}}
 */
function compararFrase(esperado, palabrasOidas, { umbral = CONFIANZA_DUDOSA } = {}) {
  const esperados = tokenizar(esperado);
  const oidos = tokenizarOidas(palabrasOidas);
  const items = alinearTokens(esperados, oidos).map((p) => clasificar(p, umbral));

  const cuenta = { ok: 0, dudosa: 0, cambiada: 0, omitida: 0, agregada: 0, 'sin-evaluar': 0 };
  for (const it of items) cuenta[it.tipo] += 1;

  const evaluables = cuenta.ok + cuenta.dudosa + cuenta.cambiada + cuenta.omitida;
  const limpias = cuenta.ok;

  return {
    items,
    resumen: {
      palabrasEsperadas: esperados.length,
      evaluables,
      ...cuenta,
      // Proporción de palabras que salieron limpias. No es una nota de pronunciación:
      // es cuántas palabras el transcriptor reconoció sin dudar.
      precision: evaluables ? Number((limpias / evaluables).toFixed(3)) : null,
    },
    problemas: items.filter((it) => it.tipo === 'cambiada' || it.tipo === 'omitida' || it.tipo === 'dudosa'),
  };
}

/**
 * Agrega los problemas de varias frases en una lista de palabras a trabajar.
 * Ordena por cuántas veces te costó la misma palabra, que es la señal que sirve entre sesiones.
 */
function palabrasATrabajar(comparaciones) {
  const mapa = new Map();
  for (const c of comparaciones || []) {
    for (const p of c.problemas || []) {
      const clave = p.esperada;
      if (!clave) continue;
      const prev = mapa.get(clave) || { palabra: clave, veces: 0, tipos: {}, oidaComo: new Set() };
      prev.veces += 1;
      prev.tipos[p.tipo] = (prev.tipos[p.tipo] || 0) + 1;
      if (p.oida && p.oida !== clave) prev.oidaComo.add(p.oida);
      mapa.set(clave, prev);
    }
  }
  return [...mapa.values()]
    .map((x) => ({ ...x, oidaComo: [...x.oidaComo] }))
    .sort((a, b) => b.veces - a.veces || a.palabra.localeCompare(b.palabra));
}

/**
 * Compara dos intentos de la misma respuesta para decir si mejoró o empeoró.
 *
 * Existe porque repetir sin saber si mejoraste no es práctica, es repetición. La señal que
 * sirve no es «tuviste 10 problemas» sino «arreglaste estas tres y rompiste esta otra»:
 * lo segundo es accionable en el intento siguiente.
 *
 * Trabaja sobre el conjunto de palabras problemáticas de cada intento, no sobre la
 * precisión sola, porque el mismo porcentaje puede esconder que cambiaste unos errores
 * por otros.
 *
 * @param {object} antes  resultado de compararFrase del intento previo
 * @param {object} ahora  resultado del intento nuevo
 */
function compararIntentos(antes, ahora) {
  const setDe = (c) => new Set((c?.problemas || []).map((p) => p.esperada).filter(Boolean));
  const A = setDe(antes);
  const B = setDe(ahora);

  const arregladas = [...A].filter((w) => !B.has(w)).sort();
  const empeoradas = [...B].filter((w) => !A.has(w)).sort();
  const persisten = [...A].filter((w) => B.has(w)).sort();

  const pa = antes?.resumen?.precision;
  const pb = ahora?.resumen?.precision;
  const delta = (typeof pa === 'number' && typeof pb === 'number')
    ? Number((pb - pa).toFixed(3))
    : null;

  // El veredicto mira las palabras, no el porcentaje: cambiar unos errores por otros deja
  // la precisión igual y no es haber mejorado.
  let veredicto = 'igual';
  if (arregladas.length > empeoradas.length) veredicto = 'mejor';
  else if (empeoradas.length > arregladas.length) veredicto = 'peor';
  else if (delta !== null && Math.abs(delta) >= 0.05) veredicto = delta > 0 ? 'mejor' : 'peor';

  return {
    veredicto,
    delta,
    precisionAntes: pa ?? null,
    precisionAhora: pb ?? null,
    arregladas,
    empeoradas,
    persisten,
  };
}

module.exports = {
  compararFrase,
  compararIntentos,
  palabrasATrabajar,
  tokenizar,
  tokenizarOidas,
  alinearTokens,
  normalizar,
  CONFIANZA_DUDOSA,
};
