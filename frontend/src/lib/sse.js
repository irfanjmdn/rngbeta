import {
  activeUserId,
  rngTracks,
  playlistsCount,
  debugStatus,
  isBuildingCrate,
  isCrateReady,
  appendLog,
  loadUserData,
  activeWinnerCard,
  activeArenaTrack,
  activeBinderTrack,
  gameInventory,
  gameInventoryTimestamps,
  starredTrackIds,
  gameRolls,
  userAvatarUrl,
} from './store.js';
import { getAudioContext } from './audio.js';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

async function loadStaticDemoCrate(profileUrl) {
  appendLog('Server API offline. Launching client-side static demo...', 'warning');
  appendLog('Reminder: This game is only optimized for desktop screens.', 'info');

  await wait(180);
  appendLog(`Parsing target Spotify profile: ${profileUrl}`, 'info');

  await wait(240);
  appendLog('[1/10] Loading public playlist \'3mmc\'...', 'info');
  appendLog('  -> \'3mmc\' contains 72 tracks.', 'success');

  await wait(220);
  appendLog('[2/10] Loading public playlist \'Speed Garage / UKG / Bassline\'...', 'info');
  appendLog('  -> \'Speed Garage / UKG / Bassline\' contains 98 tracks.', 'success');

  await wait(200);
  appendLog('Extracting remaining public playlists...', 'info');

  await wait(250);
  appendLog('Calculating dynamic rarity weights across all tracks...', 'info');

  try {
    const base = import.meta.env.BASE_URL || '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    const dataUrl = `${prefix}data/demo_crate.json`;
    const res = await fetch(dataUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const demoPayload = await res.json();

    appendLog(`Library compiled: ${demoPayload.tracks.length} total unique tracks across ${demoPayload.playlistsCount} playlists.`, 'success');
    appendLog(`Rarity Distribution -> Mythic: ${demoPayload.distribution.mythic}, Legendary: ${demoPayload.distribution.legendary}, Epic: ${demoPayload.distribution.epic}, Rare: ${demoPayload.distribution.rare}, Uncommon: ${demoPayload.distribution.uncommon}, Common: ${demoPayload.distribution.common}`, 'info');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');
    appendLog(`Profile verified: ${demoPayload.userId}`, 'success');

    await wait(200);
    handleSseEvent(demoPayload);
  } catch (loadErr) {
    appendLog(`Static demo failed: ${loadErr.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
  }
}


async function loadLastfmCrateClient(username) {
  appendLog(`Connecting to Last.fm API for user '${username}'...`, 'info');
  const apiKey = 'b25b959554ed76058ac220b7b2e0a026';
  
  let avatarUrl = null;
  let displayName = username;
  try {
    const uRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getinfo&user=${encodeURIComponent(username)}&api_key=${apiKey}&format=json`);
    if (uRes.ok) {
      const uData = await uRes.json();
      if (uData.user) {
        displayName = uData.user.name || username;
        const imgs = uData.user.image || [];
        if (imgs.length > 0) {
          avatarUrl = imgs[imgs.length - 1]['#text'] || null;
        }
      }
    }
  } catch (e) {
    appendLog(`User info notice: ${e.message}`, 'warning');
  }

  appendLog(`Fetching listening history from Last.fm for '${displayName}'...`, 'info');
  try {
    const rawScrobbles = [];

    // 1. Fetch page 1 to inspect total scrobbles and totalPages
    const p1Res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&limit=200&page=1&api_key=${apiKey}&format=json`);
    if (!p1Res.ok) {
      throw new Error(`Last.fm returned HTTP ${p1Res.status}`);
    }
    const p1Data = await p1Res.json();
    const p1Batch = p1Data.recenttracks?.track || [];
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
        totalPages
      ]);
      sampled.delete(1);
      extraPages = Array.from(sampled).filter(p => p > 1 && p <= totalPages).sort((a, b) => a - b);
    }

    if (extraPages.length > 0) {
      appendLog(`Sampling listening timeline across pages: ${extraPages.join(', ')}...`, 'info');
      // Fetch in pairs with brief pause to respect rate limits
      for (let i = 0; i < extraPages.length; i += 2) {
        const slice = extraPages.slice(i, i + 2);
        const batchResults = await Promise.all(slice.map(async (pageNum) => {
          try {
            const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${encodeURIComponent(username)}&limit=200&page=${pageNum}&api_key=${apiKey}&format=json`);
            if (!res.ok) return [];
            const data = await res.json();
            return data.recenttracks?.track || [];
          } catch (e) {
            return [];
          }
        }));
        for (const b of batchResults) {
          rawScrobbles.push(...b);
        }
        if (i + 2 < extraPages.length) {
          await wait(120);
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
          playCount: 1
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
      common: 0.500
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
        rarityTier: spec.tier,
        rarityName: spec.name,
        rarityColor: spec.color,
        dropChance: `1 in ${spec.odds.toLocaleString()}`,
        weight: trackWeight,
        release_date: ''
      };
    });

    appendLog(`Library compiled: ${allTracks.length} unique tracks from Last.fm listening history.`, 'success');
    appendLog(`Rarity Distribution -> Mythic: ${tierCounts.mythic}, Legendary: ${tierCounts.legendary}, Epic: ${tierCounts.epic}, Rare: ${tierCounts.rare}, Uncommon: ${tierCounts.uncommon}, Common: ${tierCounts.common}`, 'info');
    appendLog('Crate RNG initialized. Ready to roll!', 'success');

    handleSseEvent({
      type: 'ready',
      userId: displayName,
      rawUserId: username,
      avatarUrl: avatarUrl,
      playlistsCount: 1,
      tracksCount: allTracks.length,
      tracks: allTracks,
      distribution: tierCounts
    });
  } catch (err) {
    appendLog(`Last.fm load error: ${err.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
  }
}

export async function fetchAndBuildCrate(inputStr, forceRefresh = false) {
  getAudioContext();
  isBuildingCrate.set(true);
  debugStatus.set('active');

  let lastfmUser = (inputStr || '').trim();
  if (lastfmUser.toLowerCase().includes('last.fm/user/')) {
    lastfmUser = lastfmUser.split('last.fm/user/')[1].split('/')[0].split('?')[0].trim();
  } else if (lastfmUser.startsWith('lastfm:')) {
    lastfmUser = lastfmUser.split('lastfm:')[1].trim();
  }

  appendLog(`Initiating Last.fm request for user: ${lastfmUser}`, 'system');
  await loadLastfmCrateClient(lastfmUser);
}

function handleSseEvent(ev) {
  if (ev.type === 'log') {
    appendLog(ev.message, ev.level, ev.time);
  } else if (ev.type === 'error') {
    appendLog(`Error: ${ev.message}`, 'error');
    debugStatus.set('error');
    isBuildingCrate.set(false);
  } else if (ev.type === 'ready') {
    debugStatus.set('success');
    isBuildingCrate.set(false);

    // Reset current round
    activeWinnerCard.set(null);
    activeArenaTrack.set(null);
    activeBinderTrack.set(null);

    // Initialize user data
    activeUserId.set(ev.userId);
    userAvatarUrl.set(ev.avatarUrl || null);
    rngTracks.set(ev.tracks || []);
    playlistsCount.set(ev.playlistsCount || 0);

    // Reset/load inventory
    gameInventory.set({});
    gameInventoryTimestamps.set({});
    starredTrackIds.set(new Set());
    gameRolls.set(0);

    loadUserData(ev.userId);
    isCrateReady.set(true);
  }
}
