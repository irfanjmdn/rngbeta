/**
 * Multi-artist tokenizer and string similarity matcher ported from Monochrome.
 */

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
