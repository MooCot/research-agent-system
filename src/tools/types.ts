/**
 * TOOL LAYER — shared types
 * Layer: Infrastructure
 */

export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchToolOutput {
  query: string;
  results: SearchResult[];
  totalResults: number;
}

export interface FetchToolOutput {
  url: string;
  title: string;
  content: string;       // cleaned text, no HTML
  contentLength: number;
}
