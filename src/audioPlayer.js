/**
 * Reproduce el audio del entrevistador por los parlantes.
 *
 * Reemplaza al router de audio de la versión anterior. La diferencia no es de implementación,
 * es de propósito: acá el audio sale por la salida real del sistema, para que lo escuches vos.
 * No hay ruta hacia un micrófono virtual, y por eso este módulo no puede usarse para meter voz
 * sintética en una llamada.
 *
 * Eso está además verificado en código, no solo documentado: `elegirSalida()` rechaza los
 * dispositivos de loopback conocidos (BlackHole, Loopback, Soundflower, VB-Cable). Si alguien
 * apunta la salida a uno de ellos, el módulo se niega a arrancar. Es la única forma de que la
 * restricción sobreviva a un fork.
 *
 * Backend: ffmpeg + audiotoolbox, igual que la captura — no compila nada y ya está instalado.
 * Entrada: PCM 16-bit LE mono al sample rate que entrega Cartesia (24 kHz por defecto).
 */

'use strict';

const { spawn } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Dispositivos de audio virtual. No son "malos" — son la pieza que permitiría hacer pasar
 * esta voz por la tuya en un Meet. Quedan fuera por diseño.
 */
const LOOPBACK_PROHIBIDO = [
  'blackhole', 'loopback', 'soundflower', 'vb-cable', 'vb cable',
  'virtual audio', 'voicemeeter', 'existential audio',
];

function esLoopback(nombre) {
  const n = String(nombre || '').toLowerCase();
  return LOOPBACK_PROHIBIDO.some((p) => n.includes(p));
}

/**
 * Valida el destino de salida.
 * @param {string} [nombre] nombre del device; vacío = salida por defecto del sistema
 * @throws si apunta a un dispositivo de loopback
 */
function elegirSalida(nombre) {
  if (!nombre) return null;          // null = default del sistema, que es lo que queremos
  if (esLoopback(nombre)) {
    throw new Error(
      `Salida rechazada: "${nombre}" es un dispositivo de audio virtual. ` +
      'Esta herramienta reproduce por los parlantes para que practiques escuchando. ' +
      'No rutea audio hacia un micrófono virtual.',
    );
  }
  return nombre;
}

/**
 * Abre un reproductor de PCM. Devuelve un objeto con `write(chunk)` y `end()`.
 *
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=24000]
 * @param {number} [opts.channels=1]
 * @param {string} [opts.deviceName]  device de salida; por defecto el del sistema
 * @param {(e:Error)=>void} [opts.onError]
 */
function crearReproductor({
  sampleRate = Number(process.env.CARTESIA_SAMPLE_RATE ?? 24000),
  channels = 1,
  deviceName = process.env.OUTPUT_DEVICE || '',
  onError,
} = {}) {
  const destino = elegirSalida(deviceName);

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-i', 'pipe:0',
    '-f', 'audiotoolbox',
  ];
  // Sin índice de device, audiotoolbox usa la salida por defecto del sistema.
  args.push(destino ? destino : '-');

  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let colaStderr = '';
  let cerrado = false;

  ff.stderr.on('data', (d) => { colaStderr = (colaStderr + d.toString()).slice(-800); });
  ff.on('error', (err) => onError && onError(new Error(`No se pudo lanzar ffmpeg: ${err.message}`)));
  ff.on('close', (code) => {
    cerrado = true;
    if (code && code !== 0 && onError) {
      onError(new Error(`ffmpeg de salida terminó (code ${code}): ${colaStderr.trim()}`));
    }
  });
  // EPIPE si ffmpeg muere antes de que terminemos de escribir: ruido, no error real.
  ff.stdin.on('error', () => { /* noop */ });

  return {
    write(chunk) {
      if (cerrado) return false;
      return ff.stdin.write(chunk);
    },
    end() {
      try { ff.stdin.end(); } catch { /* noop */ }
    },
    kill() {
      cerrado = true;
      try { ff.kill('SIGTERM'); } catch { /* noop */ }
    },
  };
}

module.exports = { crearReproductor, elegirSalida, esLoopback, LOOPBACK_PROHIBIDO };
