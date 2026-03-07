import { getApiBaseUrl, getRemoteApiBaseUrl, isDesktopRuntime } from '@/services/runtime';

export function getIntelEngineBaseUrl(): string {
  const configured = import.meta.env.VITE_INTEL_ENGINE_BASE_URL;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.replace(/\/$/, '');
  }

  if (isDesktopRuntime()) {
    return getApiBaseUrl().replace(/\/$/, '');
  }

  // In local web dev (`vite` on :5173), `/api/*` may resolve to index.html if no API proxy is active.
  // Prefer configured remote API host so Intel calls hit real backend JSON routes.
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (isLocalHost) {
      const remoteBase = getRemoteApiBaseUrl();
      if (remoteBase) return remoteBase.replace(/\/$/, '');
      // Last-resort local-web fallback: use production API host instead of hitting Vite HTML fallback on /api/*.
      return 'https://worldmonitor.app';
    }
  }

  return '';
}
