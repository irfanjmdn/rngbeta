import { writable, derived } from 'svelte/store';
import { playStarSound, playUnstarSound } from './audio.js';

export const activeUserId = writable(null);
export const rngTracks = writable([]);
export const playlistsCount = writable(0);
export const gameInventory = writable({});
export const gameInventoryTimestamps = writable({});
export const starredTrackIds = writable(new Set());
export const gameRolls = writable(0);

export const isSpinning = writable(false);
export const isAutoRolling = writable(false);
export const isAutoSkip = writable(false);

export const activeWinnerCard = writable(null);
export const activeArenaTrack = writable(null);
export const activeBinderTrack = writable(null);

export const isArenaPlaying = writable(false);
export const isBinderPlaying = writable(false);
export const arenaAudioTime = writable({ current: 0, duration: 30 });
export const binderAudioTime = writable({ current: 0, duration: 30 });

export const debugLogs = writable([
  { level: 'system', message: 'Ready. Enter a Spotify profile URL and click \'Fetch & Build Crate\'.' }
]);
export const debugStatus = writable('idle'); // 'idle' | 'active' | 'success' | 'error'
export const isBuildingCrate = writable(false);
export const isCrateReady = writable(false);

export const activeModal = writable(null); // 'binder' | 'rates' | 'settings' | null

// Telemetry derived stores
export const unlockedCount = derived(gameInventory, ($inv) => Object.keys($inv).length);
export const masteryText = derived([unlockedCount, rngTracks], ([$count, $tracks]) => `${$count} / ${$tracks.length}`);
export const masteryPercent = derived([unlockedCount, rngTracks], ([$count, $tracks]) => {
  if (!$tracks.length) return 0;
  return Math.round(($count / $tracks.length) * 100);
});

export const rarestRolled = derived([gameInventory, rngTracks], ([$inv, $tracks]) => {
  const tierRanks = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6 };
  let highestRank = 0;
  let rarestName = '-';
  Object.keys($inv).forEach((id) => {
    const item = $tracks.find((t) => t.id === id);
    if (item && tierRanks[item.rarityTier] > highestRank) {
      highestRank = tierRanks[item.rarityTier];
      rarestName = item.rarityName;
    }
  });
  return rarestName;
});

// Load saved data for user
export function loadUserData(userId) {
  if (!userId) return;
  try {
    const savedInv = localStorage.getItem(`crate_rng_inv_${userId}`);
    if (savedInv) gameInventory.set(JSON.parse(savedInv));

    const savedRolls = localStorage.getItem(`crate_rng_rolls_${userId}`);
    if (savedRolls) gameRolls.set(parseInt(savedRolls, 10) || 0);

    const savedTimes = localStorage.getItem(`crate_rng_times_${userId}`);
    if (savedTimes) gameInventoryTimestamps.set(JSON.parse(savedTimes));

    const savedStarred = localStorage.getItem(`crate_starred_${userId}`);
    if (savedStarred) starredTrackIds.set(new Set(JSON.parse(savedStarred)));
  } catch (e) {}
}

export function saveUserData(userId, inv, rolls, times, starred) {
  if (!userId) return;
  try {
    localStorage.setItem(`crate_rng_inv_${userId}`, JSON.stringify(inv));
    localStorage.setItem(`crate_rng_rolls_${userId}`, rolls.toString());
    localStorage.setItem(`crate_rng_times_${userId}`, JSON.stringify(times));
    localStorage.setItem(`crate_starred_${userId}`, JSON.stringify([...starred]));
  } catch (e) {}
}

export function toggleStar(trackId) {
  if (!trackId) return;
  let isStarredNow = false;
  let currentUserId = null;

  activeUserId.subscribe((u) => (currentUserId = u))();

  starredTrackIds.update((set) => {
    const next = new Set(set);
    if (next.has(trackId)) {
      next.delete(trackId);
      playUnstarSound();
      isStarredNow = false;
    } else {
      next.add(trackId);
      playStarSound();
      isStarredNow = true;
    }
    if (currentUserId) {
      try {
        localStorage.setItem(`crate_starred_${currentUserId}`, JSON.stringify([...next]));
      } catch (e) {}
    }
    return next;
  });

  return isStarredNow;
}

export function appendLog(message, level = 'info', time = '') {
  debugLogs.update((logs) => [...logs, { message, level, time }]);
}
