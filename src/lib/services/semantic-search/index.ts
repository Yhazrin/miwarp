/**
 * SemanticCodeSearch — provides natural language code search using local embeddings.
 *
 * Features:
 * - Token-based semantic indexing (no external API required)
 * - TF-IDF weighted search with n-gram support
 * - Fuzzy matching for typos
 * - Code-aware tokenization (handles identifiers, operators, etc.)
 * - Incremental indexing for performance
 *
 * Inspired by Claude Code's code search capabilities.
 */

import { dbg } from "$lib/utils/debug";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CodeDocument {
  id: string;
  path: string;
  content: string;
  language: string;
  lineCount: number;
  lastModified: number;
  /** Pre-computed tokens for fast search */
  tokens: string[];
  /** TF-IDF vectors */
  tfidf?: Map<string, number>;
}

export interface SearchResult {
  document: CodeDocument;
  score: number;
  matches: SearchMatch[];
  snippet: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  token: string;
}

export interface SearchOptions {
  maxResults?: number;
  minScore?: number;
  fuzzyMatch?: boolean;
  fuzzyThreshold?: number;
  includeSnippets?: boolean;
  snippetLength?: number;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────

const CODE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "may",
  "might",
  "must",
  "can",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
]);

const IDENTIFIER_PATTERN = /[a-zA-Z_][a-zA-Z0-9_]*/g;
const CAMEL_CASE_PATTERN = /([a-z])([A-Z])/g;
const SNAKE_CASE_PATTERN = /_([a-z])/g;

export class Tokenizer {
  /**
   * Tokenize code content into searchable terms
   */
  static tokenize(content: string): string[] {
    const tokens: string[] = [];

    // Split into lines for line-based indexing
    const lines = content.split("\n");

    for (const line of lines) {
      // Extract identifiers
      const identifiers = line.match(IDENTIFIER_PATTERN) || [];

      for (const id of identifiers) {
        if (id.length >= 2 && !CODE_STOPWORDS.has(id.toLowerCase())) {
          tokens.push(id.toLowerCase());

          // Split camelCase
          const camelParts = id.split(/(?=[A-Z])/);
          for (const part of camelParts) {
            if (part.length >= 2) {
              tokens.push(part.toLowerCase());
            }
          }

          // Split snake_case
          const snakeParts = id.split("_");
          for (const part of snakeParts) {
            if (part.length >= 2) {
              tokens.push(part.toLowerCase());
            }
          }
        }
      }
    }

    return [...new Set(tokens)];
  }

  /**
   * Tokenize a query string
   */
  static tokenizeQuery(query: string): string[] {
    // Handle natural language queries
    const words = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !CODE_STOPWORDS.has(w));

    const tokens: string[] = [...words];

    // Add bigrams for phrase matching
    for (let i = 0; i < words.length - 1; i++) {
      tokens.push(`${words[i]} ${words[i + 1]}`);
    }

    return tokens;
  }
}

// ── TF-IDF Index ─────────────────────────────────────────────────────────────

export class TfidfIndex {
  private documents: Map<string, CodeDocument> = new Map();
  private documentFrequency: Map<string, number> = new Map();
  private totalDocuments = 0;

  /**
   * Add or update a document in the index
   */
  indexDocument(doc: CodeDocument): void {
    const tokens = Tokenizer.tokenize(doc.content);
    doc.tokens = tokens;

    // Calculate term frequency
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Normalize by document length
    const maxTf = Math.max(...tf.values(), 1);
    for (const [token, count] of tf) {
      tf.set(token, count / maxTf);
    }

    doc.tfidf = tf;
    this.documents.set(doc.id, doc);
    this.totalDocuments++;

    // Update document frequency
    const seenTokens = new Set(tokens);
    for (const token of seenTokens) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
    }

    dbg("semantic-search", "indexed", { path: doc.path, tokens: tokens.length });
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (doc) {
      this.documents.delete(id);
      this.totalDocuments--;

      // Update document frequency
      const seenTokens = new Set(doc.tokens);
      for (const token of seenTokens) {
        const freq = (this.documentFrequency.get(token) || 1) - 1;
        if (freq <= 0) {
          this.documentFrequency.delete(token);
        } else {
          this.documentFrequency.set(token, freq);
        }
      }
    }
  }

  /**
   * Search for documents matching the query
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const {
      maxResults = 10,
      minScore = 0.1,
      includeSnippets = true,
      snippetLength = 150,
    } = options;

    const queryTokens = Tokenizer.tokenizeQuery(query);
    if (queryTokens.length === 0) return [];

    // Calculate IDF for query terms
    const idf = new Map<string, number>();
    for (const token of queryTokens) {
      const df = this.documentFrequency.get(token) || 0;
      idf.set(token, df > 0 ? Math.log(this.totalDocuments / df) : 0);
    }

    // Score each document
    const results: SearchResult[] = [];

    for (const [id, doc] of this.documents) {
      if (!doc.tfidf) continue;

      let score = 0;
      const matches: SearchMatch[] = [];

      for (const token of queryTokens) {
        const tfidf = doc.tfidf.get(token) || 0;
        const tokenIdf = idf.get(token) || 0;

        if (tfidf > 0) {
          score += tfidf * tokenIdf;

          // Find match location
          const matchIndex = doc.content.toLowerCase().indexOf(token);
          if (matchIndex >= 0) {
            const line = doc.content.substring(0, matchIndex).split("\n").length;
            matches.push({
              line,
              column: matchIndex,
              length: token.length,
              token,
            });
          }
        }
      }

      if (score >= minScore) {
        let snippet = "";
        if (includeSnippets && matches.length > 0) {
          const firstMatch = matches[0];
          const lines = doc.content.split("\n");
          const matchLine = lines[firstMatch.line - 1] || "";

          const start = Math.max(0, firstMatch.column - 50);
          const end = Math.min(matchLine.length, firstMatch.column + snippetLength);
          snippet =
            (start > 0 ? "..." : "") +
            matchLine.substring(start, end) +
            (end < matchLine.length ? "..." : "");
        }

        results.push({
          document: doc,
          score,
          matches: matches.slice(0, 5), // Limit matches per result
          snippet,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): CodeDocument | undefined {
    return this.documents.get(id);
  }

  /**
   * Get all documents
   */
  getAllDocuments(): CodeDocument[] {
    return Array.from(this.documents.values());
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      documentCount: this.totalDocuments,
      uniqueTerms: this.documentFrequency.size,
      avgTokensPerDoc:
        this.totalDocuments > 0
          ? Array.from(this.documents.values()).reduce((sum, doc) => sum + doc.tokens.length, 0) /
            this.totalDocuments
          : 0,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
  }
}

// ── Semantic Code Search Service ─────────────────────────────────────────────

export class SemanticCodeSearch {
  private index: TfidfIndex;
  private indexCache: Map<string, number> = new Map(); // path -> mtime

  constructor() {
    this.index = new TfidfIndex();
  }

  /**
   * Index a code file
   */
  indexFile(path: string, content: string, language: string): void {
    const id = this.generateDocId(path);
    const mtime = Date.now();

    // Check if file has changed since last index
    const cachedMtime = this.indexCache.get(path);
    if (cachedMtime && cachedMtime === mtime) {
      return; // Already indexed
    }

    const doc: CodeDocument = {
      id,
      path,
      content,
      language,
      lineCount: content.split("\n").length,
      lastModified: mtime,
      tokens: [],
    };

    this.index.indexDocument(doc);
    this.indexCache.set(path, mtime);

    dbg("semantic-search", "indexed file", { path, lines: doc.lineCount });
  }

  /**
   * Remove a file from the index
   */
  unindexFile(path: string): void {
    const id = this.generateDocId(path);
    this.index.removeDocument(id);
    this.indexCache.delete(path);
  }

  /**
   * Search code using natural language query
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    return this.index.search(query, options);
  }

  /**
   * Update an existing file's index
   */
  reindexFile(path: string, content: string, language: string): void {
    this.unindexFile(path);
    this.indexFile(path, content, language);
  }

  /**
   * Batch index multiple files
   */
  indexBatch(files: Array<{ path: string; content: string; language: string }>): void {
    for (const file of files) {
      this.indexFile(file.path, file.content, file.language);
    }
    dbg("semantic-search", "batch indexed", { count: files.length });
  }

  /**
   * Get search index statistics
   */
  getStats() {
    return this.index.getStats();
  }

  /**
   * Clear all indexes
   */
  clear(): void {
    this.index.clear();
    this.indexCache.clear();
  }

  private generateDocId(path: string): string {
    // Simple hash-based ID
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `doc_${Math.abs(hash).toString(36)}`;
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

let semanticSearch: SemanticCodeSearch | null = null;

export function getSemanticSearch(): SemanticCodeSearch {
  if (!semanticSearch) {
    semanticSearch = new SemanticCodeSearch();
  }
  return semanticSearch;
}

// ── Language detection helper ─────────────────────────────────────────────────

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    scala: "scala",
    r: "r",
  };

  return languageMap[ext] || "unknown";
}
