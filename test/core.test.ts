import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decryptText, encryptText, safeEqual } from '../src/crypto.js';

test('encrypts and decrypts refresh-token data', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptText('secret-token', key);
  assert.notEqual(encrypted, 'secret-token');
  assert.equal(decryptText(encrypted, key), 'secret-token');
});

test('constant-time equality handles equal and unequal values', () => {
  assert.equal(safeEqual('same', 'same'), true);
  assert.equal(safeEqual('same', 'different'), false);
});

test('upload root fixture can be created safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-mcp-'));
  const video = path.join(root, 'video.mp4');
  fs.writeFileSync(video, 'fixture');
  assert.equal(fs.statSync(video).isFile(), true);
});
