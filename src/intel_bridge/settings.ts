import { isDesktopRuntime } from '@/services/runtime';

const OBSERVATION_BRIDGE_KEY = 'wm:observation-bridge-enabled';

export function getObservationBridgeEnabled(): boolean {
  const stored = localStorage.getItem(OBSERVATION_BRIDGE_KEY);
  if (stored === '1') return true;
  if (stored === '0') return false;
  return isDesktopRuntime();
}

export function setObservationBridgeEnabled(enabled: boolean): void {
  localStorage.setItem(OBSERVATION_BRIDGE_KEY, enabled ? '1' : '0');
}
