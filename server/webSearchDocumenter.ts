import { db } from './db';
import { documents, agentDocumentChunks, type InsertDocument } from '@shared/schema';
import { generateEmbedding } from './openai';
import { analyzeContentExpiry, calculateSmartTTL } from './llmExpiryAnalyzer';

interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Google Search 결과를 자동으로 documents + agentDocumentChunks에 저장
 * 이후 RAG 검색에서 활용 가능하도록 embedding 생성
 */
export async function saveWebSearchAsDocument(
  agentId: number,
  query: string,
  searchResults: WebSearchResult[],
  uploadedBy: string = 'system'
): Promise<number | null> {
  if (!searchResults || searchResults.length === 0) {
    console.log('[📄 Web→Doc] 검색 결과 없음 - 문서화 스킵');
    return null;
  }

  try {
    console.log(`[📄 Web→Doc] ${searchResults.length}개 검색 결과 문서화 시작`);
    
    // 1. 모든 검색 결과를 하나의 문서로 통합
    const combinedContent = searchResults.map((result, idx) => {
      return `[출처 ${idx + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}\n`;
    }).join('\n---\n\n');

    // 2. Smart TTL 계산
    console.log(`[🧠 Smart TTL] LLM 분석 시작...`);
    const expiryAnalysis = await analyzeContentExpiry(combinedContent);
    const expiresAt = calculateSmartTTL(expiryAnalysis);
    console.log(`[✅ Smart TTL] 만료일: ${expiresAt.toISOString()}, 카테고리: ${expiryAnalysis.category}`);

    // 3. documents 테이블에 저장
    const filename = `web_search_${Date.now()}.txt`;
    const originalName = `Google Search: ${query.substring(0, 50)}...`;
    
    const newDocument: InsertDocument = {
      agentId,
      filename,
      originalName,
      mimeType: 'text/plain',
      size: combinedContent.length,
      content: combinedContent,
      uploadedBy,
      type: 'web_search',
      description: `Auto-generated from Google Search: "${query}"`,
      status: 'active',
      connectedAgents: JSON.stringify([agentId]),
      isVisibleToUsers: false, // 자동 생성 문서는 사용자에게 숨김
      isUsedForTraining: true,
      expiresAt, // 🆕 Smart TTL 적용
    };

    const [createdDoc] = await db.insert(documents).values(newDocument).returning();
    console.log(`[✅ Web→Doc] 문서 생성 완료: ID=${createdDoc.id}, 크기=${combinedContent.length}자`);

    // 4. 각 검색 결과를 개별 청크로 저장 + embedding 생성
    let embeddingCount = 0;
    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      const chunkContent = `${result.title}\n${result.snippet}\n출처: ${result.url}`;
      
      try {
        // Embedding 생성 (OpenAI text-embedding-3-large)
        const embedding = await generateEmbedding(chunkContent);
        
        if (embedding && embedding.length === 3072) {
          await db.insert(agentDocumentChunks).values({
            documentId: createdDoc.id,
            agentId,
            chunkIndex: i,
            content: chunkContent,
            keywords: JSON.stringify([query]), // 검색 쿼리를 키워드로 저장
            metadata: JSON.stringify({
              source: 'google_search',
              url: result.url,
              title: result.title,
              query
            }),
            embedding: embedding as any, // vector 타입으로 저장
            expiresAt, // 🆕 부모 문서의 만료 시간 상속
          });
          embeddingCount++;
        } else {
          console.warn(`[⚠️ Web→Doc] Embedding 생성 실패: 청크 ${i}, 차원=${embedding?.length}`);
        }
      } catch (embErr) {
        console.error(`[❌ Web→Doc] Embedding 생성 오류: 청크 ${i}`, embErr);
      }
    }

    console.log(`[🎉 Web→Doc] 완료: 문서 ID=${createdDoc.id}, ${embeddingCount}/${searchResults.length}개 청크 저장`);
    return createdDoc.id;
    
  } catch (error) {
    console.error('[❌ Web→Doc] 문서화 실패:', error);
    return null;
  }
}
