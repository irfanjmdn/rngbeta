# Monochrome Audio and Cover Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade track audio preview and album cover resolution using Monochrome's multi-tier providers (iTunes, Apple Music Catalog, Deezer) and multi-artist fuzzy matcher.

**Architecture:** A unified client-side resolver in `frontend/src/lib/` queries iTunes first, then falls back to Apple Music Catalog API (via live token minter) and Deezer public search. Matches are validated using Monochrome's tokenized scoring algorithm (`titleScore * 0.5 + artistScore * 0.4 + albumScore * 0.1`), extracting both 30-second audio previews and HD album artwork.

**Tech Stack:** JavaScript (ES modules), Web Fetch API, LocalStorage, Node.js stdlib test runner (`node --test`).

---

### Task 1: Create Multi-Artist Token Matcher

**Files:**
- Create: `frontend/src/lib/matcher.js`
- Test: `tests/test_matcher.js`

- [ ] **Step 1: Write the failing unit test for the matcher**

Create `tests/test_matcher.js` testing title similarity, artist splitting, and track scoring:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test_matcher.js`
Expected: FAIL with module not found `../frontend/src/lib/matcher.js`

- [ ] **Step 3: Implement minimal matcher in frontend/src/lib/matcher.js**

Port Monochrome's matching functions:

```javascript
export function normalizeForMatch(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function tokenize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function stringSimilarity(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let common = 0;
  for (const t of sa) {
    if (sb.has(t)) common++;
  }
  return common / Math.max(sa.size, sb.size);
}

export function splitArtists(str) {
  return String(str || '')
    .split(/[,&]| and | feat\.? | featuring /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getTrackArtistNames(track) {
  if (Array.isArray(track.artists) && track.artists.length > 0) {
    const names = track.artists.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
    if (names.length > 0) return names;
  }
  if (track.artist?.name) return [track.artist.name];
  if (typeof track.artist === 'string') return [track.artist];
  return [];
}

export function scoreTrack(candidate, targetTitle, targetArtist, targetAlbum = '') {
  const candidateTitle = candidate.title || candidate.trackName || candidate.name || '';
  const titleScore = stringSimilarity(candidateTitle, targetTitle);

  const candidateArtists = getTrackArtistNames(candidate);
  const targetArtists = splitArtists(targetArtist);
  let artistScore = 0;

  for (const ta of targetArtists) {
    for (const ca of candidateArtists) {
      artistScore = Math.max(artistScore, stringSimilarity(ca, ta));
    }
  }
  if (candidateArtists.length > 0) {
    artistScore = Math.max(artistScore, stringSimilarity(candidateArtists.join(' '), targetArtist));
  }

  const candidateAlbum = candidate.album?.title || candidate.collectionName || candidate.album || '';
  const albumScore = targetAlbum && candidateAlbum ? stringSimilarity(candidateAlbum, targetAlbum) : 0;

  const score = titleScore * 0.5 + artistScore * 0.4 + albumScore * 0.1;
  return { score, titleScore, artistScore, albumScore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test_matcher.js`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add frontend/src/lib/matcher.js tests/test_matcher.js
git commit -m "feat: add multi-artist token matcher from monochrome"
```

---

### Task 2: Build Provider Clients for Apple Music and Deezer

**Files:**
- Create: `frontend/src/lib/audioProviders.js`
- Test: `tests/test_audio_providers.js`

- [ ] **Step 1: Write integration tests for Apple Music token and Deezer lookup**

Create `tests/test_audio_providers.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDeezerTrack, getAppleMusicToken, fetchAppleMusicTrack } from '../frontend/src/lib/audioProviders.js';

test('Deezer returns audio preview and 1000x1000 album cover', async () => {
  const result = await fetchDeezerTrack('Daft Punk', 'One More Time');
  assert.ok(result, 'Deezer track found');
  assert.ok(result.previewUrl.startsWith('http'), 'Has valid previewUrl');
  assert.ok(result.albumCoverUrl.includes('1000x1000') || result.albumCoverUrl.includes('500x500'), 'Has HD cover URL');
});

test('Apple Music minter returns valid bearer token', async () => {
  const token = await getAppleMusicToken();
  assert.ok(token, 'Token string exists');
  assert.ok(token.length > 50, 'Token has valid length');
});

test('Apple Music Catalog API returns preview and artwork template', async () => {
  const result = await fetchAppleMusicTrack('Daft Punk', 'One More Time');
  assert.ok(result, 'Apple Music track found');
  assert.ok(result.previewUrl.startsWith('http'), 'Has preview URL');
  assert.ok(result.albumCoverUrl.includes('1000x1000'), 'Has formatted HD cover URL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test_audio_providers.js`
Expected: FAIL with module not found `../frontend/src/lib/audioProviders.js`

- [ ] **Step 3: Implement frontend/src/lib/audioProviders.js**

Implement token caching, Apple Music catalog query, and Deezer query with scoring:

```javascript
import { scoreTrack } from './matcher.js';

let cachedAppleToken = null;
let tokenPromise = null;

export async function getAppleMusicToken() {
  if (cachedAppleToken && cachedAppleToken.expiresAt > Date.now()) {
    return cachedAppleToken.token;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const stored = JSON.parse(localStorage.getItem('crate_am_token') || '{}');
      if (stored.token && stored.expiresAt > Date.now()) {
        cachedAppleToken = stored;
        return stored.token;
      }
    } catch {}
  }

  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    try {
      const res = await fetch('https://am-mint.binimum.org/token');
      if (!res.ok) throw new Error(`Token failed: ${res.status}`);
      const data = await res.json();
      const token = data.token || data.dev_token;
      const ttl = (data.cache_ttl_seconds || 120) * 1000;
      cachedAppleToken = { token, expiresAt: Date.now() + ttl };
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('crate_am_token', JSON.stringify(cachedAppleToken));
        } catch {}
      }
      return token;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

export async function fetchAppleMusicTrack(artist, title, album = '') {
  try {
    const token = await getAppleMusicToken();
    if (!token) return null;
    const query = `${artist} ${title}`.trim();
    const url = `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=5`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const songs = data.results?.songs?.data || [];

    let best = null;
    let bestScore = 0;
    for (const item of songs) {
      const attrs = item.attributes || {};
      const candidate = {
        title: attrs.name,
        artist: attrs.artistName,
        album: attrs.albumName
      };
      const score = scoreTrack(candidate, title, artist, album);
      if (score.titleScore >= 0.5 && score.score > bestScore) {
        bestScore = score.score;
        best = { attrs, score: score.score };
      }
    }

    if (!best || best.score < 0.6) return null;

    const previewUrl = best.attrs.previews?.[0]?.url || null;
    let albumCoverUrl = null;
    if (best.attrs.artwork?.url) {
      albumCoverUrl = best.attrs.artwork.url.replace('{w}x{h}', '1000x1000');
    }
    const releaseDate = best.attrs.releaseDate || null;

    return { previewUrl, albumCoverUrl, releaseDate, provider: 'apple-catalog' };
  } catch {
    return null;
  }
}

export async function fetchDeezerTrack(artist, title, album = '') {
  try {
    const query = `${artist} ${title}`.trim();
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.data || [];

    let best = null;
    let bestScore = 0;
    for (const item of items) {
      const candidate = {
        title: item.title,
        artist: item.artist?.name,
        album: item.album?.title
      };
      const score = scoreTrack(candidate, title, artist, album);
      if (score.titleScore >= 0.5 && score.score > bestScore) {
        bestScore = score.score;
        best = { item, score: score.score };
      }
    }

    if (!best || best.score < 0.6) return null;

    const previewUrl = best.item.preview || null;
    const albumCoverUrl = best.item.album?.cover_xl || best.item.album?.cover_big || null;
    return { previewUrl, albumCoverUrl, releaseDate: null, provider: 'deezer' };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test_audio_providers.js`
Expected: PASS (all 3 tests succeed with live network calls).

- [ ] **Step 5: Commit**

Run:
```bash
git add frontend/src/lib/audioProviders.js tests/test_audio_providers.js
git commit -m "feat: add apple music catalog and deezer provider resolvers"
```

---

### Task 3: Upgrade artCache.js with Fallback Chain and HD Cover Resolution

**Files:**
- Modify: `frontend/src/lib/artCache.js`
- Test: `tests/test_art_cache_integration.js`

- [ ] **Step 1: Write integration test for the upgraded artCache**

Create `tests/test_art_cache_integration.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `node --test tests/test_art_cache_integration.js`

- [ ] **Step 3: Update frontend/src/lib/artCache.js**

Wire in `scoreTrack`, `fetchAppleMusicTrack`, and `fetchDeezerTrack` as sequential fallbacks when iTunes fails or returns no audio/artwork.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test_art_cache_integration.js`
Expected: PASS

- [ ] **Step 5: Build frontend and verify no compilation errors**

Run: `cd frontend && npm run build`
Expected: Vite build succeeds and writes bundle to `dist/`.

- [ ] **Step 6: Commit**

Run:
```bash
git add frontend/src/lib/artCache.js tests/test_art_cache_integration.js dist/
git commit -m "feat: integrate multi-provider audio preview and hd cover pipeline"
```

---

### Task 4: End-to-End Verification with Playwright

**Files:**
- Test: `tests/verify_rng_app.py`

- [ ] **Step 1: Run full Playwright test suite**

Run: `python tests/verify_rng_app.py`
Expected: Server starts, user rolls, audio preload and playback work without errors.

- [ ] **Step 2: Commit final verification notes**

Run:
```bash
git commit --allow-empty -m "chore: verify monochrome audio and cover integration"
```
