import { fetchPublishedCatalogue } from "../lib/catalogue";

export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_FURNITURE_CHECK_MODEL = "gpt-5.6-luna";

const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 12 * 1024 * 1024;
const MAX_SWATCH_BYTES = 10 * 1024 * 1024;
const FURNITURE_MISMATCH_CONFIDENCE = 0.72;
const RATE_LIMIT_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

interface PreviewEnv {
  OPENAI_API_KEY?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string }>;
  error?: { code?: string };
}

interface OpenAITextResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { code?: string };
}

interface FurniturePhotoCheck {
  status: "match" | "mismatch" | "uncertain";
  detectedFurnitureType: string;
  confidence: number;
}

class FurnitureCheckFailure extends Error {
  status: number;
  apiCode: string;

  constructor(status: number, apiCode = "") {
    super("The furniture photo check failed.");
    this.status = status;
    this.apiCode = apiCode;
  }
}

const rateLimits = new Map<string, RateLimitEntry>();

function getApiKey(env?: PreviewEnv): string {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return (
    env?.OPENAI_API_KEY?.trim() ||
    runtime.process?.env?.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function isAllowedOrigin(origin: string): boolean {
  if (
    origin === "https://paraudiana94-ux.github.io" ||
    origin === "https://upholstery-hub-fabric-visualiser.onrender.com"
  ) {
    return true;
  }

  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  return {
    ...(origin && isAllowedOrigin(origin)
      ? { "access-control-allow-origin": origin }
      : {}),
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      ...extraHeaders,
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("cf-connecting-ip")?.trim() || forwarded || "unknown";
}

function checkRateLimit(request: Request): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const key = clientKey(request);
  const current = rateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT_REQUESTS) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function isCloudinarySwatch(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

async function fetchLiveSwatch(url: string): Promise<Blob> {
  if (!isCloudinarySwatch(url)) {
    throw new Error("INVALID_SWATCH_SOURCE");
  }

  const response = await fetch(url, {
    headers: { accept: "image/jpeg,image/png,image/webp" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? "0");

  if (
    !response.ok ||
    !allowedImageTypes.has(contentType) ||
    (Number.isFinite(contentLength) && contentLength > MAX_SWATCH_BYTES)
  ) {
    throw new Error("LIVE_SWATCH_UNAVAILABLE");
  }

  const swatch = await response.blob();
  if (swatch.size === 0 || swatch.size > MAX_SWATCH_BYTES) {
    throw new Error("LIVE_SWATCH_UNAVAILABLE");
  }
  return swatch;
}

function previewPrompt(furnitureName: string, fabricName: string): string {
  return [
    "Create one photorealistic, indicative upholstery visualisation.",
    `Image 1 is the customer's ${furnitureName} photograph. Preserve the same furniture, viewpoint, room, proportions, structure, legs, cushions, lighting and background.`,
    `Image 2 is the selected ${fabricName} fabric swatch. Change only the upholstered surfaces of the furniture in Image 1 to use the colour, material texture and pattern from Image 2 at a plausible upholstery scale.`,
    "Preserve seams, piping, folds and shadows. Do not add or remove furniture, people, text, logos, watermarks or decor.",
    "The result is an indicative screen preview, not a guarantee of colour, texture, pattern scale or finished workmanship.",
  ].join(" ");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function responseOutputText(payload: OpenAITextResponse): string {
  if (payload.output_text?.trim()) {
    return payload.output_text.trim();
  }
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text ?? "")
    .join("")
    .trim();
}

async function safetyIdentifier(request: Request): Promise<string> {
  const input = new TextEncoder().encode(`upholstery-hub:${clientKey(request)}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `uh_${Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function checkFurniturePhoto(
  request: Request,
  apiKey: string,
  photo: File,
  selectedFurnitureType: string,
  availableFurnitureTypes: string[],
): Promise<FurniturePhotoCheck> {
  const classificationValues = Array.from(
    new Set([...availableFurnitureTypes, "Other", "Unclear"]),
  );
  const imageDataUrl = `data:${photo.type};base64,${arrayBufferToBase64(await photo.arrayBuffer())}`;
  const prompt = [
    "Classify the dominant furniture item in this customer photograph.",
    `Choose exactly one value from this live catalogue list: ${availableFurnitureTypes.join(", ")}; or choose Other or Unclear.`,
    `The customer's current selection is ${selectedFurnitureType}. Classify from the photograph itself; do not copy or favour the selection.`,
    "Distinguish visually similar seating by its complete form and intended use. In particular, an upholstered lounge armchair is not a dining chair.",
    "Use Unclear when the furniture is obscured, several different items dominate, no furniture is visible, or the type cannot be determined reliably.",
  ].join(" ");

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_FURNITURE_CHECK_MODEL,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 160,
        safety_identifier: await safetyIdentifier(request),
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: prompt },
              { type: "input_image", image_url: imageDataUrl, detail: "low" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "furniture_photo_check",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                detectedFurnitureType: {
                  type: "string",
                  enum: classificationValues,
                },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["detectedFurnitureType", "confidence"],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new FurnitureCheckFailure(504);
  }

  let payload: OpenAITextResponse;
  try {
    payload = (await response.json()) as OpenAITextResponse;
  } catch {
    throw new FurnitureCheckFailure(response.status || 502);
  }
  if (!response.ok) {
    throw new FurnitureCheckFailure(response.status, payload.error?.code);
  }

  let parsed: { detectedFurnitureType?: unknown; confidence?: unknown };
  try {
    parsed = JSON.parse(responseOutputText(payload)) as {
      detectedFurnitureType?: unknown;
      confidence?: unknown;
    };
  } catch {
    throw new FurnitureCheckFailure(502);
  }

  if (
    typeof parsed.detectedFurnitureType !== "string" ||
    !classificationValues.includes(parsed.detectedFurnitureType) ||
    typeof parsed.confidence !== "number" ||
    !Number.isFinite(parsed.confidence)
  ) {
    throw new FurnitureCheckFailure(502);
  }

  const confidence = Math.max(0, Math.min(1, parsed.confidence));
  const detectedFurnitureType = parsed.detectedFurnitureType;
  const status =
    detectedFurnitureType === selectedFurnitureType
      ? "match"
      : detectedFurnitureType === "Unclear" || confidence < FURNITURE_MISMATCH_CONFIDENCE
        ? "uncertain"
        : "mismatch";

  return { status, detectedFurnitureType, confidence };
}

function furnitureCheckErrorResponse(
  request: Request,
  error: FurnitureCheckFailure,
): Response {
  if (error.status === 401 || error.status === 403) {
    return json(
      request,
      {
        code: "AI_NOT_CONFIGURED",
        message: "The secure AI service is not configured correctly on Render.",
      },
      503,
    );
  }
  if (error.status === 429) {
    return json(
      request,
      {
        code: "AI_TEMPORARILY_UNAVAILABLE",
        message: "The furniture photo check is busy or has reached its usage limit. Please try again later.",
      },
      503,
    );
  }
  return json(
    request,
    {
      code: error.status === 504 ? "FURNITURE_CHECK_TIMEOUT" : "FURNITURE_CHECK_UNAVAILABLE",
      message:
        "We could not verify the furniture type in this photo. Please try again or continue without an AI preview.",
    },
    error.status === 504 ? 504 : 502,
  );
}

function openAIErrorResponse(
  request: Request,
  status: number,
  errorCode = "",
): Response {
  if (errorCode === "moderation_blocked") {
    return json(
      request,
      {
        code: "PREVIEW_BLOCKED",
        message:
          "The preview could not be created from this photograph. Try a clear furniture-only image without people or personal details.",
      },
      400,
    );
  }

  if (status === 401 || status === 403) {
    return json(
      request,
      {
        code: "AI_NOT_CONFIGURED",
        message: "The secure AI service is not configured correctly on Render.",
      },
      503,
    );
  }

  if (status === 429) {
    return json(
      request,
      {
        code: "AI_TEMPORARILY_UNAVAILABLE",
        message:
          "The AI preview service is busy or has reached its usage limit. Please try again later.",
      },
      503,
    );
  }

  return json(
    request,
    {
      code: "AI_PREVIEW_FAILED",
      message: "The AI preview could not be created. Your estimate is still available.",
    },
    502,
  );
}

export function getPreviewStatus(request: Request, env?: PreviewEnv): Response {
  return json(request, {
    configured: Boolean(getApiKey(env)),
    provider: "OpenAI",
    model: OPENAI_IMAGE_MODEL,
    furnitureCheckModel: OPENAI_FURNITURE_CHECK_MODEL,
  });
}

export function getPreviewOptions(request: Request): Response {
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    return json(
      request,
      { code: "ORIGIN_NOT_ALLOWED", message: "This site is not allowed to use the preview service." },
      403,
    );
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function createPreview(request: Request, env?: PreviewEnv): Promise<Response> {
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    return json(
      request,
      { code: "ORIGIN_NOT_ALLOWED", message: "This site is not allowed to use the preview service." },
      403,
    );
  }

  const apiKey = getApiKey(env);
  if (!apiKey) {
    return json(
      request,
      { code: "AI_NOT_CONFIGURED", message: "The secure AI service is not configured on Render." },
      503,
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return json(
      request,
      { code: "PHOTO_TOO_LARGE", message: "Choose a furniture photo smaller than 10 MB." },
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json(
      request,
      { code: "INVALID_REQUEST", message: "The preview request could not be read." },
      400,
    );
  }

  const photo = formData.get("photo");
  const fabricId = String(formData.get("fabricId") ?? "").trim();
  const furnitureId = String(formData.get("furnitureId") ?? "").trim();
  const allowMismatch = String(formData.get("allowMismatch") ?? "") === "true";

  if (!(photo instanceof File) || !fabricId || !furnitureId) {
    return json(
      request,
      { code: "INVALID_REQUEST", message: "A photo, furniture type and fabric are required." },
      400,
    );
  }
  if (!allowedImageTypes.has(photo.type)) {
    return json(
      request,
      { code: "INVALID_PHOTO_TYPE", message: "Choose a JPEG, PNG or WebP furniture photo." },
      415,
    );
  }
  if (photo.size === 0 || photo.size > MAX_PHOTO_BYTES) {
    return json(
      request,
      { code: "PHOTO_TOO_LARGE", message: "Choose a furniture photo smaller than 10 MB." },
      413,
    );
  }

  let catalogue;
  try {
    catalogue = await fetchPublishedCatalogue();
  } catch {
    return json(
      request,
      {
        code: "LIVE_DATA_UNAVAILABLE",
        message: "The live catalogue is unavailable, so the selected swatch cannot be verified.",
      },
      503,
    );
  }

  const fabric = catalogue.fabrics.find((item) => item.id === fabricId);
  const furniture = catalogue.furniture.find((item) => item.id === furnitureId);
  if (!fabric || !furniture) {
    return json(
      request,
      {
        code: "LIVE_SELECTION_UNAVAILABLE",
        message: "That furniture or fabric is no longer active. Refresh the live catalogue and choose again.",
      },
      409,
    );
  }

  const limit = checkRateLimit(request);
  if (!limit.allowed) {
    return json(
      request,
      {
        code: "PREVIEW_RATE_LIMITED",
        message: "This prototype allows 10 AI previews per hour. Please try again later.",
      },
      429,
      { "retry-after": String(limit.retryAfter) },
    );
  }

  let photoCheck: FurniturePhotoCheck | null = null;
  if (!allowMismatch) {
    try {
      photoCheck = await checkFurniturePhoto(
        request,
        apiKey,
        photo,
        furniture.name,
        catalogue.furniture.map((item) => item.name),
      );
    } catch (error) {
      if (error instanceof FurnitureCheckFailure) {
        return furnitureCheckErrorResponse(request, error);
      }
      return furnitureCheckErrorResponse(request, new FurnitureCheckFailure(502));
    }

    if (photoCheck.status === "mismatch") {
      const detectedLabel =
        photoCheck.detectedFurnitureType === "Other"
          ? "a different furniture type"
          : `“${photoCheck.detectedFurnitureType}”`;
      return json(
        request,
        {
          code: "FURNITURE_MISMATCH",
          message: `The photo appears to show ${detectedLabel}, but “${furniture.name}” is selected.`,
          detectedFurnitureType: photoCheck.detectedFurnitureType,
          selectedFurnitureType: furniture.name,
        },
        409,
      );
    }
    if (photoCheck.status === "uncertain") {
      return json(
        request,
        {
          code: "FURNITURE_UNCLEAR",
          message:
            "We could not confidently identify the furniture type in this photo, so the selection has not been verified.",
          detectedFurnitureType: photoCheck.detectedFurnitureType,
          selectedFurnitureType: furniture.name,
        },
        409,
      );
    }
  }

  let swatch: Blob;
  try {
    swatch = await fetchLiveSwatch(fabric.swatchImageUrl);
  } catch {
    return json(
      request,
      {
        code: "LIVE_SWATCH_UNAVAILABLE",
        message: "The current Cloudinary swatch image is unavailable. Choose another fabric or try again.",
      },
      503,
    );
  }

  const openAIForm = new FormData();
  openAIForm.append("model", OPENAI_IMAGE_MODEL);
  openAIForm.append("image[]", photo, photo.name || "furniture-photo");
  openAIForm.append("image[]", swatch, `${fabric.id}-live-swatch`);
  openAIForm.append("prompt", previewPrompt(furniture.name, fabric.name));
  openAIForm.append("quality", "low");
  openAIForm.append("size", "1024x1024");
  openAIForm.append("output_format", "jpeg");
  openAIForm.append("output_compression", "82");

  let openAIResponse: Response;
  try {
    openAIResponse = await fetch(OPENAI_IMAGE_EDIT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: openAIForm,
      signal: AbortSignal.timeout(125_000),
    });
  } catch {
    return json(
      request,
      {
        code: "AI_PREVIEW_TIMEOUT",
        message: "The AI preview took too long. Please try again; your selections remain available.",
      },
      504,
    );
  }

  let payload: OpenAIImageResponse;
  try {
    payload = (await openAIResponse.json()) as OpenAIImageResponse;
  } catch {
    return openAIErrorResponse(request, openAIResponse.status);
  }

  if (!openAIResponse.ok) {
    return openAIErrorResponse(request, openAIResponse.status, payload.error?.code);
  }

  const imageBase64 = payload.data?.[0]?.b64_json;
  if (!imageBase64) {
    return openAIErrorResponse(request, 502);
  }

  return json(request, {
    imageDataUrl: `data:image/jpeg;base64,${imageBase64}`,
    model: OPENAI_IMAGE_MODEL,
    furniturePhotoCheck: photoCheck?.status ?? "overridden",
    generatedAt: new Date().toISOString(),
    disclaimer:
      "AI-generated indicative preview. Confirm colour, texture and pattern scale with a physical swatch and professional inspection.",
  });
}
