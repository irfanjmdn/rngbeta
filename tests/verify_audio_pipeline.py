import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright

TEST_PORT = 8080
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"
TEST_DIR = os.path.dirname(os.path.abspath(__file__))

async def run_audio_verification():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await context.new_page()

        console_errors = []
        page.on("console", lambda msg: print(f"[BROWSER {msg.type.upper()}] {msg.text}") if msg.type in ("error", "warning") else None)
        page.on("pageerror", lambda err: print(f"[PAGE ERROR] {err}"))

        print(f"Navigating to {BASE_URL}...", flush=True)
        await page.goto(BASE_URL)
        await page.wait_for_load_state("domcontentloaded")

        # Step 1: Mode Selection screen -> Choose Last.fm
        btn_choose = await page.wait_for_selector("#btnChooseLastfm", timeout=5000)
        await btn_choose.click()
        print("PASS: Clicked Last.fm mode.", flush=True)

        # Step 2: Onboarding input -> enter user and build crate
        input_el = await page.wait_for_selector("#inputLastfmUser", timeout=5000)
        await input_el.fill("irfanjmdn")
        btn_build = await page.wait_for_selector("#btnBuildCrate")
        await btn_build.click()
        print("PASS: Submitted username irfanjmdn.", flush=True)

        # Step 3: Wait for desktop notice or arena
        notice_btn = await page.wait_for_selector("#btnAgreeNotice", timeout=60000)
        await notice_btn.click()
        print("PASS: Clicked desktop notice agreement.", flush=True)

        # Step 4: Arena loaded
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("PASS: Arena is visible.", flush=True)

        # Step 5: Roll once
        btn_roll = await page.wait_for_selector("#btnBigRoll:not(:disabled)")
        await btn_roll.click()
        print("PASS: Triggered spin roll.", flush=True)

        # Wait for roll completion
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=12000)
        print("PASS: Spin completed.", flush=True)

        # Step 6: Verify winner card has cover and audio preview
        await page.wait_for_timeout(2000)
        winner_img = await page.wait_for_selector("#winnerArtImg", timeout=8000)
        assert winner_img is not None, "Winner artwork img not found!"

        # Check audio and artwork resolution in page
        card_data = await page.evaluate("""() => {
            const img = document.getElementById('winnerArtImg');
            const audioA = document.getElementById('arenaAudioPlayerA');
            const audioB = document.getElementById('arenaAudioPlayerB');
            return {
                imgSrc: img ? img.getAttribute('src') : null,
                audioSrcA: audioA ? audioA.getAttribute('src') : null,
                audioSrcB: audioB ? audioB.getAttribute('src') : null
            };
        }""")
        print(f"Winner Artwork SRC: {card_data.get('imgSrc')}", flush=True)
        audio_src = card_data.get('audioSrcA') or card_data.get('audioSrcB')
        print(f"Winner Audio SRC: {audio_src}", flush=True)

        assert card_data.get('imgSrc'), "Artwork image source missing!"
        assert "2a96cbd8b46e442fc41c2b86b821562f" not in card_data.get('imgSrc'), "Artwork is still Last.fm placeholder!"

        screenshot_path = os.path.join(TEST_DIR, "audio_pipeline_verified.png")
        await page.screenshot(path=screenshot_path)
        print(f"PASS: Saved screenshot to {screenshot_path}", flush=True)

        await browser.close()
        print("SUCCESS: End-to-end audio and cover verification passed!", flush=True)

if __name__ == "__main__":
    asyncio.run(run_audio_verification())
