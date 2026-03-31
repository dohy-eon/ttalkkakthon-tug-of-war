/** 브라우저가 DeviceMotion/Orientation API를 노출하는지 (권한과 무관) */
export function getSensorApisAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'DeviceMotionEvent' in window && 'DeviceOrientationEvent' in window;
}

export function shouldAskSensorPermission(): boolean {
  const motionNeedsAsk =
    typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as any).requestPermission === 'function';
  const orientationNeedsAsk =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as any).requestPermission === 'function';
  return motionNeedsAsk || orientationNeedsAsk;
}

export async function requestSensorPermissions(): Promise<{ ok: boolean; motion: SensorPermissionState; orientation: SensorPermissionState }> {
  const askMotion: Promise<SensorPermissionState> =
    typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as any).requestPermission === 'function'
      ? (DeviceMotionEvent as any).requestPermission()
      : Promise.resolve('granted');

  const askOrientation: Promise<SensorPermissionState> =
    typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as any).requestPermission === 'function'
      ? (DeviceOrientationEvent as any).requestPermission()
      : Promise.resolve('granted');

  const [motion, orientation] = await Promise.all([askMotion, askOrientation]);
  const ok = motion === 'granted' && orientation === 'granted';
  return { ok, motion, orientation };
}
