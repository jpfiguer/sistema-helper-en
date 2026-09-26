/**
 * Parámetros de la conexión con Deepgram. No abre ningún socket: solo arma la URL.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DeepgramListener } = require('../src/deepgramListener');

test('pide filler_words a Deepgram cuando el idioma es inglés', () => {
  const url = new URL(new DeepgramListener('clave', { language: 'en-US' }).buildUrl());
  assert.equal(url.searchParams.get('filler_words'), 'true');
});

test('con otro idioma no pide filler_words, porque Deepgram solo lo acepta en inglés', () => {
  const url = new URL(new DeepgramListener('clave', { language: 'es' }).buildUrl());
  assert.equal(url.searchParams.get('filler_words'), null);
});
