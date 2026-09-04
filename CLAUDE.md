# Spotify Crate RNG

Standalone Spotify profile gacha spinner and album card binder web app.

## Run and Verify

```bash
# Start server (stdlib only)
python server.py

# Run Playwright test suite
py -3.13 tests/verify_rng_app.py
py -3.13 tests/verify_starred_and_binder.py
```

## Key Files

- `server.py`: Python HTTP + SSE server (port 8080) for scraping Spotify profiles and caching data.
- `public/index.html`: Main UI with onboarding screen, slot spinner arena, winner spotlight, and binder modal.
- `public/style.css`: Dark-themed arcade styling, custom animations, and responsive layout.
- `public/app.js`: Game logic, slot reel physics, Web Audio synthesis, starred tracks, and binder sorting/filtering.
- `data/`: Profile JSON caches (`cache_<userId>.json`) and album art cache.
- `tests/`: Automated Playwright verification scripts.

## Dependencies

- Python 3.13 (stdlib only: `http.server`, `urllib.request`, `json`, `re`, `time`, `os`).
- Playwright for running test suites (`py -3.13`).
