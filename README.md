# Upholstery Hub Fabric Visualiser

A focused prototype that helps a customer choose a live upholstery fabric, review a deterministic indicative estimate and prepare for professional advice.

- Source repository: <https://github.com/paraudiana94-ux/upholstery-hub-fabric-visualiser>
- GitHub Pages: <https://paraudiana94-ux.github.io/upholstery-hub-fabric-visualiser/>

## Current implementation status

- The approved guided journey, local photograph preview, live-data states, deterministic pricing and responsive brand system are implemented.
- The application reads the published `Fabrics` and `FurniturePricing` CSV exports at run time. GitHub Pages reads them directly in the browser; server-capable deployments expose the same validated data through `/api/catalogue`.
- Fabric images are rendered only from each current `Swatch Image URL` value returned by Google Sheets.
- No catalogue or pricing rows are embedded in the application.
- The two supplied published exports are publicly readable demonstration data and permit browser access from GitHub Pages.
- The importer locates the actual field-heading row beneath the Sheet's descriptive rows, validates the contract and exposes a truthful error without fallback rows if either source is malformed or unavailable.
- AI preview generation and quote submission remain visibly unconnected because no provider, photograph policy or verified quotation route has been approved.

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

The tests cover server rendering, both published live-tab requests, descriptive-row handling, inactive-row filtering, Cloudinary URL preservation, visible failure without substituted rows and the approved Armchair pricing examples.

## Live data contract

Spreadsheet ID: `1urDlqANR-WFYwAoEFVd0xi0YnXUwi8HFOoiUzUiMW3w`

Published tabs:

- `Fabrics`: `gid=441339050`
- `FurniturePricing`: `gid=589043625`

The application requests both published CSV outputs at run time with client caching disabled. It locates and validates the field headings, validates numeric pricing fields, filters to `Active = TRUE`, preserves `Demo Data` and returns stable IDs. A failed or restricted server request returns HTTP 503 and no fallback data; GitHub Pages shows the same explicit unavailable state.

Publishing makes the two demonstration tabs public to anyone with their export URLs. Never add a key, token, service-account file or copied row data to this repository.

## Privacy and security

- Customer photographs are validated and previewed with a local object URL.
- No photograph is uploaded, stored, logged or written to Google Sheets.
- Only stable product IDs and quantity are stored in browser session storage.
- The prototype contains no API keys, tokens or credentials.
- AI and quotation actions remain blocked until their business and privacy requirements are approved.

## Main files

- `app/Visualiser.tsx`: customer journey and local state
- `app/globals.css`: responsive visual system and accessibility states
- `lib/pricing.ts`: deterministic estimate function
- `lib/catalogue.ts`: published Sheet endpoints, CSV validation and catalogue mapping shared by browser and server
- `worker/index.ts`: live Google Sheets reader and failure contract
- `tests/rendered-html.test.mjs`: reproducible build and behaviour checks
- `.openai/hosting.json`: Sites hosting declaration
- `github-pages/index.html` and `github-pages/main.tsx`: GitHub Pages client entry
- `vite.pages.config.ts`: static Pages build configuration
- `.github/workflows/deploy-pages.yml`: GitHub Pages deployment workflow
