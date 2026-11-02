import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * A tiny local feed fetcher, built into Haven's own dev/preview server.
 *
 * Browsers won't let a web page read most news feeds (Google News, Bing News, publishers'
 * RSS) directly. The page asks this endpoint instead — GET /api/feed?url=… — and it fetches
 * the feed from your machine and hands back the XML.
 *
 * Guard rails: only http(s), never local/private network addresses, only feed-like responses
 * (XML/RSS/Atom) up to 5 MB, and a custom header that cross-site pages can't send, so other
 * websites you visit can't use it.
 */

const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;
const MAX_BYTES = 5 * 1024 * 1024;

async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
  if (!req.url?.startsWith("/api/feed")) return next();
  const fail = (code: number, message: string) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
  };
  if (req.method !== "GET") return fail(405, "Only GET is allowed.");
  if (req.headers["x-haven"] !== "1") return fail(403, "Missing header.");

  let target: URL;
  try {
    target = new URL(new URL(req.url, "http://haven.local").searchParams.get("url") ?? "");
  } catch {
    return fail(400, "That isn't a valid address.");
  }
  if (!/^https?:$/.test(target.protocol) || PRIVATE_HOST.test(target.hostname)) return fail(400, "Only public web addresses can be fetched.");

  try {
    const upstream = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Haven feed reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const type = upstream.headers.get("content-type") ?? "";
    const text = await upstream.text();
    if (!upstream.ok) return fail(502, `The source answered ${upstream.status}.`);
    if (text.length > MAX_BYTES) return fail(413, "That feed is too large.");
    const looksLikeFeed = /xml|rss|atom/i.test(type) || /^\s*(<\?xml|<rss|<feed)/i.test(text);
    if (!looksLikeFeed) return fail(415, "That address isn't a news feed.");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch (e) {
    fail(504, e instanceof Error && e.name === "TimeoutError" ? "The source took too long to answer." : "The source couldn't be reached.");
  }
}

export function feedProxy(): Plugin {
  return {
    name: "haven-feed-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
