# Upholstery Hub Fabric Visualiser

A focused prototype that helps a customer choose a live upholstery fabric, review a deterministic indicative estimate and prepare for professional advice.

- Source repository: <https://github.com/paraudiana94-ux/upholstery-hub-fabric-visualiser>
- GitHub Pages: <https://paraudiana94-ux.github.io/upholstery-hub-fabric-visualiser/>
- Secure AI service: <https://upholstery-hub-fabric-visualiser.onrender.com>

## Current implementation status

- The approved guided journey, local photograph preview, live-data states, deterministic pricing and responsive brand system are implemented.
- The application reads the published `Fabrics` and `FurniturePricing` CSV exports at run time. GitHub Pages reads them directly in the browser; server-capable deployments expose the same validated data through `/api/catalogue`.
- Fabric images are rendered only from each current `Swatch Image URL` value returned by Google Sheets.
- No catalogue or pricing rows are embedded in the application.
- The two supplied published exports are publicly readable demonstration data and permit browser access from GitHub Pages.
- The importer locates the actual field-heading row beneath the Sheet's descriptive rows, validates the contract and exposes a truthful error without fallback rows if either source is malformed or unavailable.
- An optional, consent-gated AI preview sends the customer photo and the selected live Cloudinary swatch to a server-only Render route, which calls OpenAI's Image Edits API with `gpt-image-2`.
- Quote submission remains visibly unconnected because no verified quotation route has been supplied.

## Run locally

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Verify

```bash
npm test
npm run lint
npm run build:pages
```

The tests cover server rendering, both published live-tab requests, descriptive-row handling, inactive-row filtering, Cloudinary URL preservation, visible failure without substituted rows, the approved Armchair pricing examples, CORS protection, secret non-disclosure and the live-ID-to-image-edit contract.

## Live data contract

Spreadsheet ID: `1urDlqANR-WFYwAoEFVd0xi0YnXUwi8HFOoiUzUiMW3w`

Published tabs:

- `Fabrics`: `gid=441339050`
- `FurniturePricing`: `gid=589043625`

The application requests both published CSV outputs at run time with client caching disabled. It locates and validates the field headings, validates numeric pricing fields, filters to `Active = TRUE`, preserves `Demo Data` and returns stable IDs. A failed or restricted server request returns HTTP 503 and no fallback data; GitHub Pages shows the same explicit unavailable state.

Publishing makes the two demonstration tabs public to anyone with their export URLs. Never add a key, token, service-account file or copied row data to this repository.

## Privacy and security

- Customer photographs are validated and previewed with a local object URL.
- Selecting a photograph does not upload it. Only pressing **Create indicative preview** after accepting the consent statement sends it to the Render service and OpenAI.
- The application does not write customer photographs to disk, application storage, logs or Google Sheets. The generated image remains in browser memory and is lost on refresh.
- OpenAI states that API data is not used for training unless the account opts in. Default abuse-monitoring logs may retain API content for up to 30 days; rare content-safety review exceptions can apply.
- Only stable product IDs and quantity are stored in browser session storage.
- `OPENAI_API_KEY` is read only by the Render server route. It must never be added to GitHub, a client-side environment variable or browser code.
- The public prototype allows 10 preview attempts per source IP per hour using an in-memory limiter to support supervised testing. Render restarts reset this prototype limiter, so set a strict OpenAI project budget and add durable abuse protection before a wider launch.

## Render configuration

Set `OPENAI_API_KEY` as a secret environment variable in the Render Web Service. The key is intentionally absent from this repository and from the GitHub Pages bundle.

Routes:

- `GET /api/preview/status`: reports only whether a key is configured, plus the provider and model; it never returns the key.
- `POST /api/preview`: accepts the consented customer photo plus stable live furniture and fabric IDs, re-reads Google Sheets, fetches only the current Cloudinary swatch URL, then makes the server-side OpenAI request.

The route accepts requests from the published GitHub Pages origin, the Render origin and local development origins. CORS is a browser boundary rather than full abuse protection.

## Main files

- `app/Visualiser.tsx`: customer journey and local state
- `app/globals.css`: responsive visual system and accessibility states
- `lib/pricing.ts`: deterministic estimate function
- `lib/catalogue.ts`: published Sheet endpoints, CSV validation and catalogue mapping shared by browser and server
- `worker/index.ts`: live Google Sheets reader and failure contract
- `worker/preview.ts`: consented Render/OpenAI image-edit boundary, CORS, validation and prototype rate limit
- `tests/rendered-html.test.mjs`: reproducible build and behaviour checks
- `.openai/hosting.json`: Sites hosting declaration
- `github-pages/index.html` and `github-pages/main.tsx`: GitHub Pages client entry
- `vite.pages.config.ts`: static Pages build configuration
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment workflow
