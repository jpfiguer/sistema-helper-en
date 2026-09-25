/**
 * Cartesia TTS: le da voz al entrevistador simulado.
 *
 * La voz es la del entrevistador, no un clon de la tuya. `CARTESIA_VOICE_ID` apunta a
 * cualquier voz del catálogo de Cartesia; conviene una nativa de inglés.
 *
 * Streaming: abre un WebSocket a Cartesia, manda el texto, y entrega los chunks de audio por
 * `onChunk(Buffer)` a medida que llegan, para que la pregunta empiece a sonar antes de estar
 * generada entera.
 *
 * Salida: PCM 16-bit LE mono a SAMPLE_RATE (24 kHz por defecto), que reproduce audioPlayer.js.
 */

const WebSocket = require('ws');

const CARTESIA_WS = 'wss://api.cartesia.ai/tts/websocket';
const VERSION = process.env.CARTESIA_VERSION || '2024-11-13';
const MODELO = process.env.CARTESIA_MODEL || 'sonic-3';
const IDIOMA = process.env.CARTESIA_LANGUAGE || 'en';
// Sample rate del PCM que se pide. El reproductor y la voz de `say` usan el mismo valor, y
// la clave del caché de TTS lo incluye: un clip guardado a otra frecuencia sonaría a otra
// velocidad.
const SAMPLE_RATE = Number(process.env.CARTESIA_SAMPLE_RATE ?? 24000);

// Controles de generación. `volume` sube el nivel desde el propio TTS en vez de amplificar
// después. `speed` parte en 1.0; cuando ya sigas al entrevistador cómodo, súbelo a 1.1 o 1.2
// desde el .env.
const GENERATION_CONFIG = {
  speed: Number(process.env.CARTESIA_SPEED ?? 1.0),
  volume: Number(process.env.CARTESIA_VOLUME ?? 1.5),
};
// Timeout por inactividad: si Cartesia no manda ningún mensaje en este tiempo, se aborta. Es
// por inactividad y no un tope total, para no cortar textos largos.
const IDLE_TIMEOUT_MS = 15_000;

/**
 * Sintetiza `text` y entrega PCM por `onChunk`. Resuelve cuando Cartesia manda 'done'
 * (o cuando se aborta vía `signal`).
 *
 * @param {string} text
 * @param {(chunk: Buffer) => void} onChunk
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ interrupted: boolean, bytes: number, chunks: number, ttfaMs?: number, totalMs?: number }>}
 */
async function textToSpeechStream(text, onChunk, { signal } = {}) {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) throw new Error('Falta CARTESIA_API_KEY en .env');
  const voiceId = process.env.CARTESIA_VOICE_ID;
  if (!voiceId) throw new Error('Falta CARTESIA_VOICE_ID en .env');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(CARTESIA_WS, {
      headers: { 'X-API-Key': apiKey, 'Cartesia-Version': VERSION },
    });

    let settled = false;
    let bytes = 0;
    let chunks = 0;
    let ttfaMs = 0;
    const t0 = Date.now();

    let timer = null;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try { ws.close(); } catch { /* noop */ }
      fn(arg);
    };
    const onAbort = () => finish(resolve, { interrupted: true, bytes, chunks });

    // Se rearma con cada mensaje recibido: el límite es el silencio de Cartesia, no la duración total.
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error('Cartesia: sin datos por 15s')), IDLE_TIMEOUT_MS);
    };
    armTimeout();

    if (signal) {
      if (signal.aborted) { finish(resolve, { interrupted: true, bytes, chunks }); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ws.on('open', () => {
      if (signal?.aborted) return finish(resolve, { interrupted: true, bytes, chunks });
      ws.send(JSON.stringify({
        model_id: MODELO,
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        language: IDIOMA,
        context_id: `practice-${t0}`,
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
        generation_config: GENERATION_CONFIG,
      }));
    });

    ws.on('message', (data) => {
      if (settled) return;
      armTimeout();   // hubo actividad: reinicia el contador de inactividad
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'chunk' && msg.data) {
        const buf = Buffer.from(msg.data, 'base64');
        if (chunks === 0) ttfaMs = Date.now() - t0;
        bytes += buf.length;
        chunks += 1;
        try { onChunk(buf); } catch { /* el consumidor maneja sus errores */ }
      } else if (msg.type === 'done') {
        finish(resolve, { interrupted: false, bytes, chunks, ttfaMs, totalMs: Date.now() - t0 });
      } else if (msg.type === 'error') {
        finish(reject, new Error(`Cartesia: ${msg.error || 'error'}`));
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => finish(reject, new Error(`Cartesia HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
    });

    ws.on('error', (err) => finish(reject, err));
  });
}

/** Todo lo que cambia el audio de un mismo texto. Es parte de la clave del caché de TTS. */
function firma() {
  return [
    'cartesia', process.env.CARTESIA_VOICE_ID || '', MODELO, IDIOMA,
    GENERATION_CONFIG.speed, GENERATION_CONFIG.volume, SAMPLE_RATE,
  ].join('|');
}

module.exports = { textToSpeechStream, firma, SAMPLE_RATE };
