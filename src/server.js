/**
 * Servidor de la sesión de práctica: orquesta el ciclo pregunta → respuesta → feedback.
 *
 * Una sesión es una máquina de estados chica y estrictamente secuencial:
 *
 *   idle ──iniciar──► preguntando ──(termina el TTS)──► escuchando
 *                          ▲                                │
 *                          │                         (silencio o "listo")
 *                          │                                ▼
 *                          └──────(siguiente)──────── evaluando
 *
 * Por qué secuencial y no concurrente: el micrófono se abre RECIÉN cuando el entrevistador
 * terminó de hablar. Si se dejara abierto todo el tiempo, Deepgram transcribiría también la
 * voz del entrevistador saliendo por los parlantes y esas palabras se contarían como tuyas —
 * las métricas medirían una conversación en vez de tu habla. Es el bug que define la forma de
 * todo este archivo.
 *
 * Es una herramienta local de un solo usuario: hay UNA sesión viva por proceso y no hay login.
 * Por eso escucha solo en 127.0.0.1 y el WebSocket acepta únicamente la página que sirve este
 * mismo proceso.
 */

'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const { startCapture } = require('./audioCapture');
const { DeepgramListener } = require('./deepgramListener');
const { textToSpeechStream, SAMPLE_RATE } = require('./cartesiaSpeaker');
const { crearReproductor } = require('./audioPlayer');
const ttsCache = require('./ttsCache');
const { sayStream, disponible: sayDisponible } = require('./saySpeaker');

// Proveedor de voz. `say` es el respaldo gratis de macOS, para cuando se acaban los
// créditos: peor calidad, pero mejor que no poder practicar. Ver saySpeaker.js.
const USAR_SAY = (process.env.TTS_PROVIDER || '').toLowerCase() === 'say' && sayDisponible();
const { entrevistar, evaluar, MODELO } = require('./agents');
const { armarSet, areasTecnicas, barajar } = require('./questionBank');
const { armarLectura, rondas, contarFrases, preguntasGuiadas } = require('./lecturas');
const { compararFrase, palabrasATrabajar, compararIntentos } = require('./alignment');
const { medirRespuesta, promediar } = require('./metrics');
const sesion = require('./sessionLog');

const PORT = Number(process.env.PORT) || 3002;
// Solo loopback: la app controla tu micrófono y no tiene por qué verse desde la red local.
const HOST = '127.0.0.1';
// Silencio tras tu última palabra para dar la respuesta por terminada. 3 s: abajo de eso una
// pausa para pensar cortaba la respuesta; arriba, la sesión se siente lenta.
const SILENCIO_FIN_MS = Number(process.env.SILENCIO_FIN_MS ?? 3000);
// Leyendo un texto preparado las pausas son más largas que improvisando: se respira entre
// frases y se busca el renglón siguiente. Con 3 s la respuesta se cortaba por la mitad.
const SILENCIO_FIN_GUIADO_MS = Number(process.env.SILENCIO_FIN_GUIADO_MS ?? 5000);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/areas', (_req, res) => res.json({ areas: areasTecnicas() }));
app.get('/api/rondas', (_req, res) => res.json({ rondas: rondas() }));

const server = http.createServer(app);

// El navegador deja que cualquier página abra un WebSocket a localhost. Sin revisar el Origin,
// un sitio abierto en otra pestaña podría iniciar una sesión y recibir en vivo el transcript de
// tu micrófono.
const wss = new WebSocketServer({
  server,
  verifyClient: ({ origin }, responder) => responder(origenPermitido(origin), 403),
});

/** true si `origen` es la página que sirve este mismo proceso. */
function origenPermitido(origen, puerto = server.address()?.port) {
  if (!origen || !puerto) return false;
  return origen === `http://localhost:${puerto}` || origen === `http://127.0.0.1:${puerto}`;
}

/** Estado de la única sesión viva. `null` cuando no hay ninguna. */
let S = null;

/**
 * Sesión de lectura. Comparte la captura de audio con la de entrevista pero no el ciclo:
 * acá no hay entrevistador ni evaluador LLM. Lo que se mide es la distancia entre la frase
 * que tenías que leer y lo que Deepgram oyó, que es aritmética sobre la alineación.
 */
function nuevaSesionLectura(opts) {
  const lecturas = armarLectura(opts);
  return {
    modo: 'lectura',
    lecturas,
    iLectura: 0,
    iFrase: 0,
    totalFrases: contarFrases(lecturas),
    frasesHechas: 0,
    comparaciones: [],
    // captura en curso (mismos campos que la sesión de entrevista)
    estado: 'idle',
    pararCaptura: null,
    dg: null,
    bytes: 0,
    finales: [],
    palabras: [],
    parcial: '',
    tsAbrioMic: 0,
    tsPrimeraPalabra: null,
    timerSilencio: null,
    reproductor: null,
    metricas: [],
    iniciada: new Date().toISOString(),
  };
}

/** La frase que toca leer ahora, o null si se acabaron. */
function fraseActual() {
  const lec = S?.lecturas?.[S.iLectura];
  if (!lec) return null;
  const texto = lec.frases[S.iFrase];
  if (texto == null) return null;
  return { texto, lectura: lec };
}

/**
 * Sesión de entrevista. Con `guiada`, las preguntas salen del set que tiene respuesta
 * preparada y esa respuesta se manda a pantalla para leerla.
 *
 * Es el escalón intermedio entre leer y improvisar: la pregunta llega por voz y sin saber
 * cuál viene —eso es la parte de entrevista— pero hay qué decir, que es lo que evita el
 * bloqueo. Evaluamos las dos cosas: la pronunciación contra el texto esperado, y el inglés
 * y la entrega con el evaluador de siempre.
 *
 * En guiada no hay repreguntas: no existe respuesta preparada para ellas, y mandarlo a
 * improvisar a mitad del ejercicio rompe justamente el andamio que lo hace servir.
 */
function nuevaSesion(opts = {}) {
  const guiada = Boolean(opts.guiada);
  return {
    modo: 'entrevista',
    guiada,
    preguntas: guiada ? barajar(preguntasGuiadas()).slice(0, opts.cuantas || 6) : armarSet(opts),
    apoyoActual: '',
    intentos: [],          // intentos de la pregunta actual, para comparar
    indice: 0,
    seguimientos: 0,
    historial: [],          // [{role, content}] para el entrevistador
    preguntaActual: '',     // lo que el entrevistador dijo de verdad (puede ser repregunta)
    estado: 'idle',
    // captura en curso
    pararCaptura: null,
    dg: null,
    bytes: 0,
    finales: [],
    palabras: [],
    parcial: '',
    tsAbrioMic: 0,
    tsPrimeraPalabra: null,
    timerSilencio: null,
    reproductor: null,
    // acumulado
    metricas: [],
    iniciada: new Date().toISOString(),
  };
}

function enviar(ws, tipo, datos = {}) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ tipo, ...datos }));
}

function estado(ws, nombre, extra = {}) {
  if (S) S.estado = nombre;
  enviar(ws, 'estado', { estado: nombre, ...extra });
}

// ── turno del entrevistador ───────────────────────────────────────────────────

/**
 * Genera la próxima intervención del entrevistador, la reproduce por los parlantes y, cuando
 * termina de sonar, abre el micrófono.
 */
async function turnoEntrevistador(ws, ultimaRespuesta = '') {
  const planificada = S.preguntas[S.indice]?.texto;

  if (!planificada && !ultimaRespuesta) return finalizar(ws);
  if (!planificada) return finalizar(ws);

  estado(ws, 'preguntando');

  let texto;
  try {
    texto = await entrevistar({
      preguntaPlanificada: planificada,
      ultimaRespuesta,
      seguimientosUsados: S.seguimientos,
      historial: S.historial,
    });
  } catch (err) {
    enviar(ws, 'error', { mensaje: `El entrevistador falló: ${err.message}` });
    return estado(ws, 'idle');
  }

  // ¿Repreguntó sobre lo anterior o avanzó? Heurística: si el texto contiene el núcleo de la
  // pregunta planificada, la hizo. Si no, fue repregunta y la planificada sigue pendiente.
  // En guiada siempre se avanza: no hay respuesta preparada para una repregunta.
  const avanzo = S.guiada || !ultimaRespuesta || pareceMismaPregunta(texto, planificada);
  if (avanzo) { S.indice += 1; S.seguimientos = 0; } else { S.seguimientos += 1; }

  S.preguntaActual = texto;
  if (avanzo) S.intentos = [];
  S.apoyoActual = (avanzo && S.guiada) ? (S.preguntas[S.indice - 1]?.apoyo || '') : S.apoyoActual;
  S.historial.push({ role: 'assistant', content: texto });
  enviar(ws, 'pregunta', {
    texto,
    esSeguimiento: !avanzo,
    numero: S.indice,
    total: S.preguntas.length,
    apoyo: S.apoyoActual || null,
  });
  sesion.log('pregunta', { texto, esSeguimiento: !avanzo });

  await hablar(ws, texto);
  if (S) abrirMicrofono(ws);
}

/**
 * Compara la intervención real contra la pregunta del banco. Trabaja sobre palabras de
 * contenido: el modelo reformula ("Could you walk me through…" vs "Walk me through…") y una
 * comparación literal daría siempre falso.
 */
function pareceMismaPregunta(dicho, planificada) {
  const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const vacias = new Set(['the', 'a', 'an', 'you', 'your', 'me', 'i', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'do', 'did', 'that', 'this', 'it', 'what', 'how', 'when', 'would', 'could', 'can', 'have', 'has', 'about', 'with', 'my']);
  const clave = new Set(norm(planificada).filter((w) => w.length > 3 && !vacias.has(w)));
  if (!clave.size) return true;
  const dichas = new Set(norm(dicho));
  let hits = 0;
  for (const w of clave) if (dichas.has(w)) hits += 1;
  return hits / clave.size >= 0.45;
}

/** Sintetiza y reproduce por parlantes. Resuelve cuando terminó de sonar. */
async function hablar(ws, texto) {
  const rep = crearReproductor({
    sampleRate: SAMPLE_RATE,
    onError: (e) => enviar(ws, 'error', { mensaje: `Audio de salida: ${e.message}` }),
  });
  // Puede no haber sesión viva: practicar una palabra suelta después del resumen es válido.
  if (S) S.reproductor = rep;
  try {
    // El mismo texto suena igual siempre. Las frases de lectura, los fragmentos de «▶ Oír»
    // y repetir una pregunta salen del disco: ahorra créditos y, sobre todo, suena al
    // instante — practicar una palabra son diez repeticiones y esperar la red las rompe.
    if (!ttsCache.servir(texto, (chunk) => rep.write(chunk))) {
      const trozos = [];
      const sintetizar = USAR_SAY ? sayStream : textToSpeechStream;
      await sintetizar(texto, (chunk) => { trozos.push(chunk); rep.write(chunk); });
      ttsCache.guardar(texto, trozos);
    }
  } catch (err) {
    enviar(ws, 'error', { mensaje: `TTS: ${err.message}` });
  } finally {
    rep.end();
    if (S) S.reproductor = null;
  }
  // Colchón para que ffmpeg drene el buffer antes de abrir el mic; sin esto el final de la
  // pregunta se cuela por el micrófono y Deepgram lo transcribe como si lo hubieras dicho tú.
  await new Promise((r) => setTimeout(r, 400));
}

// ── turno del candidato ───────────────────────────────────────────────────────

function abrirMicrofono(ws) {
  estado(ws, 'escuchando');
  S.bytes = 0;
  S.finales = [];
  S.palabras = [];
  S.parcial = '';
  S.tsAbrioMic = Date.now();
  S.tsPrimeraPalabra = null;
  S.prorrogas = 0;

  const dg = new DeepgramListener(process.env.DEEPGRAM_API_KEY);
  S.dg = dg;

  // Misma guarda que en la captura: un transcript puede llegar después de cerrada la sesión.
  const miaDg = S;

  dg.on('interim', ({ text }) => {
    if (S !== miaDg) return;
    if (S.tsPrimeraPalabra === null) S.tsPrimeraPalabra = Date.now();
    S.parcial = text;
    enviar(ws, 'parcial', { texto: text });
    rearmarSilencio(ws);
  });

  dg.on('final', ({ text, words }) => {
    if (S !== miaDg) return;
    if (S.tsPrimeraPalabra === null) S.tsPrimeraPalabra = Date.now();
    S.finales.push(text);
    // Palabra por palabra con su confianza: es lo único que permite señalar cuál
    // pronunciaste mal. En modo entrevista se acumula igual y no se usa.
    if (Array.isArray(words) && words.length) S.palabras.push(...words);
    S.parcial = '';
    enviar(ws, 'parcialFinal', { texto: S.finales.join(' ') });
    rearmarSilencio(ws);
  });

  dg.on('error', (e) => { if (S === miaDg) enviar(ws, 'error', { mensaje: `STT: ${e.message}` }); });
  dg.connect();

  // ffmpeg no se apaga al instante: después de pararlo siguen llegando los chunks que ya
  // estaban en vuelo. Si mientras tanto la sesión terminó, S es null y el proceso entero se
  // caía con "Cannot read properties of null". Comparar contra la sesión que abrió este
  // micrófono descarta además el audio de una sesión anterior que todavía no murió.
  const mia = S;
  startCapture({
    onChunk: (chunk) => {
      if (S !== mia) return;
      S.bytes += chunk.length;
      dg.sendAudio(chunk);
    },
    onError: (e) => { if (S === mia) enviar(ws, 'error', { mensaje: `Micrófono: ${e.message}` }); },
  })
    .then((stop) => {
      // La sesión pudo terminar mientras el micrófono todavía estaba arrancando.
      if (S !== mia) { try { stop(); } catch { /* noop */ } return; }
      S.pararCaptura = stop;
    })
    .catch((e) => { if (S === mia) enviar(ws, 'error', { mensaje: `Micrófono: ${e.message}` }); });
}

/** Cuántas palabras del texto esperado se llevan dichas, de 0 a 1. null si no hay esperado. */
function cobertura() {
  const esperado = S?.modo === 'lectura' ? fraseActual()?.texto : S?.apoyoActual;
  if (!esperado) return null;
  const nEsperadas = esperado.trim().split(/\s+/).filter(Boolean).length;
  if (!nEsperadas) return null;
  const dichas = [...S.finales, S.parcial].filter(Boolean).join(' ').trim().split(/\s+/).filter(Boolean).length;
  return dichas / nEsperadas;
}

/**
 * Reinicia el contador de silencio. Cuando expira, la respuesta se da por terminada.
 *
 * Dos ajustes sobre el temporizador simple, los dos por el mismo motivo: leyendo un texto
 * preparado una pausa NO significa que terminaste.
 *   1. El umbral es más largo cuando hay texto esperado (respiras entre frases).
 *   2. Si llevas dicho menos del 60% de lo esperado, se te da una ventana más en vez de
 *      cerrar. Con un tope, para que un micrófono mudo no deje la sesión colgada.
 */
function rearmarSilencio(ws) {
  clearTimeout(S.timerSilencio);
  const hayEsperado = S.modo === 'lectura' || (S.guiada && S.apoyoActual);
  const espera = hayEsperado ? SILENCIO_FIN_GUIADO_MS : SILENCIO_FIN_MS;
  S.timerSilencio = setTimeout(() => {
    const cob = cobertura();
    if (cob !== null && cob < 0.6 && (S.prorrogas || 0) < 2) {
      S.prorrogas = (S.prorrogas || 0) + 1;
      enviar(ws, 'aviso', { mensaje: `Te falta texto por leer — te doy ${Math.round(espera / 1000)} s más.` });
      return rearmarSilencio(ws);
    }
    cerrarRespuesta(ws);
  }, espera);
}

function pararEscucha() {
  clearTimeout(S.timerSilencio);
  S.timerSilencio = null;
  if (S.pararCaptura) { try { S.pararCaptura(); } catch { /* noop */ } S.pararCaptura = null; }
  if (S.dg) { try { S.dg.close(); } catch { /* noop */ } S.dg = null; }
}

// ── modo lectura ──────────────────────────────────────────────────────────────

/** Lee la frase actual con la voz sintética, para que la escuches antes de repetirla. */
async function escucharFrase(ws) {
  const f = fraseActual();
  if (!f) return;
  estado(ws, 'lectura:sonando');
  await hablar(ws, f.texto);
  if (S) estado(ws, 'lectura:lista');
}

/** Muestra la frase que toca y abre el micrófono para que la leas. */
function mostrarFrase(ws) {
  const f = fraseActual();
  if (!f) return finalizar(ws);
  enviar(ws, 'frase', {
    texto: f.texto,
    // La respuesta entera, no solo la frase que toca: leyendo de a una se pierde de vista
    // qué se está construyendo, y el ejercicio es fijar la respuesta completa, no recitar
    // renglones sueltos.
    frases: f.lectura.frases,
    pregunta: f.lectura.pregunta,
    ronda: f.lectura.ronda,
    idLectura: f.lectura.id,
    indiceFrase: S.iFrase + 1,
    totalEnLectura: f.lectura.frases.length,
    hechas: S.frasesHechas,
    total: S.totalFrases,
  });
  estado(ws, 'lectura:lista');
}

/**
 * Cierra una frase leída: alinea lo esperado con lo oído y devuelve la corrección.
 *
 * Acá sí se corrige en el momento, al revés que en modo entrevista. Son ejercicios distintos:
 * la entrevista simula presión y por eso el feedback llega al final; la lectura construye
 * fluidez motora, y para eso la corrección tiene que llegar mientras la frase todavía está
 * en la boca. Se corrige por frase y no por palabra: interrumpir a media palabra rompe
 * justamente el ritmo que se está entrenando.
 */
function cerrarFrase(ws) {
  if (!S || S.estado !== 'escuchando') return;
  pararEscucha();

  const f = fraseActual();
  if (!f) return finalizar(ws);

  const oido = [...S.finales, S.parcial].filter(Boolean).join(' ').trim();
  if (!oido) {
    enviar(ws, 'aviso', { mensaje: 'No se escuchó nada. ¿Está tomando el micrófono correcto?' });
    return estado(ws, 'lectura:lista');
  }

  const comp = compararFrase(f.texto, S.palabras);
  comp.frase = f.texto;
  comp.idLectura = f.lectura.id;
  S.comparaciones.push(comp);
  S.frasesHechas += 1;

  enviar(ws, 'correccion', {
    esperado: f.texto,
    oido,
    items: comp.items,
    resumen: comp.resumen,
    problemas: comp.problemas,
    hechas: S.frasesHechas,
    total: S.totalFrases,
  });
  sesion.log('lectura', { frase: f.texto, oido, resumen: comp.resumen, problemas: comp.problemas });

  estado(ws, 'lectura:corregido');
}

/** Avanza a la frase siguiente, saltando de respuesta cuando se acaba la actual. */
function avanzarFrase(ws) {
  if (!S) return;
  const lec = S.lecturas[S.iLectura];
  if (!lec) return finalizar(ws);
  S.iFrase += 1;
  if (S.iFrase >= lec.frases.length) { S.iLectura += 1; S.iFrase = 0; }
  if (!S.lecturas[S.iLectura]) return finalizar(ws);
  mostrarFrase(ws);
}

/** Cierra la respuesta: mide, evalúa y encadena el próximo turno. */
async function cerrarRespuesta(ws) {
  if (!S || S.estado !== 'escuchando') return;
  if (S.modo === 'lectura') return cerrarFrase(ws);
  pararEscucha();

  const texto = [...S.finales, S.parcial].filter(Boolean).join(' ').trim();
  if (!texto) {
    enviar(ws, 'aviso', { mensaje: 'No se escuchó nada. ¿Está tomando el micrófono correcto?' });
    return estado(ws, 'esperando');
  }

  // Descontamos del audio el silencio inicial: si tardaste 5 s en arrancar, esos 5 s no son
  // parte de tu respuesta y contarlos hundiría las palabras por minuto artificialmente.
  const msHastaPrimera = S.tsPrimeraPalabra ? S.tsPrimeraPalabra - S.tsAbrioMic : null;
  const bytesSilencio = msHastaPrimera ? Math.round((msHastaPrimera / 1000) * 16000 * 2) : 0;
  const bytesHabla = Math.max(0, S.bytes - bytesSilencio);

  const m = medirRespuesta({ texto, bytesAudio: bytesHabla, msHastaPrimera });
  S.metricas.push(m);
  S.historial.push({ role: 'user', content: texto });

  enviar(ws, 'respuesta', { texto, metricas: m });
  sesion.log('respuesta', { pregunta: S.preguntaActual, texto, metricas: m });

  // Guiada: además del juicio del modelo, la pronunciación medida contra lo que tocaba decir.
  if (S.guiada && S.apoyoActual) {
    const comp = compararFrase(S.apoyoActual, S.palabras);
    const previo = S.intentos[S.intentos.length - 1] || null;
    S.intentos.push(comp);
    enviar(ws, 'correccion', {
      intento: S.intentos.length,
      esperado: S.apoyoActual,
      oido: texto,
      items: comp.items,
      resumen: comp.resumen,
      problemas: comp.problemas,
    });
    sesion.log('pronunciacion', { intento: S.intentos.length, esperado: S.apoyoActual, resumen: comp.resumen, problemas: comp.problemas });

    // Repetir sin saber si mejoraste es repetición, no práctica.
    if (previo) {
      const cmp = compararIntentos(previo, comp);
      enviar(ws, 'comparacion', { ...cmp, intento: S.intentos.length });
      sesion.log('comparacion', cmp);
    }
  }

  estado(ws, 'evaluando');
  let evaluacion = null;
  try {
    evaluacion = await evaluar({ pregunta: S.preguntaActual, respuesta: texto, metricas: m });
  } catch (err) {
    enviar(ws, 'aviso', { mensaje: `No se pudo evaluar esta respuesta: ${err.message}` });
  }
  if (evaluacion) {
    enviar(ws, 'evaluacion', { evaluacion });
    sesion.log('evaluacion', { evaluacion });
  }

  if (!S) return;
  if (S.indice >= S.preguntas.length) return finalizar(ws);
  estado(ws, 'esperando');   // la UI muestra "siguiente"; no encadenamos solos para que
                             // puedas leer el feedback antes de la próxima pregunta
}

// ── fin de sesión ─────────────────────────────────────────────────────────────

function finalizar(ws) {
  if (!S) return;
  pararEscucha();
  if (S.reproductor) { try { S.reproductor.kill(); } catch { /* noop */ } }

  if (S.modo === 'lectura') {
    const palabras = palabrasATrabajar(S.comparaciones);
    const evaluables = S.comparaciones.reduce((a, c) => a + c.resumen.evaluables, 0);
    const limpias = S.comparaciones.reduce((a, c) => a + c.resumen.ok, 0);
    const resumenLectura = {
      frases: S.comparaciones.length,
      palabrasEvaluadas: evaluables,
      precision: evaluables ? Number((limpias / evaluables).toFixed(3)) : null,
      palabras: palabras.slice(0, 20),
    };
    enviar(ws, 'resumenLectura', { resumen: resumenLectura, archivo: sesion.currentPath() });
    sesion.log('resumenLectura', { resumen: resumenLectura, iniciada: S.iniciada, terminada: new Date().toISOString() });
    sesion.close();
    estado(ws, 'idle');
    S = null;
    return;
  }

  const resumen = promediar(S.metricas);
  enviar(ws, 'resumen', { resumen, archivo: sesion.currentPath() });
  sesion.log('resumen', { resumen, iniciada: S.iniciada, terminada: new Date().toISOString() });
  sesion.close();
  estado(ws, 'idle');
  S = null;
}

// ── websocket ─────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  enviar(ws, 'hola', { modelo: MODELO, areas: areasTecnicas() });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    try {
      switch (msg.tipo) {
        case 'iniciar': {
          if (S) finalizar(ws);
          S = nuevaSesion({
            guiada: Boolean(msg.guiada),
            incluirDificiles: msg.incluirDificiles !== false,
            areas: Array.isArray(msg.areas) && msg.areas.length ? msg.areas : null,
          });
          sesion.setSessionMeta({
            modelo: MODELO,
            preguntas: S.preguntas.map((p) => p.id),
            silencioFinMs: SILENCIO_FIN_MS,
          });
          enviar(ws, 'sesionIniciada', { total: S.preguntas.length });
          await turnoEntrevistador(ws);
          break;
        }

        case 'iniciarLectura': {
          if (S) finalizar(ws);
          S = nuevaSesionLectura({
            ids: Array.isArray(msg.ids) && msg.ids.length ? msg.ids : null,
            ronda: msg.ronda || null,
          });
          if (!S.lecturas.length) {
            enviar(ws, 'error', { mensaje: 'No hay lecturas para esa selección.' });
            S = null;
            break;
          }
          sesion.setSessionMeta({
            modo: 'lectura',
            lecturas: S.lecturas.map((l) => l.id),
            totalFrases: S.totalFrases,
          });
          enviar(ws, 'lecturaIniciada', { total: S.totalFrases, lecturas: S.lecturas.length });
          mostrarFrase(ws);
          break;
        }

        case 'escucharFrase':    // oír la frase antes de repetirla
          if (S?.modo === 'lectura') await escucharFrase(ws);
          break;

        case 'leerFrase':        // abrir el mic para leer la frase en pantalla
          if (S?.modo === 'lectura' && S.estado !== 'escuchando') abrirMicrofono(ws);
          break;

        case 'reintentarFrase':  // misma frase otra vez, sin avanzar
          if (S?.modo === 'lectura') mostrarFrase(ws);
          break;

        case 'siguienteFrase':
          if (S?.modo === 'lectura') avanzarFrase(ws);
          break;

        case 'listo':            // "terminé de responder", sin esperar el silencio
          await cerrarRespuesta(ws);
          break;

        case 'siguiente': {
          if (!S) break;
          const ultima = S.historial.filter((h) => h.role === 'user').slice(-1)[0]?.content || '';
          await turnoEntrevistador(ws, ultima);
          break;
        }

        case 'repetir':          // volver a escuchar la pregunta actual
          if (S?.preguntaActual) await hablar(ws, S.preguntaActual);
          break;

        case 'decir': {
          // Escuchar cómo se dice lo que falló, para repetirlo. Va por fragmento y no por
          // palabra suelta: los errores que importan son de habla encadenada —"out to more"
          // dicho rápido suena a "of the motor"— y una palabra aislada no entrena eso.
          const t = String(msg.texto || '').trim().slice(0, 120);
          if (t) await hablar(ws, t);
          break;
        }

        case 'reintentar':       // MISMA pregunta, otro intento, para comparar
          // Vuelve a decir la pregunta antes de abrir el micrófono: sin ese aviso auditivo
          // la grabación arrancaba en silencio y no había forma de saber que ya estaba.
          if (S && S.modo === 'entrevista' && S.estado !== 'escuchando') {
            estado(ws, 'preguntando');
            if (S.preguntaActual) await hablar(ws, S.preguntaActual);
            if (S) abrirMicrofono(ws);
          }
          break;

        case 'saltar':
          if (!S) break;
          pararEscucha();
          S.indice += 1;
          S.seguimientos = 0;
          await turnoEntrevistador(ws);
          break;

        case 'finalizar':
          // Si hay una respuesta en el aire, cerrarla primero: terminar la sesión no puede
          // significar tirar a la basura lo que acaba de decir. Pasó de verdad — leyó una
          // respuesta entera y el resumen salió "sin respuestas registradas".
          if (S && S.estado === 'escuchando') await cerrarRespuesta(ws);
          if (S) finalizar(ws);
          break;

        default:
          break;
      }
    } catch (err) {
      enviar(ws, 'error', { mensaje: err.message });
    }
  });

  ws.on('close', () => { if (S) finalizar(ws); });
});

function apagar() {
  try { if (S) { pararEscucha(); sesion.close(); } } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

/** Abre el puerto en loopback. `puerto` 0 elige uno libre (lo usan los tests). */
function escuchar(puerto = PORT, alAbrir) {
  return server.listen(puerto, HOST, alAbrir);
}

// Solo escucha cuando se ejecuta directo. Importado desde los tests no abre puerto ni registra
// handlers de señal.
if (require.main === module) {
  escuchar(PORT, () => {
    console.log(`\n  sistema-helper-en  ·  http://localhost:${PORT}\n`);
    console.log(`  modelo: ${MODELO}   ·   fin por silencio: ${SILENCIO_FIN_MS} ms`);
    const cache = ttsCache.estado();
    console.log(`  voz: ${USAR_SAY ? 'say (macOS, gratis)' : 'Cartesia'}   ·   caché: ${cache.archivos} clips, ${cache.mb} MB`);
    console.log('  Ctrl+C para salir\n');
  });
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

module.exports = { app, server, escuchar, origenPermitido, pareceMismaPregunta };
