import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SPREADSHEET_ID = "1urDlqANR-WFYwAoEFVd0xi0YnXUwi8HFOoiUzUiMW3w";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

type CsvRecord = Record<string, string>;

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function csvToRecords(csv: string): CsvRecord[] {
  const [headers, ...rows] = parseCsv(csv);
  if (!headers || headers.length === 0) {
    throw new Error("The live Sheet returned no column headings.");
  }

  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""])),
  );
}

function requireHeaders(records: CsvRecord[], required: string[], sheetName: string) {
  const first = records[0];
  if (!first) {
    throw new Error(`${sheetName} contains no current rows.`);
  }

  const missing = required.filter((header) => !(header in first));
  if (missing.length > 0) {
    throw new Error(`${sheetName} is missing required columns: ${missing.join(", ")}.`);
  }
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function parseRequiredNumber(value: string, field: string, id: string): number {
  const cleaned = value.replace(/[€,]/g, "").trim();
  const number = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(number)) {
    throw new Error(`${id} has an invalid ${field} value.`);
  }
  return number;
}

async function fetchSheetCsv(sheet: string, range: string): Promise<string> {
  const query = new URLSearchParams({
    tqx: "out:csv",
    sheet,
    range,
  });
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?${query}`,
    {
      headers: { accept: "text/csv" },
      redirect: "manual",
      cache: "no-store",
    },
  );

  const contentType = response.headers.get("content-type") ?? "";
  if (response.status >= 300 && response.status < 400) {
    throw new Error("The live Sheet requires Google sign-in or public read access.");
  }
  if (!response.ok || !contentType.toLowerCase().includes("csv")) {
    throw new Error(`The live ${sheet} tab could not be read.`);
  }

  return response.text();
}

async function getCatalogueResponse(): Promise<Response> {
  try {
    const [fabricCsv, furnitureCsv] = await Promise.all([
      fetchSheetCsv("Fabrics", "A6:T1000"),
      fetchSheetCsv("FurniturePricing", "A6:K1000"),
    ]);
    const fabricRecords = csvToRecords(fabricCsv);
    const furnitureRecords = csvToRecords(furnitureCsv);

    requireHeaders(
      fabricRecords,
      [
        "Fabric ID",
        "Fabric Name",
        "Main Colour",
        "Colour Hex",
        "Pattern",
        "Material",
        "Price per Metre (€)",
        "Suitable Furniture Types",
        "Stock Status",
        "Active",
        "Demo Data",
        "Last Updated",
        "Swatch Image URL",
      ],
      "Fabrics",
    );
    requireHeaders(
      furnitureRecords,
      [
        "Furniture Type ID",
        "Furniture Type",
        "Min Estimated Metres",
        "Max Estimated Metres",
        "Starting Labour Cost (€)",
        "Min Turnaround Weeks",
        "Max Turnaround Weeks",
        "Special Considerations",
        "Active",
        "Demo Data",
        "Last Updated",
      ],
      "FurniturePricing",
    );

    const fabrics = fabricRecords
      .filter((record) => parseBoolean(record.Active))
      .map((record) => ({
        id: record["Fabric ID"],
        name: record["Fabric Name"],
        collection: record.Collection,
        mainColour: record["Main Colour"],
        colourHex: record["Colour Hex"],
        pattern: record.Pattern,
        material: record.Material,
        pricePerMetre: parseRequiredNumber(
          record["Price per Metre (€)"],
          "Price per Metre",
          record["Fabric ID"],
        ),
        suitableFurnitureTypes: record["Suitable Furniture Types"],
        stockStatus: record["Stock Status"],
        active: true,
        demoData: parseBoolean(record["Demo Data"]),
        lastUpdated: record["Last Updated"],
        swatchImageUrl: record["Swatch Image URL"],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));

    const furniture = furnitureRecords
      .filter((record) => parseBoolean(record.Active))
      .map((record) => ({
        id: record["Furniture Type ID"],
        name: record["Furniture Type"],
        minMetres: parseRequiredNumber(
          record["Min Estimated Metres"],
          "minimum metres",
          record["Furniture Type ID"],
        ),
        maxMetres: parseRequiredNumber(
          record["Max Estimated Metres"],
          "maximum metres",
          record["Furniture Type ID"],
        ),
        labourCost: parseRequiredNumber(
          record["Starting Labour Cost (€)"],
          "starting labour cost",
          record["Furniture Type ID"],
        ),
        minTurnaroundWeeks: parseRequiredNumber(
          record["Min Turnaround Weeks"],
          "minimum turnaround",
          record["Furniture Type ID"],
        ),
        maxTurnaroundWeeks: parseRequiredNumber(
          record["Max Turnaround Weeks"],
          "maximum turnaround",
          record["Furniture Type ID"],
        ),
        specialConsiderations: record["Special Considerations"],
        active: true,
        demoData: parseBoolean(record["Demo Data"]),
        lastUpdated: record["Last Updated"],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));

    if (fabrics.length === 0 || furniture.length === 0) {
      throw new Error("The live Sheet has no active catalogue or pricing rows.");
    }

    return Response.json(
      {
        source: "Google Sheets",
        sourceUrl: SHEET_URL,
        spreadsheetId: SPREADSHEET_ID,
        fetchedAt: new Date().toISOString(),
        fabrics,
        furniture,
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown live-data error.";
    return Response.json(
      {
        code: "LIVE_DATA_UNAVAILABLE",
        message:
          "The live catalogue is unavailable. Try again or continue to professional advice. No stored prices have been substituted.",
        detail,
        sourceUrl: SHEET_URL,
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/catalogue") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return getCatalogueResponse();
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
