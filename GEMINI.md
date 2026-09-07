# Spotify Crate RNG — Project GEMINI.md

Roblox-style track crate RNG spinner and card collector. Loads a user's listening history from **Last.fm** (primary) or a Spotify profile (secondary, currently broken), assigns dynamic rarity tiers, and lets the user roll for tracks with weighted odds.

---

## How to Run

```bash
# Production: serve dist/ on http://localhost:8080
python server.py

# Frontend dev (hot reload, no SSE)
cd frontend
npm run dev

# Build frontend for production
cd frontend
npm run build
# Output goes to dist/ — server.py serves this automatically
```

Server is Python 3.13 stdlib only. No pip installs needed.

---

## Key Files

### Backend

| File | Role |
|------|------|
| `server.py` | Zero-dependency HTTP + SSE server. Handles `/stream` endpoint for Last.fm crate building and Spotify scraping (broken). Serves `dist/` falling back to `public/`. |

### Frontend (`frontend/src/`)

| File | Role |
|------|------|
| `main.js` | App entry point |
| `App.svelte` | Root coordinator. Routes between Onboarding and Arena screens. |
| `lib/store.js` | All reactive Svelte stores: `rngTracks`, `isCrateReady`, `gameInventory`, `starredTrackIds`, `gameRolls`, `activeWinnerCard`, etc. |
| `lib/sse.js` | Crate builder client. For Last.fm users: fetches scrobble history directly from Last.fm API (client-side), deduplicates, assigns rarity. For Spotify users: connects to server SSE stream. |
| `lib/artCache.js` | iTunes Search API preview resolver. `fetchTrackPreview(card)` searches top 5 results, verifies artist + title match, caches in localStorage. Strips slowed/sped-up title suffixes before searching. |
| `lib/audio.js` | Web Audio engine. Mechanical SFX (tick, latch, drop). |
| `components/Reel.svelte` | Main spin logic. `executeSpin()` uses `upcomingRollQueue` (5-item preload). `preloadCardAudio()` and `topUpUpcomingRolls()` prefetch audio in the background. |
| `components/WinnerSpotlight.svelte` | Post-roll winner display. Shows track card, rarity, audio player, "Listen on Last.fm" button. |
| `components/BinderModal.svelte` | Card binder / collection view. Also has "Listen on Last.fm" button per card. |
| `components/Hud.svelte` | Top HUD: track count, roll counter, rarity badges. |
| `components/Deck.svelte` | Scrollable card grid for collected tracks. |
| `components/RatesModal.svelte` | Drop rate odds display. |
| `components/SettingsModal.svelte` | User settings (sound toggle, etc.). |
| `components/Onboarding.svelte` | Username input screen. |

### Data / Build

| Path | Role |
|------|------|
| `dist/` | Production build. Rebuilt with `cd frontend && npm run build`. |
| `public/sounds/` | Audio SFX files (roll_tick.wav, roll_latch.wav, roll_drop.wav, kenney_tick.wav). |
| `data/demo_crate.json` | Static demo crate for offline/demo mode. |

---

## Data Pipeline

### Last.fm mode (working)

1. User enters a Last.fm username on the Onboarding screen.
2. `sse.js` calls `loadLastfmCrateClient()`. Fetches scrobble history from `ws.audioscrobbler.com/2.0/` directly in the browser.
3. API key hardcoded: `b25b959554ed76058ac220b7b2e0a026` (Irfan personal key).
4. Page sampling: pages 2, 3, 25%, 50%, 75%, totalPages-1, totalPages — covers full timeline without exhausting rate limits.
5. Sequential paging with 260ms gaps. Retry on error code 29 (rate limit) with 1.4s backoff, 2 retries.
6. Deduplication by `title+artist` key. Rarity assigned by play count percentile.
7. Audio previews fetched from **iTunes Search API** via `artCache.js` — not from Spotify.

### Spotify mode (broken)

- `scrape_user_profile()` and `scrape_playlists_urllib()` in `server.py` return empty results.
- Spotify blocks both static HTML and headless Playwright scraping from discovering playlist IDs.
- `fetch_playlist_embed(pid)` WORKS when given a known playlist ID — returns full track list + preview URLs from `__NEXT_DATA__` JSON in the embed page.
- Broken step: discovering a user's playlist IDs from their profile page.
- Not yet fixed. Options: manual playlist ID input, or Spotify Web API OAuth.

---

## Known Issues / Open Tasks

- Spotify playlist discovery is broken. Profile page returns nothing via urllib or Playwright.
- iTunes mismatches: some tracks not on Apple Music return no preview. Verification against top 5 results is already in place.
- Slowed/sped-up title variants are stripped before iTunes search (e.g. `Song - Slowed` -> `Song`).

---

## Recent Changes (as of 2026-09-07)

| Change | Files |
|--------|-------|
| Last.fm historical range expanded (samples full timeline) | sse.js, server.py |
| Rate limit backoff retries for Last.fm paging | sse.js |
| Artist + title verification for iTunes preview matching | artCache.js |
| "Listen on Spotify" changed to "Listen on Last.fm" | WinnerSpotlight.svelte, BinderModal.svelte |
| 5-roll audio preload queue | Reel.svelte |

Latest commit: `132650f` — "Add Listen on Last.fm button, 5-roll audio preload queue, and verified iTunes matching"
Remote: https://github.com/irfanjmdn/rngbeta.git (branch: master)

---

## Testing

```bash
# Playwright: full flow (Last.fm user irfanjmdn, roll once, screenshot)
python tests/verify_rng_app.py

# Spotify scraping diagnostic (tests each step in isolation, no server needed)
python "C:\Users\Irfan\.gemini\antigravity-cli\brain\187c4c10-7f93-4cfd-8bc7-2056f8670515\scratch\test_spotify_scraping.py" irfanjmdn

# Spotify embed fetch test (known playlist ID, works independently)
python "C:\Users\Irfan\.gemini\antigravity-cli\brain\187c4c10-7f93-4cfd-8bc7-2056f8670515\scratch\test_embed_only.py"
```

Playwright notes:
- Desktop notice (#btnAgreeNotice) must be clicked before arena is accessible.
- Roll button ID: #btnBigRoll
- HUD brand sub selector: .hud-brand-sub
- "Winner modal visible: False" is normal — winner renders inline, not as an overlay.

---

## Dependencies

- Python 3.13 (stdlib only, no pip installs)
- Node.js v24+ (cd frontend && npm install)
- Playwright (optional, for tests): pip install playwright && playwright install chromium
- Last.fm API key: b25b959554ed76058ac220b7b2e0a026

---

## Git Credentials

Use GitHub CLI: gh auth git-credential
