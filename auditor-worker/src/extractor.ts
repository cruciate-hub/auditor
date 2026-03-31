import type { Env, ExtractResponse } from "./types";
import { getSiteContent } from "./guidelines";

const MAX_CONTENT_LENGTH = 50_000;

/**
 * Extract text content from a URL.
 *
 * Strategy:
 * 1. For social.plus URLs → look up in site-content.json (fastest, most accurate)
 * 2. For external URLs → use Jina Reader API for clean markdown extraction
 * 3. Fallback → direct fetch + HTML stripping
 */
export async function extractContent(
  url: string,
  env: Env,
): Promise<ExtractResponse> {
  // Normalize the URL
  const parsed = new URL(url);

  // ─── social.plus shortcut: use cached site-content.json ────────
  if (
    parsed.hostname === "social.plus" ||
    parsed.hostname === "www.social.plus"
  ) {
    const siteContent = await getSiteContent(env);
    if (siteContent?.pages) {
      const path = parsed.pathname === "" ? "/" : parsed.pathname;
      const page = (siteContent.pages as Array<{ url: string; metaTitle: string; content: string }>)
        .find((p) => p.url === path || p.url === path.replace(/\/$/, ""));

      if (page && page.content) {
        return {
          content: page.content.slice(0, MAX_CONTENT_LENGTH),
          title: page.metaTitle || "",
          url,
        };
      }
    }
    // Page not found in snapshot — fall through to Jina
  }

  // ─── Jina Reader API for external URLs ─────────────────────────
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain",
        "User-Agent": "lighthouse-auditor-worker",
      },
    });

    if (jinaRes.ok) {
      const text = await jinaRes.text();
      // Jina returns markdown. Extract a title from the first heading.
      const titleMatch = text.match(/^#\s+(.+)$/m);
      return {
        content: text.slice(0, MAX_CONTENT_LENGTH),
        title: titleMatch?.[1] ?? parsed.hostname,
        url,
      };
    }
  } catch {
    // Jina failed — fall through to manual extraction
  }

  // ─── Fallback: direct fetch + HTML stripping ───────────────────
  const res = await fetch(url, {
    headers: { "User-Agent": "lighthouse-auditor-worker" },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const text = stripHtml(html);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    content: text.slice(0, MAX_CONTENT_LENGTH),
    title: titleMatch?.[1]?.trim() ?? parsed.hostname,
    url,
  };
}

/**
 * Rough HTML-to-text conversion. Strips scripts, styles, nav, footer,
 * and remaining tags. Normalizes whitespace.
 */
function stripHtml(html: string): string {
  let text = html;

  // Remove script, style, nav, footer, header elements and their contents
  text = text.replace(/<(script|style|nav|footer|header|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}
