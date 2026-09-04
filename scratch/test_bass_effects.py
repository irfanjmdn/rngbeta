import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:8080"

async def main():
    console_errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await context.new_page()

        page.on("console", lambda msg: console_errors.append(f"CONSOLE ERROR: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(f"PAGE ERROR: {err}"))

        print("1. Loading application...")
        await page.goto(BASE_URL)
        await page.wait_for_load_state("networkidle")

        print("2. Clicking Demo Profile button...")
        btn_demo = await page.wait_for_selector("#btnDemoIrfan")
        await btn_demo.click()

        print("3. Waiting for Game Arena to unlock...")
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)

        # Verify canvas exists and is preceding spinnerMachineWrap
        canvas_preceding = await page.evaluate('''() => {
            const canvas = document.getElementById('arenaParticleCanvas');
            const spinner = document.getElementById('spinnerMachineWrap');
            if (!canvas || !spinner) return false;
            return canvas.nextElementSibling === spinner;
        }''')
        assert canvas_preceding, "Canvas is not immediately preceding spinnerMachineWrap!"
        print("CHECK PASSED: #arenaParticleCanvas is positioned immediately before #spinnerMachineWrap.")

        print("4. Clicking Big Roll to spin and land winner...")
        btn_roll = await page.wait_for_selector("#btnBigRoll")
        await btn_roll.click()

        # Wait for roll to finish
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=10000)
        print("Roll finished, landed on card.")

        # Wait for audio proxy stream and analyser to initialize
        print("Waiting for audio proxy stream and analyser to initialize...")
        await asyncio.sleep(2.5)

        # Check audio element attributes and analyser data
        state = await page.evaluate('''() => {
            const audio = document.getElementById('arenaAudioPlayer');
            const canvas = document.getElementById('arenaParticleCanvas');
            const spotlight = document.getElementById('winnerSpotlight');
            return {
                src: audio ? audio.src : '',
                paused: audio ? audio.paused : true,
                crossOrigin: audio ? audio.crossOrigin : '',
                currentTime: audio ? audio.currentTime : 0,
                canvasActive: canvas ? canvas.classList.contains('active') : false,
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
                spotlightClasses: spotlight ? spotlight.className : ''
            };
        }''')
        print(f"Audio State: src={state['src'][:60]}..., paused={state['paused']}, crossOrigin={state['crossOrigin']}, time={state['currentTime']:.2f}")
        print(f"Canvas State: active={state['canvasActive']}, width={state['canvasWidth']}, height={state['canvasHeight']}")

        assert state['crossOrigin'] == 'anonymous', f"Expected crossOrigin 'anonymous', got '{state['crossOrigin']}'"
        assert '/api/audio-proxy?url=' in state['src'], f"Audio source not proxied: {state['src']}"

        # Sample frequency data over 2.5 seconds to check non-zero bass frequencies
        print("5. Verifying non-zero bass frequencies and beat sampling...")
        non_zero_bass_samples = 0

        for _ in range(25):
            sample = await page.evaluate('''() => {
                const spotlight = document.getElementById('winnerSpotlight');
                const audio = document.getElementById('arenaAudioPlayer');
                const bassScale = spotlight ? spotlight.style.getPropertyValue('--bass-scale') : '';
                const bassGlow = spotlight ? spotlight.style.getPropertyValue('--bass-glow') : '';
                const hasBassBump = spotlight ? spotlight.classList.contains('bass-bump') : false;

                return {
                    paused: audio ? audio.paused : true,
                    currentTime: audio ? audio.currentTime : 0,
                    bassScale,
                    bassGlow,
                    hasBassBump
                };
            }''')
            if sample['bassScale'] or sample['hasBassBump']:
                non_zero_bass_samples += 1
            await asyncio.sleep(0.1)

        print(f"Observed {non_zero_bass_samples} frames with active bass response.")
        assert non_zero_bass_samples > 0, "Expected non-zero bass frequency response in visualizer"

        freq_check = await page.evaluate('''() => {
            const audio = document.getElementById('arenaAudioPlayer');
            return {
                audioPlaying: !audio.paused && audio.currentTime > 0
            };
        }''')
        print(f"Audio playback verified: {freq_check['audioPlaying']}")
        assert freq_check['audioPlaying'], "Audio should be actively playing"

        # Test Binder opening cleanup
        print("6. Testing binder modal open pauses visualizer loop cleanly...")
        btn_binder = await page.wait_for_selector("#btnHudBinder")
        await btn_binder.click()
        await page.wait_for_selector("#gameBinderModal.open")

        cleanup_state = await page.evaluate('''() => {
            const canvas = document.getElementById('arenaParticleCanvas');
            const spotlight = document.getElementById('winnerSpotlight');
            const audio = document.getElementById('arenaAudioPlayer');
            return {
                paused: audio.paused,
                canvasActive: canvas.classList.contains('active'),
                hasBassBump: spotlight.classList.contains('bass-bump')
            };
        }''')
        print(f"Binder Opened State: paused={cleanup_state['paused']}, canvasActive={cleanup_state['canvasActive']}, bassBump={cleanup_state['hasBassBump']}")
        assert cleanup_state['paused'], "Arena audio player should be paused when binder modal opens"
        assert not cleanup_state['canvasActive'], "Canvas should not have .active class when paused"
        assert not cleanup_state['hasBassBump'], "Spotlight should not have .bass-bump class when paused"

        # Test closing binder modal
        print("7. Testing binder modal close...")
        btn_close_binder = await page.wait_for_selector("#btnCloseBinderModal")
        await btn_close_binder.click()
        await page.wait_for_selector("#gameBinderModal:not(.open)", state="attached")
        print("Binder modal closed cleanly.")

        # Test pausing and resuming audio directly via button
        print("8. Testing toggleArenaPlayPause resume and pause behavior...")
        await page.click("#btnWinnerMiniPlay", force=True)
        await asyncio.sleep(1.0)
        play_state = await page.evaluate('''() => {
            const audio = document.getElementById('arenaAudioPlayer');
            const canvas = document.getElementById('arenaParticleCanvas');
            return { paused: audio.paused, canvasActive: canvas.classList.contains('active') };
        }''')
        assert not play_state['paused'], "Audio should be resumed on play button click"
        assert play_state['canvasActive'], "Canvas should be active when playing"
        print("Audio resumed, canvas active.")

        await page.click("#btnWinnerMiniPlay", force=True)
        await asyncio.sleep(0.5)
        pause_state = await page.evaluate('''() => {
            const audio = document.getElementById('arenaAudioPlayer');
            const canvas = document.getElementById('arenaParticleCanvas');
            const spotlight = document.getElementById('winnerSpotlight');
            return {
                paused: audio.paused,
                canvasActive: canvas.classList.contains('active'),
                hasBassBump: spotlight.classList.contains('bass-bump')
            };
        }''')
        assert pause_state['paused'], "Audio should be paused on pause click"
        assert not pause_state['canvasActive'], "Canvas should be inactive when paused"
        assert not pause_state['hasBassBump'], "Spotlight bass bump should be removed when paused"
        print("Audio paused, visualizer loop stopped, canvas inactive.")

        print("9. Checking console errors...")
        if console_errors:
            print("Console Errors Found:")
            for err in console_errors:
                print(f"  - {err}")
            assert len(console_errors) == 0, f"Found {len(console_errors)} console errors!"
        else:
            print("CHECK PASSED: 0 console errors.")

        print("\nALL BASS EFFECTS & VISUALIZER TESTS PASSED SUCCESSFULLY!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
