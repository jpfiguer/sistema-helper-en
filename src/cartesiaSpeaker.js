/**
 * Cartesia TTS — le da voz al entrevistador simulado.
 *
 * Importante: acá NO se usa una voz clonada tuya. La voz es la del entrevistador, y conviene
 * que suene distinta a la tuya para que la sesión se sienta como una entrevista y no como un
 * eco. `CARTESIA_VOICE_ID` apunta a cualquier voz del catálogo de Cartesia; elige una nativa
 * de inglés, que es contra lo que te conviene practicar el oído.
 *
 * Streaming: abre un WebSocket a Cartesia, manda el texto, y entrega los chunks de audio por
 * `onChunk(Buffer)` a medida que llegan, para que la pregunta empiece a sonar antes de estar
 * generada entera.
 *
 * Salida: PCM 16-bit LE, mono, 24 kHz (raw) → va a `audioPlayer.js` → parlantes.
 */

const WebSocket = require('ws');

const CARTESIA_WS = 'wss://api.cartesia.ai/tts/websocket';
const VERSION = process.env.CARTESIA_VERSION || '2024-11-13';
// Sample rate del PCM que pedimos. 44100 da mejor calidad que 24000 y el device resamplea
// solo. OJO: el cache de fillers guarda PCM crudo, así que su clave incluye este valor.
const SAMPLE_RATE = Number(process.env.CARTESIA_SAMPLE_RATE ?? 24000);

/**
 * Controles de generación. Medido contra la API: sin generation_config los picos salen a
 * ~-20 dBFS; con volume 1.5 suben a ~-11.6, o sea +8.5 dB desde el propio TTS, que es mejor
 * que amplificar después.
 */
// speed 1.0 a propósito: un entrevistador acelerado te entrena a entender rápido antes de
// entender bien. Si ya te resulta fácil, súbelo a 1.1–1.2 desde el .env — ese es el ejercicio.
const GENERATION_CONFIG = {
  speed: Number(process.env.CARTESIA_SPEED ?? 1.0),
  volume: Number(process.env.CARTESIA_VOLUME ?? 1.5),
};
// Timeout POR INACTIVIDAD: si Cartesia no manda ningún mensaje por este tiempo, abortamos.
// (Antes era un tope total de 20s, que cortaba respuestas largas a la mitad.)
const IDLE_TIMEOUT_MS = 15_000;

/**
 * Sintetiza `text` y entrega PCM por `onChunk`. Resuelve cuando Cartesia manda 'done'
 * (o cuando se aborta vía `signal`, para el mute).
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
        model_id: process.env.CARTESIA_MODEL || 'sonic-3',
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        language: process.env.CARTESIA_LANGUAGE || 'en',
        context_id: `practice-${t0}`,
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SAMPLE_RATE },
        generation_config: GENERATION_CONFIG,
      }));
    });

    ws.on('message', (data) => {
      if (settled) return;
      armTimeout();   // hubo actividad: reiniciá el contador de inactividad
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

module.exports = { textToSpeechStream, SAMPLE_RATE };
