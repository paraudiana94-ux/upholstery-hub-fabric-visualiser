import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { fetchPublishedCatalogue, SHEET_URL } from "../lib/catalogue";
import {
  createPreview,
  getPreviewOptions,
  getPreviewStatus,
} from "./preview";

interface Env {
  ASSETS: Fetcher;
  OPENAI_API_KEY?: string;
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

async function getCatalogueResponse(): Promise<Response> {
  try {
    const catalogue = await fetchPublishedCatalogue();
    return Response.json(
      catalogue,
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

    if (url.pathname === "/api/preview/status") {
      if (request.method === "OPTIONS") {
        return getPreviewOptions(request);
      }
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, OPTIONS" },
        });
      }
      return getPreviewStatus(request, env);
    }

    if (url.pathname === "/api/preview") {
      if (request.method === "OPTIONS") {
        return getPreviewOptions(request);
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "POST, OPTIONS" },
        });
      }
      return createPreview(request, env);
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
