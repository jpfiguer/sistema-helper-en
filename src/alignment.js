/**
 * Alineación entre lo que ibas a leer y lo que Deepgram oyó.
 *
 * Solo sirve cuando hay texto esperado (modo lectura y entrevista con apoyo). Alinea las dos
 * secuencias de tokens y clasifica cada palabra esperada: ok, dudosa, cambiada, omitida o
 * sin-evaluar; lo que se oyó de más queda como agregada.
 *
 * Deepgram transcribe, no evalúa pronunciación: detecta una palabra que se oyó como otra
 * ("ship" como "sheep", "full" como "fool"), una palabra comida o una apenas reconocida, pero
 * no el acento sobre la palabra correcta. El detalle está en el README, en «Qué NO detecta».
 */

'use strict';

/** Confianza bajo la cual una palabra reconocida se marca dudosa. Es una heurística sin calibrar. */
const CONFIANZA_DUDOSA = 0.85;

/**
 * Contracciones expandidas en ambos lados antes de comparar.
 * Deepgram a veces devuelve "do not" donde el texto dice "don't" y viceversa; sin esto
 * cada contracción aparece como una palabra omitida más una agregada.
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
  // El apóstrofo curvo pasa a recto antes de expandir: "don’t" también es "do not".
  let t = String(texto || '').toLowerCase().replace(/[‘’]/g, "'");
  for (const [corta, larga] of CONTRACCIONES) {
    t = t.split(corta).join(larga);
  }
  return t
    .replace(/[^\p{L}\p{N}\s'%$.,]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte el texto esperado en tokens comparables. */
function tokenizar(texto) {
  const t = normalizar(texto);
  if (!t) return [];
  return t.split(' ').map((w) => w.replace(/^[.,]+|[.,]+$/g, '')).filter(Boolean);
}

/**
 * Convierte las palabras de Deepgram en tokens comparables, con su confianza y sus tiempos.
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
 * Alineación global en vez de un diff de líneas, porque el feedback necesita saber qué
 * palabra reemplazó a cuál: "ship" se oyó "sheep".
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
 * Los números escritos con dígitos quedan fuera de la evaluación: el texto dice "2,700" y tú
 * dices "twenty-seven hundred" o "two thousand seven hundred", y las dos lecturas son
 * correctas. Compararlos marcaría como error una lectura bien hecha.
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
 * Agrega los problemas de varias frases en una lista de palabras a trabajar, ordenada por
 * cuántas veces falló la misma palabra.
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
 * Devuelve qué palabras se arreglaron, cuáles empeoraron y cuáles siguen fallando. Trabaja
 * sobre el conjunto de palabras problemáticas de cada intento y no sobre la precisión sola,
 * porque el mismo porcentaje puede esconder que cambiaste unos errores por otros.
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

  // El veredicto sale de las palabras; la diferencia de precisión solo desempata.
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
