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
