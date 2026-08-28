const assert = require('node:assert/strict');
const test = require('node:test');
const { createZipBlob } = require('../zip.js');

test('ZIP writer creates a readable local-file archive signature', async () => {
  const blob = await createZipBlob([
    { name: 'manifest.json', data: '{"ok":true}' },
    { name: 'media/test.txt', data: 'hello' }
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /manifest\.json/);
  assert.match(text, /media\/test\.txt/);
});
