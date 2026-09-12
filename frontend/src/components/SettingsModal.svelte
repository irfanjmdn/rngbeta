<script>
  import {
    activeModal,
    isCrateReady,
    rngTracks,
    isAutoRolling,
    activeWinnerCard,
    activeArenaTrack,
    activeBinderTrack,
  } from '../lib/store.js';
  import {
    getSfxVolume,
    setSfxVolume,
    getMusicVolume,
    setMusicVolume,
    playSampledSound,
    playMechanicalBrakeSound,
    playStarSound,
    stopAllMediaAudio,
    setArenaLowpassFilter,
    setArenaReverbWet,
    fadeInMusic,
    playLogoutConfirmSound,
  } from '../lib/audio.js';

  let currentPercent = Math.round(getSfxVolume() * 100);
  let musicPercent = Math.round(getMusicVolume() * 100);

  function closeModal() {
    activeModal.set(null);
  }

  function handleSwitchCrate() {
    closeModal();
    setArenaLowpassFilter(false, 20000, 20000, 0.02);
    setArenaReverbWet(0, 0.02);
    stopAllMediaAudio();
    fadeInMusic(0);
    playLogoutConfirmSound();
    isAutoRolling.set(false);
    activeWinnerCard.set(null);
    activeArenaTrack.set(null);
    activeBinderTrack.set(null);
    rngTracks.set([]);
    isCrateReady.set(false);
  }

  function handleBackdropClick(e) {
    if (e.target.id === 'gameSettingsModal') {
      closeModal();
    }
  }

  function handleSliderInput(e) {
    const val = parseInt(e.target.value, 10);
    currentPercent = isNaN(val) ? 80 : Math.max(0, Math.min(100, val));
    setSfxVolume(currentPercent / 100);
  }

  function handleMusicSliderInput(e) {
    const val = parseInt(e.target.value, 10);
    musicPercent = isNaN(val) ? 80 : Math.max(0, Math.min(100, val));
    setMusicVolume(musicPercent / 100);
  }

  function testSfx() {
    playSampledSound('roll_tick', { volume: 0.8, playbackRate: 1.0 });
    setTimeout(() => {
      playMechanicalBrakeSound();
    }, 140);
  }

  function testStarChime() {
    playStarSound();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<dialog
  class="game-settings-modal {$activeModal === 'settings' ? 'open' : ''}"
  id="gameSettingsModal"
  open={$activeModal === 'settings'}
  on:click={handleBackdropClick}
>
  <div class="settings-dialog-content">
    <div class="modal-header">
      <div class="modal-title" style="display:flex; align-items:center; gap:8px;">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          ></path>
        </svg>
        GAME SETTINGS
      </div>
      <button class="modal-close-btn" id="btnCloseSettingsModal" type="button" aria-label="Close" on:click={closeModal}>
        &times;
      </button>
    </div>

    <div class="settings-body">
      <!-- Music Volume Section -->
      <div class="settings-section">
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-label">Music Volume</div>
            <div class="settings-sublabel">Spotify previews, arena music playback, and binder audio</div>
          </div>
          <span class="settings-val-badge" id="musicVolumeBadge">{musicPercent}%</span>
        </div>
        <div class="settings-slider-wrap">
          <input
            type="range"
            class="settings-slider"
            id="musicVolumeSlider"
            min="0"
            max="100"
            step="1"
            value={musicPercent}
            aria-label="Music volume"
            on:input={handleMusicSliderInput}
          />
        </div>
      </div>

      <!-- Sound Effects Volume Section -->
      <div class="settings-section">
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-label">Sound Effects Volume</div>
            <div class="settings-sublabel">Roll ticker, caliper latch, impact bass, and star chime</div>
          </div>
          <span class="settings-val-badge" id="sfxVolumeBadge">{currentPercent}%</span>
        </div>
        <div class="settings-slider-wrap">
          <input
            type="range"
            class="settings-slider"
            id="sfxVolumeSlider"
            min="0"
            max="100"
            step="1"
            value={currentPercent}
            aria-label="Sound effects volume"
            on:input={handleSliderInput}
          />
        </div>
        <div class="settings-actions-row">
          <button
            type="button"
            class="btn-settings-test"
            id="btnTestSfx"
            aria-label="Preview roll sound effects at current volume"
            on:click={testSfx}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
            Test SFX
          </button>
          <button
            type="button"
            class="btn-settings-test"
            id="btnTestStarSfx"
            aria-label="Preview star chime at current volume"
            on:click={testStarChime}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            Test Star Chime
          </button>
        </div>
      </div>


      <!-- Mobile Logout Section (Hidden on Desktop) -->
      <div class="settings-mobile-logout-wrap">
        <button
          type="button"
          class="btn-mobile-settings-logout"
          id="btnMobileSettingsLogout"
          on:click={handleSwitchCrate}
        >
          Log Out
        </button>
      </div>
    </div>
  </div>
</dialog>
