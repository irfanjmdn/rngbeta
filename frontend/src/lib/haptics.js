import { WebHaptics } from 'web-haptics';

let hapticsInstance = null;
let lastHapticTimes = {};

function getHaptics() {
  if (typeof window === 'undefined') return null;
  if (!hapticsInstance) {
    try {
      hapticsInstance = new WebHaptics();
    } catch (e) {
      hapticsInstance = null;
    }
  }
  return hapticsInstance;
}

export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
}

/**
 * Trigger haptic vibration on mobile devices only.
 * Supported types: 'selection', 'light', 'medium', 'heavy', 'success', 'warning', 'error'.
 */
export function triggerHaptic(type = 'selection') {
  if (!isMobileDevice()) return;
  const instance = getHaptics();
  if (!instance) return;
  try {
    instance.trigger(type);
  } catch (e) {}
}

/**
 * Trigger throttled haptic vibration to prevent vibration motor overlap during fast animations.
 */
export function triggerThrottledHaptic(type = 'selection', minIntervalMs = 35) {
  if (!isMobileDevice()) return;
  const now = performance.now();
  const lastTime = lastHapticTimes[type] || 0;
  if (now - lastTime < minIntervalMs) return;
  lastHapticTimes[type] = now;

  triggerHaptic(type);
}
