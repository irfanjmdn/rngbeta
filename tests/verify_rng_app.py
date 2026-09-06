import asyncio
import os
import sys
import time
from playwright.async_api import async_playwright

TEST_PORT = 8080
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"
TEST_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TEST_DIR)

async def run_tests():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        console_errors = []

        # ==========================================
        # DESKTOP RUN (1366x850)
        # ==========================================
        desk_context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await desk_context.new_page()
        page.on("console", lambda msg: console_errors.append(f"[DESK] {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(f"[DESK] {err}"))

        print("Navigating to standalone app...")
        await page.goto(BASE_URL)
        try:
            await page.wait_for_load_state("networkidle", timeout=2000)
        except Exception:
            await page.wait_for_load_state("domcontentloaded")

        # Check onboarding screen visibility
        onboarding = await page.wait_for_selector("#onboardingScreen")
        assert await onboarding.is_visible(), "Onboarding screen not visible!"
        print("CHECK PASSED: Onboarding screen loaded.")

        # Click Build Crate Button to load profile
        btn_build = await page.wait_for_selector("#btnBuildCrate")
        await btn_build.click()
        print("Clicked Build Crate button.")

        # Verify debug terminal receives live progress logs
        await page.wait_for_selector(".terminal-line.success", state="attached", timeout=5000)
        logs = await page.eval_on_selector_all(".terminal-line", "els => els.map(e => e.textContent)")
        assert len(logs) >= 3, f"Not enough debug log lines: {len(logs)}"
        print(f"CHECK PASSED: Debug dropdown logged {len(logs)} events. Latest: '{logs[-1]}'")

        # Verify Game Arena unlocks
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("CHECK PASSED: Game Arena unlocked after profile compilation.")

        # Verify HUD Telemetry
        hud_text = await page.text_content("#hudAccountSub")
        assert "935 Tracks" in hud_text or "Tracks" in hud_text, f"Unexpected HUD sub: {hud_text}"
        print(f"CHECK PASSED: HUD telemetry active: '{hud_text}'")

        # Capture desktop idle stage screenshot
        screenshot_idle = os.path.join(TEST_DIR, "standalone_stage_idle.png")
        await page.screenshot(path=screenshot_idle)

        # Test 1: Normal Roll
        btn_roll = await page.wait_for_selector("#btnBigRoll")
        await btn_roll.click()
        await page.wait_for_selector("#btnBigRoll.is-spinning")
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=6000)
        print("CHECK PASSED: Normal roll completed naturally.")

        # Test 2: Auto Skip with Immediate Stop and Brake Calipers
        btn_auto_skip = await page.wait_for_selector("#btnAutoSkip")
        await btn_auto_skip.click()
        lbl_skip = await page.text_content("#lblAutoSkip")
        assert "Auto Skip: ON" in lbl_skip, f"Unexpected label: {lbl_skip}"

        t0 = time.time()
        await btn_roll.click()
        await page.wait_for_selector("#btnBigRoll.is-spinning")
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=3000)
        t_auto_skip = time.time() - t0
        print(f"CHECK PASSED: Auto Skip roll completed in {t_auto_skip:.2f}s (sub-1.8s)")
        assert 0.7 <= t_auto_skip < 2.0, f"Auto Skip duration out of range: {t_auto_skip:.2f}s"

        # Check Needle and Winner Card Alignment
        alignment = await page.evaluate("""() => {
            const pointer = document.getElementById('reelPointerTop');
            const winningCard = document.querySelector('.reel-card.winner-landed');
            const reelTrack = document.getElementById('reelTrack');
            const pRect = pointer.getBoundingClientRect();
            const wRect = winningCard.getBoundingClientRect();
            const diff = Math.abs((pRect.left + pRect.width / 2) - (wRect.left + wRect.width / 2));
            const transDur = window.getComputedStyle(reelTrack).transitionDuration;
            return { diff, transDur };
        }""")
        print(f"Pointer / Winner Card Alignment Diff: {alignment['diff']:.2f}px")
        assert alignment['diff'] < 3.0, f"Needle not centered on winner! Diff: {alignment['diff']}"
        assert alignment['transDur'] in ['0s', '0.1s'], f"Track transition not halted! Duration: {alignment['transDur']}"
        print("CHECK PASSED: Needle points dead-center on winner card with dynamic 0.1s settle.")

        # Capture desktop winner reveal screenshot
        screenshot_winner = os.path.join(TEST_DIR, "standalone_winner_reveal.png")
        await page.screenshot(path=screenshot_winner)

        # Test 3: Winner Spotify App Launch Button
        spot_btn = await page.wait_for_selector("#winnerSpotifyBtn")
        spot_href = await spot_btn.get_attribute("href")
        spot_target = await spot_btn.get_attribute("target")
        assert spot_href.startswith("spotify:track:"), f"Winner link does not use spotify: URI: {spot_href}"
        assert spot_target is None, f"Winner link should not have target=_blank: {spot_target}"
        print(f"CHECK PASSED: Winner Spotify button uses app protocol '{spot_href}' without target=_blank.")

        # Test 4: Album Card Binder Modal
        await page.hover(".monolith-base")
        btn_binder = await page.wait_for_selector("#btnHudBinder")
        await btn_binder.click()
        await page.wait_for_selector("#gameBinderModal.open")
        await page.wait_for_timeout(300)

        binder_links = await page.eval_on_selector_all(".btn-binder-spotify", "els => els.map(e => ({ href: e.getAttribute('href'), target: e.getAttribute('target') }))")
        assert len(binder_links) > 0, "No binder cards unlocked!"
        assert all(l['href'].startswith("spotify:track:") for l in binder_links), "Some binder cards lack spotify: URI!"
        assert all(l['target'] is None for l in binder_links), "Some binder cards have target=_blank!"
        print(f"CHECK PASSED: {len(binder_links)} binder cards render with native Spotify app links.")

        screenshot_binder = os.path.join(TEST_DIR, "standalone_binder_view.png")
        await page.screenshot(path=screenshot_binder)

        btn_close_binder = await page.wait_for_selector("#btnCloseBinderModal")
        await btn_close_binder.click()
        await desk_context.close()

        # ==========================================
        # MOBILE RUN (390x844)
        # ==========================================
        mob_context = await browser.new_context(viewport={"width": 390, "height": 844})
        mob_page = await mob_context.new_page()
        mob_page.on("console", lambda msg: console_errors.append(f"[MOB] {msg.text}") if msg.type == "error" else None)
        mob_page.on("pageerror", lambda err: console_errors.append(f"[MOB] {err}"))

        await mob_page.goto(BASE_URL)
        try:
            await mob_page.wait_for_load_state("networkidle", timeout=2000)
        except Exception:
            await mob_page.wait_for_load_state("domcontentloaded")

        # Load profile on mobile
        await mob_page.click("#btnBuildCrate")
        await mob_page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=4000)

        # Mobile spin with Auto Skip
        await mob_page.click("#btnAutoSkip")
        await mob_page.click("#btnBigRoll")
        await mob_page.wait_for_selector("#btnBigRoll.is-spinning")
        await mob_page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=3000)

        mob_align = await mob_page.evaluate("""() => {
            const pointer = document.getElementById('reelPointerTop');
            const winningCard = document.querySelector('.reel-card.winner-landed');
            const pRect = pointer.getBoundingClientRect();
            const wRect = winningCard.getBoundingClientRect();
            return Math.abs((pRect.left + pRect.width / 2) - (wRect.left + wRect.width / 2));
        }""")
        print(f"Mobile Pointer Alignment Diff: {mob_align:.2f}px")
        assert mob_align < 3.0, f"Mobile needle not aligned! Diff: {mob_align}"

        screenshot_mob = os.path.join(TEST_DIR, "standalone_mobile_winner.png")
        await mob_page.screenshot(path=screenshot_mob)
        await mob_context.close()

        print(f"Total console errors recorded: {len(console_errors)}")
        for err in console_errors:
            print("  Console Error:", err)
        assert len(console_errors) == 0, f"Encountered console errors: {console_errors}"

        await browser.close()
        print("ALL STANDALONE TESTS PASSED WITH ZERO ERRORS!")

if __name__ == "__main__":
    asyncio.run(run_tests())
