/**
 * Client-side Spotify album art lazy loader and cache
 */

export const clientArtCache = {};

export function isPlaceholderCover(card) {
  if (!card) return true;
  const albumArt = (card.spotify_id && clientArtCache[card.spotify_id]) || card.album_cover_url;
  if (!albumArt) return true;
  if (card.playlist_cover_url && albumArt === card.playlist_cover_url) return true;
  return false;
}

export async function fetchAlbumArt(spotifyId) {
  if (!spotifyId) return null;
  if (clientArtCache[spotifyId]) return clientArtCache[spotifyId];

  try {
    const res = await fetch(`/api/art?id=${encodeURIComponent(spotifyId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.album_cover_url) {
        clientArtCache[spotifyId] = data.album_cover_url;
        return data.album_cover_url;
      }
    }
  } catch (e) {}
  return null;
}
