/**
 * RESEARCH MEMORY
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight in-process memory that persists across iterations within a
 * single agent run. Prevents duplicate searches and tracks answered questions.
 *
 * Layer: Domain / Service
 *
 * Rules enforced:
 *  - No search query is issued twice (case-normalised + trimmed).
 *  - No URL is fetched twice.
 *  - Sub-question IDs are marked answered once evidence is found.
 *  - All state is immutable from outside; mutations go through typed methods.
 */

import crypto from "crypto";
import type { EvidencePiece } from "../contracts/index.js";

export interface MemorySnapshot {
  queriedSearches: string[];
  fetchedUrls: string[];
  answeredSubQuestionIds: string[];
  storedSources: EvidencePiece[];
  iterationsCompleted: number;
}

export class ResearchMemory {
  private readonly queriedSearches = new Set<string>();
  private readonly fetchedUrls = new Set<string>();
  private readonly answeredSubQuestionIds = new Set<string>();
  private readonly storedSources = new Map<string, EvidencePiece>();
  private iterationsCompleted = 0;

  // ─── Query deduplication ────────────────────────────────────────────────

  hasSearchedQuery(query: string): boolean {
    return this.queriedSearches.has(this.normalise(query));
  }

  markSearchQueried(query: string): void {
    this.queriedSearches.add(this.normalise(query));
  }

  // ─── URL deduplication ──────────────────────────────────────────────────

  hasFetchedUrl(url: string): boolean {
    return this.fetchedUrls.has(url);
  }

  markUrlFetched(url: string): void {
    this.fetchedUrls.add(url);
  }

  // ─── Sub-question tracking ───────────────────────────────────────────────

  markSubQuestionAnswered(id: string): void {
    this.answeredSubQuestionIds.add(id);
  }

  isSubQuestionAnswered(id: string): boolean {
    return this.answeredSubQuestionIds.has(id);
  }

  getAnsweredSubQuestionIds(): string[] {
    return [...this.answeredSubQuestionIds];
  }

  // ─── Source store ────────────────────────────────────────────────────────

  addSource(piece: EvidencePiece): void {
    // Use URL hash as stable key — prevents duplicate sources across iterations
    const key = this.urlHash(piece.url);
    if (!this.storedSources.has(key)) {
      this.storedSources.set(key, { ...piece, sourceId: key });
    }
  }

  getSources(): EvidencePiece[] {
    return [...this.storedSources.values()];
  }

  getSourceByUrl(url: string): EvidencePiece | undefined {
    return this.storedSources.get(this.urlHash(url));
  }

  // ─── Iteration tracking ──────────────────────────────────────────────────

  incrementIteration(): void {
    this.iterationsCompleted++;
  }

  getIterationsCompleted(): number {
    return this.iterationsCompleted;
  }

  // ─── Snapshot (for observability) ────────────────────────────────────────

  snapshot(): MemorySnapshot {
    return {
      queriedSearches: [...this.queriedSearches],
      fetchedUrls: [...this.fetchedUrls],
      answeredSubQuestionIds: [...this.answeredSubQuestionIds],
      storedSources: this.getSources(),
      iterationsCompleted: this.iterationsCompleted,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private normalise(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, " ");
  }

  urlHash(url: string): string {
    return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
  }
}
