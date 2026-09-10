import { appendLog } from '../store.js';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Fetch scrobble history from Last.fm API directly in the client and construct crate tracks.
 * @param {string} username Last.fm username
 * @param {(ev: any) => void} onEvent Callback for dispatching ready/error events
 */
const BUILTIN_KEYS = [
  'a93da16045abb894cb7a4482255247bb',
  'd64ba82baaf21554416b25365c114455',
  'ffd6c3e445e45d0d4bc124184853b772',
  '0356663ee33a0a5d27428b1f63011652',
  'b25b959554ed76058ac220b7b2e0a026',
];

function getApiKeyPool() {
  const pool = [];
  if (typeof localStorage !== 'undefined') {
    const custom = localStorage.getItem('crate_lastfm_api_key')?.trim();
    if (custom) pool.push(custom);
  }
  pool.push(...BUILTIN_KEYS);
  return pool;
}

let activeKeyIndex = 0;

function getActiveKey(keys) {
  return keys[activeKeyIndex % keys.length];
}

function rotateKey(keys) {
  activeKeyIndex = (activeKeyIndex + 1) % keys.length;
  return keys[activeKeyIndex % keys.length];
}

async function requestLastfm(method, params, keys) {
  const maxTries = keys.length;
  let lastError = null;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const key = getActiveKey(keys);
    const search = new URLSearchParams({
      method,
      api_key: key,
      format: 'json',
      ...params,
    });
    const url = `https://ws.audioscrobbler.com/2.0/?${search.toString()}`;

    try {
      const res = await fetch(url);
      if (res.status === 429) {
        appendLog(`Last.fm key #${(activeKeyIndex % keys.length) + 1} rate limited. Switching to backup key...`, 'warning');
        rotateKey(keys);
        await wait(250);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error === 29) {
        appendLog(`Last.fm key #${(activeKeyIndex % keys.length) + 1} rate limit reached. Switching to backup key...`, 'warning');
        rotateKey(keys);
        await wait(250);
        continue;
      }
      if (data.error) {
        throw new Error(data.message || `Last.fm error ${data.error}`);
      }
      return data;
    } catch (err) {
      lastError = err;
      if (err.message && err.message.toLowerCase().includes('rate limit')) {
        rotateKey(keys);
        await wait(250);
        continue;
      }
      await wait(400);
    }
  }
  throw lastError || new Error('All Last.fm API keys in the pool were rate limited.');
}

const CACHE_PREFIX = 'crate_lastfm_cache_v1_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function loadCachedCrate(username) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${username.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.timestamp || 0) < CACHE_TTL_MS && parsed.payload) {
      return parsed.payload;
    }
  } catch {}
  return null;
}

function saveCachedCrate(username, payload) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      `${CACHE_PREFIX}${username.toLowerCase()}`,
      JSON.stringify({ timestamp: Date.now(), payload })
    );
  } catch {}
}

/**
 * Fetch scrobble history from Last.fm API directly in the client and construct crate tracks.
 * @param {string} username Last.fm username
 * @param {(ev: any) => void} onEvent Callback for dispatching ready/error events
 * @param {boolean} forceRefresh Force a fresh network fetch ignoring cache
 */
export async function loadLastfmCrateClient(username, onEvent, forceRefresh = false) {
  // Check local cache first
  if (!forceRefresh) {
    const cached = loadCachedCrate(username);
    if (cached && cached.tracks && cached.tracks.length > 0) {
      appendLog(`Loaded ${cached.tracks.length} tracks from browser cache for '${username}'.`, 'success');
      appendLog('Crate RNG initialized. Ready to roll!', 'success');
      onEvent(cached);
      return;
    }
  }

  const keys = getApiKeyPool();
  appendLog(`Connecting to Last.fm API for user '${username}' (using ${keys.length}-key pool)...`, 'info');

  let avatarUrl = null;
  let displayName = username;
  try {
    const uData = await requestLastfm('user.getinfo', { user: username }, keys);
    if (uData && uData.user) {
      displayName = uData.user.name || username;
      const imgs = uData.user.image || [];
      if (imgs.length > 0) {
        avatarUrl = imgs[imgs.length - 1]['#text'] || null;
      }
    }
  } catch (e) {
    appendLog(`User info notice: ${e.message}`, 'warning');
  }

  appendLog(`Fetching listening history from Last.fm for '${displayName}'...`, 'info');
  try {
    const rawScrobbles = [];

    // 1. Fetch page 1 to inspect total scrobbles and totalPages
    const p1Data = await requestLastfm('user.getrecenttracks', { user: username, limit: '200', page: '1' }, keys);
    const extractTracks = (data) => {
      if (!data?.recenttracks?.track) return [];
      const t = data.recenttracks.track;
      return Array.isArray(t) ? t : [t];
    };

    const p1Batch = extractTracks(p1Data);
    if (!p1Batch.length) {
      throw new Error(`No recent tracks found for Last.fm user '${username}'`);
    }
    rawScrobbles.push(...p1Batch);

    const totalPages = parseInt(p1Data.recenttracks?.['@attr']?.totalPages || '1', 10);
    const totalScrobbles = parseInt(p1Data.recenttracks?.['@attr']?.total || String(p1Batch.length), 10);
    appendLog(`Found ${totalScrobbles.toLocaleString()} all-time scrobbles across ${totalPages} pages.`, 'info');

    // Build timeline pages spanning newest, intermediate milestones, and oldest scrobbles
    let extraPages = [];
    if (totalPages <= 6) {
      for (let p = 2; p <= totalPages; p++) extraPages.push(p);
    } else {
      const sampled = new Set([
        2, 3,
        Math.round(totalPages * 0.25),
        Math.round(totalPages * 0.50),
        Math.round(totalPages * 0.75),
        totalPages - 1,
        totalPages,
      ]);
      sampled.delete(1);
      extraPages = Array.from(sampled).filter((p) => p > 1 && p <= totalPages).sort((a, b) => a - b);
    }

    if (extraPages.length > 0) {
      appendLog(`Sampling listening timeline across pages: ${extraPages.join(', ')}...`, 'info');
      for (const pageNum of extraPages) {
        await wait(300);
        try {
          const data = await requestLastfm('user.getrecenttracks', { user: username, limit: '200', page: pageNum.toString() }, keys);
          const batch = extractTracks(data);
          rawScrobbles.push(...batch);
        } catch (pageErr) {
          appendLog(`Notice sampling page ${pageNum}: ${pageErr.message}`, 'warning');
        }
      }
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const trackMap = new Map();
    for (const t of rawScrobbles) {
      const title = (t.name || '').trim();
      const artist = typeof t.artist === 'object' ? (t.artist?.['#text'] || '').trim() : String(t.artist || '').trim();
      if (!title || !artist) continue;
      const key = `${title.toLowerCase()}||${artist.toLowerCase()}`;

      const isNowPlaying = t['@attr']?.nowplaying === 'true';
      const uts = isNowPlaying ? nowTs : parseInt(t.date?.uts || '0', 10);
      const dateText = isNowPlaying ? 'Now Playing' : (t.date?.['#text'] || 'Past listen');

      const imgs = t.image || [];
      const coverUrl = imgs.length > 0 ? imgs[imgs.length - 1]['#text'] : '';

      if (!trackMap.has(key)) {
        trackMap.set(key, {
          title,
          artist,
          lastPlayedUts: uts,
          lastPlayedText: dateText,
          coverUrl,
          url: t.url || `https://www.last.fm/user/${username}`,
          playCount: 1,
        });
      } else {
        const item = trackMap.get(key);
        item.playCount++;
        if (uts > item.lastPlayedUts) {
          item.lastPlayedUts = uts;
          item.lastPlayedText = dateText;
        }
      }
    }

    const uniqueTracks = Array.from(trackMap.values());
    // Sort ascending: lowest timestamp (oldest last played) = rank 0 = Mythic
    uniqueTracks.sort((a, b) => a.lastPlayedUts - b.lastPlayedUts);

    appendLog(`Compiled ${uniqueTracks.length} unique tracks from listening history.`, 'success');
    appendLog('Calculating rarity: oldest played = Mythic, newest played = Common...', 'info');

    const total = uniqueTracks.length;
    const tierTargetProbs = {
      mythic: 0.005,
      legendary: 0.025,
      epic: 0.070,
      rare: 0.140,
      uncommon: 0.260,
      common: 0.500,
    };

    const tierCounts = { mythic: 0, legendary: 0, epic: 0, rare: 0, uncommon: 0, common: 0 };
    const tempSpecs = [];

    for (let rank = 0; rank < total; rank++) {
      const pct = (rank + 0.5) / Math.max(1, total);
      let tier, name, color, odds, tPct;
      if (pct <= 0.012) {
        tier = 'mythic'; name = 'Mythic'; color = '#F43F5E'; odds = 200; tPct = pct / 0.012;
      } else if (pct <= 0.045) {
        tier = 'legendary'; name = 'Legendary'; color = '#F59E0B'; odds = 40; tPct = (pct - 0.012) / (0.045 - 0.012);
      } else if (pct <= 0.125) {
        tier = 'epic'; name = 'Epic'; color = '#A855F7'; odds = 14; tPct = (pct - 0.045) / (0.125 - 0.045);
      } else if (pct <= 0.28) {
        tier = 'rare'; name = 'Rare'; color = '#3B82F6'; odds = 7; tPct = (pct - 0.125) / (0.28 - 0.125);
      } else if (pct <= 0.55) {
        tier = 'uncommon'; name = 'Uncommon'; color = '#10B981'; odds = 4; tPct = (pct - 0.28) / (0.55 - 0.28);
      } else {
        tier = 'common'; name = 'Common'; color = '#94A3B8'; odds = 2; tPct = (pct - 0.55) / (1.0 - 0.55);
      }
      tierCounts[tier]++;
      tempSpecs.push({ tier, name, color, odds, tPct });
    }

    const allTracks = uniqueTracks.map((t, i) => {
      const spec = tempSpecs[i];
      const count = Math.max(1, tierCounts[spec.tier]);
      const targetProb = tierTargetProbs[spec.tier];
      const poolWeight = 100000.0 * targetProb;
      const fineMod = 0.85 + (0.30 * (1.0 - spec.tPct));
      const trackWeight = Math.max(1, Math.round((poolWeight / count) * fineMod));

      return {
        id: `lastfm:${username}:${i}`,
        spotify_id: '',
        title: t.title,
        artist: t.artist,
        album_cover_url: t.coverUrl,
        playlist_cover_url: t.coverUrl,
        cover_url: t.coverUrl,
        playlist_name: `Last played: ${t.lastPlayedText}`,
        playlist_id: `lastfm_${username}`,
        playlist_uri: '',
        playlist_url: t.url,
        preview_url: '',
        uri: '',
        spotify_url: t.url,
        source: 'lastfm',
        source_url: t.url,
        rarityTier: spec.tier,
        rarityName: spec.name,
        rarityColor: spec.color,
        dropChance: `1 in ${spec.odds.toLocaleString()}`,
        weight: trackWeight,
        release_date: '',
      };
    });

    appendLog(`Library compiled: ${allTracks.length} unique tracks from Last.fm listening history.`, 'success');
    appendLog(
      `Rarity Distribution -> Mythic: ${tierCounts.mythic}, Legendary: ${tierCounts.legendary}, Epic: ${tierCounts.epic}, Rare: ${tierCounts.rare}, Uncommon: ${tierCounts.uncommon}, Common: ${tierCounts.common}`,
      'info'
    );
    appendLog('Crate RNG initialized. Ready to roll!', 'success');

    const readyPayload = {
      type: 'ready',
      userId: displayName,
      rawUserId: username,
      avatarUrl: avatarUrl,
      playlistsCount: 1,
      tracksCount: allTracks.length,
      tracks: allTracks,
      distribution: tierCounts,
    };

    saveCachedCrate(username, readyPayload);
    onEvent(readyPayload);
  } catch (err) {
    appendLog(`Last.fm load error: ${err.message}`, 'error');
    onEvent({ type: 'error', message: err.message });
  }
}
