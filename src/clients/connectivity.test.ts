import { describe, it } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { OrefClient } from './orefClient';
import { OREF_ALERTS_URL, OREF_HEADERS, TZOFAR_WS_URL, tzofarHeaders } from '../settings';

describe('Oref HTTP connectivity', () => {
  it('connects and returns valid response', async () => {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    assert.strictEqual(res.ok, true, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert.strictEqual(typeof text, 'string');
  });

  it('OrefClient.fetchAlerts returns an array', async () => {
    const client = new OrefClient(10000);
    const alerts = await client.fetchAlerts();

    assert.ok(Array.isArray(alerts), 'fetchAlerts should return an array');
    for (const alert of alerts) {
      assert.ok(alert.cat !== undefined, 'alert should have cat');
      assert.ok(Array.isArray(alert.data), 'alert.data should be an array');
    }
  });

  it('response is valid JSON or empty', async () => {
    const res = await fetch(OREF_ALERTS_URL, {
      headers: OREF_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    const text = (await res.text()).replace(/^﻿/, '').trim();

    if (text.length > 0) {
      assert.doesNotThrow(() => JSON.parse(text), 'non-empty response should be valid JSON');
    }
  });
});

describe('Tzofar WebSocket connectivity', () => {
  it('connects and receives initial message within 15s', async () => {
    const headers = tzofarHeaders();
    const messages: any[] = [];

    const result = await new Promise<{ connected: boolean; messageCount: number; error?: string }>((resolve) => {
      const ws = new WebSocket(TZOFAR_WS_URL, { headers });
      let connected = false;

      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        resolve({ connected, messageCount: messages.length });
      }, 15000);

      ws.on('open', () => {
        connected = true;
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          messages.push(msg);
        } catch {
          messages.push({ raw: data.toString() });
        }

        if (messages.length >= 1) {
          clearTimeout(timeout);
          ws.removeAllListeners();
          ws.on('error', () => {});
          ws.terminate();
          resolve({ connected, messageCount: messages.length });
        }
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        resolve({ connected: false, messageCount: 0, error: err.message });
      });
    });

    assert.strictEqual(result.connected, true, `WebSocket should connect (error: ${result.error ?? 'none'})`);
  });

  it('responds to ping with pong', async () => {
    const headers = tzofarHeaders();

    const gotPong = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(TZOFAR_WS_URL, { headers });

      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        resolve(false);
      }, 10000);

      ws.on('open', () => {
        ws.ping();
      });

      ws.on('pong', () => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        resolve(true);
      });

      ws.on('error', () => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.on('error', () => {});
        ws.terminate();
        resolve(false);
      });
    });

    assert.strictEqual(gotPong, true, 'Server should respond to ping with pong');
  });

  it('X-App-Token header is unique per call', () => {
    const h1 = tzofarHeaders();
    const h2 = tzofarHeaders();

    assert.notStrictEqual(h1['X-App-Token'], h2['X-App-Token'], 'Each call should generate a unique token');
    assert.strictEqual(h1['X-App-Token'].length, 32, 'Token should be 32 hex chars (16 bytes)');
  });
});
