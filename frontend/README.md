# CFO Command Centre — Frontend

Next.js (App Router, TypeScript) frontend for the South NSW Conference CFO
Command Centre. Renders nine dashboard views (Overview, Operating position,
Department budgets, Decision copilot, Staffing scenario, Field & pastoral,
Entity statements, Cash position, Data sources) behind a mock auth gate,
faithful to the approved design (Poppins, #FAFAF8/#F5F4EF palette, hand-rolled
inline SVG charts, no chart libraries).

## Running

```bash
npm install
npm run dev     # http://localhost:3000
npm run build && npm run start   # production
```

`/api/*` and `/health` are rewritten (see `next.config.ts`) to the Express
backend in `../backend` (default `http://localhost:4000`; override with
`API_PROXY_TARGET`).

## Data wiring

Every view fetches its payload via `src/lib/api.ts#apiGet(path, fallback)`
per the frontend/backend contract (`/api/command-centre/*`, plus the existing
`/api/cash/*` routes). On any error, non-2xx or ~3s timeout the view renders a
pixel-identical fallback from `src/lib/designData.ts`, so a dead backend still
shows the design figures.

## Layout

- `src/app` — root layout (local Poppins via `next/font/local`), global CSS,
  single page mounting the client `Shell`.
- `src/components/Shell.tsx` — sidebar nav, header, range picker, auth gate.
- `src/components/views/*` — the nine views.
- `src/lib` — API client, design constants/fallbacks, formatters (`fmtF`,
  `fmtC`, `color`, `tint`, `FONT`).
