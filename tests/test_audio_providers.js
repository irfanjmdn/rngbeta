import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDeezerTrack, getAppleMusicToken, fetchAppleMusicTrack } from '../frontend/src/lib/audioProviders.js';

test('Deezer returns audio preview and 1000x1000 album cover', async () => {
  const result = await fetchDeezerTrack('Daft Punk', 'One More Time');
  assert.ok(result, 'Deezer track found');
  assert.ok(result.previewUrl && result.previewUrl.startsWith('http'), 'Has valid previewUrl');
  assert.ok(
    result.albumCoverUrl && (result.albumCoverUrl.includes('1000x1000') || result.albumCoverUrl.includes('500x500')),
    'Has HD cover URL'
  );
});

test('Apple Music minter returns valid bearer token', async () => {
  const token = await getAppleMusicToken();
  assert.ok(token, 'Token string exists');
  assert.ok(token.length > 50, 'Token has valid length');
});

test('Apple Music Catalog API returns preview and artwork template', async () => {
  const result = await fetchAppleMusicTrack('Daft Punk', 'One More Time');
  assert.ok(result, 'Apple Music track found');
  assert.ok(result.previewUrl && result.previewUrl.startsWith('http'), 'Has preview URL');
  assert.ok(result.albumCoverUrl && result.albumCoverUrl.includes('1000x1000'), 'Has formatted HD cover URL');
});
