import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadKey } from '../../upload-state.js';

const file = {
  name: 'mobile.jpg',
  size: 1024,
  lastModified: 1784120000000,
  type: 'image/jpeg',
};

test('reuses an upload when the file and metadata inputs are unchanged', () => {
  const first = createUploadKey(file, { name: 'Mobile NFT', symbol: 'aisol', description: 'Hello' });
  const second = createUploadKey(file, { name: ' Mobile NFT ', symbol: 'AISOL', description: ' Hello ' });
  assert.equal(second, first);
});

test('requires a new upload when NFT metadata changes', () => {
  const first = createUploadKey(file, { name: 'Mobile NFT', symbol: 'AISOL', description: 'First' });
  const changed = createUploadKey(file, { name: 'Mobile NFT', symbol: 'AISOL', description: 'Second' });
  assert.notEqual(changed, first);
});

test('requires a new upload when the selected file changes', () => {
  const first = createUploadKey(file, { name: 'Mobile NFT', symbol: 'AISOL', description: 'Hello' });
  const changed = createUploadKey({ ...file, size: 2048 }, { name: 'Mobile NFT', symbol: 'AISOL', description: 'Hello' });
  assert.notEqual(changed, first);
});
