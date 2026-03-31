const HAPTIC_COOLDOWN_MS = 70;

export function createPullHapticController() {
  let lastHapticAt = 0;

  return function triggerPullHaptic({
    timingQuality = 0,
    fever = false,
    strong = false,
  }: {
    timingQuality?: number;
    fever?: boolean;
    strong?: boolean;
  } = {}): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (!strong && timingQuality < 0.66) return;
    const now = Date.now();
    if (now - lastHapticAt < HAPTIC_COOLDOWN_MS) return;
    lastHapticAt = now;

    if (strong || timingQuality > 0.85) {
      navigator.vibrate(fever ? [22, 16, 28] : [16, 12, 22]);
      return;
    }
    if (timingQuality >= 0.66) {
      navigator.vibrate(fever ? [18, 10, 18] : [12, 8, 12]);
    }
  };
}
