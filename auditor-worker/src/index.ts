import type { Env, AnalyzeRequest, ExtractRequest } from "./types";
import { analyzeContent } from "./analyzer";
import { extractContent } from "./extractor";

const MAX_CONTENT_LENGTH = 50_000; // Characters — matches extractor limit

// Block SSRF: private/reserved IP ranges and metadata endpoints
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^\[::1\]/,
  /^metadata\.google/i,
];

function isBlockedUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    return BLOCKED_HOSTS.some((re) => re.test(parsed.hostname));
  } catch {
    return true;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(new Response(null, { status: 204 }), env);
    }

    const url = new URL(request.url);

    try {
      if (request.method === "POST" && url.pathname === "/analyze") {
        return corsResponse(await handleAnalyze(request, env), env);
      }

      if (request.method === "POST" && url.pathname === "/extract") {
        return corsResponse(await handleExtract(request, env), env);
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return corsResponse(
          jsonResponse({ status: "ok", timestamp: new Date().toISOString() }),
          env,
        );
      }

      return corsResponse(
        jsonResponse({ error: "Not found" }, 404),
        env,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Worker error:", message);
      return corsResponse(
        jsonResponse({ error: "Internal server error" }, 500),
        env,
      );
    }
  },
} satisfies ExportedHandler<Env>;

// ─── Route Handlers ─────────────────────────────────────────────

async function handleAnalyze(request: Request, env: Env): Promise<Response> {
  let body: Partial<AnalyzeRequest>;
  try {
    body = (await request.json()) as Partial<AnalyzeRequest>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.content || typeof body.content !== "string") {
    return jsonResponse({ error: "Missing or invalid 'content' field" }, 400);
  }

  if (body.content.length > MAX_CONTENT_LENGTH) {
    return jsonResponse(
      { error: `Content too long (${body.content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.` },
      400,
    );
  }

  if (!body.mode) {
    body.mode = "full";
  }

  if (!body.contentType) {
    body.contentType = "Webpage";
  }

  const analyzeRequest: AnalyzeRequest = {
    content: body.content,
    contentType: body.contentType,
    sourceUrl: body.sourceUrl ?? null,
    mode: body.mode,
    persona: body.persona ?? null,
  };

  const result = await analyzeContent(analyzeRequest, env);
  return jsonResponse(result);
}

async function handleExtract(request: Request, env: Env): Promise<Response> {
  let body: Partial<ExtractRequest>;
  try {
    body = (await request.json()) as Partial<ExtractRequest>;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.url || typeof body.url !== "string") {
    return jsonResponse({ error: "Missing or invalid 'url' field" }, 400);
  }

  // Basic URL validation
  try {
    new URL(body.url);
  } catch {
    return jsonResponse({ error: "Invalid URL format" }, 400);
  }

  // SSRF protection — block private/internal URLs
  if (isBlockedUrl(body.url)) {
    return jsonResponse({ error: "URL not allowed" }, 400);
  }

  const result = await extractContent(body.url, env);
  return jsonResponse(result);
}

// ─── Helpers ────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function corsResponse(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);

  // Restrict to GitHub Pages origin. Never fall back to wildcard in production.
  const allowedOrigin = env.ALLOWED_ORIGIN || "https://cruciate-hub.github.io";
  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
