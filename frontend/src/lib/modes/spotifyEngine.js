import { appendLog } from '../store.js';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function loadStaticDemoCrate(profileUrl, onEvent) {
  appendLog('Spotify backend server offline. Live playlist scraping requires running: python server.py', 'warning');
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
 * Connect to the backend server SSE stream for Spotify profile / playlist parsing.
 * Falls back seamlessly to bundled demo crate on static hosts like GitHub Pages.
 * @param {string} profileUrl Spotify profile URL or playlist input
 * @param {boolean} forceRefresh Whether to force live re-scrape and ignore cache
 * @param {(ev: any) => void} onEvent Callback for dispatching ready/error/log events
 */
export async function loadSpotifyCrateClient(profileUrl, forceRefresh, onEvent) {
  appendLog(`Initiating Spotify connection for: ${profileUrl}`, 'info');

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

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported on this response.');
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
          if (ev.type === 'ready' && Array.isArray(ev.tracks)) {
            // Tag each track with source metadata
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
  } catch (err) {
    appendLog(`Spotify server error: ${err.message}`, 'warning');
    await loadStaticDemoCrate(profileUrl, onEvent);
  }
}
