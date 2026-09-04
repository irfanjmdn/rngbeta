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

    time.sleep(0.5)
    page.screenshot(path=os.path.join(output_dir, "frameless_reel_idle.png"))

    # Roll to show cards and winner reveal
    page.click("#btnAutoSkip")
    page.click("#btnBigRoll")
    time.sleep(1.4)

    page.screenshot(path=os.path.join(output_dir, "frameless_reel_settled.png"))
    browser.close()
