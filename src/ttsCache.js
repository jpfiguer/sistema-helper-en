/**
 * Caché en disco del audio sintetizado, con Cartesia o con `say`.
 *
 * El mismo texto con la misma voz suena igual siempre, y acá se repite seguido: las frases del
 * set de lectura son fijas, los fragmentos de «▶ Oír» salen de un texto que no cambia, y
 * «Repetir pregunta» e «Intentar de nuevo» vuelven a decir lo que ya sonó. Las preguntas del
 * entrevistador se generan de nuevo en cada turno, así que esas se sintetizan cada vez.
 *
 * Desde el caché el audio suena sin esperar la red y sin gastar créditos de Cartesia.
 *
 * Formato: PCM crudo, tal como llega del proveedor, listo para el reproductor sin convertir.
 * La clave es el sha1 del texto más la firma de la voz: proveedor, voz y sample rate, y en
 * Cartesia además modelo, idioma, velocidad y volumen (ver `firma()` en cartesiaSpeaker.js y
 * saySpeaker.js). Si cambia cualquiera de esos valores, los clips anteriores dejan de
 * servirse en vez de sonar con la voz o la frecuencia equivocada.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.TTS_CACHE_DIR
  || path.join(__dirname, '..', 'cache', 'tts');

/** Tope del caché. Pasado esto se borra lo más viejo; audio de voz pesa poco. */
const MAX_MB = Number(process.env.TTS_CACHE_MAX_MB ?? 200);

function clave(texto, firma) {
  return crypto.createHash('sha1').update(`${firma}|${texto}`).digest('hex');
}

function ruta(texto, firma) {
  return path.join(DIR, `${clave(texto, firma)}.pcm`);
}

function asegurarDir() {
  try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* noop */ }
}

/** Reproduce desde disco si está. Devuelve true si sirvió el caché. */
function servir(texto, firma, onChunk) {
  const f = ruta(texto, firma);
  let buf;
  try {
    buf = fs.readFileSync(f);
  } catch {
    return false;
  }
  if (!buf.length) return false;

  // En trozos, como llegaría de la red: el reproductor espera un stream, no un bloque.
  const TROZO = 8192;
  for (let i = 0; i < buf.length; i += TROZO) onChunk(buf.subarray(i, i + TROZO));
  try { fs.utimesSync(f, new Date(), new Date()); } catch { /* noop */ }
  return true;
}

/** Guarda el audio de un texto. No guarda nada si la síntesis falló a medias. */
function guardar(texto, firma, trozos) {
  if (!trozos || !trozos.length) return;
  const buf = Buffer.concat(trozos);
  if (!buf.length) return;
  asegurarDir();
  try {
    // Escribir a temporal y renombrar: si el proceso muere a mitad no queda un .pcm
    // truncado que después suene cortado para siempre.
    const f = ruta(texto, firma);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, f);
  } catch { /* si no se puede escribir, se sigue sin caché */ }
  podar();
}

/** Borra lo menos usado si el caché pasó el tope. */
function podar() {
  try {
    const archivos = fs.readdirSync(DIR)
      .filter((n) => n.endsWith('.pcm'))
      .map((n) => {
        const p = path.join(DIR, n);
        const s = fs.statSync(p);
        return { p, size: s.size, atime: s.atimeMs };
      });
    let total = archivos.reduce((a, x) => a + x.size, 0);
    const tope = MAX_MB * 1024 * 1024;
    if (total <= tope) return;
    archivos.sort((a, b) => a.atime - b.atime);
    for (const a of archivos) {
      if (total <= tope) break;
      try { fs.unlinkSync(a.p); total -= a.size; } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

/** Cuántos archivos y cuántos MB hay guardados. Lo muestra el servidor al arrancar. */
function estado() {
  try {
    const archivos = fs.readdirSync(DIR).filter((n) => n.endsWith('.pcm'));
    const bytes = archivos.reduce((a, n) => a + fs.statSync(path.join(DIR, n)).size, 0);
    return { archivos: archivos.length, mb: Number((bytes / 1024 / 1024).toFixed(1)) };
  } catch {
    return { archivos: 0, mb: 0 };
  }
}

module.exports = { servir, guardar, ruta, estado, DIR };
