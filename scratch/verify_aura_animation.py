from playwright.sync_api import sync_playwright
import time
import os

output_dir = r"C:\Users\Irfan\.gemini\antigravity-cli\brain\ca43a1a1-fb40-4657-90b7-de15ffb4ef98"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 840}, device_scale_factor=2)
    page.goto("http://127.0.0.1:8080")
    page.wait_for_selector("#btnDemoIrfan", state="visible")
    page.click("#btnDemoIrfan")
    page.wait_for_selector("#gameArenaScreen:not(.hidden)", timeout=15000)

    # 1. Verify ambient aura layer exists
    aura_layer = page.locator(".ambient-aura-layer")
    assert aura_layer.count() == 1, "Ambient aura layer not found in DOM!"
    print("CHECK PASSED: Ambient aura layer exists in DOM.")

    # Screenshot 1: Idle state
    time.sleep(0.5)
    page.screenshot(path=os.path.join(output_dir, "aura_stage_idle.png"))
    print("Captured idle aura screenshot.")

    # 2. Test Spinning kinetic stretch
    roll_btn = page.locator("#btnBigRoll")
    roll_btn.click()
    time.sleep(0.4) # Mid spin

    is_spinning = page.evaluate("() => document.querySelector('.ambient-aura-layer').classList.contains('is-spinning')")
    print(f"Aura layer has .is-spinning during spin: {is_spinning}")
    assert is_spinning, "Aura layer missing .is-spinning during roll!"

    page.screenshot(path=os.path.join(output_dir, "aura_stage_spinning.png"))
    print("Captured spinning aura screenshot.")

    # 3. Wait for roll to settle
    page.wait_for_selector("#btnBigRoll:not(.is-spinning)", timeout=7000)
    time.sleep(0.6)

    winner_tier = page.evaluate("() => document.getElementById('winnerTierPill').textContent.trim()")
    print(f"Winner tier landed: {winner_tier}")
    page.screenshot(path=os.path.join(output_dir, "aura_stage_settled.png"))
    print("Captured settled aura screenshot.")

    browser.close()
    print("ALL AURA VERIFICATIONS PASSED SUCCESSFULLY!")
