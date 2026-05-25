/**
 * Repository pattern for storage abstraction.
 *
 * Provides clean interfaces for CRUD operations with support for:
 * - Multiple storage backends (JSON, IndexedDB, etc.)
 * - Query capabilities
 * - Change notifications
 *
 * Based on patterns from Claude Code/Cowork design.
 */

/** Base repository interface for type-safe storage operations. */
export interface Repository<T, TId = string> {
  /** Get all items */
  findAll(): Promise<T[]>;

  /** Get item by ID */
  findById(id: TId): Promise<T | null>;

  /** Find items matching a predicate */
  findWhere(predicate: (item: T) => boolean): Promise<T[]>;

  /** Save or update an item */
  save(item: T): Promise<T>;

  /** Delete an item by ID */
  delete(id: TId): Promise<boolean>;

  /** Delete all items */
  clear(): Promise<void>;

  /** Get count of items */
  count(): Promise<number>;

  /** Check if item exists */
  exists(id: TId): Promise<boolean>;

  /** Get storage backend info */
  getBackendInfo(): StorageBackendInfo;
}

/** Query options for repository operations. */
export interface QueryOptions {
  /** Maximum number of items to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort field */
  sortBy?: string;
  /** Sort direction */
  sortDir?: "asc" | "desc";
}

/** Extended repository with query support. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface QueryableRepository<T, _TId = string> extends Repository<T, _TId> {
  /** Query with options */
  query(options?: QueryOptions): Promise<T[]>;

  /** Get items updated after a timestamp */
  findUpdatedAfter(timestamp: number): Promise<T[]>;
}

/** Storage backend information. */
export interface StorageBackendInfo {
  /** Backend type identifier */
  type: "json" | "indexeddb" | "localStorage" | "memory";
  /** Backend description */
  description: string;
  /** Whether backend supports persistence */
  persistent: boolean;
}

/** Repository factory for creating instances. */
export interface RepositoryFactory {
  create<T, TId>(config: RepositoryConfig<T, TId>): Repository<T, TId>;
}

/** Configuration for repository creation. */
export interface RepositoryConfig<T, TId = string> {
  /** Storage key/path */
  key: string;
  /** Backend to use */
  backend?: "json" | "indexeddb" | "localStorage" | "memory";
  /** Custom serializer/deserializer */
  serializer?: {
    serialize: (items: T[]) => string;
    deserialize: (data: string) => T[];
  };
  /** Default factory for creating new items */
  createDefault?: () => T;
}

/** Change event for repository operations. */
export interface RepositoryChangeEvent<T> {
  type: "created" | "updated" | "deleted" | "cleared";
  item?: T;
  items?: T[];
  timestamp: number;
}

/** Observer for repository changes. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type RepositoryObserver<T, _TId = never> = (event: RepositoryChangeEvent<T>) => void;

/**
 * Observable repository that notifies observers on changes.
 */
export abstract class ObservableRepository<T, TId = string> implements Repository<T, TId> {
  private observers = new Set<RepositoryObserver<T>>();

  subscribe(observer: RepositoryObserver<T>): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  protected notify(event: RepositoryChangeEvent<T>): void {
    const observers = Array.from(this.observers);
    for (const observer of observers) {
      try {
        observer(event);
      } catch (e) {
        console.error("[repository] observer error:", e);
      }
    }
  }

  abstract findAll(): Promise<T[]>;
  abstract findById(id: TId): Promise<T | null>;
  abstract findWhere(predicate: (item: T) => boolean): Promise<T[]>;
  abstract save(item: T): Promise<T>;
  abstract delete(id: TId): Promise<boolean>;
  abstract clear(): Promise<void>;
  abstract count(): Promise<number>;
  abstract exists(id: TId): Promise<boolean>;
  abstract getBackendInfo(): StorageBackendInfo;
}

/**
 * In-memory storage backend (useful for testing or caching).
 */
export class MemoryStorage<T> {
  private data = new Map<string, T>();

  get(id: string): T | undefined {
    return this.data.get(id);
  }

  set(id: string, value: T): void {
    this.data.set(id, value);
  }

  has(id: string): boolean {
    return this.data.has(id);
  }

  delete(id: string): boolean {
    return this.data.delete(id);
  }

  values(): T[] {
    return Array.from(this.data.values());
  }

  entries(): [string, T][] {
    return Array.from(this.data.entries());
  }

  clear(): void {
    this.data.clear();
  }

  size(): number {
    return this.data.size;
  }

  /** Get all items matching a predicate */
  filter(predicate: (item: T) => boolean): T[] {
    return this.values().filter(predicate);
  }

  /** Find first item matching predicate */
  find(predicate: (item: T) => boolean): T | undefined {
    return this.values().find(predicate);
  }
}

/**
 * LocalStorage backend for browser persistence.
 */
export class LocalStorageBackend<T> {
  constructor(
    private key: string,
    private serializer: {
      serialize: (items: T[]) => string;
      deserialize: (data: string) => T[];
    },
  ) {}

  load(): T[] {
    try {
      const data = localStorage.getItem(this.key);
      if (!data) return [];
      return this.serializer.deserialize(data);
    } catch (e) {
      console.error(`[localStorage] failed to load ${this.key}:`, e);
      return [];
    }
  }

  save(items: T[]): void {
    try {
      localStorage.setItem(this.key, this.serializer.serialize(items));
    } catch (e) {
      console.error(`[localStorage] failed to save ${this.key}:`, e);
    }
  }

  clear(): void {
    localStorage.removeItem(this.key);
  }

  getInfo(): StorageBackendInfo {
    return {
      type: "localStorage",
      description: "Browser localStorage",
      persistent: true,
    };
  }
}

/**
 * Generic JSON file backend for Node.js/Tauri.
 */
export class JsonFileBackend<T> {
  private cache: T[] | null = null;

  constructor(private filePath: string) {}

  async load(): Promise<T[]> {
    if (this.cache) return this.cache;

    try {
      // This would integrate with Tauri fs or node fs
      // For now, return empty array as placeholder
      return [];
    } catch (e) {
      console.error(`[jsonFile] failed to load ${this.filePath}:`, e);
      return [];
    }
  }

  async save(items: T[]): Promise<void> {
    this.cache = items;
    // This would integrate with Tauri fs or node fs
  }

  async clear(): Promise<void> {
    this.cache = [];
  }

  getInfo(): StorageBackendInfo {
    return {
      type: "json",
      description: `JSON file: ${this.filePath}`,
      persistent: true,
    };
  }
}

/**
 * Create a repository with localStorage backend.
 */
export function createLocalStorageRepository<T extends { id: string }>(
  key: string,
): ObservableRepository<T, string> {
  const defaultSerializer = {
    serialize: (items: T[]) => JSON.stringify(items),
    deserialize: (data: string) => JSON.parse(data) as T[],
  };

  const storage = new LocalStorageBackend<T>(key, defaultSerializer);

  return new (class extends ObservableRepository<T, string> {
    private items: T[] = storage.load();

    private persist(): void {
      storage.save(this.items);
    }

    findAll(): Promise<T[]> {
      return Promise.resolve([...this.items]);
    }

    findById(id: string): Promise<T | null> {
      return Promise.resolve(this.items.find((item) => item.id === id) ?? null);
    }

    findWhere(predicate: (item: T) => boolean): Promise<T[]> {
      return Promise.resolve(this.items.filter(predicate));
    }

    async save(item: T): Promise<T> {
      const idx = this.items.findIndex((i) => i.id === item.id);
      const isNew = idx < 0;

      if (isNew) {
        this.items.push(item);
        this.notify({ type: "created", item, timestamp: Date.now() });
      } else {
        const oldItem = this.items[idx];
        this.items[idx] = item;
        this.notify({ type: "updated", item, items: [oldItem], timestamp: Date.now() });
      }

      this.persist();
      return item;
    }

    async delete(id: string): Promise<boolean> {
      const idx = this.items.findIndex((item) => item.id === id);
      if (idx < 0) return false;

      const [removed] = this.items.splice(idx, 1);
      this.notify({ type: "deleted", item: removed, timestamp: Date.now() });
      this.persist();
      return true;
    }

    async clear(): Promise<void> {
      this.items = [];
      this.notify({ type: "cleared", timestamp: Date.now() });
      this.persist();
    }

    async count(): Promise<number> {
      return this.items.length;
    }

    async exists(id: string): Promise<boolean> {
      return this.items.some((item) => item.id === id);
    }

    getBackendInfo(): StorageBackendInfo {
      return storage.getInfo();
    }
  })();
}
