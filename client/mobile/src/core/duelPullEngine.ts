import { clamp } from './math';

const DECAY = 0.82;
const PULL_SCALE = 0.4;
const HORIZONTAL_GRAVITY_Z_MIN = 4.8;
const HORIZONTAL_GRAVITY_Z_MAX = 9.8;
const PULL_TRIGGER_THRESHOLD = 0.45;
const PULL_BEAT_MS = 450;
const PULL_BEAT_TOLERANCE_MS = 280;
const PULL_FIRST_HIT_QUALITY = 0.8;
const PULL_PULSE_MS = 300;

export type OutputForce = {
  value: number;
  accuracy: number;
  acceptedPull: boolean;
  earlyPull: boolean;
  invalidPull: boolean;
  timingQuality: number;
};

/**
 * 모바일 줄다리기: devicemotion 기반 pull 추정 + deviceorientation 기반 자세 정확도 + 리듬 판정.
 * React/DOM과 무관하게 동일 입력에 동일 출력을 내야 한다.
 */
export class DuelPullEngine {
  private pullForce = 0;
  private horizontalConfidence = 0;
  private currentBeta = 0;
  private currentGamma = 0;
  private baselineBeta = 0;
  private baselineGamma = 0;
  private lastPullAxis = 0;
  private lastPullBeatAt = 0;
  private pullPulseUntil = 0;
  private pullOverThreshold = false;

  onMotion(event: DeviceMotionEvent): void {
    const linear = event.acceleration;
    const gravity = event.accelerationIncludingGravity;
    if (!gravity || gravity.z === null) return;

    const gravityZ = Math.abs(gravity.z);
    const horizontalConfidence = clamp(
      (gravityZ - HORIZONTAL_GRAVITY_Z_MIN) / (HORIZONTAL_GRAVITY_Z_MAX - HORIZONTAL_GRAVITY_Z_MIN),
      0,
      1
    );
    this.horizontalConfidence = horizontalConfidence;

    const pullAxis = Number(linear?.y ?? gravity?.y ?? 0);
    const pullDelta = Math.abs(pullAxis - this.lastPullAxis);
    this.lastPullAxis = pullAxis;
    const axisBoost = linear?.y == null ? 0.75 : 1;
    const rawPull = clamp(pullDelta * PULL_SCALE * axisBoost * (0.8 + horizontalConfidence * 0.2), 0, 1);
    const smoothed = this.pullForce * DECAY + rawPull * (1 - DECAY);
    this.pullForce = clamp(smoothed, 0, 1);
  }

  setOrientation(beta: number, gamma: number): void {
    this.currentBeta = beta;
    this.currentGamma = gamma;
  }

  setBaseline(beta: number, gamma: number): void {
    this.baselineBeta = beta;
    this.baselineGamma = gamma;
  }

  getCurrentOrientation(): { beta: number; gamma: number } {
    return { beta: this.currentBeta, gamma: this.currentGamma };
  }

  getBaseline(): { beta: number; gamma: number } {
    return { beta: this.baselineBeta, gamma: this.baselineGamma };
  }

  reset(): void {
    this.pullForce = 0;
    this.horizontalConfidence = 0;
    this.baselineBeta = 0;
    this.baselineGamma = 0;
    this.lastPullAxis = 0;
    this.lastPullBeatAt = 0;
    this.pullPulseUntil = 0;
    this.pullOverThreshold = false;
  }

  private getTiltError(): number {
    const betaDiff = Math.abs(this.currentBeta - this.baselineBeta);
    const gammaDiff = Math.abs(this.currentGamma - this.baselineGamma);
    return Math.hypot(betaDiff, gammaDiff);
  }

  private getAccuracy(): number {
    const tiltError = this.getTiltError();
    const tiltScore = clamp(1 - tiltError / 36, 0, 1);
    return tiltScore * (0.62 + this.horizontalConfidence * 0.38);
  }

  getOutputForce(now: number): OutputForce {
    const accuracy = this.getAccuracy();
    const tiltError = this.getTiltError();
    if (tiltError > 75) {
      return {
        value: 0,
        accuracy: 0,
        acceptedPull: false,
        earlyPull: false,
        invalidPull: false,
        timingQuality: 0,
      };
    }

    const pullLevel = this.pullForce;
    const overThreshold = pullLevel >= PULL_TRIGGER_THRESHOLD;
    const risingEdge = overThreshold && !this.pullOverThreshold;
    let acceptedPull = false;
    let earlyPull = false;
    let invalidPull = false;
    let timingQuality = 0;

    if (risingEdge) {
      const lastBeat = this.lastPullBeatAt;
      const interval = lastBeat > 0 ? now - lastBeat : PULL_BEAT_MS;
      const minCooldown = 150;

      if (lastBeat > 0 && interval < minCooldown) {
        earlyPull = true;
        invalidPull = true;
        this.pullPulseUntil = 0;
      } else {
        const offset = Math.abs(interval - PULL_BEAT_MS);
        if (lastBeat === 0 || offset <= PULL_BEAT_TOLERANCE_MS) {
          acceptedPull = true;
          timingQuality =
            lastBeat === 0
              ? PULL_FIRST_HIT_QUALITY
              : clamp(1 - offset / PULL_BEAT_TOLERANCE_MS, 0.5, 1);
          this.lastPullBeatAt = now;
          this.pullPulseUntil = now + PULL_PULSE_MS;
        } else {
          earlyPull = true;
          invalidPull = true;
          this.pullPulseUntil = 0;
          this.lastPullBeatAt = now;
        }
      }
    }
    this.pullOverThreshold = overThreshold;

    const isPulseWindow = now <= this.pullPulseUntil;
    const value = isPulseWindow ? clamp(pullLevel * accuracy, 0, 1) : 0;
    return { value, accuracy, acceptedPull, earlyPull, invalidPull, timingQuality };
  }
}
