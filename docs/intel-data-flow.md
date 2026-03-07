# Intel Engine Data Flow (World Monitor backend-first)

This document maps the complete ingestion path for Intel records and explains why HTML responses appear when testing Intel endpoints from local web dev.

## 1) Where source data enters the system

World Monitor source handlers live in backend modules under:

- `server/worldmonitor/*/v1/handler.ts`

Current handler domains:

- aviation
- climate
- conflict
- cyber
- displacement
- economic
- giving
- infrastructure
- intelligence
- maritime
- market
- military
- natural
- news
- positive-events
- prediction
- research
- seismology
- supply-chain
- trade
- unrest
- wildfire

These are backend JSON sources (not UI-scraped data).

## 2) How handlers are exposed as API routes

Each domain is exposed through Vercel-style route modules under:

- `api/<domain>/v1/[rpc].ts`

The shared gateway (`server/gateway.ts`) executes matched RPC handlers and returns JSON responses.

## 3) Correct hook for record ingestion

Intel ingestion should hook at the gateway response layer (server-side), not frontend panels.

Current hook:

1. Request hits `/api/<domain>/v1/<rpc>`.
2. `createDomainGateway(...)` executes the handler.
3. On successful JSON `GET` response, gateway clones payload.
4. Gateway asynchronously calls `ingestRecordsFromApiPayload(pathname, payload)`.

This happens in:

- `server/gateway.ts`

Path filter for capture:

- capture all `/api/*` except `/api/intel/records/*`.

## 4) Why you can get HTML instead of JSON

When running frontend dev server on `localhost:5173` (`vite`), requests to `/api/intel/*` may be handled by frontend fallback (index HTML) if no backend API runtime/proxy is serving those routes in that session.

That produces responses starting with:

- `<!DOCTYPE html>`

and causes JSON parse failures unless guarded.

## 5) How Intel client now avoids wrong endpoint selection

Intel base URL resolution (`src/config/intel-engine.ts`) now prefers backend hosts in local web dev:

1. `VITE_INTEL_ENGINE_BASE_URL` if provided.
2. Desktop local API base when in desktop runtime.
3. On `localhost/127.0.0.1` web dev:
   - `getRemoteApiBaseUrl()` if configured.
   - fallback to `https://worldmonitor.app` to avoid Vite HTML `/api/*` fallback.
4. Otherwise same-origin (`''`).

This keeps Intel queries pointed at backend JSON source modules rather than frontend HTML.

## 6) Practical validation checks

- `curl -i http://localhost:5173/api/intel/health`
- `curl -i http://localhost:5173/api/intel/records/search?limit=5`

If body starts with `<html` or `<!DOCTYPE`, endpoint is not routed to backend JSON.
