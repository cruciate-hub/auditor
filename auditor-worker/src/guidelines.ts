import type { Env } from "./types";

const CACHE_KEY = "guidelines:v2";
const CACHE_TTL_SECONDS = 3600; // 1 hour

/**
 * All knowledge files from the marketing-team repo, organized by section.
 * The Content Checker has access to EVERYTHING.
 */
const KNOWLEDGE_BASE: Array<{ section: string; path: string; files: string[] }> = [
  {
    section: "BRAND BRAIN",
    path: "",
    files: ["brain.md"],
  },
  {
    section: "MESSAGING",
    path: "messaging",
    files: [
      "brain.md",
      "terminology.md",
      "tone.md",
      "positioning.md",
      "narrative.md",
      "value-story.md",
      "boilerplates.md",
      "ui-micro-copy.md",
    ],
  },
  {
    section: "DESIGN SYSTEM",
    path: "design-system",
    files: [
      "brain.md",
      "colors-palette.md",
      "colors-usage.md",
      "typography.md",
      "buttons.md",
      "inputs.md",
      "layout.md",
      "spacing.md",
      "border-radius.md",
      "shadows.md",
      "iconography.md",
      "imagery.md",
      "logo.md",
      "accessibility.md",
      "social-posts.md",
    ],
  },
  {
    section: "EMAIL GUIDELINES",
    path: "emails",
    files: [
      "emails.md",
      "product-update-newsletter-spec.md",
      "product-update-newsletter-structure.md",
      "product-update-newsletter-blocks.md",
      "product-update-newsletter-assembly.md",
    ],
  },
];

interface GitHubContentResponse {
  content: string; // base64-encoded
  encoding: string;
  sha: string;
}

const REPO_BASE = "https://api.github.com/repos/cruciate-hub/marketing-team/contents";

/**
 * Fetch a single file from the GitHub API, returning its decoded text content.
 */
async function fetchFile(
  filePath: string,
  token?: string,
): Promise<string> {
  const url = `${REPO_BASE}/${filePath}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "content-checker-worker",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error for ${filePath}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as GitHubContentResponse;

  // GitHub returns base64-encoded content — decode properly for UTF-8
  const raw = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const decoded = new TextDecoder().decode(bytes);
  return decoded;
}

/**
 * Fetch all knowledge base files and return them concatenated with section headers.
 * Results are cached in KV for 1 hour.
 */
export async function getGuidelines(env: Env): Promise<{ text: string; version: string }> {
  // Check KV cache first
  const cached = await env.CACHE.get(CACHE_KEY, "json") as { text: string; version: string } | null;
  if (cached) {
    return cached;
  }

  // Build list of all fetches
  const fetchList: Array<{ section: string; filePath: string; label: string }> = [];
  for (const group of KNOWLEDGE_BASE) {
    for (const file of group.files) {
      const filePath = group.path ? `${group.path}/${file}` : file;
      const label = file.replace(".md", "").replace(/-/g, " ");
      fetchList.push({ section: group.section, filePath, label });
    }
  }

  // Fetch all files in parallel
  const results = await Promise.all(
    fetchList.map(async ({ section, filePath, label }) => {
      try {
        const content = await fetchFile(filePath, env.GITHUB_TOKEN);
        return { section, filePath, label, content };
      } catch (err) {
        console.error(`Failed to fetch ${filePath}:`, err);
        return { section, filePath, label, content: null };
      }
    }),
  );

  // Group by section and concatenate
  const sections = new Map<string, string[]>();
  for (const { section, filePath, label, content } of results) {
    if (!content) continue;
    if (!sections.has(section)) {
      sections.set(section, []);
    }
    sections.get(section)!.push(
      `### ${label.toUpperCase()}\n(Source: ${filePath})\n\n${content}`,
    );
  }

  const text = Array.from(sections.entries())
    .map(([section, parts]) => `\n# ${section}\n\n${parts.join("\n\n---\n\n")}`)
    .join("\n\n═══════════════════════════════════════\n");

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

  try {
    const decoded = await fetchFile("website/site-content.json", env.GITHUB_TOKEN);
    const parsed = JSON.parse(decoded);

    await env.CACHE.put(cacheKey, JSON.stringify(parsed), {
      expirationTtl: CACHE_TTL_SECONDS,
    });

    return parsed;
  } catch (err) {
    console.error("Failed to fetch site-content.json:", err);
    return null;
  }
}
