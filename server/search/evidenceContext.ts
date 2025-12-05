import { buildSearchQuery } from './searchQueryBuilder';
import { filterSnippets, rankSnippets, type SearchChunk } from './snippetFilter';
import { searchWithCache } from './searchClient';

/**
 * Evidence Context (검색 결과 컨텍스트)
 */
export interface EvidenceContext {
  snippets: SearchChunk[];
  searchPerformed: boolean;
  query: string;
  auditTrail: string[];
}

/**
 * 에이전트와 질문을 기반으로 Evidence Context 준비
 * @param agent 에이전트 정보
 * @param userQuestion 사용자 질문
 * @param enableSearch 검색 활성화 여부 (기본: true)
 * @param agentNames 그룹챗 에이전트 이름 목록 (선택)
 * @returns Evidence Context
 */
export async function prepareEvidenceContext(
  agent: { id: number; name: string; category?: string | null },
  userQuestion: string,
  enableSearch: boolean = true,
  agentNames?: string[]
): Promise<EvidenceContext> {
  const auditTrail: string[] = [];
  
  if (!enableSearch) {
    auditTrail.push('[검색 비활성화] Evidence 검색 생략');
    return {
      snippets: [],
      searchPerformed: false,
      query: '',
      auditTrail
    };
  }
  
  try {
    // 1. 검색 쿼리 생성 (그룹챗 에이전트 정보 포함)
    const querySpecs = buildSearchQuery({
      agentName: agent.name,
      agentCategory: agent.category || undefined,
      userQuestion
    }, agentNames);
    
    const primaryQuerySpec = querySpecs[0];
    auditTrail.push(`[쿼리 생성] ${primaryQuerySpec.fullQuery}`);
    
    // 2. Google Search 실행 (캐싱 적용)
    const normalizedQuestion = userQuestion.toLowerCase().replace(/[.,!?;]/g, '').trim();
    const rawResults = await searchWithCache(
      agent.id,
      primaryQuerySpec.fullQuery,
      normalizedQuestion
    );
    
    auditTrail.push(`[검색 결과] ${rawResults.length}개 원본 결과`);
    
    if (rawResults.length === 0) {
      // Fallback: 더 단순한 쿼리로 재시도
      if (querySpecs.length > 1) {
        const fallbackQuerySpec = querySpecs[1];
        auditTrail.push(`[Fallback 쿼리] ${fallbackQuerySpec.fullQuery}`);
        
        const fallbackResults = await searchWithCache(
          agent.id,
          fallbackQuerySpec.fullQuery,
          normalizedQuestion
        );
        
        if (fallbackResults.length > 0) {
          auditTrail.push(`[Fallback 성공] ${fallbackResults.length}개 결과`);
          return processResults(fallbackResults, agent, userQuestion, fallbackQuerySpec.fullQuery, auditTrail);
        }
      }
      
      auditTrail.push('[검색 실패] 관련 출처를 찾지 못했습니다');
      return {
        snippets: [],
        searchPerformed: true,
        query: primaryQuerySpec.fullQuery,
        auditTrail
      };
    }
    
    return processResults(rawResults, agent, userQuestion, primaryQuerySpec.fullQuery, auditTrail);
  } catch (error) {
    console.error('[Evidence Context] 준비 실패:', error);
    auditTrail.push(`[오류] ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      snippets: [],
      searchPerformed: true,
      query: '',
      auditTrail
    };
  }
}

/**
 * 검색 결과 처리 (필터링 + 랭킹)
 */
function processResults(
  rawResults: SearchChunk[],
  agent: { id: number; name: string; category?: string | null },
  userQuestion: string,
  query: string,
  auditTrail: string[]
): EvidenceContext {
  // 3. 스니펫 필터링
  const filteredResults = filterSnippets(rawResults, {
    agentName: agent.name,
    userQuestion
  });
  
  auditTrail.push(`[필터링 후] ${filteredResults.length}개 결과`);
  
  if (filteredResults.length === 0) {
    auditTrail.push('[필터링 결과] 신뢰할 수 있는 출처를 찾지 못했습니다');
    return {
      snippets: [],
      searchPerformed: true,
      query,
      auditTrail
    };
  }
  
  // 4. 스니펫 랭킹
  const questionKeywords = userQuestion
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length >= 2);
  
  const rankedResults = rankSnippets(filteredResults, agent.name, questionKeywords);
  
  // 5. 상위 2개만 반환 (TTFT 최적화)
  const topResults = rankedResults.slice(0, 2);
  auditTrail.push(`[최종 선택] 상위 ${topResults.length}개 스니펫`);
  
  return {
    snippets: topResults,
    searchPerformed: true,
    query,
    auditTrail
  };
}

/**
 * Evidence를 프롬프트에 주입할 형식으로 변환
 * @param context Evidence Context
 * @returns 프롬프트 텍스트
 */
export function formatEvidenceForPrompt(context: EvidenceContext): string {
  if (context.snippets.length === 0) {
    return '';
  }
  
  const evidenceBlock = context.snippets
    .map((snippet, index) => {
      return `
**출처 ${index + 1}:** ${snippet.title}
- URL: ${snippet.url}
- 내용: ${snippet.snippet || '(내용 없음)'}
`.trim();
    })
    .join('\n\n');
  
  return `
📰 **[검색 결과 스니펫]**

다음은 Google 검색으로 찾은 관련 자료입니다. 반드시 이 내용을 근거로 답변하세요.

${evidenceBlock}

⚠️ **중요**: 위 스니펫에 없는 내용은 절대 언급하지 마세요.
`.trim();
}
