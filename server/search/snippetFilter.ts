import searchConfig from './searchConfig.json';

/**
 * Google Search 결과 청크
 */
export interface SearchChunk {
  url: string;
  title: string;
  snippet?: string;
  publishedTime?: string; // 🗓️ 기사 발행 날짜 (Grounding용)
}

/**
 * 스니펫 필터링 컨텍스트
 */
export interface FilterContext {
  agentName: string;
  userQuestion: string;
  requiredKeywords?: string[];
}

/**
 * URL이 허용된 도메인인지 확인
 * @param url URL
 * @returns 허용 여부
 */
function isAllowedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    
    // 거부 도메인 체크
    for (const denied of searchConfig.deniedDomains) {
      if (hostname.includes(denied)) {
        return false;
      }
    }
    
    // 허용 도메인 체크 (엄격 모드)
    for (const allowed of searchConfig.allowedDomains) {
      if (hostname.includes(allowed)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * 텍스트에 키워드가 포함되어 있는지 확인
 * @param text 검색할 텍스트
 * @param keywords 키워드 배열
 * @param mode 'any' (하나라도) 또는 'all' (모두)
 * @returns 포함 여부
 */
function containsKeywords(
  text: string,
  keywords: string[],
  mode: 'any' | 'all' = 'any'
): boolean {
  if (!keywords || keywords.length === 0) return true;
  
  const normalizedText = text.toLowerCase();
  const matches = keywords.filter(keyword => 
    normalizedText.includes(keyword.toLowerCase())
  );
  
  if (mode === 'any') {
    return matches.length > 0;
  } else {
    return matches.length === keywords.length;
  }
}

/**
 * 에이전트 이름이 스니펫에 포함되어 있는지 확인
 * @param snippet 스니펫
 * @param agentName 에이전트 이름
 * @returns 포함 여부
 */
function containsAgentName(snippet: SearchChunk, agentName: string): boolean {
  const text = `${snippet.title} ${snippet.snippet || ''}`.toLowerCase();
  return text.includes(agentName.toLowerCase());
}

/**
 * 검색 결과 스니펫 필터링
 * @param snippets 원본 스니펫 배열
 * @param context 필터링 컨텍스트
 * @returns 필터링된 스니펫 배열
 */
export function filterSnippets(
  snippets: SearchChunk[],
  context: FilterContext
): SearchChunk[] {
  if (!snippets || snippets.length === 0) {
    return [];
  }
  
  const { agentName, userQuestion, requiredKeywords } = context;
  
  // 최소 보장할 스니펫 개수
  const MIN_SNIPPETS_TO_GUARANTEE = 2;
  
  // 1단계: 필수 필터 (도메인, 필수 키워드) - 반드시 통과해야 함
  const criticalFiltered = snippets.filter(snippet => {
    // 도메인 필터링 (필수)
    if (!isAllowedDomain(snippet.url)) {
      return false;
    }
    
    // 필수 키워드 확인 (제공된 경우만)
    if (requiredKeywords && requiredKeywords.length > 0) {
      const mode = searchConfig.requiredKeywordsMode as 'any' | 'all';
      const snippetText = `${snippet.title} ${snippet.snippet || ''}`;
      if (!containsKeywords(snippetText, requiredKeywords, mode)) {
        return false;
      }
    }
    
    return true;
  });
  
  // 필수 필터 통과한 것이 없을 때 - 안전한 절충안
  if (criticalFiltered.length === 0) {
    console.warn(
      '[⚠️ SNIPPET FILTER] 도메인 필터를 통과한 스니펫이 0개입니다. ' +
      '키워드 필터링을 시도합니다.'
    );
    
    // 1단계: 키워드 매칭 시도 (에이전트 이름 + 질문 키워드)
    const queryKeywords = userQuestion.toLowerCase()
      .split(/[\s,]+/)
      .filter(w => w.length > 2 && !['어디서', '어떻게', '왜', '무엇을', '누가'].includes(w));
    
    const keywordMatched = snippets.filter(snippet => {
      // 금지 도메인 제외
      try {
        const hostname = new URL(snippet.url).hostname.replace('www.', '');
        for (const denied of searchConfig.deniedDomains) {
          if (hostname.includes(denied)) {
            return false;
          }
        }
      } catch {
        return false;
      }
      
      // 에이전트 이름 또는 질문 키워드 매칭
      const snippetText = `${snippet.title} ${snippet.snippet || ''}`.toLowerCase();
      return agentName.split(/\s+/).some(name => snippetText.includes(name.toLowerCase())) ||
             queryKeywords.some(keyword => snippetText.includes(keyword));
    });
    
    if (keywordMatched.length > 0) {
      console.log(`[✅ 키워드 매칭] ${keywordMatched.length}개 발견 (안전한 절충안)`);
      return keywordMatched.slice(0, MIN_SNIPPETS_TO_GUARANTEE);
    }
    
    // 2단계: 키워드 매칭도 실패하면 빈 배열 반환 (Evidence 없음)
    console.warn('[❌ 절충안 실패] 키워드 매칭 0개 → Evidence 없음 반환');
    return [];
  }
  
  // 2단계: 관련성 필터 (에이전트 이름 OR 질문 키워드) - 완화
  const fullyFiltered = criticalFiltered.filter(snippet => {
    const snippetText = `${snippet.title} ${snippet.snippet || ''}`;
    
    // 질문 키워드 추출
    const questionKeywords = userQuestion
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length >= 2);
    
    // 완화된 관련성 체크: 에이전트 이름 OR 질문 키워드 중 하나라도 포함되면 OK
    const hasAgentName = containsAgentName(snippet, agentName);
    const hasQuestionKeyword = questionKeywords.length > 0 && 
                               containsKeywords(snippetText, questionKeywords, 'any');
    
    return hasAgentName || hasQuestionKeyword;
  });
  
  // 🛡️ 최소 스니펫 보장 안전장치 - 필수 필터만 통과한 스니펫에서 선택
  if (fullyFiltered.length < MIN_SNIPPETS_TO_GUARANTEE) {
    console.warn(
      `[⚠️ SNIPPET FILTER] 완전 필터링 후 ${fullyFiltered.length}개만 남음! ` +
      `필수 필터만 통과한 상위 ${MIN_SNIPPETS_TO_GUARANTEE}개를 강제 주입합니다.`
    );
    return criticalFiltered.slice(0, MIN_SNIPPETS_TO_GUARANTEE);
  }
  
  return fullyFiltered;
}

/**
 * 스니펫을 관련성 점수로 정렬
 * @param snippets 스니펫 배열
 * @param agentName 에이전트 이름
 * @param questionKeywords 질문 키워드
 * @returns 정렬된 스니펫 배열
 */
export function rankSnippets(
  snippets: SearchChunk[],
  agentName: string,
  questionKeywords: string[]
): SearchChunk[] {
  return snippets.sort((a, b) => {
    const textA = `${a.title} ${a.snippet || ''}`.toLowerCase();
    const textB = `${b.title} ${b.snippet || ''}`.toLowerCase();
    
    // 점수 계산: 에이전트 이름 + 질문 키워드 출현 빈도
    const scoreA = (textA.match(new RegExp(agentName.toLowerCase(), 'g')) || []).length +
                   questionKeywords.filter(k => textA.includes(k.toLowerCase())).length;
    const scoreB = (textB.match(new RegExp(agentName.toLowerCase(), 'g')) || []).length +
                   questionKeywords.filter(k => textB.includes(k.toLowerCase())).length;
    
    return scoreB - scoreA;
  });
}
