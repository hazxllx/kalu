/**
 * Performance monitoring utilities for KALUSAGAP
 * Measures and reports key performance metrics
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.apiMetrics = [];
    this.componentMetrics = [];
  }

  /**
   * Mark the start of a measurement
   */
  markStart(label) {
    if (typeof performance !== 'undefined') {
      performance.mark(`${label}-start`);
    }
  }

  /**
   * Mark the end of a measurement and calculate duration
   */
  markEnd(label) {
    if (typeof performance !== 'undefined') {
      performance.mark(`${label}-end`);
      try {
        const measure = performance.measure(label, `${label}-start`, `${label}-end`);
        this.metrics.set(label, measure.duration);
        return measure.duration;
      } catch (e) {
        console.warn(`Performance measurement failed for ${label}:`, e);
      }
    }
    return null;
  }

  /**
   * Measure an async operation
   */
  async measureAsync(label, operation) {
    this.markStart(label);
    try {
      const result = await operation();
      const duration = this.markEnd(label);
      return { result, duration };
    } catch (error) {
      this.markEnd(label);
      throw error;
    }
  }

  /**
   * Record API request metrics
   */
  recordApiMetric(endpoint, method, duration, status) {
    this.apiMetrics.push({
      endpoint,
      method,
      duration,
      status,
      timestamp: Date.now(),
    });

    // Keep only last 100 API metrics
    if (this.apiMetrics.length > 100) {
      this.apiMetrics.shift();
    }
  }

  /**
   * Record component render metrics
   */
  recordComponentMetric(componentName, renderDuration) {
    this.componentMetrics.push({
      componentName,
      renderDuration,
      timestamp: Date.now(),
    });

    // Keep only last 50 component metrics
    if (this.componentMetrics.length > 50) {
      this.componentMetrics.shift();
    }
  }

  /**
   * Get Web Vitals (LCP, FCP, CLS, etc.)
   */
  getWebVitals() {
    if (typeof performance === 'undefined' || !performance.getEntriesByType) {
      return null;
    }

    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');

    const fcp = paint.find(entry => entry.name === 'first-contentful-paint');
    const lcp = performance.getEntriesByType('largest-contentful-paint')[0];

    return {
      // Time to First Contentful Paint
      fcp: fcp ? Math.round(fcp.startTime) : null,
      // Largest Contentful Paint
      lcp: lcp ? Math.round(lcp.renderTime || lcp.loadTime) : null,
      // DOM Content Loaded
      domContentLoaded: navigation ? Math.round(navigation.domContentLoadedEventEnd - navigation.fetchStart) : null,
      // Total page load time
      loadComplete: navigation ? Math.round(navigation.loadEventEnd - navigation.fetchStart) : null,
      // Time to Interactive (approximation)
      tti: navigation ? Math.round(navigation.domInteractive - navigation.fetchStart) : null,
    };
  }

  /**
   * Get API performance summary
   */
  getApiSummary() {
    if (this.apiMetrics.length === 0) {
      return null;
    }

    const durations = this.apiMetrics.map(m => m.duration);
    const sorted = [...durations].sort((a, b) => a - b);

    return {
      count: this.apiMetrics.length,
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      min: Math.round(Math.min(...durations)),
      max: Math.round(Math.max(...durations)),
      p50: Math.round(sorted[Math.floor(sorted.length * 0.5)]),
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
      p99: Math.round(sorted[Math.floor(sorted.length * 0.99)]),
      slowest: this.apiMetrics
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map(m => ({
          endpoint: m.endpoint,
          method: m.method,
          duration: Math.round(m.duration),
        })),
    };
  }

  /**
   * Get component render performance summary
   */
  getComponentSummary() {
    if (this.componentMetrics.length === 0) {
      return null;
    }

    const byComponent = new Map();

    this.componentMetrics.forEach(metric => {
      if (!byComponent.has(metric.componentName)) {
        byComponent.set(metric.componentName, []);
      }
      byComponent.get(metric.componentName).push(metric.renderDuration);
    });

    const summary = [];
    byComponent.forEach((durations, componentName) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      summary.push({
        componentName,
        renderCount: durations.length,
        avgDuration: Math.round(avg),
        maxDuration: Math.round(Math.max(...durations)),
      });
    });

    return summary.sort((a, b) => b.avgDuration - a.avgDuration);
  }

  /**
   * Get all collected metrics
   */
  getAllMetrics() {
    return {
      webVitals: this.getWebVitals(),
      apiSummary: this.getApiSummary(),
      componentSummary: this.getComponentSummary(),
      customMetrics: Object.fromEntries(this.metrics),
    };
  }

  /**
   * Log performance report to console
   */
  logReport() {
    const metrics = this.getAllMetrics();
    console.group('📊 KALUSAGAP Performance Report');
    
    if (metrics.webVitals) {
      console.group('🌐 Web Vitals');
      console.table(metrics.webVitals);
      console.groupEnd();
    }

    if (metrics.apiSummary) {
      console.group('🔌 API Performance');
      console.table({
        'Total Requests': metrics.apiSummary.count,
        'Average (ms)': metrics.apiSummary.avg,
        'Median (ms)': metrics.apiSummary.p50,
        'P95 (ms)': metrics.apiSummary.p95,
        'Min (ms)': metrics.apiSummary.min,
        'Max (ms)': metrics.apiSummary.max,
      });
      if (metrics.apiSummary.slowest.length > 0) {
        console.log('🐌 Slowest API Calls:');
        console.table(metrics.apiSummary.slowest);
      }
      console.groupEnd();
    }

    if (metrics.componentSummary && metrics.componentSummary.length > 0) {
      console.group('⚛️ Component Render Performance');
      console.table(metrics.componentSummary.slice(0, 10));
      console.groupEnd();
    }

    if (Object.keys(metrics.customMetrics).length > 0) {
      console.group('📏 Custom Metrics');
      console.table(metrics.customMetrics);
      console.groupEnd();
    }

    console.groupEnd();
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
    this.apiMetrics = [];
    this.componentMetrics = [];
    if (typeof performance !== 'undefined' && performance.clearMarks) {
      performance.clearMarks();
      performance.clearMeasures();
    }
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Export class for testing
export { PerformanceMonitor };

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.__KALUSAGAP_PERFORMANCE__ = performanceMonitor;
}
