import { appendLog } from '../store.js';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function extractPlaylistId(input) {
  if (!input) return null;
  const raw = input.trim();
  if (raw.includes('spotify.com/playlist/')) {
    return raw.split('spotify.com/playlist/')[1].split('?')[0].split('/')[0].trim();
  }
  if (raw.startsWith('spotify:playlist:')) {
    return raw.split(':').pop().trim();
  }
  if (/^[a-zA-Z0-9]{22}$/.test(raw)) {
    return raw;
  }
  return null;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function processPlaylistEntity(entity) {
  const pName = entity.name || 'Spotify Playlist';
  const coverSources = entity.coverArt?.sources || [];
  const coverUrl = coverSources.length > 0 ? coverSources[0].url : '';
  const rawTracks = entity.trackList || [];

  if (rawTracks.length === 0) {
    throw new Error(`Playlist '${pName}' contains no playable tracks.`);
  }

  const trackMap = new Map();
  for (const t of rawTracks) {
    const title = (t.title || '').trim();
    const artist = (t.subtitle || '').trim();
    if (!title || !artist) continue;
    const key = `${title.toLowerCase()}||${artist.toLowerCase()}`;

    const audioPreview = t.audioPreview;
    const previewUrl = t.preview_url || (typeof audioPreview === 'object' ? audioPreview?.url : '') || '';
    const spotifyId = (t.uri || '').split(':').pop() || '';
    const spotifyUrl = spotifyId ? `https://open.spotify.com/track/${spotifyId}` : '';

    if (!trackMap.has(key)) {
      trackMap.set(key, {
        id: key,
        spotify_id: spotifyId,
        title,
        artist,
        album_cover_url: coverUrl,
        playlist_cover_url: coverUrl,
        cover_url: coverUrl,
        playlist_name: pName,
        playlist_id: entity.id || '',
        playlist_uri: entity.uri || '',
        playlist_url: `https://open.spotify.com/playlist/${entity.id || ''}`,
        preview_url: previewUrl,
        uri: t.uri || '',
        spotify_url: spotifyUrl,
        duration_ms: t.duration || 0,
        source: 'spotify',
        source_url: spotifyUrl,
      });
    }
  }

  const tracks = Array.from(trackMap.values());
  // Deterministic rarity rank by hash
  tracks.sort((a, b) => hashString(b.id) - hashString(a.id));

  const total = tracks.length;
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

  const finalTracks = tracks.map((t, idx) => {
    const spec = tempSpecs[idx];
    const count = Math.max(1, tierCounts[spec.tier]);
    const targetProb = tierTargetProbs[spec.tier];
    const poolWeight = 100000.0 * targetProb;
    const fineMod = 0.85 + (0.30 * (1.0 - spec.tPct));
    const weight = Math.max(1, Math.round((poolWeight / count) * fineMod));

    return {
      ...t,
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
    userId: pName,
    rawUserId: entity.id || 'playlist',
    avatarUrl: coverUrl,
    playlistsCount: 1,
    tracksCount: finalTracks.length,
    tracks: finalTracks,
    distribution: tierCounts,
  };
}

const DEFAULT_PROXY_URL = 'https://spotify-crate-proxy.ahmad-irfan-120707.workers.dev';

export function getSpotifyProxyUrl() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('crate_spotify_proxy_url') || DEFAULT_PROXY_URL;
  }
  return DEFAULT_PROXY_URL;
}

export function setSpotifyProxyUrl(url) {
  if (typeof window !== 'undefined') {
    if (url) {
      localStorage.setItem('crate_spotify_proxy_url', url.trim());
    } else {
      localStorage.removeItem('crate_spotify_proxy_url');
    }
  }
}

export async function loadStaticDemoCrate(onEvent) {
  appendLog('Loading bundled offline demo crate...', 'info');

  try {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const dataUrl = `${prefix}data/demo_crate.json`;
    const res = await fetch(dataUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const demoPayload = await res.json();

    if (Array.isArray(demoPayload.tracks)) {
      demoPayload.tracks = demoPayload.tracks.map((t) => ({
        ...t,
        source: 'spotify',
        source_url: t.spotify_url || t.playlist_url || '',
      }));
    }

    appendLog(`Loaded demo crate: ${demoPayload.tracks.length} tracks (${demoPayload.userId}).`, 'success');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');

    await wait(200);
    onEvent(demoPayload);
  } catch (loadErr) {
    appendLog(`Static demo failed: ${loadErr.message}`, 'error');
    onEvent({ type: 'error', message: loadErr.message });
  }
}

/**
 * Connect to backend server SSE stream or Cloudflare Worker proxy for Spotify crate generation.
 * @param {string} profileUrl Spotify profile URL or playlist input
 * @param {boolean} forceRefresh Whether to force live re-scrape and ignore cache
 * @param {(ev: any) => void} onEvent Callback for dispatching ready/error/log events
 */
export async function loadSpotifyCrateClient(profileUrl, forceRefresh, onEvent) {
  appendLog(`Initiating Spotify connection for: ${profileUrl}`, 'info');

  // 1. Try local or configured backend server first
  let backendError = null;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const endpoint = `${prefix}api/fetch`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_url: profileUrl,
        mode: 'spotify',
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
            if (ev.type === 'ready' && Array.isArray(ev.tracks)) {
              ev.tracks = ev.tracks.map((t) => ({
                ...t,
                source: 'spotify',
                source_url: t.spotify_url || t.playlist_url || '',
              }));
            }
            onEvent(ev);
          } catch (parseErr) {
            console.error('Failed to parse SSE line:', rawJson, parseErr);
          }
        }
      }
      return;
    } else {
      backendError = new Error(`Backend returned HTTP ${response.status}`);
    }
  } catch (err) {
    backendError = err;
  }

  // 2. If backend server is unavailable (e.g. GitHub Pages static host), try Cloudflare Worker proxy
  appendLog(`Backend server unreachable (${backendError?.message || 'offline'}).`, 'warning');

  const playlistId = extractPlaylistId(profileUrl);
  if (!playlistId) {
    appendLog('User profile multi-playlist scraping requires the Python backend (python server.py).', 'error');
    appendLog('Please paste a public Spotify playlist link (e.g. open.spotify.com/playlist/...) to load on static hosts.', 'info');
    onEvent({
      type: 'error',
      message: 'Static hosting requires a Spotify playlist link, or run python server.py for user profiles.',
    });
    return;
  }

  const proxyBase = getSpotifyProxyUrl();
  if (!proxyBase) {
    appendLog('No Cloudflare Worker proxy configured for static hosting.', 'error');
    appendLog("Deploy the Cloudflare Worker script in 'cloudflare-worker/worker.js' and set your Worker URL, or run: python server.py", 'info');
    onEvent({
      type: 'error',
      message: 'Cloudflare Worker proxy not configured. Set your Worker URL or run server.py.',
    });
    return;
  }

  appendLog(`Connecting to Cloudflare Worker proxy for playlist ${playlistId}...`, 'info');
  try {
    const cleanBase = proxyBase.replace(/\/+$/, '');
    const proxyUrl = `${cleanBase}/playlist/${playlistId}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Proxy returned HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.entity) {
      throw new Error('Proxy returned empty playlist entity.');
    }

    appendLog(`Extracting tracks from playlist '${data.entity.name || playlistId}'...`, 'info');
    const readyEvent = processPlaylistEntity(data.entity);

    appendLog(`Library compiled: ${readyEvent.tracksCount} tracks from playlist '${readyEvent.userId}'.`, 'success');
    appendLog(`Rarity Distribution -> Mythic: ${readyEvent.distribution.mythic}, Legendary: ${readyEvent.distribution.legendary}, Epic: ${readyEvent.distribution.epic}, Rare: ${readyEvent.distribution.rare}, Uncommon: ${readyEvent.distribution.uncommon}, Common: ${readyEvent.distribution.common}`, 'info');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');

    await wait(200);
    onEvent(readyEvent);
  } catch (proxyErr) {
    appendLog(`Cloudflare Worker proxy error: ${proxyErr.message}`, 'error');
    onEvent({
      type: 'error',
      message: `Cloudflare Worker proxy failed: ${proxyErr.message}`,
    });
  }
}
