/**
 * Tests del caché de TTS: un clip solo se sirve con la misma voz con que se generó.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TTS_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-cache-'));
test.after(() => fs.rmSync(process.env.TTS_CACHE_DIR, { recursive: true, force: true }));

const ttsCache = require('../src/ttsCache');
const cartesia = require('../src/cartesiaSpeaker');
const say = require('../src/saySpeaker');

test('un clip guardado con una voz no se sirve con otra', () => {
  const audio = Buffer.from([1, 2, 3, 4, 5, 6]);
  ttsCache.guardar('Tell me about yourself.', 'cartesia|voz-a|24000', [audio]);

  const recibido = [];
  assert.equal(ttsCache.servir('Tell me about yourself.', 'say|Samantha|24000', (c) => recibido.push(c)), false);
  assert.equal(ttsCache.servir('Tell me about yourself.', 'cartesia|voz-a|44100', (c) => recibido.push(c)), false);
  assert.equal(recibido.length, 0);

  assert.equal(ttsCache.servir('Tell me about yourself.', 'cartesia|voz-a|24000', (c) => recibido.push(c)), true);
  assert.deepEqual(Buffer.concat(recibido), audio);
});

test('las firmas distinguen proveedor e incluyen el sample rate', () => {
  const fc = cartesia.firma();
  const fs_ = say.firma();
  assert.notEqual(fc, fs_);
  assert.ok(fc.startsWith('cartesia|'));
  assert.ok(fs_.startsWith(`say|${say.VOZ}|`));
  assert.ok(fc.endsWith(`|${cartesia.SAMPLE_RATE}`));
  assert.ok(fs_.endsWith(`|${cartesia.SAMPLE_RATE}`));
});
