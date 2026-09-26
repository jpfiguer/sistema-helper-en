/**
 * Stream de TU audio a Deepgram STT en vivo.
 *
 * Conexión WebSocket cruda a wss://api.deepgram.com/v1/listen (sin SDK, para no acoplarnos a
 * versiones). Transcribe tu inglés hablado desde el PCM 16k mono que entrega audioCapture.
 *
 * Nota sobre el modelo: nova-3 "arregla" parte de lo que dices: completa artículos y corrige
 * concordancias. El transcript puede verse mejor que el audio, y por eso el feedback gramatical
 * tiende a ser indulgente.
 *
 * Eventos (EventEmitter):
 *   'open'                       conectado y listo para recibir audio
 *   'interim'  { text, ... }     transcript parcial (en vivo, puede cambiar)
 *   'final'    { text, ... }     transcript confirmado
 *   'transcript' { ..., isFinal} se emite para interim y final (conveniencia)
 *   'speechStarted' / 'utteranceEnd'
 *   'reconnecting' { attempt, delay }
 *   'close' (code, reason)       cerrado (reconectará salvo cierre manual / error fatal)
 *   'error' (Error)
 *
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

const DEFAULTS = {
  model: 'nova-3',
  language: process.env.DEEPGRAM_LANGUAGE || 'en-US',   // tú hablas en inglés
  encoding: 'linear16',  // PCM 16-bit LE (lo que sale de audioCapture)
  sampleRate: 16000,
  channels: 1,
  smartFormat: true,
  // ms de silencio para cerrar un final. Al practicar se hacen pausas más largas que un
  // nativo, y con valores bajos una pausa a mitad de frase la parte en segmentos: con 300,
  // "Well, are you ready for the interview?" llegó en tres. Cada segmento se transcribe sin el
  // contexto del resto de la oración, y ahí aparecen errores ("are you ready" se oyó como
  // "Ray, for the").
  endpointing: Number(process.env.DEEPGRAM_ENDPOINTING ?? 1200),
  interimResults: true,
  vadEvents: true,
  utteranceEndMs: 1000,
  // Sin esto Deepgram borra "uh" y "um" del transcript y no hay muletillas que contar.
  // Deepgram solo lo acepta en inglés, así que con otro idioma no se pide.
  fillerWords: true,
};

// Deepgram cierra la conexión tras ~10s sin audio si no mandamos KeepAlive.
const KEEPALIVE_MS = 5_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const MAX_RECONNECTS = 20;

class DeepgramListener extends EventEmitter {
  constructor(apiKey, opts = {}) {
    super();
    if (!apiKey) throw new Error('DeepgramListener: falta DEEPGRAM_API_KEY');
    this.apiKey = apiKey;
    this.opts = { ...DEFAULTS, ...opts };

    this.ws = null;
    this.connected = false;
    this.closedByUser = false;
    this.fatal = false;          // error de config (401/403/400): no reconectar
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  buildUrl() {
    const o = this.opts;
    const params = new URLSearchParams({
      model: o.model,
      language: o.language,
      encoding: o.encoding,
      sample_rate: String(o.sampleRate),
      channels: String(o.channels),
      smart_format: String(o.smartFormat),
      endpointing: String(o.endpointing),
      interim_results: String(o.interimResults),
      vad_events: String(o.vadEvents),
      utterance_end_ms: String(o.utteranceEndMs),
    });
    if (o.fillerWords && /^en\b/i.test(o.language)) params.set('filler_words', 'true');
    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  connect() {
    this.closedByUser = false;
    const ws = new WebSocket(this.buildUrl(), {
      headers: { Authorization: `Token ${this.apiKey}` },
    });
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startKeepalive();
      this.emit('open');
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this.handleMessage(msg);
    });

    // Respuesta HTTP de error en el handshake (401 key inválida, 400 params, etc.)
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if ([400, 401, 402, 403].includes(res.statusCode)) this.fatal = true;
        this.emit('error', new Error(`Deepgram HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
      });
    });

    // Tras un close() manual, cerrar un socket que aún estaba conectando emite un
    // error de ruido ("closed before connection established"); lo silenciamos.
    ws.on('error', (err) => { if (!this.closedByUser) this.emit('error', err); });

    ws.on('close', (code, reason) => {
      this.connected = false;
      this.stopKeepalive();
      this.emit('close', code, reason?.toString() || '');
      if (!this.closedByUser && !this.fatal) this.scheduleReconnect();
    });

    return this;
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_RECONNECTS) {
      this.emit('error', new Error(`Deepgram: ${MAX_RECONNECTS} reintentos fallidos, me rindo.`));
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    this.reconnectTimer = setTimeout(() => {
      if (!this.closedByUser && !this.fatal) this.connect();
    }, delay);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'SpeechStarted':
        this.emit('speechStarted');
        return;
      case 'UtteranceEnd':
        this.emit('utteranceEnd');
        return;
      case 'Metadata':
        this.emit('metadata', msg);
        return;
      case 'Results': {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript || '').trim();
        if (!text) return;
        const isFinal = Boolean(msg.is_final);
        const payload = {
          text,
          confidence: alt.confidence ?? null,
          // Palabra por palabra, con confianza y tiempos: la confianza de la frase completa
          // promedia y esconde justo la palabra que te costó. Ver alignment.js.
          words: Array.isArray(alt.words)
            ? alt.words.map((w) => ({
                word: w.word,
                punctuated: w.punctuated_word ?? w.word,
                confidence: typeof w.confidence === 'number' ? w.confidence : null,
                start: w.start ?? null,
                end: w.end ?? null,
              }))
            : [],
          isFinal,
          speechFinal: Boolean(msg.speech_final),
        };
        this.emit(isFinal ? 'final' : 'interim', payload);
        this.emit('transcript', payload);
        return;
      }
      default:
        if (msg.type === 'Error' || msg.error) {
          this.emit('error', new Error(`Deepgram: ${JSON.stringify(msg).slice(0, 300)}`));
        }
    }
  }

  /** Envía un chunk de PCM. Si el socket todavía no abrió, el chunk se descarta. */
  sendAudio(chunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(chunk); } catch (err) { this.emit('error', err); }
    }
  }

  startKeepalive() {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'KeepAlive' })); } catch { /* noop */ }
      }
    }, KEEPALIVE_MS);
  }

  stopKeepalive() {
    if (this.keepaliveTimer) { clearInterval(this.keepaliveTimer); this.keepaliveTimer = null; }
  }

  /** Cierre manual: no reconecta. */
  close() {
    this.closedByUser = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopKeepalive();
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close();
      } catch { /* noop */ }
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = { DeepgramListener };
