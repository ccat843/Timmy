import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

export function getIntelEngineBaseUrl(): string {
  const configured = import.meta.env.VITE_INTEL_ENGINE_BASE_URL;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.replace(/\/$/, '');
  }

  if (isDesktopRuntime()) {
    return getApiBaseUrl().replace(/\/$/, '');
  }

  return '';
}
