/**
 * Captura de tu micrófono — el audio que se transcribe sos tú hablando en inglés.
 *
 * En la versión anterior este módulo capturaba al entrevistador desde un dispositivo de
 * loopback. Acá el sentido está invertido: la entrada es tu micrófono real, porque lo que se
 * mide es tu habla, no la de otro. Por eso el device por defecto es el del sistema y no hay
 * nada que configurar en Audio MIDI Setup.
 *
 * Backend: ffmpeg + avfoundation. En vez de `naudiodon` (módulo nativo, build frágil en macOS
 * reciente / arm64), usamos el ffmpeg del sistema, que ya viene instalado y resamplea a
 * 16k mono PCM sin compilar nada.
 *
 * Salida: PCM 16-bit little-endian, mono, 16 kHz (linear16, el formato que espera Deepgram
 * nova-3), emitido en chunks vía callback `onChunk(Buffer)`.
 *
 * Los bytes que pasan por acá son además la fuente de la duración real de cada respuesta:
 * 32.000 bytes = 1 segundo. Ver `metrics.js`.
 *
 * Interfaz:
 *   listDevices() -> Promise<[{ index, name }]>
 *   startCapture({ deviceName, sampleRate, channels, onChunk, onError, onStop }) -> Promise<stopFn>
 */

const { spawn, execFile } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

/**
 * Lista los dispositivos de audio de entrada que ve avfoundation.
 * ffmpeg imprime la lista en stderr y sale con código !=0 (esperado); parseamos stderr igual.
 */
function listDevices() {
  return new Promise((resolve) => {
    execFile(
      FFMPEG,
      ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { timeout: 10_000 },
      (_err, _stdout, stderr) => resolve(parseAudioDevices(stderr || '')),
    );
  });
}

/**
 * Parsea el bloque "AVFoundation audio devices:" de la salida de ffmpeg.
 * Cada línea relevante es: `[AVFoundation indev @ 0x..] [N] Nombre del device`.
 */
function parseAudioDevices(stderr) {
  const devices = [];
  let inAudioBlock = false;
  for (const line of stderr.split('\n')) {
    if (/AVFoundation audio devices:/.test(line)) { inAudioBlock = true; continue; }
    if (/AVFoundation video devices:/.test(line)) { inAudioBlock = false; continue; }
    if (!inAudioBlock) continue;
    const m = line.match(/\]\s*\[(\d+)\]\s*(.+?)\s*$/);
    if (m) devices.push({ index: Number(m[1]), name: m[2] });
  }
  return devices;
}

/**
 * Arranca la captura desde `deviceName` y entrega PCM en chunks por `onChunk`.
 * Resuelve a una función `stop()` que termina el proceso de ffmpeg.
 *
 * @throws si el dispositivo no se encuentra (ej. BlackHole no instalado).
 */
async function startCapture({
  deviceName = process.env.INPUT_DEVICE || '',
  sampleRate = 16000,
  channels = 1,
  onChunk,
  onError,
  onStop,
} = {}) {
  const devices = await listDevices();
  // Sin nombre explícito usamos el primer input, que en macOS es el micrófono por defecto.
  const match = deviceName
    ? devices.find((d) => d.name.toLowerCase().includes(deviceName.toLowerCase()))
    : devices[0];

  if (!match) {
    const available = devices.length
      ? devices.map((d) => `[${d.index}] ${d.name}`).join(', ')
      : '(ninguno — ¿ffmpeg/avfoundation OK?)';
    throw new Error(
      `Micrófono no encontrado${deviceName ? `: "${deviceName}"` : ''}. ` +
      `Disponibles: ${available}. ` +
      'Revisá que la terminal tenga permiso de Micrófono en Ajustes > Privacidad y seguridad.',
    );
  }

  // avfoundation input ":N" = solo audio del device índice N.
  // -ac/-ar resamplean al formato que espera Deepgram; s16le = PCM 16-bit LE crudo a stdout.
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-i', `:${match.index}`,
    '-ac', String(channels),
    '-ar', String(sampleRate),
    '-f', 's16le',
    'pipe:1',
  ];

  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stopping = false;
  let stderrTail = '';

  ff.stdout.on('data', (chunk) => { if (onChunk) onChunk(chunk); });

  ff.stderr.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-1000);
  });

  ff.on('error', (err) => {
    // p.ej. ENOENT si no está ffmpeg en el PATH
    if (onError) onError(new Error(`No se pudo lanzar ffmpeg: ${err.message}`));
  });

  ff.on('close', (code, signal) => {
    if (!stopping && code && code !== 0) {
      if (onError) onError(new Error(`ffmpeg terminó (code ${code}): ${stderrTail.trim()}`));
    }
    if (onStop) onStop(code, signal);
  });

  return function stop() {
    stopping = true;
    try { ff.kill('SIGTERM'); } catch { /* ya muerto */ }
  };
}

module.exports = { startCapture, listDevices };
