/**
 * Simple in-memory cache with TTL support for reference data.
 * Used to cache rarely-changing data like barangays, medicine catalogs, etc.
 */

class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get cached value if it exists and hasn't expired
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cached value with TTL in milliseconds
   */
  set(key, value, ttlMs = 5 * 60 * 1000) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Invalidate a specific key
   */
  invalidate(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cached entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get or fetch pattern - returns cached value or fetches and caches
   */
  async getOrFetch(key, fetchFn, ttlMs = 5 * 60 * 1000) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    this.set(key, value, ttlMs);
    return value;
  }
}

// Export singleton instance
export const memoryCache = new MemoryCache();

// Export class for testing
export { MemoryCache };
