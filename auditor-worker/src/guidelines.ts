import type { Env } from "./types";

const CACHE_KEY = "guidelines:latest";
const CACHE_TTL_SECONDS = 3600; // 1 hour

const MESSAGING_FILES = [
  "terminology.md",
  "tone.md",
  "positioning.md",
  "narrative.md",
  "value-story.md",
  "boilerplates.md",
  "ui-micro-copy.md",
];

interface GitHubContentResponse {
  content: string; // base64-encoded
  encoding: string;
  sha: string;
}

/**
 * Fetch a single file from the GitHub API, returning its decoded text content.
 * Uses the GitHub Contents API (not raw.githubusercontent.com).
 */
async function fetchFile(
  filename: string,
  token?: string,
): Promise<string> {
  const url = `https://api.github.com/repos/cruciate-hub/marketing-team/contents/messaging/${filename}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "lighthouse-auditor-worker",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error for ${filename}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as GitHubContentResponse;

  // GitHub returns base64-encoded content — decode properly for UTF-8
  const raw = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  return decoded;
}

/**
 * Fetch all messaging guideline files and return them concatenated with headers.
 * Results are cached in KV for 1 hour.
 */
export async function getGuidelines(env: Env): Promise<{ text: string; version: string }> {
  // Check KV cache first
  const cached = await env.CACHE.get(CACHE_KEY, "json") as { text: string; version: string } | null;
  if (cached) {
    return cached;
  }

  // Fetch all files in parallel
  const results = await Promise.all(
    MESSAGING_FILES.map(async (filename) => {
      const content = await fetchFile(filename, env.GITHUB_TOKEN);
      return { filename, content };
    }),
  );

  // Concatenate with clear section headers
  const text = results
    .map(({ filename, content }) => {
      const label = filename.replace(".md", "").replace(/-/g, " ").toUpperCase();
      return `\n## ${label}\n(Source: messaging/${filename})\n\n${content}`;
    })
    .join("\n\n---\n");

  const version = new Date().toISOString();
  const result = { text, version };

  // Cache in KV
  await env.CACHE.put(CACHE_KEY, JSON.stringify(result), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return result;
}

/**
 * Fetch site-content.json for social.plus URL extraction.
 * Cached in KV for 1 hour.
 */
export async function getSiteContent(env: Env): Promise<Record<string, any> | null> {
  const cacheKey = "site-content:latest";

  const cached = await env.CACHE.get(cacheKey, "json") as Record<string, any> | null;
  if (cached) {
    return cached;
  }

  const url = "https://api.github.com/repos/cruciate-hub/marketing-team/contents/website/site-content.json";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "lighthouse-auditor-worker",
  };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`Failed to fetch site-content.json: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as GitHubContentResponse;
  const raw = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(decoded);

  await env.CACHE.put(cacheKey, JSON.stringify(parsed), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return parsed;
}
