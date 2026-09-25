/**
 * Voz de respaldo con `say`, el sintetizador de macOS. Gratis y sin red.
 *
 * Existe por dos motivos distintos, los dos prácticos:
 *
 *   1. Si se acaban los créditos de Cartesia a mitad de semana, la práctica no se detiene.
 *      Quedarse sin poder practicar por una cuota es la peor forma de romper una racha.
 *   2. Alguien que clona el repo puede probarlo sin sacar una cuenta de Cartesia. Tres API
 *      keys antes de oír nada es una barrera alta para evaluar si la herramienta sirve.
 *
 * NO es equivalente en calidad, y conviene decirlo: para IMITAR pronunciación quieres la
 * voz mejor que tengas. Esto sirve para no parar, no para reemplazar.
 *
 * Se activa con TTS_PROVIDER=say. La voz se elige con SAY_VOICE (por defecto Samantha,
 * en_US); `say -v '?'` lista las instaladas.
 *
 * Entrega PCM 16-bit mono al mismo sample rate que Cartesia, así que el reproductor no
 * distingue de dónde viene el audio.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SAMPLE_RATE } = require('./cartesiaSpeaker');

const VOZ = process.env.SAY_VOICE || 'Samantha';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Sintetiza con `say` y entrega el audio en trozos, misma firma que textToSpeechStream.
 *
 * `say` solo escribe a un archivo: deduce el formato de la extensión, y tanto `-o -` como
 * `-o /dev/stdout` fallan con "Opening output file failed: fmt?". Va por un .aiff temporal
 * que ffmpeg convierte al PCM del reproductor. Es el mismo ffmpeg que ya hace falta para el
 * micrófono, así que no agrega dependencias, y el temporal se paga una sola vez por texto
 * porque de ahí en adelante sale del caché.
 */
function sayStream(texto, onChunk) {
  return new Promise((resolve, reject) => {
    const t = String(texto || '').trim();
    if (!t) return resolve();

    // `say` solo escribe a un archivo: con `-o -` o `-o /dev/stdout` falla con
    // "Opening output file failed: fmt?" porque deduce el formato de la extensión.
    // Así que temporal .aiff y ffmpeg lo convierte al PCM que espera el reproductor.
    // Se paga una sola vez por texto: de ahí en adelante sale del caché.
    const tmp = path.join(os.tmpdir(), `shen-say-${process.pid}-${Date.now()}.aiff`);

    const limpiar = () => { try { fs.unlinkSync(tmp); } catch { /* noop */ } };

    const say = spawn('say', ['-v', VOZ, '-o', tmp, t]);
    say.on('error', (e) => { limpiar(); reject(e); });

    say.on('close', (code) => {
      if (code !== 0) { limpiar(); return reject(new Error(`say terminó con código ${code}`)); }

      const ff = spawn(FFMPEG, [
        '-hide_banner', '-loglevel', 'error',
        '-i', tmp,
        '-ar', String(SAMPLE_RATE), '-ac', '1', '-f', 's16le', 'pipe:1',
      ]);
      ff.stdout.on('data', (c) => onChunk(c));
      ff.on('error', (e) => { limpiar(); reject(e); });
      ff.on('close', (c2) => {
        limpiar();
        if (c2 !== 0) return reject(new Error(`ffmpeg terminó con código ${c2}`));
        resolve();
      });
    });

    // Un texto largo con una voz lenta no debería colgar la sesión.
    setTimeout(() => {
      try { say.kill('SIGKILL'); } catch { /* noop */ }
      limpiar();
    }, 30_000).unref();
  });
}

/** ¿Está `say` disponible? Solo existe en macOS. */
function disponible() {
  return process.platform === 'darwin';
}

/** true si TTS_PROVIDER=say y el sistema tiene `say`. Si no, la voz es la de Cartesia. */
function elegido() {
  return (process.env.TTS_PROVIDER || '').toLowerCase() === 'say' && disponible();
}

/** Lo que cambia el audio de un mismo texto. Es parte de la clave del caché de TTS. */
function firma() {
  return ['say', VOZ, SAMPLE_RATE].join('|');
}

module.exports = { sayStream, disponible, elegido, firma, VOZ };
