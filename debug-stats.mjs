import { MemoryEngine } from './dist/core/MemoryEngine.js';

(async () => {
  try {
    const engine = new MemoryEngine();
    await engine.initialize();
    
    console.log('About to call getStats...');
    const stats = await engine.getStats();
    console.log('Stats result:', stats);
    
    // Let's also test the chunkRepo directly from the engine
    console.log('Testing chunkRepo directly...');
    const count = await engine.chunkRepo.count();
    console.log('Direct engine chunk count:', count);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
})();