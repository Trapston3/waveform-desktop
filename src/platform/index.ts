import type { PlatformBridge } from './PlatformBridge';
import { createElectronPlatformBridge, hasLiveElectronHost } from './electronBridge';

export type { PlatformBridge, PlatformFetchResult, PlatformMonitorInfo } from './PlatformBridge';
export { createElectronPlatformBridge };

const defaultBridge = createElectronPlatformBridge();
let testBridgeOverride: PlatformBridge | null = null;
let testMockOverride: Partial<PlatformBridge> | null = null;

export function getPlatformBridge(): PlatformBridge {
  return testBridgeOverride ?? defaultBridge;
}

export function hasPlatformBridge(capability?: keyof PlatformBridge): boolean {
  if (testMockOverride) {
    if (!capability || capability === 'isDesktop' || capability === 'platform') return true;
    return typeof (testMockOverride as any)[capability] === 'function';
  }
  return hasLiveElectronHost(capability);
}

export function setPlatformBridgeForTests(mock: Partial<PlatformBridge> | null): void {
  if (!mock) {
    testBridgeOverride = null;
    testMockOverride = null;
    return;
  }
  testMockOverride = mock;
  testBridgeOverride = {
    ...defaultBridge,
    isDesktop: true,
    ...mock,
  };
}
