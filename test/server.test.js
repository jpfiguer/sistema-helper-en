/**
 * Tests del acceso al servidor: solo loopback, y el WebSocket solo desde la propia página.
 *
 *   npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const { server, escuchar, origenPermitido } = require('../src/server');

test('origenPermitido acepta solo la página de este mismo servidor', () => {
  assert.equal(origenPermitido('http://localhost:3002', 3002), true);
  assert.equal(origenPermitido('http://127.0.0.1:3002', 3002), true);
  assert.equal(origenPermitido('http://localhost:4000', 3002), false);
  assert.equal(origenPermitido('https://localhost:3002', 3002), false);
  assert.equal(origenPermitido('https://ejemplo.com', 3002), false);
  assert.equal(origenPermitido('null', 3002), false);
  assert.equal(origenPermitido(undefined, 3002), false);
});

/** Intenta el handshake y devuelve 'abierto' o el status HTTP con que se rechazó. */
function conectar(puerto, origen) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${puerto}`, origen ? { origin: origen } : {});
    ws.on('open', () => { ws.close(); resolve('abierto'); });
    ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); });
    ws.on('error', (e) => { if (!/Unexpected server response/.test(e.message)) reject(e); });
  });
}

test('escucha solo en 127.0.0.1 y rechaza WebSockets de otro origen', { timeout: 10_000 }, async (t) => {
  await new Promise((resolve) => escuchar(0, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');

  assert.equal(await conectar(port, `http://localhost:${port}`), 'abierto');
  assert.equal(await conectar(port, `http://127.0.0.1:${port}`), 'abierto');
  assert.equal(await conectar(port, 'https://ejemplo.com'), 403);
  assert.equal(await conectar(port, `http://localhost:${port + 1}`), 403);
  assert.equal(await conectar(port, null), 403);
});
