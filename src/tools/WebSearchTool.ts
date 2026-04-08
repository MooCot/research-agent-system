/**
 * WEB SEARCH TOOL
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls the Brave Search API (or falls back to a mock for dev / test).
 * All responses are validated and normalised before returning.
 *
 * Layer: Infrastructure
 *
 * Environment variables:
 *   BRAVE_SEARCH_API_KEY  — Brave Search API key (required in production)
 *   SEARCH_TIMEOUT_MS     — request timeout, default 8000
 *   SEARCH_MAX_RESULTS    — max results per query, default 5
 */

import axios, { type AxiosError } from "axios";
import type { ToolResult, SearchResult, SearchToolOutput } from "./types.js";
import { logger } from "../observability/logger.js";

const BRAVE_API_BASE = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_TIMEOUT_MS = parseInt(process.env.SEARCH_TIMEOUT_MS ?? "8000", 10);
const DEFAULT_MAX_RESULTS = parseInt(process.env.SEARCH_MAX_RESULTS ?? "5", 10);

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

export class WebSearchTool {
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly maxResults: number;

  constructor(opts?: { timeoutMs?: number; maxResults?: number }) {
    this.apiKey = process.env.BRAVE_SEARCH_API_KEY;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;

    if (!this.apiKey) {
      logger.warn(
        "BRAVE_SEARCH_API_KEY not set — WebSearchTool will return mock results"
      );
    }
  }

  async search(query: string): Promise<ToolResult<SearchToolOutput>> {
    const startMs = Date.now();

    try {
      const results = this.apiKey
        ? await this.callBraveApi(query)
        : this.mockResults(query);

      const output: SearchToolOutput = {
        query,
        results: results.slice(0, this.maxResults),
        totalResults: results.length,
      };

      logger.debug("WebSearchTool", { query, resultCount: output.totalResults });

      return { ok: true, data: output, durationMs: Date.now() - startMs };
    } catch (err) {
      const message = this.extractErrorMessage(err);
      logger.error("WebSearchTool failed", { query, error: message });
      return { ok: false, error: message, durationMs: Date.now() - startMs };
    }
  }

  private async callBraveApi(query: string): Promise<SearchResult[]> {
    const response = await axios.get<BraveSearchResponse>(BRAVE_API_BASE, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": this.apiKey!,
      },
      params: { q: query, count: this.maxResults },
      timeout: this.timeoutMs,
    });

    const rawResults = response.data.web?.results ?? [];
    return rawResults.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  }

  private mockResults(query: string): SearchResult[] {
    // Deterministic mock — enables full dev/test without API keys.
    return [
      {
        title: `[MOCK] Overview of "${query}"`,
        url: `https://example.com/overview-${encodeURIComponent(query)}`,
        snippet: `This article provides a comprehensive overview of ${query}, including key concepts, history, and current developments.`,
      },
      {
        title: `[MOCK] Deep dive: ${query} — analysis`,
        url: `https://research.example.com/${encodeURIComponent(query)}-analysis`,
        snippet: `An in-depth analysis examining multiple dimensions of ${query} with data-driven insights and expert commentary.`,
      },
      {
        title: `[MOCK] ${query}: latest news and updates`,
        url: `https://news.example.com/${encodeURIComponent(query)}`,
        snippet: `Stay updated with the latest developments, breakthroughs, and news related to ${query}.`,
      },
    ];
  }

  private extractErrorMessage(err: unknown): string {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      return `HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`;
    }
    if (axiosErr.code === "ECONNABORTED") return "Request timed out";
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
