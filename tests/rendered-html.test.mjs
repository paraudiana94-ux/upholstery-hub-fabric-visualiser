import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /Selecting a photograph keeps it local until you consent/);
  assert.match(html, /UpholsteryHubLogo-Horizontal\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("catalogue route queries both live tabs and filters inactive rows", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  const requested = [];

  const fabrics = [
    '"Fabrics Catalogue",,,,,,,,,,,,,,,,,,',
    '"All initial rows are demonstration data.",,,,,,,,,,,,,,,,,,',
    '"Fabric records","Fabric records",,"Active fabrics","Active fabrics",,,,,,,,,,,,,,',
    '"12",,"11",,,,,,,,,,,,,,,,',
    '"Fabric ID","Fabric Name","Collection","Swatch Preview","Main Colour","Colour Hex","Pattern","Material","Price per Metre (€)","Fabric Width (cm)","Martindale Rating","Suitable Furniture Types","Stock Status","Supplier Lead Time (days)","Cleaning Instructions","Active","Demo Data","Last Updated","Swatch Image URL"',
    '"F001","Test Linen","Demo","","Sand","#D7C4A3","Plain","Blend","28","140","30000","Armchair","In Stock","5","Care","TRUE","TRUE","2026-08-06","https://res.cloudinary.com/example/F001.jpg"',
    '"F099","Inactive Fabric","Demo","","Grey","#666666","Plain","Blend","20","140","30000","Armchair","Out of Stock","5","Care","FALSE","TRUE","2026-08-06","https://res.cloudinary.com/example/F099.jpg"',
  ].join("\n");

  const furniture = [
    '"Furniture Pricing Assumptions",,,,,,,,,,',
    '"Demonstration quantities, labour costs and turnaround ranges.",,,,,,,,,,',
    '"Furniture Type ID","Furniture Type","Min Estimated Metres","Max Estimated Metres","Starting Labour Cost (€)","Min Turnaround Weeks","Max Turnaround Weeks","Special Considerations","Active","Demo Data","Last Updated"',
    '"FT002","Armchair","5","7","550","4","6","Inspection required","TRUE","TRUE","2026-08-06"',
  ].join("\n");

  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    return new Response(url.includes("gid=441339050") ? fabrics : furniture, {
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
    assert.ok(
      requested.some(
        (url) =>
          url.includes("/spreadsheets/d/e/2PACX-") && url.includes("gid=441339050"),
      ),
    );
    assert.ok(
      requested.some(
        (url) =>
          url.includes("/spreadsheets/d/e/2PACX-") && url.includes("gid=589043625"),
      ),
    );
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

test("preview status reports configuration without exposing the server key", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/preview/status", {
      headers: { origin: "https://paraudiana94-ux.github.io" },
    }),
    { ...runtime, OPENAI_API_KEY: "test-key-never-returned" },
    context,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.configured, true);
  assert.equal(payload.provider, "OpenAI");
  assert.equal(payload.model, "gpt-image-2");
  assert.equal(JSON.stringify(payload).includes("test-key-never-returned"), false);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://paraudiana94-ux.github.io",
  );
});

test("preview status tolerates vinext production calls without a worker env binding", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/preview/status"),
    undefined,
    context,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.configured, Boolean(process.env.OPENAI_API_KEY));
  assert.equal(payload.model, "gpt-image-2");
});

test("preview route resolves live IDs and sends the customer photo plus live Cloudinary swatch", async () => {
  const worker = await getWorker();
  const originalFetch = globalThis.fetch;
  const requested = [];

  const fabrics = [
    '"Fabric ID","Fabric Name","Collection","Main Colour","Colour Hex","Pattern","Material","Price per Metre (€)","Suitable Furniture Types","Stock Status","Active","Demo Data","Last Updated","Swatch Image URL"',
    '"F001","Test Linen","Demo","Sand","#D7C4A3","Plain","Blend","28","Armchair","In Stock","TRUE","TRUE","2026-08-06","https://res.cloudinary.com/example/F001.jpg"',
  ].join("\n");
  const furniture = [
    '"Furniture Type ID","Furniture Type","Min Estimated Metres","Max Estimated Metres","Starting Labour Cost (€)","Min Turnaround Weeks","Max Turnaround Weeks","Special Considerations","Active","Demo Data","Last Updated"',
    '"FT002","Armchair","5","7","550","4","6","Inspection required","TRUE","TRUE","2026-08-06"',
  ].join("\n");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("gid=441339050")) {
      return new Response(fabrics, { headers: { "content-type": "text/csv" } });
    }
    if (url.includes("gid=589043625")) {
      return new Response(furniture, { headers: { "content-type": "text/csv" } });
    }
    if (url === "https://res.cloudinary.com/example/F001.jpg") {
      return new Response(new Blob(["live-swatch"], { type: "image/jpeg" }), {
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (url === "https://api.openai.com/v1/images/edits") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "gpt-image-2");
      assert.equal(init.body.get("quality"), "low");
      assert.equal(init.body.getAll("image[]").length, 2);
      assert.match(String(init.body.get("prompt")), /Armchair/);
      assert.match(String(init.body.get("prompt")), /Test Linen/);
      return Response.json({ data: [{ b64_json: "dGVzdC1pbWFnZQ==" }] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const form = new FormData();
  form.append(
    "photo",
    new File(["customer-photo"], "chair.jpg", { type: "image/jpeg" }),
  );
  form.append("fabricId", "F001");
  form.append("furnitureId", "FT002");

  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/preview", {
        method: "POST",
        headers: {
          origin: "https://paraudiana94-ux.github.io",
          "x-forwarded-for": "192.0.2.10",
        },
        body: form,
      }),
      { ...runtime, OPENAI_API_KEY: "test-key" },
      context,
    );
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.imageDataUrl, "data:image/jpeg;base64,dGVzdC1pbWFnZQ==");
    assert.equal(payload.model, "gpt-image-2");
    assert.equal(requested.filter((url) => url.includes("docs.google.com")).length, 2);
    assert.ok(requested.includes("https://res.cloudinary.com/example/F001.jpg"));
    assert.ok(requested.includes("https://api.openai.com/v1/images/edits"));
    assert.equal(JSON.stringify(payload).includes("test-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preview route blocks unapproved origins before reading data", async () => {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/preview", {
      method: "POST",
      headers: { origin: "https://example.org" },
    }),
    { ...runtime, OPENAI_API_KEY: "test-key" },
    context,
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.code, "ORIGIN_NOT_ALLOWED");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("testing quota and logo reset stay aligned across server and client", async () => {
  const [previewSource, visualiserSource, readme] = await Promise.all([
    readFile(new URL("../worker/preview.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/Visualiser.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(previewSource, /RATE_LIMIT_REQUESTS = 10/);
  assert.match(previewSource, /allows 10 AI previews per hour/);
  assert.match(visualiserSource, /limits each visitor to 10 previews per hour/);
  assert.match(visualiserSource, /function resetJourneyFromLogo\(\)/);
  assert.match(visualiserSource, /key\.startsWith\("uh-"\)/);
  assert.match(visualiserSource, /window\.location\.reload\(\)/);
  assert.match(readme, /allows 10 preview attempts per source IP per hour/);
});

test("project summary is local, printable and truthfully labelled", async () => {
  const [visualiserSource, css, readme] = await Promise.all([
    readFile(new URL("../app/Visualiser.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(visualiserSource, /View &amp; save project summary/);
  assert.match(visualiserSource, /Print or save as PDF/);
  assert.match(visualiserSource, /window\.print\(\)/);
  assert.match(visualiserSource, /maxLength=\{600\}/);
  assert.match(visualiserSource, /has not been emailed or submitted/);
  assert.match(css, /@media print/);
  assert.match(css, /size: A4 portrait/);
  assert.match(css, /\.summary-controls[\s\S]*display: none !important/);
  assert.match(readme, /native print dialog to print or save a polished PDF summary/);
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
