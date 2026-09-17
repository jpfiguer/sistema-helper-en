#!/usr/bin/env node
/**
 * Chequeo previo: verifica que todo lo que la sesión necesita esté en su lugar.
 *
 * Corre antes de practicar, no antes de programar. Cada chequeo prueba la cosa real —
 * lanza ffmpeg, abre el WebSocket contra Deepgram, le pide una frase a Groq, sintetiza un
 * segundo de audio en Cartesia — en vez de mirar si la variable de entorno está definida.
 * Una clave presente pero inválida es el caso que más tiempo hace perder, y es exactamente
 * el que un chequeo de `typeof` no encuentra.
 *
 *   npm run check
 *
 * Sale con 0 si podés practicar, 1 si falta algo.
 */

'use strict';

require('dotenv').config();

const { execFile } = require('child_process');
const WebSocket = require('ws');
const { listDevices } = require('../src/audioCapture');

const VERDE = '\x1b[32m'; const ROJO = '\x1b[31m'; const AMAR = '\x1b[33m';
const GRIS = '\x1b[90m'; const NEG = '\x1b[1m'; const FIN = '\x1b[0m';

const OK = `${VERDE}✓${FIN}`;
const MAL = `${ROJO}✗${FIN}`;
const OJO = `${AMAR}!${FIN}`;

let fallas = 0;

function bien(t, d) { console.log(`  ${OK} ${t}${d ? ` ${GRIS}${d}${FIN}` : ''}`); }
function mal(t, d) { fallas += 1; console.log(`  ${MAL} ${t}${d ? `\n      ${GRIS}${d}${FIN}` : ''}`); }
function ojo(t, d) { console.log(`  ${OJO} ${t}${d ? `\n      ${GRIS}${d}${FIN}` : ''}`); }

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function chequearFfmpeg() {
  return new Promise((resolve) => {
    execFile(FFMPEG, ['-version'], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        mal('ffmpeg', `No está en el PATH. Instalalo con: brew install ffmpeg${process.env.FFMPEG_PATH ? `  (FFMPEG_PATH=${process.env.FFMPEG_PATH})` : ''}`);
      } else {
        bien('ffmpeg', (stdout.split('\n')[0] || '').replace('ffmpeg version ', 'v').slice(0, 40));
      }
      resolve();
    });
  });
}

async function chequearMicrofono() {
  let devices = [];
  try { devices = await listDevices(); } catch { /* cae abajo */ }

  if (!devices.length) {
    mal('micrófono', 'ffmpeg no ve ningún dispositivo de entrada. En macOS: Ajustes > Privacidad y seguridad > Micrófono, y habilitá tu terminal.');
    return;
  }

  const elegido = process.env.INPUT_DEVICE
    ? devices.find((d) => d.name.toLowerCase().includes(process.env.INPUT_DEVICE.toLowerCase()))
    : devices[0];

  if (!elegido) {
    mal('micrófono', `INPUT_DEVICE="${process.env.INPUT_DEVICE}" no coincide con ninguno. Disponibles: ${devices.map((d) => d.name).join(', ')}`);
    return;
  }

  bien('micrófono', `[${elegido.index}] ${elegido.name}`);
  console.log(`      ${GRIS}otros: ${devices.filter((d) => d !== elegido).map((d) => d.name).join(', ') || '(ninguno)'}${FIN}`);

  if (/blackhole|loopback|soundflower|vb-?cable/i.test(elegido.name)) {
    ojo('el micrófono elegido es un dispositivo virtual',
      'Esta herramienta mide TU voz. Apuntando a un loopback estarías grabando el audio del sistema. Cambiá INPUT_DEVICE.');
  }
}

function chequearDeepgram() {
  return new Promise((resolve) => {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) { mal('Deepgram', 'Falta DEEPGRAM_API_KEY en .env'); return resolve(); }

    const url = 'wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1';
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
    const t = setTimeout(() => { try { ws.close(); } catch {} mal('Deepgram', 'timeout de conexión'); resolve(); }, 9000);

    ws.on('open', () => {
      clearTimeout(t);
      bien('Deepgram', 'nova-3 en-US');
      try { ws.close(); } catch {}
      resolve();
    });
    ws.on('unexpected-response', (_r, res) => {
      clearTimeout(t);
      mal('Deepgram', `HTTP ${res.statusCode}${res.statusCode === 401 ? ' — la clave es inválida' : ''}`);
      resolve();
    });
    ws.on('error', (e) => { clearTimeout(t); mal('Deepgram', e.message); resolve(); });
  });
}

async function chequearGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) { mal('Groq', 'Falta GROQ_API_KEY en .env'); return; }

  const modelo = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  try {
    const Groq = require('groq-sdk');
    const Cliente = Groq.default || Groq.Groq || Groq;
    const c = new Cliente({ apiKey: key });
    const t0 = Date.now();
    const r = await c.chat.completions.create({
      model: modelo,
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: 8,
      temperature: 0,
    });
    const txt = r.choices?.[0]?.message?.content?.trim() || '';
    bien('Groq', `${modelo} · ${Date.now() - t0} ms · "${txt.slice(0, 20)}"`);
  } catch (e) {
    mal('Groq', `${modelo}: ${e.message.slice(0, 160)}`);
  }
}

async function chequearCartesia() {
  if (!process.env.CARTESIA_API_KEY) { mal('Cartesia', 'Falta CARTESIA_API_KEY en .env'); return; }
  if (!process.env.CARTESIA_VOICE_ID) { mal('Cartesia', 'Falta CARTESIA_VOICE_ID en .env — elegí una voz en play.cartesia.ai'); return; }

  try {
    const { textToSpeechStream } = require('../src/cartesiaSpeaker');
    let bytes = 0;
    const t0 = Date.now();
    const r = await textToSpeechStream('Ready when you are.', (c) => { bytes += c.length; });
    const seg = (bytes / (Number(process.env.CARTESIA_SAMPLE_RATE ?? 24000) * 2)).toFixed(1);
    bien('Cartesia', `${bytes} bytes (${seg}s) · TTFA ${r.ttfaMs ?? '?'} ms · total ${Date.now() - t0} ms`);
  } catch (e) {
    mal('Cartesia', e.message.slice(0, 200));
  }
}

function chequearSalida() {
  const nombre = process.env.OUTPUT_DEVICE;
  if (!nombre) { bien('salida de audio', 'parlantes por defecto del sistema'); return; }
  try {
    const { elegirSalida } = require('../src/audioPlayer');
    elegirSalida(nombre);
    bien('salida de audio', nombre);
  } catch (e) {
    mal('salida de audio', e.message);
  }
}

(async () => {
  console.log(`\n${NEG}sistema-helper-en — chequeo previo${FIN}\n`);

  await chequearFfmpeg();
  await chequearMicrofono();
  chequearSalida();
  await chequearDeepgram();
  await chequearGroq();
  await chequearCartesia();

  console.log('');
  if (fallas === 0) {
    console.log(`  ${VERDE}${NEG}Todo listo.${FIN} Arrancá con ${NEG}npm start${FIN} y abrí http://localhost:${process.env.PORT || 3002}\n`);
    process.exit(0);
  }
  console.log(`  ${ROJO}${NEG}${fallas} cosa${fallas > 1 ? 's' : ''} por resolver${FIN} antes de practicar.\n`);
  process.exit(1);
})();
