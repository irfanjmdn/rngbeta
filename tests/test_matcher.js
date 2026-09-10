import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreTrack, stringSimilarity, splitArtists } from '../frontend/src/lib/matcher.js';

test('splitArtists handles standard delimiters', () => {
  assert.deepEqual(splitArtists('Daft Punk feat. Pharrell Williams'), ['Daft Punk', 'Pharrell Williams']);
  assert.deepEqual(splitArtists('Drake & 21 Savage'), ['Drake', '21 Savage']);
  assert.deepEqual(splitArtists('Kanye West, Kid Cudi'), ['Kanye West', 'Kid Cudi']);
});

test('stringSimilarity matches exact and substrings', () => {
  assert.equal(stringSimilarity('One More Time', 'One More Time'), 1);
  assert.equal(stringSimilarity('One More Time (12" Mix)', 'One More Time') >= 0.85, true);
});

test('scoreTrack identifies matching song', () => {
  const candidate = {
    title: 'Get Lucky',
    artist: 'Daft Punk',
    album: 'Random Access Memories'
  };
  const result = scoreTrack(candidate, 'Get Lucky', 'Daft Punk feat. Pharrell Williams', 'Random Access Memories');
  assert.equal(result.score >= 0.7, true);
  assert.equal(result.titleScore >= 0.5, true);
  assert.equal(result.artistScore >= 0.5, true);
});
