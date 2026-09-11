import { appendLog } from '../store.js';

const CACHE_PREFIX = 'crate_soundcloud_cache_v1_';
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

/**
 * Connect to backend server SSE stream for SoundCloud liked songs crate generation.
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

  appendLog(`Connecting to backend server for SoundCloud user '${cleanUser}'...`, 'info');

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

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Readable stream not supported by browser environment.');
    }

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
  } catch (err) {
    appendLog(`SoundCloud load failed: ${err.message}`, 'error');
    appendLog('Ensure Python backend (python server.py) is running on localhost:8080.', 'warning');
    onEvent({
      type: 'error',
      message: `SoundCloud load failed: ${err.message}. Local server required for CORS bypass.`,
    });
  }
}
