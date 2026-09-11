import asyncio
import os
import sys
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:8080"
TEST_DIR = os.path.dirname(os.path.abspath(__file__))

async def verify_redesign():
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        print("\n--- 1. TESTING DESKTOP (1366x850) ---")
        desk_context = await browser.new_context(viewport={"width": 1366, "height": 850})
        page = await desk_context.new_page()

        await page.goto(BASE_URL)
        await page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        await page.reload()

        btn_lastfm = await page.wait_for_selector("#btnChooseLastfm", timeout=10000)
        assert await btn_lastfm.is_visible(), "Desktop: Mode select not visible"
        print("PASS: Desktop mode select visible.")

        await btn_lastfm.click()
        btn_build = await page.wait_for_selector("#btnBuildCrate", timeout=5000)
        input_user = await page.wait_for_selector("#inputLastfmUser")
        await input_user.fill("rj")
        await btn_build.click()

        btn_agree = await page.wait_for_selector("#btnAgreeNotice", timeout=35000)
        await btn_agree.click()
        await page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("PASS: Desktop entered game arena.")

        watermark = await page.wait_for_selector(".hud-top-left-watermark", timeout=5000)
        assert await watermark.is_visible(), "Desktop: Watermark should be visible on desktop"

        pod = await page.wait_for_selector(".hud-corner-dock.pod-monolith", timeout=5000)
        assert await pod.is_visible(), "Desktop: Pod monolith dock should be visible on desktop"

        mobile_bar = await page.query_selector(".hud-mobile-nav-bar")
        assert mobile_bar is None or not (await mobile_bar.is_visible()), "Desktop: Mobile nav bar must NOT be visible on desktop"
        print("PASS: Desktop HUD confirmed (pod monolith visible, mobile dock hidden).")

        btn_roll = await page.wait_for_selector("#btnBigRoll", timeout=5000)
        await btn_roll.click()
        await page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=8000)
        print("PASS: Desktop roll completed.")

        screenshot_desk = os.path.join(TEST_DIR, "test_redesign_desktop.png")
        await page.screenshot(path=screenshot_desk)
        print(f"Screenshot saved: {screenshot_desk}")
        await desk_context.close()

        print("\n--- 2. TESTING MOBILE (390x844) ---")
        mob_context = await browser.new_context(viewport={"width": 390, "height": 844})
        mob_page = await mob_context.new_page()

        await mob_page.goto(BASE_URL)
        await mob_page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
        await mob_page.reload()

        btn_mob_lastfm = await mob_page.wait_for_selector("#btnChooseLastfm", timeout=10000)
        assert await btn_mob_lastfm.is_visible(), "Mobile: Mode select not visible"
        print("PASS: Mobile mode select visible.")

        await btn_mob_lastfm.click()
        btn_mob_build = await mob_page.wait_for_selector("#btnBuildCrate", timeout=5000)
        input_mob_user = await mob_page.wait_for_selector("#inputLastfmUser")
        await input_mob_user.fill("rj")
        await btn_mob_build.click()

        btn_mob_agree = await mob_page.wait_for_selector("#btnAgreeNotice", timeout=35000)
        await btn_mob_agree.click()
        await mob_page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=10000)
        print("PASS: Mobile entered game arena.")

        top_bar = await mob_page.wait_for_selector(".hud-mobile-top-bar", timeout=5000)
        assert await top_bar.is_visible(), "Mobile: Top bar must be visible on mobile"

        watermark_mob = await mob_page.query_selector(".hud-top-left-watermark")
        assert watermark_mob is None or not (await watermark_mob.is_visible()), "Mobile: Desktop watermark must be hidden on mobile"

        nav_bar = await mob_page.wait_for_selector(".hud-mobile-nav-bar", timeout=5000)
        assert await nav_bar.is_visible(), "Mobile: Bottom navigation bar must be visible on mobile"
        print("PASS: Mobile Chrome active (Top Bar + Bottom Navigation Dock).")

        screenshot_mob_arena = os.path.join(TEST_DIR, "test_redesign_mobile_arena_idle.png")
        await mob_page.screenshot(path=screenshot_mob_arena)
        print(f"Screenshot saved: {screenshot_mob_arena}")

        btn_mob_roll = await mob_page.wait_for_selector("#btnBigRoll", timeout=5000)
        await btn_mob_roll.click()
        await mob_page.wait_for_selector("#btnBigRoll.is-spinning")
        await mob_page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=8000)
        print("PASS: Mobile spin completed.")

        winner_title = await mob_page.wait_for_selector("#winnerTitle", timeout=5000)
        title_text = await winner_title.inner_text()
        print(f"PASS: Mobile winner card displayed: '{title_text}'")

        screenshot_mob_winner = os.path.join(TEST_DIR, "test_redesign_mobile_winner.png")
        await mob_page.screenshot(path=screenshot_mob_winner)
        print(f"Screenshot saved: {screenshot_mob_winner}")

        btn_nav_binder = await mob_page.wait_for_selector("#btnHudBinder")
        await btn_nav_binder.click()
        binder_modal = await mob_page.wait_for_selector("#gameBinderModal.open", timeout=5000)
        assert await binder_modal.is_visible(), "Mobile: Catalogue modal not opened via bottom tab"
        print("PASS: Mobile Catalogue sheet opened via bottom tab.")

        screenshot_mob_catalogue = os.path.join(TEST_DIR, "test_redesign_mobile_catalogue.png")
        await mob_page.screenshot(path=screenshot_mob_catalogue)
        print(f"Screenshot saved: {screenshot_mob_catalogue}")

        await mob_page.click("#btnCloseBinderModal")
        await mob_page.wait_for_selector("#gameBinderModal:not(.open)", timeout=5000, state="hidden")
        print("PASS: Mobile Catalogue closed.")

        btn_nav_rates = await mob_page.wait_for_selector("#btnHudRates")
        await btn_nav_rates.click()
        rates_modal = await mob_page.wait_for_selector("#gameRatesModal.open", timeout=5000)
        assert await rates_modal.is_visible(), "Mobile: Rates modal not opened via bottom tab"
        print("PASS: Mobile Rates sheet opened via bottom tab.")

        screenshot_mob_rates = os.path.join(TEST_DIR, "test_redesign_mobile_rates.png")
        await mob_page.screenshot(path=screenshot_mob_rates)
        print(f"Screenshot saved: {screenshot_mob_rates}")

        await mob_page.click("#btnCloseRatesModal")
        await mob_page.wait_for_selector("#gameRatesModal:not(.open)", timeout=5000, state="hidden")
        print("PASS: Mobile Rates closed.")

        btn_nav_settings = await mob_page.wait_for_selector("#btnHudSettings")
        await btn_nav_settings.click()
        settings_modal = await mob_page.wait_for_selector("#gameSettingsModal.open", timeout=5000)
        assert await settings_modal.is_visible(), "Mobile: Settings modal not opened via bottom tab"
        print("PASS: Mobile Settings sheet opened via bottom tab.")

        screenshot_mob_settings = os.path.join(TEST_DIR, "test_redesign_mobile_settings.png")
        await mob_page.screenshot(path=screenshot_mob_settings)
        print(f"Screenshot saved: {screenshot_mob_settings}")

        await mob_page.click("#btnCloseSettingsModal")
        await mob_page.wait_for_selector("#gameSettingsModal:not(.open)", timeout=5000, state="hidden")
        print("PASS: Mobile Settings closed via close button.")

        btn_arena = await mob_page.wait_for_selector("#btnHudArena")
        assert await btn_arena.is_visible(), "Mobile: Arena bottom tab should be visible on Arena screen"
        await btn_arena.click()
        print("PASS: Returned to Arena via bottom Arena tab.")

        await mob_context.close()
        await browser.close()
        print("\nALL DESKTOP AND MOBILE REDESIGN TESTS PASSED!")

if __name__ == "__main__":
    asyncio.run(verify_redesign())
