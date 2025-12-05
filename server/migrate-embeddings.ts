import { db } from './db';
import { agentDocumentChunks } from '../shared/schema';
import { isNull, sql } from 'drizzle-orm';
import { generateEmbedding } from './openai';

async function migrateEmbeddings() {
  console.log('[Embedding Migration] Starting migration...');
  
  const chunksWithoutEmbedding = await db
    .select()
    .from(agentDocumentChunks)
    .where(isNull(agentDocumentChunks.embedding));
  
  console.log(`[Embedding Migration] Found ${chunksWithoutEmbedding.length} chunks without embeddings`);
  
  if (chunksWithoutEmbedding.length === 0) {
    console.log('[Embedding Migration] All chunks already have embeddings. Migration complete.');
    return;
  }
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < chunksWithoutEmbedding.length; i++) {
    const chunk = chunksWithoutEmbedding[i];
    
    try {
      console.log(`[${i + 1}/${chunksWithoutEmbedding.length}] Generating embedding for chunk ${chunk.id}...`);
      
      const embedding = await generateEmbedding(chunk.content);
      
      await db
        .update(agentDocumentChunks)
        .set({ embedding: embedding })
        .where(sql`${agentDocumentChunks.id} = ${chunk.id}`);
      
      successCount++;
      console.log(`  ✅ Success`);
      
    } catch (error) {
      errorCount++;
      console.error(`  ❌ Error generating embedding for chunk ${chunk.id}:`, error);
    }
  }
  
  console.log('\n[Embedding Migration] Migration complete!');
  console.log(`  ✅ Success: ${successCount}`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`  📊 Total: ${chunksWithoutEmbedding.length}`);
  
  process.exit(0);
}

migrateEmbeddings().catch((error) => {
  console.error('[Embedding Migration] Fatal error:', error);
  process.exit(1);
});
