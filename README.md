# Upholstery Hub Fabric Visualiser

A focused prototype that helps a customer choose a live upholstery fabric, review a deterministic indicative estimate and prepare for professional advice.

## Current implementation status

- The approved guided journey, local photograph preview, live-data states, deterministic pricing and responsive brand system are implemented.
- The application reads `Fabrics` and `FurniturePricing` at run time through its `/api/catalogue` server endpoint.
- Fabric images are rendered only from each current `Swatch Image URL` value returned by Google Sheets.
- No catalogue or pricing rows are embedded in the application.
- The current Sheet requires Google sign-in. The public prototype therefore shows a truthful unavailable state until the data owner grants public read access or supplies an authorised secure server integration.
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
```

The tests cover server rendering, both live tab requests, inactive-row filtering, Cloudinary URL preservation, visible failure without substituted rows and the approved Armchair pricing examples.

## Live data contract

Spreadsheet ID: `1urDlqANR-WFYwAoEFVd0xi0YnXUwi8HFOoiUzUiMW3w`

Required tabs:

- `Fabrics`, starting at the field header in row 6
- `FurniturePricing`, starting at the field header in row 6

The server requests fresh CSV output from both tabs with caching disabled. It validates required headers and numeric pricing fields, filters to `Active = TRUE`, preserves `Demo Data` and returns stable IDs to the client. A failed or restricted request returns HTTP 503 and no fallback data.

For a public demonstration, the data owner must make the Sheet readable without Google sign-in or approve a secure server-side credential integration. Never add a key, token, service-account file or copied row data to this repository.

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
- `worker/index.ts`: live Google Sheets reader and failure contract
- `tests/rendered-html.test.mjs`: reproducible build and behaviour checks
- `.openai/hosting.json`: Sites hosting declaration

