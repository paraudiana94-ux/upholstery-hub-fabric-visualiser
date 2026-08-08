export const SPREADSHEET_ID = "1urDlqANR-WFYwAoEFVd0xi0YnXUwi8HFOoiUzUiMW3w";
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;

export const PUBLISHED_FABRICS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQBiGwXrq5y_ostP4gL8Lwvc6JggfPuKNNrS23rvfi8FNvqVV9XHm8CHoYHQtuUP52HtYnkECTlmOCU/pub?gid=441339050&single=true&output=csv";
export const PUBLISHED_FURNITURE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQBiGwXrq5y_ostP4gL8Lwvc6JggfPuKNNrS23rvfi8FNvqVV9XHm8CHoYHQtuUP52HtYnkECTlmOCU/pub?gid=589043625&single=true&output=csv";

export interface Fabric {
  id: string;
  name: string;
  collection: string;
  mainColour: string;
  colourHex: string;
  pattern: string;
  material: string;
  pricePerMetre: number;
  suitableFurnitureTypes: string;
  stockStatus: string;
  active: boolean;
  demoData: boolean;
  lastUpdated: string;
  swatchImageUrl: string;
}

export interface FurnitureType {
  id: string;
  name: string;
  minMetres: number;
  maxMetres: number;
  labourCost: number;
  minTurnaroundWeeks: number;
  maxTurnaroundWeeks: number;
  specialConsiderations: string;
  active: boolean;
  demoData: boolean;
  lastUpdated: string;
}

export interface CataloguePayload {
  source: "Google Sheets";
  sourceUrl: string;
  spreadsheetId: string;
  fetchedAt: string;
  fabrics: Fabric[];
  furniture: FurnitureType[];
}

type CsvRecord = Record<string, string>;

const fabricHeaders = [
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
];

const furnitureHeaders = [
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
];

export function parseCsv(input: string): string[][] {
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

function csvToRecords(csv: string, firstHeader: string, sheetName: string): CsvRecord[] {
  const rows = parseCsv(csv).map((row) =>
    row.map((value) => value.replace(/^\uFEFF/, "").trim()),
  );
  const headerIndex = rows.findIndex((row) => row[0] === firstHeader);
  if (headerIndex === -1) {
    throw new Error(`${sheetName} returned no ${firstHeader} heading.`);
  }

  const headers = rows[headerIndex];
  const records = rows
    .slice(headerIndex + 1)
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );

  if (records.length === 0) {
    throw new Error(`${sheetName} contains no current rows.`);
  }

  return records;
}

function requireHeaders(records: CsvRecord[], required: string[], sheetName: string) {
  const first = records[0];
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

function parseRequiredText(value: string, field: string, rowLabel: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new Error(`${rowLabel} has a missing ${field} value.`);
  }
  return cleaned;
}

function liveCloudinarySwatchUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function parseCatalogueCsv(
  fabricCsv: string,
  furnitureCsv: string,
): Pick<CataloguePayload, "fabrics" | "furniture"> {
  const fabricRecords = csvToRecords(fabricCsv, "Fabric ID", "Fabrics");
  const furnitureRecords = csvToRecords(
    furnitureCsv,
    "Furniture Type ID",
    "FurniturePricing",
  );

  requireHeaders(fabricRecords, fabricHeaders, "Fabrics");
  requireHeaders(furnitureRecords, furnitureHeaders, "FurniturePricing");

  const fabrics = fabricRecords
    .filter((record) => parseBoolean(record.Active))
    .map((record, index) => ({
      id: parseRequiredText(record["Fabric ID"], "Fabric ID", `Fabric row ${index + 1}`),
      name: parseRequiredText(record["Fabric Name"], "Fabric Name", record["Fabric ID"] || `Fabric row ${index + 1}`),
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
      stockStatus: parseRequiredText(record["Stock Status"], "Stock Status", record["Fabric ID"]),
      active: true,
      demoData: parseBoolean(record["Demo Data"]),
      lastUpdated: record["Last Updated"],
      swatchImageUrl: liveCloudinarySwatchUrl(record["Swatch Image URL"]),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));

  const furniture = furnitureRecords
    .filter((record) => parseBoolean(record.Active))
    .map((record, index) => ({
      id: parseRequiredText(record["Furniture Type ID"], "Furniture Type ID", `Furniture row ${index + 1}`),
      name: parseRequiredText(record["Furniture Type"], "Furniture Type", record["Furniture Type ID"] || `Furniture row ${index + 1}`),
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

  return { fabrics, furniture };
}

async function fetchPublishedCsv(url: string, sheetName: string): Promise<string> {
  const liveUrl = new URL(url);
  liveUrl.searchParams.set("refresh", Date.now().toString());
  const response = await fetch(liveUrl, {
    headers: { accept: "text/csv" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok || !contentType.includes("csv")) {
    throw new Error(`The published ${sheetName} tab could not be read.`);
  }
  return response.text();
}

export async function fetchPublishedCatalogue(): Promise<CataloguePayload> {
  const [fabricCsv, furnitureCsv] = await Promise.all([
    fetchPublishedCsv(PUBLISHED_FABRICS_CSV_URL, "Fabrics"),
    fetchPublishedCsv(PUBLISHED_FURNITURE_CSV_URL, "FurniturePricing"),
  ]);
  const { fabrics, furniture } = parseCatalogueCsv(fabricCsv, furnitureCsv);

  return {
    source: "Google Sheets",
    sourceUrl: SHEET_URL,
    spreadsheetId: SPREADSHEET_ID,
    fetchedAt: new Date().toISOString(),
    fabrics,
    furniture,
  };
}
