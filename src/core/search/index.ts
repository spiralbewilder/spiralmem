// Search engine exports
export { VectorSearchEngine } from './VectorSearchEngine.js';
export { HybridSearchEngine } from './HybridSearchEngine.js';
export { EnhancedMemoryEngine } from './EnhancedMemoryEngine.js';

// Type exports
export type { 
  VectorSearchOptions, 
  VectorSearchResult, 
  SearchPerformanceMetrics,
  VectorIndex 
} from './VectorSearchEngine.js';

export type { 
  HybridSearchOptions, 
  HybridSearchResult, 
  HybridSearchMetrics 
} from './HybridSearchEngine.js';