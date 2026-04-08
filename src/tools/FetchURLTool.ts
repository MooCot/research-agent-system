/**
 * FETCH URL TOOL
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches a web page and extracts clean text content.
 * Strips HTML tags, collapses whitespace, enforces length limits.
 *
 * Layer: Infrastructure
 *
 * Environment variables:
 *   FETCH_TIMEOUT_MS      — request timeout, default 10000
 *   FETCH_MAX_CONTENT_LEN — max chars of extracted text, default 6000
 */

import axios, { type AxiosError } from "axios";
import type { ToolResult, FetchToolOutput } from "./types.js";
import { logger } from "../observability/logger.js";

const DEFAULT_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? "10000", 10);
const DEFAULT_MAX_CONTENT = parseInt(process.env.FETCH_MAX_CONTENT_LEN ?? "6000", 10);

// Only follow these content types — skip binary / media
const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml"];

export class FetchURLTool {
  private readonly timeoutMs: number;
  private readonly maxContentLen: number;

  constructor(opts?: { timeoutMs?: number; maxContentLen?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxContentLen = opts?.maxContentLen ?? DEFAULT_MAX_CONTENT;
  }

  async fetch(url: string): Promise<ToolResult<FetchToolOutput>> {
    const startMs = Date.now();

    if (!this.isValidUrl(url)) {
      return {
        ok: false,
        error: `Invalid URL: ${url}`,
        durationMs: Date.now() - startMs,
      };
    }

    try {
      const response = await axios.get<string>(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ResearchAgentBot/1.0; +https://example.com/bot)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
        timeout: this.timeoutMs,
        responseType: "text",
        maxContentLength: 2 * 1024 * 1024, // 2 MB raw cap
      });

      const contentType = (response.headers["content-type"] as string) ?? "";
      if (!ALLOWED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
        return {
          ok: false,
          error: `Unsupported content type: ${contentType}`,
          durationMs: Date.now() - startMs,
        };
      }

      const html = response.data;
      const title = this.extractTitle(html);
      const content = this.extractText(html, this.maxContentLen);

      logger.debug("FetchURLTool", {
        url,
        title,
        contentLength: content.length,
      });

      return {
        ok: true,
        data: { url, title, content, contentLength: content.length },
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const message = this.extractErrorMessage(err);
      logger.error("FetchURLTool failed", { url, error: message });
      return { ok: false, error: message, durationMs: Date.now() - startMs };
    }
  }

  // ─── HTML extraction helpers ─────────────────────────────────────────────

  private extractTitle(html: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return match ? this.decodeEntities(match[1].trim()) : "Untitled";
  }

  private extractText(html: string, maxLen: number): string {
    // 1. Remove script / style / head blocks
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ");

    // 2. Block elements → newlines
    text = text
      .replace(/<\/?(p|div|h[1-6]|li|tr|br)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ");

    // 3. Decode common HTML entities
    text = this.decodeEntities(text);

    // 4. Collapse whitespace
    text = text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 30) // drop nav/boilerplate fragments
      .join("\n");

    return text.slice(0, maxLen);
  }

  private decodeEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }

  private extractErrorMessage(err: unknown): string {
    const axiosErr = err as AxiosError;
    if (axiosErr.code === "ECONNABORTED") return "Request timed out";
    if (axiosErr.response) return `HTTP ${axiosErr.response.status}`;
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
