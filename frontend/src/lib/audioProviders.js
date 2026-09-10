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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('https://am-mint.binimum.org/token', { signal: controller.signal });
      clearTimeout(timeoutId);
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
    const cleanTitle = (title || '')
      .replace(/\s*-\s*\d{4}\s*Remaster.*/i, '')
      .replace(/\s*\(feat\..*?\)/i, '')
      .replace(/\s*-\s*slowed.*/i, '')
      .replace(/\s*-\s*sped up.*/i, '')
      .replace(/\s*\(slowed.*?\)/i, '')
      .replace(/\s*\(sped up.*?\)/i, '')
      .trim();
    const cleanArtist = (artist || '').trim();
    const query = `${cleanArtist} ${cleanTitle}`.trim();
    if (!query) return null;

    const url = `https://api.music.apple.com/v1/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=5`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
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
      const score = scoreTrack(candidate, cleanTitle, cleanArtist, album);
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
    const cleanTitle = (title || '')
      .replace(/\s*-\s*\d{4}\s*Remaster.*/i, '')
      .replace(/\s*\(feat\..*?\)/i, '')
      .replace(/\s*-\s*slowed.*/i, '')
      .replace(/\s*-\s*sped up.*/i, '')
      .replace(/\s*\(slowed.*?\)/i, '')
      .replace(/\s*\(sped up.*?\)/i, '')
      .trim();
    const cleanArtist = (artist || '').trim();
    const query = `${cleanArtist} ${cleanTitle}`.trim();
    if (!query) return null;

    const isBrowser = typeof window !== 'undefined';
    const baseUrl = isBrowser ? '/api/deezer' : 'https://api.deezer.com/search';
    const url = `${baseUrl}?q=${encodeURIComponent(query)}&limit=5`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
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
      const score = scoreTrack(candidate, cleanTitle, cleanArtist, album);
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
