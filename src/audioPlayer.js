/**
 * Reproduce el audio del entrevistador por los parlantes.
 *
 * `elegirSalida()` rechaza por nombre los dispositivos de audio virtual conocidos (BlackHole,
 * Loopback, Soundflower, VB-Cable, VoiceMeeter) cuando OUTPUT_DEVICE apunta a uno. Sin
 * OUTPUT_DEVICE se usa la salida por defecto del sistema, que no se revisa: si esa salida ya
 * es un dispositivo virtual, este chequeo no lo detecta.
 *
 * Backend: ffmpeg con salida audiotoolbox, solo macOS.
 * Entrada: PCM 16-bit LE mono a CARTESIA_SAMPLE_RATE (24 kHz por defecto), venga de Cartesia
 * o de `say`.
 */

'use strict';

const { spawn } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Dispositivos de audio virtual. Quedan fuera por diseño: la voz sintética no puede
 * enrutarse a una llamada.
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
 * Abre un reproductor de PCM. Devuelve `write(chunk)`, `end()`, `kill()` y `terminado`, una
 * promesa que se cumple cuando ffmpeg sale. Con audiotoolbox eso pasa cuando el audio terminó
 * de sonar, no cuando terminó de llegar: el caché entrega todo de una vez.
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

  // Si ffmpeg no llega a lanzarse, Node emite 'error' y después 'close'; se escuchan los dos.
  const terminado = new Promise((resolve) => {
    ff.on('close', resolve);
    ff.on('error', resolve);
  });

  return {
    terminado,
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
