/**
 * Log de cada sesión de práctica a JSONL — una línea JSON por evento, en orden cronológico.
 *
 * No es un log de depuración: es el set de evaluación. La idea es la misma que se usa para
 * medir un sistema de RAG en producción — el conjunto contra el que te mides no se escribe,
 * se captura. Tus respuestas reales de la semana pasada son el baseline de esta semana, y
 * `scripts/report.js` lee estos archivos para mostrar si mejoraste o si te lo estás
 * imaginando.
 *
 * Decisiones:
 * - Un archivo por sesión, con la fecha en el nombre. Sin rotación ni índice: son chicos.
 * - El archivo se crea RECIÉN con el primer evento real, para no dejar archivos vacíos cada
 *   vez que arrancas el server a probar algo.
 * - Escritura append, sin await: un fallo de disco no puede frenar la práctica. El error se
 *   logea una vez y el resto de la sesión sigue sin log.
 * - JSONL y no JSON: se puede seguir con `tail -f` mientras practicas, y cada línea es válida
 *   aunque el proceso muera a la mitad.
 *
 * Apagado con SESSION_LOG=off. El directorio va gitignored: contiene tu voz transcripta.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.SESSION_DIR || path.join(__dirname, '..', 'sesiones');
const ENABLED = (process.env.SESSION_LOG || 'on').toLowerCase() !== 'off';

let stream = null;
let filePath = null;
let broken = false;
let meta = null;      // cabecera de sesión; se escribe como primera línea del archivo

/** Nombre de archivo ordenable y sin caracteres raros: 2026-09-16T16-30-05.jsonl */
function nombreDeSesion() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\..+$/, '') + '.jsonl';
}

function ensureStream() {
  if (stream || broken || !ENABLED) return stream;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    filePath = path.join(DIR, nombreDeSesion());
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    stream.on('error', (e) => {
      if (!broken) console.warn(`[sesion] se desactiva por error de escritura: ${e.message}`);
      broken = true;
    });
    console.log(`[sesion] guardando en ${filePath}`);
    if (meta) stream.write(JSON.stringify({ ts: new Date().toISOString(), type: 'session', ...meta }) + '\n');
  } catch (e) {
    console.warn(`[sesion] no se pudo abrir el archivo: ${e.message}`);
    broken = true;
  }
  return stream;
}

/**
 * Define la cabecera de sesión (modelos, voz, devices). No abre el archivo: se escribe como
 * primera línea recién cuando llega el primer evento real, para no dejar archivos vacíos.
 */
function setSessionMeta(obj) {
  meta = obj;
}

/**
 * Agrega un evento. `type` identifica la clase de línea; el resto de los campos van tal cual.
 * Nunca tira: un fallo de log no puede romper una sesión en curso.
 */
function log(type, data = {}) {
  const s = ensureStream();
  if (!s) return;
  try {
    s.write(JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + '\n');
  } catch (e) {
    if (!broken) console.warn(`[sesion] evento descartado: ${e.message}`);
    broken = true;
  }
}

/** Cierra el archivo (shutdown). Si nunca se escribió nada, no hay nada que cerrar. */
function close() {
  if (!stream) return;
  try { stream.end(); } catch { /* noop */ }
  stream = null;
}

/** Ruta del archivo de esta sesión, o null si todavía no se escribió nada. */
function currentPath() {
  return filePath;
}

module.exports = { log, setSessionMeta, close, currentPath, ENABLED, DIR };
