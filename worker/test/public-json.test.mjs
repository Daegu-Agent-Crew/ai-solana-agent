import assert from 'node:assert/strict';
import test from 'node:test';
import { waitUntilPublic } from '../src/index.js';

test('accepts parseable Raw GitHub JSON served as text/plain', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ name: 'Uploaded NFT', image: 'https://example.com/image.jpg' }),
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );

  try {
    const result = await waitUntilPublic('https://example.com/metadata.json', 'application/json', 1);
    assert.equal(result.status, 200);
    assert.equal(result.type, 'text/plain; charset=utf-8');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('still rejects a non-JSON text response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'not json',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );

  try {
    await assert.rejects(
      waitUntilPublic('https://example.com/metadata.json', 'application/json', 1),
      /HTTP 200, Content-Type text\/plain/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
