export {};

declare global {
  type SensorPermissionState = 'granted' | 'denied';

  interface DeviceMotionEventConstructor {
    requestPermission?: () => Promise<SensorPermissionState>;
  }

  interface DeviceOrientationEventConstructor {
    requestPermission?: () => Promise<SensorPermissionState>;
  }
}

