import assert from "node:assert/strict";
import test from "node:test";
import { calculateIndicativeEstimate } from "../lib/pricing.ts";

const templateRoot = new URL("../", import.meta.url);

async function getWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const runtime = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("server-renders the finished Upholstery Hub product shell", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    runtime,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Fabric Visualiser \| Upholstery Hub<\/title>/i);
  assert.match(html, /See a possible new look for your furniture/);
  assert.match(html, /Prototype demonstration/);
  assert.match(html, /Selecting a photograph does not send it anywhere/);
  assert.match(html, /UpholsteryHubLogo-Horizontal\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("catalogue route queries both live tabs and filters inactive rows", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  const requested = [];

  const fabrics = [
    '"Fabric ID","Fabric Name","Collection","Swatch Preview","Main Colour","Colour Hex","Pattern","Material","Price per Metre (€)","Fabric Width (cm)","Martindale Rating","Suitable Furniture Types","Stock Status","Supplier Lead Time (days)","Cleaning Instructions","Active","Demo Data","Last Updated","Swatch Image URL"',
    '"F001","Test Linen","Demo","","Sand","#D7C4A3","Plain","Blend","28","140","30000","Armchair","In Stock","5","Care","TRUE","TRUE","2026-08-06","https://res.cloudinary.com/example/F001.jpg"',
    '"F099","Inactive Fabric","Demo","","Grey","#666666","Plain","Blend","20","140","30000","Armchair","Out of Stock","5","Care","FALSE","TRUE","2026-08-06","https://res.cloudinary.com/example/F099.jpg"',
  ].join("\n");

  const furniture = [
    '"Furniture Type ID","Furniture Type","Min Estimated Metres","Max Estimated Metres","Starting Labour Cost (€)","Min Turnaround Weeks","Max Turnaround Weeks","Special Considerations","Active","Demo Data","Last Updated"',
    '"FT002","Armchair","5","7","550","4","6","Inspection required","TRUE","TRUE","2026-08-06"',
  ].join("\n");

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    return new Response(url.includes("sheet=Fabrics") ? fabrics : furniture, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8" },
    });
  };

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/catalogue"),
      runtime,
      context,
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requested.length, 2);
    assert.ok(requested.some((url) => url.includes("sheet=Fabrics")));
    assert.ok(requested.some((url) => url.includes("sheet=FurniturePricing")));
    assert.equal(payload.fabrics.length, 1);
    assert.equal(payload.fabrics[0].id, "F001");
    assert.equal(payload.fabrics[0].swatchImageUrl, "https://res.cloudinary.com/example/F001.jpg");
    assert.equal(payload.furniture[0].id, "FT002");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalogue route exposes failure and never substitutes rows", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://accounts.google.com/ServiceLogin" },
    });

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/catalogue"),
      runtime,
      context,
    );
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.code, "LIVE_DATA_UNAVAILABLE");
    assert.match(payload.message, /No stored prices have been substituted/);
    assert.equal("fabrics" in payload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deterministic Armchair pricing matches the approved reversible test", () => {
  assert.deepEqual(
    calculateIndicativeEstimate({
      quantity: 1,
      labourCost: 550,
      pricePerMetre: 28,
      minMetres: 5,
      maxMetres: 7,
    }),
    { low: 690, high: 746 },
  );

  assert.deepEqual(
    calculateIndicativeEstimate({
      quantity: 1,
      labourCost: 600,
      pricePerMetre: 28,
      minMetres: 5,
      maxMetres: 7,
    }),
    { low: 740, high: 796 },
  );

  assert.equal(
    calculateIndicativeEstimate({
      quantity: 1,
      labourCost: 550,
      pricePerMetre: Number.NaN,
      minMetres: 5,
      maxMetres: 7,
    }),
    null,
  );
});

test("starter preview directory is removed", async () => {
  await assert.rejects(
    import("node:fs/promises").then(({ access }) =>
      access(new URL("app/_sites-preview", templateRoot)),
    ),
  );
});
