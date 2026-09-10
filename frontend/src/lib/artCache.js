/**
 * Client-side Spotify / Last.fm album art and audio preview resolver and cache.
 * Uses a multi-tier fallback pipeline: iTunes Search -> Apple Music Catalog -> Deezer.
 */

import { scoreTrack } from './matcher.js';
import { fetchAppleMusicTrack, fetchDeezerTrack } from './audioProviders.js';

export const clientArtCache = {};
export const clientReleaseDateCache = {};
export const clientPreviewCache = {};
const pendingPreviewRequests = new Map();
const pendingArtRequests = new Map();

export function isPlaceholderCover(card) {
  if (!card) return true;
  const albumArt = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url;
  if (!albumArt) return true;
  if (albumArt.includes('2a96cbd8b46e442fc41c2b86b821562f')) return true;
  if (card.playlist_cover_url && albumArt === card.playlist_cover_url) return true;
  return false;
}

function getCacheKey(artist, title) {
  return `${(artist || '').trim().toLowerCase()}||${(title || '').trim().toLowerCase()}`;
}

function cleanTrackTitle(title) {
  return (title || '')
    .replace(/\s*-\s*\d{4}\s*Remaster.*/i, '')
    .replace(/\s*\(feat\..*?\)/i, '')
    .replace(/\s*-\s*slowed.*/i, '')
    .replace(/\s*-\s*sped up.*/i, '')
    .replace(/\s*\(slowed.*?\)/i, '')
    .replace(/\s*\(sped up.*?\)/i, '')
    .trim();
}

/**
 * Resolve album artwork and release date for a card or track details.
 */
export async function fetchTrackDetails(spotifyId, title = '', artist = '') {
  const key = getCacheKey(artist, title);
  if (spotifyId && clientArtCache[spotifyId] && clientReleaseDateCache[spotifyId]) {
    return {
      album_cover_url: clientArtCache[spotifyId],
      release_date: clientReleaseDateCache[spotifyId]
    };
  }
  if (key !== '||' && clientArtCache[key]) {
    return {
      album_cover_url: clientArtCache[key],
      release_date: clientReleaseDateCache[key] || null
    };
  }

  // Check localStorage
  if (typeof localStorage !== 'undefined' && key !== '||') {
    try {
      const cachedArt = localStorage.getItem(`crate_art_${key}`);
      const cachedDate = localStorage.getItem(`crate_date_${key}`);
      if (cachedArt) {
        clientArtCache[key] = cachedArt;
        if (spotifyId) clientArtCache[spotifyId] = cachedArt;
        if (cachedDate) {
          clientReleaseDateCache[key] = cachedDate;
          if (spotifyId) clientReleaseDateCache[spotifyId] = cachedDate;
        }
        return { album_cover_url: cachedArt, release_date: cachedDate || null };
      }
    } catch {}
  }

  const artKey = key !== '||' ? key : spotifyId;
  if (pendingArtRequests.has(artKey)) {
    return pendingArtRequests.get(artKey);
  }

  const promise = (async () => {
    if (!artist && !title) return null;
    const cardObj = { artist, title, spotify_id: spotifyId };
    await fetchTrackPreview(cardObj);
    return {
      album_cover_url: cardObj.album_cover_url || clientArtCache[key] || null,
      release_date: cardObj.release_date || clientReleaseDateCache[key] || null
    };
  })().finally(() => {
    pendingArtRequests.delete(artKey);
  });

  pendingArtRequests.set(artKey, promise);
  return promise;
}

export async function fetchAlbumArt(spotifyId, title = '', artist = '') {
  const details = await fetchTrackDetails(spotifyId, title, artist);
  return details?.album_cover_url || null;
}

/**
 * Multi-tier audio preview and HD album cover resolver.
 * 1. iTunes Search API with multi-artist scoring.
 * 2. Apple Music Catalog API with developer token mint.
 * 3. Deezer search API (public, unauthenticated).
 */
export async function fetchTrackPreview(card) {
  if (!card) return null;

  const key = getCacheKey(card.artist, card.title);

  // Check in-memory caches
  if (clientPreviewCache[key]) {
    card.preview_url = clientPreviewCache[key];
    if (clientArtCache[key] && isPlaceholderCover(card)) {
      card.album_cover_url = clientArtCache[key];
    }
    if (clientReleaseDateCache[key] && !card.release_date) {
      card.release_date = clientReleaseDateCache[key];
    }
    return clientPreviewCache[key];
  }

  // Check localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      const cachedPreview = localStorage.getItem(`crate_preview_${key}`);
      const cachedArt = localStorage.getItem(`crate_art_${key}`);
      const cachedDate = localStorage.getItem(`crate_date_${key}`);

      if (cachedPreview) {
        clientPreviewCache[key] = cachedPreview;
        card.preview_url = cachedPreview;
      }
      if (cachedArt && isPlaceholderCover(card)) {
        clientArtCache[key] = cachedArt;
        card.album_cover_url = cachedArt;
      }
      if (cachedDate && !card.release_date) {
        clientReleaseDateCache[key] = cachedDate;
        card.release_date = cachedDate;
      }
      if (card.preview_url) {
        return card.preview_url;
      }
    } catch {}
  }

  // Deduplicate inflight requests
  if (pendingPreviewRequests.has(key)) {
    return pendingPreviewRequests.get(key);
  }

  const cleanTitle = cleanTrackTitle(card.title);
  const cleanArtist = (card.artist || '').trim();
  const queryTerm = `${cleanArtist} ${cleanTitle}`.trim();
  if (!queryTerm) return null;

  const promise = (async () => {
    let resolvedPreview = null;
    let resolvedArt = null;
    let resolvedDate = null;

    // --- Tier 1: iTunes Search API ---
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&entity=song&limit=5`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(itunesUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const results = data.results || [];
        let best = null;
        let bestScore = 0;

        for (const item of results) {
          const candidate = {
            title: item.trackName,
            artist: item.artistName,
            album: item.collectionName
          };
          const score = scoreTrack(candidate, cleanTitle, cleanArtist, card.album);
          if (score.titleScore >= 0.5 && score.score > bestScore) {
            bestScore = score.score;
            best = item;
          }
        }

        if (best && bestScore >= 0.6) {
          if (best.previewUrl) resolvedPreview = best.previewUrl;
          if (best.artworkUrl100) {
            resolvedArt = best.artworkUrl100.replace('100x100bb', '600x600bb');
          }
          if (best.releaseDate) resolvedDate = best.releaseDate;
        }
      }
    } catch {}

    // --- Tier 2: Apple Music Catalog API ---
    if (!resolvedPreview || !resolvedArt) {
      try {
        const amResult = await fetchAppleMusicTrack(cleanArtist, cleanTitle, card.album);
        if (amResult) {
          if (!resolvedPreview && amResult.previewUrl) resolvedPreview = amResult.previewUrl;
          if (amResult.albumCoverUrl) resolvedArt = amResult.albumCoverUrl;
          if (!resolvedDate && amResult.releaseDate) resolvedDate = amResult.releaseDate;
        }
      } catch {}
    }

    // --- Tier 3: Deezer API ---
    if (!resolvedPreview || !resolvedArt) {
      try {
        const dzResult = await fetchDeezerTrack(cleanArtist, cleanTitle, card.album);
        if (dzResult) {
          if (!resolvedPreview && dzResult.previewUrl) resolvedPreview = dzResult.previewUrl;
          if (dzResult.albumCoverUrl) resolvedArt = dzResult.albumCoverUrl;
        }
      } catch {}
    }

    // Apply resolved data to card and caches
    if (resolvedPreview) {
      clientPreviewCache[key] = resolvedPreview;
      card.preview_url = resolvedPreview;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`crate_preview_${key}`, resolvedPreview);
        }
      } catch {}
    }

    if (resolvedArt && (isPlaceholderCover(card) || !card.album_cover_url)) {
      clientArtCache[key] = resolvedArt;
      if (card.spotify_id) clientArtCache[card.spotify_id] = resolvedArt;
      card.album_cover_url = resolvedArt;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`crate_art_${key}`, resolvedArt);
        }
      } catch {}
    }

    if (resolvedDate && !card.release_date) {
      clientReleaseDateCache[key] = resolvedDate;
      if (card.spotify_id) clientReleaseDateCache[card.spotify_id] = resolvedDate;
      card.release_date = resolvedDate;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(`crate_date_${key}`, resolvedDate);
        }
      } catch {}
    }

    return resolvedPreview;
  })().finally(() => {
    pendingPreviewRequests.delete(key);
  });

  pendingPreviewRequests.set(key, promise);
  return promise;
}
