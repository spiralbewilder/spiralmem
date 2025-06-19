import { ChunkRepository } from './dist/core/database/repositories/index.js';
import { database } from './dist/core/database/index.js';

(async () => {
  try {
    await database.initialize();
    const chunkRepo = new ChunkRepository();
    const count = await chunkRepo.count();
    console.log('Direct chunk count:', count);
    
    // Also test with SQL directly
    const db = database.getDb();
    const result = await db.get('SELECT COUNT(*) as count FROM chunks');
    console.log('Direct SQL count:', result.count);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
})();