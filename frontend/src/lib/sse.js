import {
  activeMode,
  activeUserId,
  rngTracks,
  playlistsCount,
  debugStatus,
  isBuildingCrate,
  isCrateReady,
  crateBuildProgress,
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
  saveRecentProfile,
} from './store.js';
import { getAudioContext } from './audio.js';
import { loadLastfmCrateClient } from './modes/lastfmEngine.js';
import { loadSoundCloudCrateClient } from './modes/soundcloudEngine.js';
import { loadSpotifyCrateClient, loadStaticDemoCrate } from './modes/spotifyEngine.js';

/**
 * Shared SSE event dispatcher factory.
 * Scopes user data and state initialization to the selected mode.
 */
export function createSseHandler(mode, inputStr = '') {
  return function handleSseEvent(ev) {
    if (ev.type === 'log') {
      appendLog(ev.message, ev.level, ev.time);
      if (ev.progress !== undefined) {
        crateBuildProgress.set(ev.progress);
      } else if (ev.message) {
        const m = ev.message;
        const match = m.match(/\[(\d+)\/(\d+)\]/);
        if (match) {
          const cur = parseInt(match[1], 10);
          const tot = parseInt(match[2], 10);
          if (tot > 0) {
            crateBuildProgress.update((p) => Math.max(p, Math.round(25 + (cur / tot) * 60)));
          }
        } else if (m.includes('Resolving') || m.includes('Connecting') || m.includes('Scanning')) {
          crateBuildProgress.update((p) => Math.max(p, 20));
        } else if (m.includes('Found') || m.includes('Discovered') || m.includes('Loaded')) {
          crateBuildProgress.update((p) => Math.max(p, 40));
        } else if (m.includes('timeline') || m.includes('Sampling')) {
          crateBuildProgress.update((p) => Math.max(p, 55));
        } else if (m.includes('Compiling') || m.includes('Calculating') || m.includes('Rarity') || m.includes('Analyzing')) {
          crateBuildProgress.update((p) => Math.max(p, 90));
        }
      }
    } else if (ev.type === 'progress') {
      if (ev.progress !== undefined) {
        crateBuildProgress.set(ev.progress);
      }
    } else if (ev.type === 'error') {
      appendLog(`Error: ${ev.message}`, 'error');
      debugStatus.set('error');
      isBuildingCrate.set(false);
      crateBuildProgress.set(0);
    } else if (ev.type === 'ready') {
      crateBuildProgress.set(100);
      debugStatus.set('success');
      isBuildingCrate.set(false);

      activeMode.set(mode);

      // Reset active rounds
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

      loadUserData(ev.userId, mode);
      saveRecentProfile({
        userId: ev.userId,
        displayName: ev.userId,
        rawUserId: ev.rawUserId || inputStr || ev.userId,
        fetchTarget: inputStr || ev.rawUserId || ev.userId,
        mode: mode,
        input: inputStr || ev.rawUserId || ev.userId,
        avatarUrl: ev.avatarUrl || null,
        tracksCount: ev.tracks?.length || 0,
        playlistsCount: ev.playlistsCount || 0,
      });
      isCrateReady.set(true);
    }
  };
}

/**
 * Primary coordinator function to fetch and build crate according to selected mode.
 * @param {string} inputStr Username or profile URL
 * @param {'lastfm' | 'spotify'} mode Engine selection
 * @param {boolean} forceRefresh Whether to force live scraping (Spotify)
 */
export async function fetchAndBuildCrate(inputStr, mode = 'lastfm', forceRefresh = false) {
  getAudioContext();
  isBuildingCrate.set(true);
  crateBuildProgress.set(8);
  debugStatus.set('active');
  activeMode.set(mode);

  const cleanInput = (inputStr || '').trim();
  const onEvent = createSseHandler(mode, cleanInput);

  if (mode === 'lastfm') {
    let lastfmUser = cleanInput;
    if (lastfmUser.toLowerCase().includes('last.fm/user/')) {
      lastfmUser = lastfmUser.split('last.fm/user/')[1].split('/')[0].split('?')[0].trim();
    } else if (lastfmUser.startsWith('lastfm:')) {
      lastfmUser = lastfmUser.split('lastfm:')[1].trim();
    }
    appendLog(`Initiating Last.fm request for user: ${lastfmUser}`, 'system');
    await loadLastfmCrateClient(lastfmUser, onEvent, forceRefresh);
  } else if (mode === 'soundcloud') {
    let scUser = cleanInput;
    if (scUser.toLowerCase().includes('soundcloud.com/')) {
      scUser = scUser.split('soundcloud.com/')[1].split('/')[0].split('?')[0].trim();
    } else if (scUser.startsWith('soundcloud:')) {
      scUser = scUser.split(':').pop().trim();
    }
    appendLog(`Initiating SoundCloud request for user: ${scUser}`, 'system');
    await loadSoundCloudCrateClient(scUser, onEvent, forceRefresh);
  } else {
    appendLog(`Initiating Spotify request for input: ${cleanInput}`, 'system');
    await loadSpotifyCrateClient(cleanInput, forceRefresh, onEvent);
  }
}

export async function loadDemoCrateDirect(mode = 'spotify') {
  getAudioContext();
  isBuildingCrate.set(true);
  debugStatus.set('active');
  activeMode.set(mode);
  const onEvent = createSseHandler(mode, 'demo');
  await loadStaticDemoCrate(onEvent);
}
