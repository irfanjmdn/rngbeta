/**
 * Client-side Spotify album art lazy loader and cache
 */

export const clientArtCache = {};
export const clientReleaseDateCache = {};

export function isPlaceholderCover(card) {
  if (!card) return true;
  const albumArt = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url;
  if (!albumArt) return true;
  if (card.playlist_cover_url && albumArt === card.playlist_cover_url) return true;
  return false;
}

export async function fetchTrackDetails(spotifyId, title = '', artist = '') {
  if (!spotifyId) return null;
  if (clientArtCache[spotifyId] && clientReleaseDateCache[spotifyId]) {
    return {
      album_cover_url: clientArtCache[spotifyId],
      release_date: clientReleaseDateCache[spotifyId]
    };
  }

  try {
    const q = new URLSearchParams({ id: spotifyId });
    if (title) q.append('title', title);
    if (artist) q.append('artist', artist);
    const res = await fetch(`/api/art?${q.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.album_cover_url) {
        clientArtCache[spotifyId] = data.album_cover_url;
      }
      if (data.release_date) {
        clientReleaseDateCache[spotifyId] = data.release_date;
      }
      return {
        album_cover_url: data.album_cover_url || clientArtCache[spotifyId] || null,
        release_date: data.release_date || clientReleaseDateCache[spotifyId] || null
      };
    }
  } catch (e) {}
  return null;
}

export async function fetchAlbumArt(spotifyId) {
  const details = await fetchTrackDetails(spotifyId);
  return details?.album_cover_url || null;
}

export const clientPreviewCache = {};
const pendingPreviewRequests = new Map();

/**
 * Fast iTunes audio preview resolver with caching and pre-buffering.
 */
export async function fetchTrackPreview(card) {
  if (!card) return null;
  if (card.preview_url) return card.preview_url;

  const key = `${(card.artist || '').trim().toLowerCase()}||${(card.title || '').trim().toLowerCase()}`;
  if (clientPreviewCache[key]) {
    card.preview_url = clientPreviewCache[key];
    return clientPreviewCache[key];
  }

  // Check localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      const cached = localStorage.getItem(`crate_preview_${key}`);
      if (cached) {
        clientPreviewCache[key] = cached;
        card.preview_url = cached;
        return cached;
      }
    } catch (e) {}
  }

  // Deduplicate inflight requests for same song
  if (pendingPreviewRequests.has(key)) {
    return pendingPreviewRequests.get(key);
  }

  const cleanTitle = (card.title || '').replace(/\s*-\s*\d{4}\s*Remaster.*/i, '').replace(/\s*\(feat\..*?\)/i, '').trim();
  const cleanArtist = (card.artist || '').trim();
  const queryTerm = `${cleanArtist} ${cleanTitle}`.trim();
  if (!queryTerm) return null;

  const promise = (async () => {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&entity=song&limit=1`;
      const res = await fetch(itunesUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const item = data.results[0];
          const pUrl = item.previewUrl || '';
          if (pUrl) {
            clientPreviewCache[key] = pUrl;
            card.preview_url = pUrl;
            try {
              localStorage.setItem(`crate_preview_${key}`, pUrl);
            } catch (e) {}
          }
          if (item.releaseDate && !card.release_date) {
            card.release_date = item.releaseDate;
          }
          if (item.artworkUrl100 && (!card.album_cover_url || card.album_cover_url.includes('2a96cbd8b46e442fc41c2b86b821562f'))) {
            const hdArt = item.artworkUrl100.replace('100x100bb', '600x600bb');
            card.album_cover_url = hdArt;
          }
          return pUrl;
        }
      }
    } catch (e) {
      // Ignore network errors cleanly
    } finally {
      pendingPreviewRequests.delete(key);
    }
    return null;
  })();

  pendingPreviewRequests.set(key, promise);
  return promise;
}
