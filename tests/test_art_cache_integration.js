import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTrackPreview } from '../frontend/src/lib/artCache.js';

test('fetchTrackPreview populates preview_url and album_cover_url on card', async () => {
  const card = {
    title: 'Harder, Better, Faster, Stronger',
    artist: 'Daft Punk',
    album_cover_url: 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png' // placeholder
  };
  const preview = await fetchTrackPreview(card);
  assert.ok(preview, 'Got preview URL');
  assert.equal(card.preview_url, preview);
  assert.ok(card.album_cover_url, 'Cover URL updated');
  assert.equal(card.album_cover_url.includes('2a96cbd8b46e442fc41c2b86b821562f'), false, 'Replaced placeholder cover');
});
