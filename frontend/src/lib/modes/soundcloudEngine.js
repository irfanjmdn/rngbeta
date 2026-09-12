import { appendLog } from '../store.js';

const CACHE_PREFIX = 'crate_soundcloud_cache_v2_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function extractSoundCloudUsername(input) {
  if (!input) return '';
  const raw = input.trim();
  if (raw.includes('soundcloud.com/')) {
    const parts = raw.split('soundcloud.com/')[1].split('?')[0].split('/');
    return (parts[0] || '').trim();
  }
  if (raw.startsWith('soundcloud:')) {
    return raw.split(':').pop().trim();
  }
  return raw.split('?')[0].trim();
}

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

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

const DEFAULT_PROXY_URL = 'https://spotify-crate-proxy.ahmad-irfan-120707.workers.dev';

export function getSoundCloudProxyUrl() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('crate_soundcloud_proxy_url') || DEFAULT_PROXY_URL;
  }
  return DEFAULT_PROXY_URL;
}

export function setSoundCloudProxyUrl(url) {
  if (typeof window !== 'undefined') {
    if (url) {
      localStorage.setItem('crate_soundcloud_proxy_url', url.trim());
    } else {
      localStorage.removeItem('crate_soundcloud_proxy_url');
    }
  }
}

const soundcloudDirectStreamCache = new Map();

/**
 * Resolves a SoundCloud stream endpoint to its direct, signed MP3 CDN URL.
 * Queries the Cloudflare Worker or local backend with Accept: application/json,
 * bypassing 302 redirect CORS issues in HTML5 Audio elements.
 * @param {string} url SoundCloud stream proxy URL or relative API path
 * @returns {Promise<string>} Direct CDN MP3 URL with CORS and Range support
 */
export async function resolveSoundCloudStreamUrl(url) {
  if (!url) return '';
  if (url.includes('.sndcdn.com/') || url.includes('.mp3')) {
    return url;
  }

  const cached = soundcloudDirectStreamCache.get(url);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return cached.directUrl;
  }

  let targetUrl = url;
  if (url.startsWith('/api/soundcloud/stream')) {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      const proxyBase = getSoundCloudProxyUrl();
      targetUrl = url.replace('/api/soundcloud/stream', `${proxyBase.replace(/\/+$/, '')}/soundcloud/stream`);
    }
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        soundcloudDirectStreamCache.set(url, { directUrl: data.url, timestamp: Date.now() });
        return data.url;
      }
    }
  } catch (err) {
    console.warn('SoundCloud stream URL resolution error:', err);
  }

  return targetUrl;
}

export async function resolveTrackAudioUrl(track) {
  if (!track) return '';
  if (track.source !== 'soundcloud') {
    return track.preview_url || '';
  }
  const streamEndpoint = track.stream_proxy_url || track.preview_url;
  if (!streamEndpoint) return '';

  const directUrl = await resolveSoundCloudStreamUrl(streamEndpoint);
  if (directUrl && directUrl !== streamEndpoint) {
    track.stream_proxy_url = streamEndpoint;
    track.preview_url = directUrl;
    return directUrl;
  }
  return directUrl || streamEndpoint;
}

function computeSoundCloudTracks(collection, userInfo, clientId, proxyBase) {
  const trackMap = new Map();
  const username = userInfo.username || 'SoundCloud Crate';
  const userId = userInfo.id || 'soundcloud';
  const userAvatar = userInfo.avatar_url || '';

  for (const item of collection) {
    const t = item.track;
    if (!t || typeof t !== 'object') continue;

    const title = (t.title || '').trim();
    const u = t.user || {};
    const artist = (u.username || '').trim();
    const tId = t.id;
    if (!title || !artist || !tId) continue;

    const createdAtStr = item.created_at || t.created_at || '';
    let likedTs = 0;
    let likedDateText = 'Past like';
    if (createdAtStr) {
      try {
        const dt = new Date(createdAtStr);
        likedTs = dt.getTime() / 1000;
        likedDateText = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch (e) {
        likedDateText = createdAtStr.slice(0, 10);
      }
    }

    const rawArt = t.artwork_url || u.avatar_url || '';
    const coverUrl = rawArt ? rawArt.replace('-large.', '-t500x500.') : (userAvatar || '');

    // Locate progressive audio transcoding
    const media = t.media || {};
    const transcodings = media.transcodings || [];
    let progTc = null;
    for (const tc of transcodings) {
      const fmt = tc.format || {};
      if (fmt.protocol === 'progressive') {
        progTc = tc.url;
        break;
      }
    }

    let previewUrl = '';
    if (progTc) {
      const cleanProxy = (proxyBase || '').replace(/\/+$/, '');
      if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        previewUrl = `/api/soundcloud/stream?url=${encodeURIComponent(progTc)}&client_id=${clientId}`;
      } else {
        previewUrl = `${cleanProxy}/soundcloud/stream?url=${encodeURIComponent(progTc)}&client_id=${clientId}`;
      }
    }

    const key = String(tId);
    if (!trackMap.has(key)) {
      trackMap.set(key, {
        tId,
        title,
        artist,
        likedTs,
        likedDateText,
        coverUrl,
        permalinkUrl: t.permalink_url || `https://soundcloud.com/${username}`,
        previewUrl,
        playbackCount: t.playback_count || 0,
      });
    }
  }

  const uniqueTracks = Array.from(trackMap.values());
  if (uniqueTracks.length === 0) {
    throw new Error('No valid tracks found in SoundCloud likes.');
  }

  // Sort ascending by like timestamp: oldest like = rank 0 = Mythic
  uniqueTracks.sort((a, b) => a.likedTs - b.likedTs);

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

  const finalTracks = uniqueTracks.map((t, idx) => {
    const spec = tempSpecs[idx];
    const count = Math.max(1, tierCounts[spec.tier]);
    const targetProb = tierTargetProbs[spec.tier];
    const poolWeight = 100000.0 * targetProb;
    const fineMod = 0.85 + (0.30 * (1.0 - spec.tPct));
    const weight = Math.max(1, Math.round((poolWeight / count) * fineMod));

    const trackId = `soundcloud:${userId}:${t.tId}`;
    return {
      id: trackId,
      spotify_id: '',
      title: t.title,
      artist: t.artist,
      album_cover_url: t.coverUrl,
      playlist_cover_url: userAvatar || t.coverUrl,
      cover_url: t.coverUrl,
      playlist_name: `Liked on: ${t.likedDateText}`,
      playlist_id: `soundcloud_${userId}`,
      playlist_uri: '',
      playlist_url: `https://soundcloud.com/${username}/likes`,
      preview_url: t.previewUrl,
      stream_proxy_url: t.previewUrl,
      uri: t.permalinkUrl,
      spotify_url: t.permalinkUrl,
      source: 'soundcloud',
      source_url: t.permalinkUrl,
      rarityTier: spec.tier,
      rarityName: spec.name,
      rarityColor: spec.color,
      dropChance: `1 in ${spec.odds.toLocaleString()}`,
      weight,
      release_date: '',
    };
  });

  return {
    type: 'ready',
    userId: userInfo.username || username,
    rawUserId: username,
    avatarUrl: userAvatar,
    playlistsCount: 1,
    tracksCount: finalTracks.length,
    tracks: finalTracks,
    distribution: tierCounts,
  };
}

/**
 * Connect to backend server SSE stream or Cloudflare Worker proxy for SoundCloud crate generation.
 * @param {string} inputStr SoundCloud profile URL or username
 * @param {(ev: any) => void} onEvent Callback for dispatching ready/error/log events
 * @param {boolean} forceRefresh Force fresh scrape ignoring local cache
 */
export async function loadSoundCloudCrateClient(inputStr, onEvent, forceRefresh = false) {
  const cleanUser = extractSoundCloudUsername(inputStr);
  if (!cleanUser) {
    appendLog('Please enter a valid SoundCloud username or profile URL.', 'error');
    onEvent({ type: 'error', message: 'Invalid SoundCloud username or profile URL.' });
    return;
  }

  // 1. Check client-side cache first
  if (!forceRefresh) {
    const cached = loadCachedCrate(cleanUser);
    if (cached && cached.tracks && cached.tracks.length > 0) {
      appendLog(`Loaded ${cached.tracks.length} tracks from browser cache for '${cleanUser}'.`, 'success');
      appendLog('Crate RNG initialized. Ready to roll!', 'success');
      onEvent(cached);
      return;
    }
  }

  appendLog(`Initiating SoundCloud connection for: ${cleanUser}`, 'info');

  // 2. Try local backend server first
  let backendError = null;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const endpoint = `${prefix}api/fetch`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_url: cleanUser,
        mode: 'soundcloud',
        force_refresh: forceRefresh,
      }),
    });

    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed.startsWith('data:')) continue;

          const rawJson = trimmed.replace(/^data:\s*/, '');
          try {
            const ev = JSON.parse(rawJson);
            if (ev.type === 'ready') {
              saveCachedCrate(cleanUser, ev);
            }
            onEvent(ev);
          } catch (parseErr) {
            console.error('Failed to parse SSE JSON:', rawJson, parseErr);
          }
        }
      }
      return;
    } else {
      backendError = new Error(`Server returned HTTP ${response.status}`);
    }
  } catch (err) {
    backendError = err;
  }

  // 3. Fallback to Cloudflare Worker proxy for static hosts (GitHub Pages)
  appendLog(`Backend server unreachable (${backendError?.message || 'offline'}).`, 'info');
  appendLog('Connecting to Cloudflare Worker proxy for SoundCloud profile...', 'info');

  const proxyBase = getSoundCloudProxyUrl();
  const cleanBase = proxyBase.replace(/\/+$/, '');

  try {
    appendLog(`Scanning SoundCloud liked songs for '${cleanUser}' via proxy...`, 'info');
    const scRes = await fetch(`${cleanBase}/soundcloud/user/${encodeURIComponent(cleanUser)}`);

    if (!scRes.ok) {
      const errBody = await scRes.json().catch(() => ({}));
      throw new Error(errBody.error || `Proxy returned HTTP ${scRes.status}`);
    }

    const scData = await scRes.json();
    if (!scData.collection || scData.collection.length === 0) {
      throw new Error(`No liked songs found on SoundCloud profile '${cleanUser}'.`);
    }

    appendLog(`Retrieved ${scData.collection.length} liked tracks. Compiling crate library...`, 'success');
    const readyPayload = computeSoundCloudTracks(scData.collection, scData.user || {}, scData.client_id, proxyBase);

    saveCachedCrate(cleanUser, readyPayload);
    appendLog(`Library compiled: ${readyPayload.tracksCount} tracks from SoundCloud likes.`, 'success');
    appendLog(`Rarity Distribution -> Mythic: ${readyPayload.distribution.mythic}, Legendary: ${readyPayload.distribution.legendary}, Epic: ${readyPayload.distribution.epic}, Rare: ${readyPayload.distribution.rare}, Uncommon: ${readyPayload.distribution.uncommon}, Common: ${readyPayload.distribution.common}`, 'info');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');

    await wait(200);
    onEvent(readyPayload);
  } catch (proxyErr) {
    appendLog(`Cloudflare Worker proxy failed: ${proxyErr.message}`, 'error');
    onEvent({
      type: 'error',
      message: `SoundCloud load failed: ${proxyErr.message}`,
    });
  }
}
