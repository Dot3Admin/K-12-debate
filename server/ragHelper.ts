import { searchDocumentChunks } from './documentProcessor';
import { searchWithCache } from './search/searchClient';
import { saveWebSearchAsDocument } from './webSearchDocumenter';

/**
 * 🎯 순차적 Waterfall RAG 시스템 (Router 제거)
 * 모든 질문에 대해 항상 동일한 순서로 실행:
 * 1. LLM 내부 지식 (기본 제공)
 * 2. RAG 문서 검색 (항상 시도)
 * 3. Google Search (RAG 품질이 낮을 때만 추가)
 * 
 * @returns { prompt: string, hasContext: boolean } - 향상된 프롬프트 + 검색 결과 존재 여부
 */
export async function enhancePromptWithRAG(
  agentId: number,
  question: string,
  existingPrompt: string,
  agentName: string = '',
  agentDescription: string = '',
  agentCategory?: string | null
): Promise<{ prompt: string, hasContext: boolean }> {
  try {
    // 🔍 Step 0: 검색어 생성 (캐릭터 이름 + 질문)
    const enrichedQuery = agentName 
      ? `${agentName} ${question}`.trim()
      : question;
    
    console.log(`[🔍 검색어 생성] "${question}" → "${enrichedQuery}"`);
    
    // 🎯 Step 1: 순차적 Waterfall 강제 (Router 제거)
    // 항상 실행: LLM 내부 지식 → RAG 검색 → Google Search (필요 시)
    // Knowledge Router 제거: 모든 질문에 대해 동일한 순서로 실행
    console.log(`[🎯 Sequential Waterfall] ${agentName}: LLM → RAG → Google (필요 시)`);
    
    // 📚 Step 2: RAG (문서 검색) - 항상 먼저 시도
    let ragContextData = '';
    let webContextData = '';
    let ragQuality: 'high' | 'low' | 'none' = 'none';
    const ragStartTime = Date.now();
    
    console.log(`[📚 RAG Search] ${agentName}: 문서 검색 시작`);
    
    // RAG 검색 시도 (enrichedQuery 사용)
    const chunks = await searchDocumentChunks(agentId, enrichedQuery, 5);
    const ragDuration = Date.now() - ragStartTime;
    
    if (chunks.length > 0 && chunks[0].score) {
      const topScore = chunks[0].score;
      const QUALITY_THRESHOLD = 3.0; // 10점 만점 기준
      
      console.log(`[📚 RAG] 최고 점수: ${topScore.toFixed(2)}/10.0 (${ragDuration}ms)`);
      
      if (topScore >= QUALITY_THRESHOLD) {
        // RAG 품질이 충분함
        console.log(`[✅ RAG] 품질 충분 (${topScore.toFixed(2)} >= ${QUALITY_THRESHOLD})`);
        ragQuality = 'high';
        
        const contextParts = [
          '다음은 업로드된 문서에서 관련 정보입니다:',
          '',
          ...chunks.map((chunk: any, index: number) => {
            return `[문서 ${index + 1}] (점수: ${chunk.score?.toFixed(2) || 'N/A'})\n${chunk.content}\n`;
          }),
          ''
        ];
        
        ragContextData = contextParts.join('\n');
      } else {
        // RAG 품질이 낮음 - Web 전략에서는 Google Search를 위해 비워둠
        console.log(`[⚠️ RAG] 품질 부족 (${topScore.toFixed(2)} < ${QUALITY_THRESHOLD}) - ragContextData 비움`);
        ragQuality = 'low';
        ragContextData = ''; // Web search가 실행되도록 비워둠
      }
    } else {
      console.log(`[⚠️ RAG] 관련 문서 없음 (${ragDuration}ms)`);
      ragQuality = 'none';
    }
    
    // 🌐 Step 3: Web Search (Google) - RAG 품질이 불충분할 때만 실행
    // Sequential Waterfall: RAG 품질 확인 → 불충분하면 Google Search
    const shouldRunWebSearch = ragQuality !== 'high';
    
    const webStartTime = Date.now();
    let webDuration = 0;
    let webExecuted = false;
    
    if (shouldRunWebSearch) {
      webExecuted = true;
      const reason = ragQuality === 'none'
        ? 'RAG 문서 없음 - Google Search 실행'
        : `RAG 품질 낮음 (${ragQuality}) - Google Search fallback`;
      console.log(`[🌐 Web Search] ${agentName}: ${reason}`);
      
      try {
        const searchResults = await searchWithCache(agentId, enrichedQuery, '');
        webDuration = Date.now() - webStartTime;
        
        if (searchResults && searchResults.length > 0) {
          console.log(`[🌐 Google Search] ${searchResults.length}개 결과 발견 (${webDuration}ms)`);
          
          const webContextParts = [
            '다음은 구글 검색 결과입니다:',
            '',
            ...searchResults.slice(0, 3).map((result, index: number) => {
              return `[검색 결과 ${index + 1}]\n제목: ${result.title}\n내용: ${result.snippet}\n출처: ${result.url}\n`;
            }),
            ''
          ];
          
          webContextData = webContextParts.join('\n');
          
          // 🔄 Google Search 결과를 자동으로 문서화 (백그라운드에서 비동기 실행)
          const webSearchResults = searchResults.map(result => ({
            title: result.title,
            snippet: result.snippet || '',
            url: result.url
          }));
          saveWebSearchAsDocument(agentId, question, webSearchResults, 'system').catch(err => {
            console.error('[❌ Web→Doc] 백그라운드 문서화 실패:', err);
          });
        } else {
          console.log(`[⚠️ Google Search] 검색 결과 없음 (${webDuration}ms)`);
        }
      } catch (error) {
        webDuration = Date.now() - webStartTime;
        console.error(`[❌ Google Search Error] (${webDuration}ms)`, error);
      }
    }
    
    // 📊 Step 4: 성능 모니터링 (구조화된 메트릭)
    const totalDuration = ragDuration + webDuration;
    const hasRAG = ragQuality === 'high';
    const hasWeb = webContextData.length > 0;
    const metrics = {
      agentCategory,
      strategy: 'sequential', // 항상 순차적 waterfall 실행
      ragQuality,
      ragDuration,
      webDuration,
      totalDuration,
      ragSuccess: hasRAG,
      webExecuted,
      webSuccess: hasWeb,
      hasContext: hasRAG || hasWeb
    };
    console.log(`[⏱️ Waterfall Metrics]`, JSON.stringify(metrics));
    
    // Step 6: 최종 컨텍스트 결합 (품질 기반 태그)
    let finalContext = '';
    
    if (ragQuality === 'high' && webContextData) {
      // RAG(고품질) + Web 모두 있음 (web 전략인 경우)
      finalContext = `${ragContextData}\n${webContextData}⚠️ 위 문서 정보(신뢰도: 높음)와 최신 검색 결과를 모두 참고하여 답변해주세요.`;
    } else if (ragQuality === 'high') {
      // RAG만 있음 (high quality)
      finalContext = `${ragContextData}⚠️ 위 정보(신뢰도: 높음)를 참고하여 답변해주세요.`;
    } else if (webContextData) {
      // Web만 있음 (RAG 품질 낮음 또는 없음)
      const qualityNote = ragQuality === 'low' 
        ? '⚠️ 문서 정보의 신뢰도가 낮아 최신 검색 결과만 사용합니다.' 
        : '⚠️ 관련 문서가 없어 최신 검색 결과만 사용합니다.';
      finalContext = `${qualityNote}\n\n${webContextData}위 최신 정보를 참고하여 답변해주세요.`;
    }
    
    // 최종 프롬프트 생성
    if (finalContext) {
      return { 
        prompt: `${existingPrompt}\n\n${finalContext}`, 
        hasContext: true 
      };
    }
    
    // 검색 결과 없음 - 자연스러운 거절 유도
    console.log(`[⚠️ Waterfall] ${agentName}: 검색 결과 없음 - 거절 프롬프트 추가`);
    const refusalPrompt = `${existingPrompt}\n\n⚠️ **중요 지시사항:**\n현재 질문에 대한 정확한 최신 정보를 찾을 수 없었습니다.\n내부 지식으로 추측하거나 오래된 정보로 답변하지 마세요.\n대신, ${agentName} 캐릭터의 말투와 성격을 유지하면서 **자연스럽게 답변을 거절**하세요.\n예: "제가 지금 그 부분에 대해서는 자세히 말씀드리기 어렵습니다." 또는 "현재로서는 정확한 정보를 드릴 수 없네요."`;
    return { 
      prompt: refusalPrompt, 
      hasContext: false 
    };
    
  } catch (error) {
    console.error('[❌ Waterfall System Error]', error);
    return { 
      prompt: existingPrompt, 
      hasContext: false 
    };
  }
}

