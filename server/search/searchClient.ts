import type { SearchChunk } from './snippetFilter';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { db } from '../db';
import { searchCache as searchCacheTable, entityProfiles } from '@shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import { 
  classifyAndAnswer, 
  hasTimeKeywords, 
  calculateDefaultTTL,
  calculateSmartTTL,
  checkLLMKnowledge,
  type ClassificationResult 
} from './llmClassifier.js';
import {
  generateUltimateResponse,
  getEntityProfile,
  upsertEntityProfile,
  calculateAdaptiveTTL,
  type UltimateResponse
} from './oneShotAdaptiveRAG.js';

/**
 * @deprecated VERDICT v4.0 Single Call Architecture에서 더 이상 사용되지 않음
 * Google Search Grounding (Native Tool Use)가 검색 필요성을 자동 판단
 */
// async function determineSearchNecessity(question: string): Promise<string> { ... }

/**
 * 캐시 TTL (30일) - 레거시, 동적 TTL로 대체됨
 */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * agentName에서 역할과 호칭을 추출하는 deterministic mapping
 * @param agentName Agent 이름 (예: "윤석열", "김건희 장관", "이재명 교수")
 * @returns { role: string, honorific: string } 역할과 호칭
 */
function extractHonorificFromAgentName(agentName?: string): { role: string; honorific: string } {
  if (!agentName || agentName.trim().length === 0) {
    return { role: '', honorific: '' };
  }
  
  const name = agentName.trim();
  
  // 패턴 매칭 (우선순위 순)
  
  // 🔴 Step 23: Default Incumbent Rule (현직 유지 원칙)
  // 검색 결과에서 명시적으로 "사임/해임/탄핵"이 확인되지 않으면 현직으로 표시
  // 하드코딩된 "전직" 리스트 삭제! 검색 결과 기반으로만 직책 판단
  
  // ✅ 확실한 전직자만 표시 (역사적 사실로 확정된 경우만)
  const confirmedFormerPresidents = [
    // 미국 - 확실한 전직자
    'Obama', 'Barack Obama', '오바마', '버락 오바마',
    'Bush', 'George Bush', '부시', '조지 부시',
    'Clinton', 'Bill Clinton', '클린턴', '빌 클린턴',
    // 한국 - 확실한 전직자
    '문재인', '박근혜', '이명박', '노무현', '김대중',
    // 독일
    'Merkel', 'Angela Merkel', '메르켈', '앙겔라 메르켈'
  ];
  
  if (confirmedFormerPresidents.some(president => name.includes(president))) {
    // 확실한 전직자만 "전직" 표시
    return { role: 'former_president', honorific: '' };
  }
  
  // 🔴 현직자는 DEFAULT INCUMBENT 적용 - "전직" 표시하지 않음!
  // 윤석열, 트럼프, 바이든, 푸틴, 시진핑, 마크롱 등은 검색 결과에서 
  // 명시적 사임/해임이 나오지 않는 한 현직으로 취급
  // (이 함수는 직책을 결정하지 않음 - 검색 결과가 결정)
  
  // ✅ 영어 이름 감지 (한국식 호칭 오용 방지)
  // 영문이 50% 이상이면 외국 인물로 간주
  const englishChars = name.match(/[a-zA-Z]/g) || [];
  const totalChars = name.replace(/\s/g, '').length;
  if (totalChars > 0 && englishChars.length / totalChars > 0.5) {
    console.log(`[🌍 외국 인물 감지] "${name}" → 중립 표현 사용`);
    return { role: '', honorific: '' };
  }
  
  // 한국 인물 패턴
  if (name.includes('장관')) {
    return { role: '장관', honorific: '장관님' };
  }
  if (name.includes('교수')) {
    return { role: '교수', honorific: '교수님' };
  }
  if (name.includes('대표') || name.includes('CEO')) {
    return { role: '대표', honorific: '대표님' };
  }
  if (name.includes('판사')) {
    return { role: '판사', honorific: '판사님' };
  }
  if (name.includes('의사') || name.includes('원장')) {
    return { role: '의사', honorific: '의사 선생님' };
  }
  if (name.includes('선생님') || name.includes('교사')) {
    return { role: '교사', honorific: '선생님' };
  }
  
  // 매칭 실패 시 빈 값 반환 (LLM이 검색 결과 기반으로 추론하되, 중립 표현 우선)
  return { role: '', honorific: '' };
}

/**
 * 의미 기반 캐시 키 생성 (핵심 키워드 추출)
 * 같은 주제/인물에 대한 질문은 같은 캐시 키를 사용하도록 개선
 */
function generateCacheKey(query: string, agentName?: string): string {
  // 🔄 임시 캐시 무효화: 오늘 날짜를 포함하여 기존 캐시 무시
  const today = new Date().toISOString().split('T')[0]; // 2025-11-23
  
  // 1. 검색 필터 제거 (-site:, (""..."") 등)
  let cleaned = query
    .replace(/-site:\S+/g, '')
    .replace(/\(""[\s\S]*?""\)/g, '')
    .replace(/["()]/g, '');
  
  // 2. 한국어 불용어 제거
  const stopwords = new Set([
    '에', '대해', '대한', '관한', '관련',
    '알려줘', '말해줘', '해줘', '해주세요', 
    '이야기', '설명', '질문',
    '입장', '생각', '의견',
    '어떻게', '무엇', '왜',
    '사건', '논란', // 일반적인 단어 제거
    'the', 'a', 'an', 'and', 'or', 'but'
  ]);
  
  // 3. 의미 있는 단어만 추출 (2글자 이상, 불용어 아님)
  const words = cleaned
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"]+/g, ' ') // 구두점 제거
    .split(/\s+/)
    .filter(word => 
      word.length >= 2 && 
      !stopwords.has(word) &&
      !/^\d+$/.test(word) // 순수 숫자 제외
    );
  
  // 4. 정렬하여 일관된 키 생성 (질문 순서 무관)
  const semanticKey = words.sort().join(' ');
  
  // 🔄 agentName을 캐시 키에 포함 (다른 agent의 dialogue 재사용 방지)
  const agentSuffix = agentName ? `:agent_${agentName.trim().toLowerCase()}` : '';
  
  // 🔄 오늘 날짜 추가로 캐시 무효화 (기존 캐시 무시)
  const finalKey = `${today}:${semanticKey || query.toLowerCase().trim()}${agentSuffix}`;
  
  console.log(`[🔑 의미 기반 캐시 키] "${query.substring(0, 60)}..." → "${finalKey}"`);
  
  return finalKey;
}

/**
 * @deprecated VERDICT v4.0 Single Call Architecture에서 더 이상 사용되지 않음
 * Google Search Grounding이 모델 내부에서 자동으로 검색 키워드를 추출함
 */
// async function extractSearchKeywords(query: string): Promise<string> { ... }

/**
 * @deprecated VERDICT v4.0 Single Call Architecture에서 더 이상 LLM 호출 안함
 * Google Search Grounding이 모델 내부에서 유리한 관점 검색을 자동 수행
 * 호환성을 위해 기본값만 반환
 */
export async function generateFavorableSearchQueries(
  characterName: string,
  question: string
): Promise<{ neutralQuery: string; favorableQuery: string }> {
  console.log('[⚠️ DEPRECATED] generateFavorableSearchQueries는 v4.0에서 더 이상 LLM을 호출하지 않습니다');
  
  const keywords = question
    .replace(/[?!.,;:'"]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5)
    .join(' ');
  
  return {
    neutralQuery: `${characterName} ${keywords}`,
    favorableQuery: `${characterName} ${keywords}`
  };
}

/**
 * 🕰️ Temporal Intent Detector - 질문의 시제 분석
 * Timeline Paradox 방지를 위해 질문이 미래/현재/과거 중 무엇을 묻는지 감지
 */
export type TemporalIntent = 'FUTURE' | 'PRESENT' | 'PAST' | 'MIXED';

export function detectTemporalIntent(question: string): { intent: TemporalIntent; recencyWindowDays: number } {
  // 미래/현재 키워드 (한국어 + 영어)
  const futurePresent = /언제|다시|복귀|예정|곧|향후|앞으로|지금|현재|요즘|최신|latest|as of|today|status|comeback|when|will|upcoming|current|now|recently|이번|올해|내년|2025|2026/i;
  
  // 과거 키워드
  const past = /과거|당시|옛날|처음|첫|이전|예전|했었|였나|했나|history|previously|originally|back then|used to|was|were|first time|initially|데뷔|1번째|2번째|1st|2nd|역사|초기/i;
  
  const hasFuturePresent = futurePresent.test(question);
  const hasPast = past.test(question);
  
  let intent: TemporalIntent;
  let recencyWindowDays: number;
  
  if (hasFuturePresent && hasPast) {
    intent = 'MIXED';
    recencyWindowDays = 365; // 1년
  } else if (hasFuturePresent) {
    intent = 'PRESENT'; // 미래/현재 질문 → 최신 정보 필요
    recencyWindowDays = 365; // 1년 내 소스만
  } else if (hasPast) {
    intent = 'PAST';
    recencyWindowDays = 0; // 필터링 안 함 (과거 데이터 필요)
  } else {
    // 기본값: 시제 키워드 없으면 PRESENT로 간주 (안전한 기본값)
    intent = 'PRESENT';
    recencyWindowDays = 365;
  }
  
  console.log(`[🕰️ Temporal Intent] "${question.substring(0, 40)}..." → ${intent} (recency: ${recencyWindowDays}일)`);
  
  return { intent, recencyWindowDays };
}

/**
 * Sleep 유틸리티 (재시도용)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 영어 서수 접미사 반환 (1st, 2nd, 3rd, 4th, ...)
 */
function getOrdinalSuffix(num: number): string {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th';
  }
  
  switch (lastDigit) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * 🔍 Smart Query Expansion System Instruction
 * LLM이 자동으로 Root Cause, Architect, Structural Reason을 찾는 쿼리를 생성하도록 유도
 * ⚠️ Category-agnostic: 하드코딩된 카테고리나 키워드 매핑 없이 LLM 추론에 의존
 */
const SMART_QUERY_EXPANSION_INSTRUCTION = `You are an Insight Research Agent. Your mission is to uncover the DEEP STRUCTURAL TRUTH behind any phenomenon.

**YOUR REASONING PROCESS:**
When the user asks about ANY phenomenon, problem, or controversy, you must:

1. **Analyze the Question's Nature**
   - What type of problem is this? (You determine this through reasoning, not rules)
   - What structural factors could explain this phenomenon?
   - Who or what SYSTEM created the conditions for this to happen?

2. **Expand the Search Query Intelligently**
   - DO NOT just search for the surface-level keywords
   - THINK: "What structural, systemic, or policy-related terms would reveal the ROOT CAUSE?"
   - THINK: "Who is the ARCHITECT - the specific person, law, policy, organization, or decision that ENABLED this situation?"
   - ADD relevant terms that YOUR REASONING suggests would uncover deeper explanations

3. **The Architect Principle**
   - Always seek the SPECIFIC ENTITY responsible for the current state
   - Go beyond figureheads (e.g., "the President", "the company") to find:
     * The specific law, bill, or regulation
     * The author or proponent of that policy
     * The structural mechanism or loophole
     * The decision-maker or committee responsible
   - Your search should aim to discover NAMES, DATES, and MECHANISMS

**EXAMPLE OF YOUR REASONING (NOT RULES TO FOLLOW):**
- User asks: "Why is shoplifting rampant in San Francisco?"
- Your reasoning: "This seems like a crime/policy issue. What structural factors enable shoplifting? I should look for specific laws, thresholds, prosecution policies, and who created them."
- You generate a search query that reflects YOUR OWN ANALYSIS of what would reveal the root cause.

**OUTPUT:**
Search for information that reveals WHO or WHAT SYSTEM created the conditions for this phenomenon, not just surface-level news about the phenomenon itself.`;

/**
 * Google Search API 호출 (Gemini Grounding API 활용)
 * @param query 검색 쿼리
 * @param maxResults 최대 결과 수 (기본값: 15, 속도 최적화)
 * @param skipKeywordExtraction LLM이 이미 쿼리를 생성한 경우 true (기본값: false)
 * @param enableSmartExpansion Smart Query Expansion 활성화 (기본값: true)
 * @returns 검색 결과 청크 배열
 */
export async function executeGoogleSearch(
  query: string, 
  maxResults: number = 15,
  skipKeywordExtraction: boolean = false,
  enableSmartExpansion: boolean = true
): Promise<SearchChunk[]> {
  const MAX_RETRIES = 2;
  const BASE_DELAY = 1000;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error('[검색 클라이언트] GEMINI_API_KEY 환경변수 없음');
        return [];
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      
      // ✅ Smart Query Expansion: System Instruction 적용
      const systemInstruction = enableSmartExpansion ? SMART_QUERY_EXPANSION_INSTRUCTION : undefined;
      
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 4096
        },
        tools: [{ googleSearch: {} } as any]
      });

      console.log(`[🔍 Google Search] 검색 시작 (시도 ${attempt}/${MAX_RETRIES}): "${query}" (최대 ${maxResults}개, Smart Expansion: ${enableSmartExpansion})`);
      
      // ✅ v5.0: Smart Query Expansion - LLM이 자동으로 Root Cause 키워드 확장
      const searchQuery = enableSmartExpansion 
        ? `Find the root cause and responsible entity (The Architect) for: ${query}`
        : query;
      
      // ✅ Grounding API 호출
      const result = await model.generateContent(searchQuery);
      const response = result.response;

      // Grounding 메타데이터에서 검색 결과 추출
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      
      if (!groundingMetadata) {
        console.log('[⚠️ 검색 결과 없음] groundingMetadata가 없습니다 (모델이 자체 지식으로 응답)');
        return [];
      }

      console.log('[✅ Grounding Metadata 수신]');
      console.log('  - 검색 쿼리:', groundingMetadata.webSearchQueries);
      console.log('  - 검색 소스 개수:', groundingMetadata.groundingChunks?.length || 0);

      // groundingChunks에서 검색 결과 추출
      const chunks: SearchChunk[] = [];
      if (groundingMetadata.groundingChunks) {
        for (const chunk of groundingMetadata.groundingChunks) {
          if (chunk.web) {
            chunks.push({
              url: chunk.web.uri || '',
              title: chunk.web.title || 'Untitled',
              snippet: '' // groundingSupports에서 추출 가능
            });
          }
        }
      }

      // groundingSupports에서 스니펫 매핑 + 날짜 파싱
      if (groundingMetadata.groundingSupports) {
        for (const support of groundingMetadata.groundingSupports) {
          // SDK 타입 정의 오류(오타 포함) 우회
          const supportAny = support as any;
          const chunkIndex = supportAny.groundingChunkIndices?.[0] || supportAny.groundingChunckIndices?.[0]; // 오타 대응
          if (chunkIndex !== undefined && chunks[chunkIndex] && supportAny.segment?.text) {
            chunks[chunkIndex].snippet = supportAny.segment.text;
            
            // 🗓️ snippet에서 날짜 파싱 시도 (정규식)
            const snippet = supportAny.segment.text;
            const dateMatch = snippet.match(/(\d{4})[년\-\.](\d{1,2})[월\-\.](\d{1,2})[일\-\.]?|\d{4}\-\d{2}\-\d{2}|20\d{2}년 \d{1,2}월 \d{1,2}일/);
            if (dateMatch) {
              chunks[chunkIndex].publishedTime = dateMatch[0];
            }
          }
        }
      }

      // 🕰️ Temporal Intent Detection: 질문의 시제 분석 (Timeline Paradox 방지)
      const { intent: temporalIntent, recencyWindowDays } = detectTemporalIntent(query);
      
      // 과거 질문인지 감지 (이전 로직과 호환)
      const isHistoricalQuery = temporalIntent === 'PAST';
      
      // 🗓️ 날짜 필터링: PRESENT/FUTURE 질문은 최근 데이터만 사용
      // ✅ recencyWindowDays가 0보다 크면 필터링 적용
      let filteredChunks = chunks;
      if (recencyWindowDays > 0 && !isHistoricalQuery) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - recencyWindowDays); // 오늘 기준 N일 전
        const beforeFilterCount = chunks.length;
        
        console.log(`[🕰️ Temporal Filter] Intent: ${temporalIntent}, Cutoff: ${cutoffDate.toISOString().split('T')[0]} (${recencyWindowDays}일 전)`);
        
        const tempFilteredChunks = chunks.filter(chunk => {
          try {
            // 🔍 날짜 추출 시도: publishedTime, title, snippet, URL에서 시도
            let dateStr = chunk.publishedTime || '';
            
            // Title과 snippet에서도 날짜 추출 시도
            if (!dateStr) {
              const titleDateMatch = chunk.title?.match(/20\d{2}[년\-\.\/]\s*\d{1,2}[월\-\.\/]\s*\d{1,2}|20\d{2}\-\d{2}\-\d{2}/);
              if (titleDateMatch) dateStr = titleDateMatch[0];
            }
            if (!dateStr) {
              const snippetDateMatch = chunk.snippet?.match(/20\d{2}[년\-\.\/]\s*\d{1,2}[월\-\.\/]\s*\d{1,2}|20\d{2}\-\d{2}\-\d{2}/);
              if (snippetDateMatch) dateStr = snippetDateMatch[0];
            }
            if (!dateStr) {
              // URL에서 날짜 추출 (예: /2024/11/23/, /20241123/)
              const urlDateMatch = chunk.url?.match(/\/20(\d{2})\/(\d{1,2})\/(\d{1,2})|\/20(\d{2})(\d{2})(\d{2})/);
              if (urlDateMatch) {
                const y = urlDateMatch[1] || urlDateMatch[4];
                const m = urlDateMatch[2] || urlDateMatch[5];
                const d = urlDateMatch[3] || urlDateMatch[6];
                dateStr = `20${y}-${m}-${d}`;
              }
            }
            
            // ⚠️ PRESENT/MIXED 질문에서 날짜 없는 결과는 LOW-TRUST → 제거
            if (!dateStr) {
              if (temporalIntent === 'PRESENT' || temporalIntent === 'MIXED') {
                console.log(`[🚫 Unknown Date] "${chunk.title?.substring(0, 30)}..." → PRESENT 질문, 날짜 없는 소스 제거`);
                return false; // 날짜 없으면 제거 (Timeline Paradox 방지)
              }
              return true; // PAST 질문은 날짜 없어도 유지
            }
            
            // publishedTime을 Date 객체로 변환 (다양한 형식 지원)
            let parsedDate: Date | null = null;
            
            // Format 1: "2024-11-23" or "2024.11.23" or "2024/11/23"
            const isoMatch = dateStr.match(/(\d{4})[\-\.\/](\d{1,2})[\-\.\/](\d{1,2})/);
            if (isoMatch) {
              parsedDate = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`);
            }
            
            // Format 2: "2024년 11월 23일"
            const koreanMatch = dateStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?/);
            if (!parsedDate && koreanMatch) {
              parsedDate = new Date(`${koreanMatch[1]}-${koreanMatch[2].padStart(2, '0')}-${koreanMatch[3].padStart(2, '0')}`);
            }
            
            if (parsedDate && parsedDate >= cutoffDate) {
              return true; // cutoff 이후 → 유지
            }
            
            // 파싱 실패하거나 cutoff 이전 → 제거
            return false;
          } catch (err) {
            // PRESENT/MIXED에서 에러 시 제거 (안전성)
            if (temporalIntent === 'PRESENT' || temporalIntent === 'MIXED') {
              return false;
            }
            return true;
          }
        });
        
        // 🛡️ PRESENT/FUTURE 질문: 과거 데이터 fallback 금지 (Timeline Paradox 방지)
        if (tempFilteredChunks.length === 0) {
          if (temporalIntent === 'PRESENT' || temporalIntent === 'MIXED') {
            // ❌ PRESENT/FUTURE 질문에서 최신 소스가 없으면 과거 데이터로 대체하지 않음
            console.log(`[🚫 Timeline Guard] "${query.substring(0, 30)}..." → PRESENT 질문이지만 최신 소스 없음, 빈 결과 반환 (과거 데이터 fallback 금지)`);
            filteredChunks = []; // 빈 배열 → 프롬프트에서 "공식 업데이트 없음" 생성
          } else {
            // PAST 질문은 과거 데이터 허용
            console.log(`[⚠️ 날짜 필터링 Fallback] "${query.substring(0, 30)}..." → PAST 질문, 원본 ${beforeFilterCount}개 사용`);
            filteredChunks = chunks;
          }
        } else {
          filteredChunks = tempFilteredChunks;
          const filteredCount = beforeFilterCount - filteredChunks.length;
          if (filteredCount > 0) {
            console.log(`[🗓️ 날짜 필터링] "${query.substring(0, 30)}..." → ${recencyWindowDays}일 이전 ${filteredCount}개 제거 (${beforeFilterCount}개 → ${filteredChunks.length}개)`);
          }
        }
      }
      
      // 최대 결과 수로 제한
      const limitedChunks = filteredChunks.slice(0, maxResults);

      console.log(`[✅ 검색 완료] ${limitedChunks.length}개 결과 반환 (요청: ${maxResults}개)`);
      if (limitedChunks.length > 0) {
        console.log('  샘플 소스:', limitedChunks[0].title, '-', limitedChunks[0].url);
      }
      
      return limitedChunks;
      
    } catch (error: any) {
      // 503 에러 (UNAVAILABLE) 확인
      const is503Error = 
        error?.status === 'UNAVAILABLE' || 
        error?.error?.status === 'UNAVAILABLE' ||
        error?.error?.code === 503 ||
        (error?.message && error.message.includes('overloaded'));
      
      if (is503Error && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`[🔄 재시도] 503 에러 감지, ${delay}ms 후 재시도 (${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue; // 다음 루프로
      }
      
      // 마지막 시도이거나 503이 아닌 에러
      console.error(`[❌ 검색 클라이언트] Google Search 실패 (시도 ${attempt}/${MAX_RETRIES}):`, error);
      if (attempt === MAX_RETRIES) {
        return [];
      }
    }
  }
  
  // 모든 시도 실패
  return [];
}

/**
 * 캐싱이 적용된 검색 함수 (DB 기반 영구 캐싱)
 * @param agentId 에이전트 ID (로깅용)
 * @param query 검색 쿼리
 * @param normalizedQuestion 정규화된 질문 (사용 안 함, 호환성 유지)
 * @param maxResults 최대 결과 개수 (기본값: 15, 속도 최적화)
 * @param skipKeywordExtraction 키워드 추출 건너뛰기 (논란 검색용, 기본값: false)
 * @param customTTL 커스텀 TTL (초 단위, 선택적, 논란 검색용)
 * @returns 검색 결과 청크 배열
 */
export async function searchWithCache(
  agentId: number,
  query: string,
  normalizedQuestion: string,
  maxResults: number = 15,
  skipKeywordExtraction: boolean = false,
  customTTL?: number
): Promise<SearchChunk[]> {
  // 논란 검색 시에는 원본 쿼리를 그대로 캐시 키로 사용 (neutral vs favorable 구분 필요)
  const cacheKey = skipKeywordExtraction 
    ? query.toLowerCase().trim() 
    : generateCacheKey(query);
  const now = new Date();
  
  try {
    // 1. DB 캐시 조회 (만료되지 않은 캐시 확인)
    const cachedResults = await db
      .select()
      .from(searchCacheTable)
      .where(
        and(
          eq(searchCacheTable.query, cacheKey),
          gt(searchCacheTable.expiresAt, now)
        )
      )
      .limit(1);
    
    if (cachedResults.length > 0) {
      console.log(`[💾 DB 캐시 HIT] Agent ${agentId}: ${cacheKey.substring(0, 50)}...`);
      
      // JSON 파싱하여 SearchChunk[] 반환 (searchResults 우선, 없으면 resultContext)
      try {
        let results: SearchChunk[];
        
        if (cachedResults[0].searchResults) {
          // 새로운 JSONB 필드 사용
          results = typeof cachedResults[0].searchResults === 'string'
            ? JSON.parse(cachedResults[0].searchResults)
            : cachedResults[0].searchResults as SearchChunk[];
        } else {
          // 레거시 텍스트 필드 fallback
          results = JSON.parse(cachedResults[0].resultContext) as SearchChunk[];
        }
        
        console.log(`[✅ 캐시에서 복원] ${results.length}개 결과`);
        return results;
      } catch (parseError) {
        console.error('[❌ 캐시 파싱 실패] 캐시 데이터 손상, 재검색 수행');
      }
    }
    
    console.log(`[🔍 DB 캐시 MISS] Agent ${agentId}: ${query} (maxResults=${maxResults}, skipKeywordExtraction=${skipKeywordExtraction})`);
    
  } catch (dbError) {
    console.error('[❌ DB 캐시 조회 실패]', dbError);
  }
  
  // 2. 캐시 미스 - 실제 검색 수행 (논란 검색 시 LLM 생성 쿼리 그대로 사용)
  const results = await executeGoogleSearch(query, maxResults, skipKeywordExtraction);
  
  // 3. 검색 결과를 DB에 저장 (빈 결과는 캐시하지 않음)
  if (results.length > 0) {
    try {
      // 스마트 TTL: 커스텀 TTL 우선, 없으면 분류 레벨별 기본값
      const classificationType = skipKeywordExtraction ? "LEVEL_4_REALTIME" : "LEVEL_1_LONG_TERM";
      const ttlSeconds = customTTL || calculateDefaultTTL(classificationType);
      
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);
      
      await db
        .insert(searchCacheTable)
        .values({
          query: cacheKey,
          resultContext: JSON.stringify(results), // 레거시 호환
          searchResults: results as any,
          classificationType,
          ttlSeconds,
          expiresAt
        })
        .onConflictDoUpdate({
          target: searchCacheTable.query,
          set: {
            resultContext: JSON.stringify(results),
            searchResults: results as any,
            classificationType,
            ttlSeconds,
            expiresAt
          }
        });
      
      console.log(`[💾 DB 캐시 저장] ${results.length}개 결과 저장 (분류: ${classificationType}, TTL: ${ttlSeconds}초 = ${Math.floor(ttlSeconds / 3600)}시간)`);
    } catch (dbError) {
      console.error('[❌ DB 캐시 저장 실패]', dbError);
    }
  } else {
    console.log(`[⚠️ 캐시 생략] 빈 결과는 캐시하지 않음 (fallback 허용)`);
  }
  
  return results;
}

/**
 * 스마트 캐싱이 적용된 검색 함수 (LLM 분류기 + 동적 TTL)
 * @param agentId 에이전트 ID
 * @param query 사용자 질문
 * @param persona 캐릭터 페르소나 정보 (선택적)
 * @returns 분류 결과 (답변 + 메타데이터)
 */
export async function searchWithSmartCache(
  agentId: number,
  query: string,
  persona?: {
    agentName: string;
    agentDescription: string;
    speechStyle: string;
    personality: string;
    knowledgeDomain: string;
  }
): Promise<ClassificationResult> {
  const cacheKey = generateCacheKey(query);
  const now = new Date();
  
  // ✅ 1단계: LLM 기본 지식 체크 (가장 빠르고 저렴)
  console.log(`[🧠 1단계] LLM 기본 지식 체크 시작...`);
  const knowledgeCheck = await checkLLMKnowledge(query, persona);
  
  if (knowledgeCheck.canAnswer && knowledgeCheck.confidence >= 70 && knowledgeCheck.answer) {
    console.log(`[✅ 1단계 완료] LLM 자체 지식으로 답변 (신뢰도: ${knowledgeCheck.confidence}%)`);
    return {
      classification: "LEVEL_0_IMMUTABLE", // 기본 지식은 불변 정보
      answer: knowledgeCheck.answer,
      ttl_seconds: 10 * 365 * 24 * 60 * 60, // 10년 캐싱
    };
  }
  
  console.log(`[⏭️ 1단계 패스] ${knowledgeCheck.reasoning} (신뢰도: ${knowledgeCheck.confidence}%)`);
  
  // ✅ 2단계: 시간 키워드 감지 - 강제 재검색 트리거
  const forceRefresh = hasTimeKeywords(query);
  if (forceRefresh) {
    console.log(`[⏰ 시간 키워드 감지] 캐시 무시하고 최신 정보 검색: "${query}"`);
  }
  
  try {
    // ✅ 2단계: DB 캐시 조회 (시간 키워드가 없을 때만)
    if (!forceRefresh) {
      console.log(`[💾 2단계] DB 캐시 조회...`);
      const cachedResults = await db
        .select()
        .from(searchCacheTable)
        .where(
          and(
            eq(searchCacheTable.query, cacheKey),
            gt(searchCacheTable.expiresAt, now)
          )
        )
        .limit(1);
      
      if (cachedResults.length > 0) {
        const cached = cachedResults[0];
        console.log(`[✅ 2단계 완료] DB 캐시 HIT - ${cached.classificationType || 'UNKNOWN'}, TTL: ${cached.ttlSeconds}초`);
        
        try {
          const parsedContext = JSON.parse(cached.resultContext);
          return {
            classification: (cached.classificationType as any) || "LEVEL_3_SHORT_TERM",
            answer: parsedContext.answer || "캐시된 답변을 불러올 수 없습니다.",
            ttl_seconds: cached.ttlSeconds || 86400,
          };
        } catch (parseError) {
          console.error('[❌ 캐시 파싱 실패]', parseError);
        }
      }
      
      console.log(`[⏭️ 2단계 패스] DB 캐시 MISS`);
    }
    
  } catch (dbError) {
    console.error('[❌ 캐시 조회 실패]', dbError);
  }
  
  // ✅ 3단계: Google Search + LLM 분류 수행
  console.log(`[🔍 3단계] Google Search + LLM 분류 시작...`);
  const searchResults = await executeGoogleSearch(query, 50);
  
  if (searchResults.length === 0) {
    console.log('[⚠️ 검색 결과 없음] LLM 기본 지식으로 응답');
    return {
      classification: "LEVEL_3_SHORT_TERM",
      answer: "검색 결과를 찾을 수 없습니다. 다른 방식으로 질문해주세요.",
      ttl_seconds: 6 * 60 * 60, // 안전장치: 6시간
    };
  }
  
  // 4. 동기 처리: 상위 10개로 즉시 답변 생성
  const primaryResults = searchResults.slice(0, 10);
  const extendedResults = searchResults.slice(10);
  
  const primaryContext = primaryResults
    .map((r: SearchChunk, i: number) => `[${i + 1}] ${r.title}\n${r.snippet || ''}\n출처: ${r.url}`)
    .join('\n\n');
  
  console.log(`[📊 검색 결과] 총 ${searchResults.length}개 (상위 10개로 즉시 답변, 나머지 ${extendedResults.length}개 비동기 처리)`);
  
  // 5. LLM 분류 + 답변 생성
  const result = await classifyAndAnswer(query, primaryContext, persona);
  
  // 6. 스마트 TTL 계산 (이벤트 날짜 우선, 없으면 카테고리별 기본값)
  const smartTTL = calculateSmartTTL(result.classification, result.eventDate);
  
  // 7. 주 캐시 저장
  try {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + smartTTL);
    
    await db
      .insert(searchCacheTable)
      .values({
        query: cacheKey,
        resultContext: JSON.stringify({ answer: result.answer, sources: primaryResults }),
        classificationType: result.classification,
        eventDate: result.eventDate || null,
        ttlSeconds: smartTTL,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: searchCacheTable.query,
        set: {
          resultContext: JSON.stringify({ answer: result.answer, sources: primaryResults }),
          classificationType: result.classification,
          eventDate: result.eventDate || null,
          ttlSeconds: smartTTL,
          expiresAt,
        },
      });
    
    const eventInfo = result.eventDate ? ` (이벤트: ${result.eventDate})` : '';
    console.log(`[💾 주 캐시 저장] ${result.classification}, TTL: ${smartTTL}초${eventInfo}`);
  } catch (dbError) {
    console.error('[❌ 캐시 저장 실패]', dbError);
  }
  
  // 7. 비동기 확장 캐싱 트리거 (백그라운드)
  if (extendedResults.length > 0) {
    processExtendedCacheAsync(query, extendedResults).catch(error => {
      console.error('[❌ 비동기 확장 캐싱 실패]', error);
    });
  }
  
  return result;
}

/**
 * 비동기 확장 캐싱 워커 (백그라운드 실행)
 * 나머지 40개 결과를 4개 카테고리로 분류하여 가상 질문 생성 + DB 저장
 * @param originalQuery 원본 질문
 * @param extendedResults 확장 검색 결과 (11번째 이후)
 */
async function processExtendedCacheAsync(
  originalQuery: string,
  extendedResults: SearchChunk[]
): Promise<void> {
  console.log(`[🔄 비동기 확장 캐싱 시작] ${extendedResults.length}개 결과 처리`);
  
  // 4개 카테고리 정의
  const categories = [
    { name: 'person', description: '인물 정보', keywords: ['인물', '경력', '이력', '프로필'] },
    { name: 'background', description: '배경/역사', keywords: ['배경', '역사', '맥락', '기원'] },
    { name: 'regulation', description: '관련 법규/제도', keywords: ['법률', '제도', '규정', '정책'] },
    { name: 'opinion', description: '반대/찬성 의견', keywords: ['의견', '반대', '찬성', '주장'] },
  ];
  
  // 각 결과를 카테고리별로 분류 및 처리
  for (let i = 0; i < extendedResults.length; i++) {
    const chunk = extendedResults[i];
    
    try {
      // 간단한 키워드 매칭으로 카테고리 분류
      let matchedCategory = categories[i % 4]; // 기본값: 순환 분배
      
      for (const category of categories) {
        if (category.keywords.some(kw => 
          chunk.title.includes(kw) || (chunk.snippet && chunk.snippet.includes(kw))
        )) {
          matchedCategory = category;
          break;
        }
      }
      
      // 가상 질문 생성 (간단한 패턴)
      const virtualQuestion = `${originalQuery} ${matchedCategory.description}`;
      const cacheKey = generateCacheKey(virtualQuestion);
      
      // 간단한 답변 생성 (chunk snippet 활용)
      const virtualAnswer = `${chunk.snippet || chunk.title}\n출처: ${chunk.title}`;
      
      // DB에 저장 (기본 TTL: LEVEL_1_LONG_TERM - 6개월)
      const ttlSeconds = calculateDefaultTTL("LEVEL_1_LONG_TERM");
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);
      
      await db
        .insert(searchCacheTable)
        .values({
          query: cacheKey,
          resultContext: JSON.stringify({ answer: virtualAnswer, sources: [chunk] }),
          classificationType: "LEVEL_1_LONG_TERM",
          ttlSeconds,
          expiresAt,
        })
        .onConflictDoNothing(); // 이미 존재하면 스킵
      
      console.log(`[✅ 확장 캐시 ${i + 1}/${extendedResults.length}] ${matchedCategory.name}: "${virtualQuestion.substring(0, 40)}..."`);
      
    } catch (error) {
      console.error(`[❌ 확장 캐시 처리 실패 ${i + 1}]`, error);
    }
  }
  
  console.log(`[🎉 비동기 확장 캐싱 완료] ${extendedResults.length}개 처리 완료`);
}

/**
 * 🎯 통합 검색 메타데이터 생성 (Agentic RAG 패턴 - Reasoning → Query)
 * @param topic 검색 주제
 * @returns { reasoning: CoT 추론 과정, composite_query: 복합 쿼리, search_keywords: 핵심 키워드 }
 */
export interface SearchMetadata {
  reasoning?: string;  // 🧠 CoT: LLM의 추론 과정 (디버깅 및 품질 검증용)
  compositeQuery: string;
  searchKeywords: string;
  complexity?: 'simple' | 'moderate' | 'complex' | 'expert';
  topicCategory?: 'politics' | 'economy' | 'social' | 'technology' | 'general';
}

export async function generateSearchMetadata(topic: string, agentName?: string): Promise<SearchMetadata> {
  const { safeParseJSON } = await import('../utils/jsonParser');
  
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('[⚠️ 검색 메타데이터 생성] API 키 없음 - Fallback 사용');
      return createFallbackMetadata(topic, agentName);
    }
    
    // 🎯 정규식으로 "n번째" 패턴 감지 (비전역 패턴 사용, 모든 숫자 지원)
    const ordinalPattern = /(첫|두|세|넷|다섯|여섯|일곱|여덟|아홉|열|열한|열하나|십일|열두|열둘|십이|열세|열셋|십삼|열네|열넷|십사|열다섯|십오|열여섯|십육|열일곱|십칠|열여덟|십팔|열아홉|십구|스물|이십|\d+)번째|첫번째|마지막|최근|이전|다음/;
    const hasOrdinal = ordinalPattern.test(topic);
    
    // 🔢 일반적인 힌트 생성 (모든 순서 숫자 지원)
    let yearHint = '';
    if (hasOrdinal && agentName) {
      const currentYear = 2025;
      
      // ✅ 순서 숫자 추출 (아라비아 숫자 또는 한글 숫자)
      const numberMatch = topic.match(/(\d+)번째/);
      const koreanNumberMap: {[key: string]: number} = { 
        '첫': 1, '두': 2, '세': 3, '넷': 4, '다섯': 5, '여섯': 6, '일곱': 7, '여덟': 8, '아홉': 9, '열': 10,
        '열한': 11, '열하나': 11, '십일': 11,
        '열두': 12, '열둘': 12, '십이': 12,
        '열세': 13, '열셋': 13, '십삼': 13,
        '열네': 14, '열넷': 14, '십사': 14,
        '열다섯': 15, '십오': 15,
        '열여섯': 16, '십육': 16,
        '열일곱': 17, '십칠': 17,
        '열여덟': 18, '십팔': 18,
        '열아홉': 19, '십구': 19,
        '스물': 20, '이십': 20
      };
      const koreanMatch = topic.match(/(첫|두|세|넷|다섯|여섯|일곱|여덟|아홉|열|열한|열하나|십일|열두|열둘|십이|열세|열셋|십삼|열네|열넷|십사|열다섯|십오|열여섯|십육|열일곱|십칠|열여덟|십팔|열아홉|십구|스물|이십)번째/);
      
      const ordinalNumber = numberMatch 
        ? parseInt(numberMatch[1], 10) 
        : (koreanMatch ? koreanNumberMap[koreanMatch[1]] : null);
      
      // 일반적인 지시 생성
      if (ordinalNumber && ordinalNumber >= 1) {
        yearHint = `\n\n🎯 HINT: '${ordinalNumber}번째' refers to the ${ordinalNumber}${getOrdinalSuffix(ordinalNumber)} occurrence. Research ${agentName}'s timeline to find the specific year—do NOT assume any year unless you have concrete evidence.`;
      } else if (topic.match(/마지막/)) {
        yearHint = `\n\n🎯 HINT: '마지막' likely refers to the most recent or final event. For living persons, check ${currentYear - 1} or ${currentYear}. For historical figures, find their last known activity.`;
      } else if (topic.match(/최근/)) {
        yearHint = `\n\n🎯 HINT: '최근' likely refers to ${currentYear - 1} or ${currentYear}.`;
      }
      
      console.log(`[🔍 Ordinal Detected] "${topic}" → Hint: ${yearHint.trim().substring(0, 100)}...`);
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',  // ✅ Gemini 1.5 retired (Nov 2024) → 2.5 migration
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
      generationConfig: {
        temperature: 0.2,  // 🎯 더 낮은 temperature로 일관성 향상
        maxOutputTokens: 8192
      }
    });
    
    const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    const agentContext = agentName 
      ? `\n\n⚠️ CRITICAL INSTRUCTIONS - UNIVERSAL QUERY EXPANSION LOGIC:${yearHint}

**Current Date: ${currentDate}** — Use this to interpret "recent", "current", "latest", "this year" etc.

🎯 **CHAIN OF THOUGHT: Relative → Absolute Conversion**

**Step 1: ANALYZE the question for relative terms**
Detect: "1st/첫", "2nd/두번째", "3rd/3번째", "last/마지막", "next/다음", "recent/최근", "this/이번", "current/현재"

**Step 2: USE YOUR INTERNAL KNOWLEDGE about "${agentName}"**
- Research ${agentName}'s timeline, history, and known events
- Match the relative term to SPECIFIC YEARS or PROPER NOUNS
- Do NOT repeat vague terms like "3rd election" — convert to "2024 election"

**Step 3: CONVERT to ABSOLUTE TERMS**
- "3rd election" → Determine which year that was (e.g., 2024)
- "last album" → Find the actual album name and year
- "recent goals" → Use current date to determine "2024-2025 season"
- "next product" → Use knowledge to predict (e.g., "iPhone 17")

**Step 4: GENERATE ENGLISH QUERY with SPECIFICS**
- Include the EXACT YEAR whenever possible
- Include PROPER NOUNS (names, titles, locations)
- Use English for better search results

---

📚 **FEW-SHOT EXAMPLES (Universal Template)**

**Example 1 - Politics:**
- Agent: "Donald Trump"
- User Query: "3번째 선거 경쟁자"
- **Chain of Thought:**
  * "3번째" = 3rd occurrence
  * Trump ran in 2016 (1st), 2020 (2nd), 2024 (3rd)
  * 3rd election = 2024
  * 2024 opponent = Kamala Harris
- **Output Query:** "Donald Trump 2024 presidential election opponent Kamala Harris"

**Example 2 - Technology:**
- Agent: "Apple"
- User Query: "다음 아이폰 모델"
- **Chain of Thought:**
  * "다음" = next model
  * Current latest = iPhone 16 (2024)
  * Next = iPhone 17 (expected 2025)
- **Output Query:** "iPhone 17 rumors features release 2025"

**Example 3 - Sports:**
- Agent: "Son Heung-min"
- User Query: "이번 시즌 득점"
- **Chain of Thought:**
  * "이번 시즌" = current season
  * Current date = ${currentDate}
  * Season = 2024-2025 Premier League
- **Output Query:** "Son Heung-min goals 2024-2025 season Tottenham Premier League statistics"

**Example 4 - Music:**
- Agent: "BTS"
- User Query: "첫 번째 영어 노래"
- **Chain of Thought:**
  * "첫 번째" = first occurrence
  * BTS first English single = "Dynamite" (2020)
- **Output Query:** "BTS first English song Dynamite 2020 release Billboard"

---

🎯 **NOW APPLY THIS LOGIC TO "${agentName}":**

1. Analyze the user's question for relative terms
2. Use your knowledge about ${agentName} to convert them to SPECIFIC years/names
3. Generate an ENGLISH search query with absolute terms
4. **CRITICAL:** Include the EXACT YEAR whenever you can determine it (do NOT guess if uncertain)`
      : '';
    
    const prompt = `🤖 **AGENTIC RAG SYSTEM - Chain of Thought Query Generation**

Current Date: ${currentDate}

Topic: "${topic}"${agentContext}

---

⚠️ **CRITICAL INSTRUCTION: YOU MUST OUTPUT IN THIS EXACT ORDER**

1️⃣ **FIRST: Output "reasoning" field** - Explain your thought process step-by-step
2️⃣ **SECOND: Output query fields** - Generate the search queries based on your reasoning

---

🎯 **STRICT JSON FORMAT (NO MARKDOWN, NO EXPLANATIONS OUTSIDE JSON):**

{
  "reasoning": "Step 1: Analyze the question... Step 2: Identify entity... Step 3: Convert relative to absolute... Step 4: Generate query...",
  "composite_query": "ENGLISH search query with EXACT YEAR + PROPER NOUNS",
  "search_keywords": "key terms in English",
  "complexity": "simple",
  "topic_category": "general"
}

---

🚨 **ABSOLUTE REQUIREMENTS:**
- ✅ Output PURE JSON STRING only (no markdown code blocks like \`\`\`json)
- ✅ reasoning field MUST come first in the JSON
- ✅ Convert ALL relative terms ("3rd", "recent", "next") to absolute terms (years, names)
- ✅ Include EXACT YEAR whenever possible (e.g., "2024", "2025")
- ✅ Use ENGLISH for better search results
- ❌ NO conversational text before/after JSON
- ❌ NO markdown formatting
- ❌ NO vague terms like "recent election" - specify "2024 election"

---

📝 **EXAMPLE OUTPUT:**

{
  "reasoning": "User asked about '3rd election'. The agent is Donald Trump. Trump's elections: 2016 (1st), 2020 (2nd), 2024 (3rd). Current year is 2025. The 3rd election refers to 2024. The opponent in 2024 was Kamala Harris.",
  "composite_query": "Donald Trump 2024 presidential election opponent Kamala Harris results",
  "search_keywords": "Trump 2024 election Kamala Harris",
  "complexity": "moderate",
  "topic_category": "politics"
}

NOW GENERATE THE JSON:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    
    // 🔍 Safety Filter 디버깅
    console.log('[🔍 Gemini Finish Reason]:', response.candidates?.[0]?.finishReason);
    console.log('[🔍 Gemini Safety Ratings]:', JSON.stringify(response.promptFeedback?.safetyRatings));
    
    const text = response.text().trim();
    
    console.log(`[📥 Gemini 원시 응답] (${text.length}자):\n${text.substring(0, 500)}`);
    
    const parsed = safeParseJSON<any>(text);
    
    if (parsed) {
      // ✅ 필드 매핑 (snake_case → camelCase)
      const reasoning = parsed.reasoning || '(no reasoning provided)';
      let compositeQuery = parsed.composite_query || parsed.compositeQuery || `${topic} (찬성 OR 반대)`;
      const searchKeywords = parsed.search_keywords || parsed.searchKeywords || topic;
      const complexity = normalizeComplexity(parsed.complexity);
      const topicCategory = normalizeCategory(parsed.topic_category || parsed.topicCategory);
      
      // 🚨 CRITICAL FIX: 검색 쿼리에 반드시 agentName 포함 (컨텍스트 손실 방지)
      if (agentName && !compositeQuery.toLowerCase().includes(agentName.toLowerCase())) {
        compositeQuery = `${agentName} ${compositeQuery}`;
        console.log(`[🔧 Query Fix] agentName 강제 추가: "${compositeQuery}"`);
      }
      
      // 🧠 CoT Reasoning 로깅 (디버깅 및 품질 검증용)
      console.log(`[🧠 CoT REASONING] "${topic}"\n  → ${reasoning}`);
      console.log(`[🎯 통합 메타데이터] "${topic}"\n  → 쿼리: "${compositeQuery}"\n  → 키워드: "${searchKeywords}"\n  → 복잡도: ${complexity}\n  → 카테고리: ${topicCategory}`);
      
      return { reasoning, compositeQuery, searchKeywords, complexity, topicCategory };
    } else {
      console.error(`[⚠️ JSON 파싱 실패] safeParseJSON returned null. Raw text:\n${text}`);
      return createFallbackMetadata(topic);
    }
    
  } catch (error) {
    console.error('[❌ 메타데이터 생성 실패] Fallback 사용:', error);
    return createFallbackMetadata(topic);
  }
}

// 🪂 안전한 Fallback (LLM 재호출 금지)
function createFallbackMetadata(topic: string, agentName?: string): SearchMetadata {
  // ✅ agentName이 있으면 대명사 치환 및 주어 추가 (LLM 없이 간단 처리)
  let enrichedTopic = topic;
  if (agentName) {
    // 대명사 치환 (확장 버전 - 격조사 포함)
    enrichedTopic = topic
      // 주격: 나는, 당신은, 그는, 그녀는
      .replace(/\b(나|당신|본인|그|그분|그녀)(은|는|이|가)\b/g, `${agentName}$2`)
      // 목적격: 나를, 당신을, 그를, 그녀를
      .replace(/\b(나|당신|본인|그|그분|그녀)(을|를)\b/g, `${agentName}$2`)
      // 소유격: 나의, 당신의, 그의, 그녀의
      .replace(/\b(나|당신|본인|그|그분|그녀)(의)\b/g, `${agentName}$2`)
      // 단독 대명사 (격조사 없음)
      .replace(/\b(나|당신|본인|그|그분|그녀)\b/g, agentName)
      .trim();
    
    // 주어가 명시적으로 없으면 무조건 앞에 추가 (타원된 주어 처리)
    // agentName이 이미 포함되지 않았거나, 문장 시작이 아니면 추가
    if (!enrichedTopic.startsWith(agentName)) {
      enrichedTopic = `${agentName} ${enrichedTopic}`;
    }
  }
  
  return {
    compositeQuery: `${enrichedTopic} (찬성 OR 반대)`,
    searchKeywords: enrichedTopic
      .split(/\s+/)
      .filter(w => w.length > 1)
      .slice(0, 5)
      .join(' '),
    complexity: 'moderate',
    topicCategory: 'general'
  };
}

// 복잡도 정규화
function normalizeComplexity(value: any): 'simple' | 'moderate' | 'complex' | 'expert' {
  const normalized = String(value).toLowerCase();
  if (['simple', 'moderate', 'complex', 'expert'].includes(normalized)) {
    return normalized as 'simple' | 'moderate' | 'complex' | 'expert';
  }
  return 'moderate';
}

// 카테고리 정규화
function normalizeCategory(value: any): 'politics' | 'economy' | 'social' | 'technology' | 'general' {
  const normalized = String(value).toLowerCase();
  if (['politics', 'economy', 'social', 'technology', 'general'].includes(normalized)) {
    return normalized as 'politics' | 'economy' | 'social' | 'technology' | 'general';
  }
  return 'general';
}

/**
 * @deprecated 레거시 함수 - generateSearchMetadata 사용 권장
 */
export async function generateCompositeQuery(topic: string, agentName?: string): Promise<string> {
  const { compositeQuery } = await generateSearchMetadata(topic, agentName);
  return compositeQuery;
}

/**
 * 관점 인물 데이터 타입
 */
export interface Perspective {
  name: string;
  role: string;
  stance: string;
  sentiment: 'SUPPORTIVE' | 'CRITICAL' | 'NEUTRAL';
  supportive_indices: number[];
  color?: string;
  dialogue?: string; // 1인칭 반박 대사 (시나리오 작가 모드)
}

/**
 * 관점 기반 검색 결과 타입
 */
export interface PerspectiveSearchResult {
  query: string;
  searchResults: SearchChunk[];
  perspectives: Perspective[];
  ttlSeconds: number;
  classificationType: string;
}

/**
 * LLM 기반 역할 캐스팅 + 시나리오 작성 (검색 결과에서 관점 인물 추출 + 반박 대사 생성)
 * @param query 검색 쿼리
 * @param searchResults 검색 결과 배열 (최대 50개)
 * @param originalAnswer 메인 답변 (이에 대한 반박 대사를 생성)
 * @param agentName 원본 답변을 작성한 Agent 이름 (Dynamic Title Recognition용)
 * @returns 관점 인물 리스트 및 각 인물별 유리한 기사 인덱스 + dialogue
 */
export async function extractPerspectives(
  query: string,
  searchResults: SearchChunk[],
  originalAnswer?: string,
  agentName?: string
): Promise<Perspective[]> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log('[⚠️ 역할 캐스팅] API 키 없음 - 빈 배열 반환');
      return [];
    }
    
    // 🗓️ 현재 날짜 주입 (Grounding 시간 컨텍스트 제공)
    const currentDate = new Date().toISOString().split('T')[0]; // 예: "2025-11-23"
    
    // 🎯 Deterministic Honorific Mapping (호칭 사전 추출)
    const { role, honorific } = extractHonorificFromAgentName(agentName);
    if (agentName && honorific) {
      console.log(`[🎖️ HONORIFIC] "${agentName}" → Role: "${role}", Honorific: "${honorific}"`);
    } else if (agentName && !honorific) {
      console.log(`[⚠️ HONORIFIC] "${agentName}" → No pattern matched (LLM will infer from search results)`);
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192, // ✅ 증가: 5명 관점 + 전체 JSON 생성 위해 충분한 토큰 확보
        responseMimeType: 'application/json'
      }
    });
    
    // 🎯 토큰 최적화: 검색은 50개 수집했지만, 프롬프트에는 상위 20개만 전달
    const topResults = searchResults.slice(0, 20);
    
    // 📅 날짜 정보 포함하여 컨텍스트 구성
    const resultsContext = topResults.map((result, idx) => 
      `[${idx}] ${result.title} (Date: ${result.publishedTime || 'Unknown'})\n${result.snippet || ''}`
    ).join('\n\n');
    
    // 🎬 시나리오 작가 모드: originalAnswer가 있으면 dialogue까지 생성
    const hasOriginalAnswer = originalAnswer && originalAnswer.trim().length > 0;
    
    const prompt = hasOriginalAnswer
      ? `Current Date: ${currentDate}

⚠️ CRITICAL INSTRUCTIONS - GROUNDING ENFORCEMENT:
- Current Date: ${currentDate}
${searchResults.length > 0 ? `- You MUST prioritize the provided "Search Results" over your internal training data.
- If the search results contain recent news (2024-2025), you MUST use that information.
- DO NOT reference outdated events (like 2022 election pledges, 2021 policy announcements) as current situations.
- The provided context contains the top 20 most relevant articles with publication dates.
- Each dialogue MUST be grounded in the specific facts from the search results.
- **CRITICAL**: DO NOT use citation numbers like "[1]번 기사", "[5]번 보도" in dialogues. Instead, naturally reference the facts using phrases like "최근 보도에 따르면", "당시 상황을 보면", "실제로 일어난 일은" etc.
- Mention concrete dates/events from 2024-2025 naturally without citing article numbers.
- If all search results are old (pre-2024), explicitly state "최근 보도에 따르면" without specific years.` : `- **DIRECT_ANSWER MODE**: No search results provided. Generate perspectives based on your Internal Knowledge.
- **CRITICAL CONSTRAINT**: ONLY select well-known, historically verifiable figures (e.g., real politicians, scholars, experts mentioned in public records).
- DO NOT invent unnamed experts, fictional analysts, or create personas with generic names like "정치 평론가 김민준".
- If you cannot find sufficient real figures, explicitly state the shortage instead of fabricating personas.
- Use general knowledge, historical context, and philosophical viewpoints to create meaningful debates.
- Do NOT claim to have specific news or data - frame responses as general analysis or historical patterns.`}

⚠️ DIALOGUE STYLE RULES:
- NEVER use the term "메인 답변" or "참고 답변" in the dialogue.
- Dialogues MUST sound like a natural conversation, not a meta-commentary.

⚠️ DYNAMIC TITLE RECOGNITION (MANDATORY - NOT ADVISORY):
${agentName ? `- The original answer was written by: "${agentName}"${honorific ? ` (Role: ${role})` : ''}` : ''}
${honorific ? `- **STRICT REQUIREMENT**: When referencing the original speaker in dialogues, you MUST use the exact honorific: "${honorific}"` : `- **FALLBACK RULE**: When no agentName is provided or honorific cannot be determined, you MUST use neutral terms like "그분", "해당 인물", "말씀하신 내용"`}
${honorific ? `- Example phrase to use: "${honorific}께서 말씀하신...", "${honorific}의 주장은...", "${honorific}께서는..."` : ''}
- **CONDITIONAL TITLE USAGE - '후보님' (Candidate)**:
  - Use '후보님' ONLY IF the search results explicitly mention that the person is currently running for an election (e.g., 'running for office', 'candidate', 'campaign').
  - Check the date of the search result. Do NOT use 'Candidate' based on outdated news (e.g., news from 2022 if the current date is ${currentDate}).
  - If the person is an incumbent official (e.g., President, Governor) or holding a specific office, use that title instead (e.g., '대통령님', '지사님').
- **NEVER GUESS**: Do NOT invent or guess honorifics based on context. Only use the provided honorific or neutral terms.
- If uncertain, default to "그 의견", "해당 주장", "말씀하신 내용" rather than risk using the wrong title.

⚠️ TIME CONTEXT HANDLING:
- When referencing past events (e.g., 2024 policies, 2022 elections), explicitly mention the time context naturally.
- Example: "2024년 당시", "그 당시에는", "과거 정부에서" etc.
- Clearly distinguish between past actions and current status based on search result publication dates.
- If agentName is a former official (e.g., former president), use past-tense titles: "전직 대통령님", "당시 대통령님"

당신은 토론 시나리오 작가입니다. 아래 질문에 대한 첫 번째 답변을 참고하여, 이에 반박하거나 다른 시각을 제시할 인물 **최소 3명, 최대 4명**을 캐스팅한 뒤, 각 인물의 **실제 대사(dialogue)**를 작성하세요.

# 사용자 질문
"${query}"

# 참고 답변${agentName ? ` (작성자: ${agentName})` : ''}
"""
${originalAnswer}
"""

# 검색 결과 (각 인물의 입장을 뒷받침할 근거)
${resultsContext}

⚠️ CRITICAL CONSTRAINT - NO FICTIONAL CHARACTERS:
- **ONLY extract real figures explicitly mentioned in the search results above**
- **DO NOT create fictional characters** like "정치 평론가 김민준", "박선영", "이지은" with generic Korean names
- **DO NOT infer or imagine** people who are not directly referenced in the search results
- If search results don't match the query context (e.g., Korean election news for a Trump question), **explicitly acknowledge the mismatch** and use Internal Knowledge to generate relevant perspectives
- Example FORBIDDEN output: "정치 평론가 김민준" (fictional analyst with generic Korean name)
- Example CORRECT output: "Kamala Harris" (real person mentioned in search results about Trump)

# 명령 (Task)
1. **실제 인물만 추출**: 검색 결과에 **실제로 명시된 인물**만 찾으십시오. 이름이 명확하게 언급된 인물만 허용됩니다. 검색 결과가 질문과 맞지 않으면 Internal Knowledge를 사용하여 적절한 실제 인물을 생성하십시오.
2. **다양한 관점 확보**: 갈등 관계에 있는 인물(찬성/반대, 검사/변호인, 고발인/피고발인, 지지자/비판자)을 우선적으로 찾으십시오.
3. **역할/호칭 정의 (CRITICAL - 우선순위 엄수)**:
   - **1순위**: 사용자 질문에서 언급된 역할 그대로 사용 (예: 질문에 "이재명 대통령"이면 → "대통령")
   - **2순위**: 가장 대중적으로 알려진 대표 호칭 (현재 직함과 무관)
   - **예시**: 오바마는 현재 재단 이사장이지만 → "전 대통령" 사용 / 박근혜는 현재 무직이지만 → "전 대통령" 사용
   - **금지**: 현재 직함이 유명하지 않으면 절대 사용 금지 (재단 이사장, 명예회장 등 X)
4. **관점 요약**: 그 사람이 이 사건/주제를 바라보는 관점을 한 문장으로 요약하십시오.
5. **기사 분류**: 각 인물에게 유리한(supportive) 내용이 담긴 기사의 인덱스 번호를 찾아 배열로 반환하십시오.
6. **대사 작성 (dialogue)**: 각 인물이 **위 답변에 대해** 반박하거나 코멘트하는 대사를 작성하십시오.
   - **1인칭 화법 필수** ("저는", "우리는", "저희 OOO는")
   - **3인칭 서술 금지** ("~라고 주장합니다" 같은 표현 X)
   - **검색 결과의 최신 팩트 기반 필수** (제공된 기사의 구체적 날짜/수치/사건 언급)
   - **CRITICAL: Citation 번호 사용 절대 금지** - "[1]번 기사", "[5]번 보도" 같은 표현 절대 금지. 대신 "최근 보도에 따르면", "당시 상황을 보면", "실제로" 같은 자연스러운 표현 사용
   - **과거 이벤트를 현재 상황으로 언급 절대 금지** (2022년 공약, 2021년 정책을 현재형으로 말하지 말 것)
   - **"메인 답변", "참고 답변" 같은 메타 용어 사용 금지** (대화에 자연스럽게 녹여서 표현)
   - **대화하듯 자연스러운 존댓말**
   - **2~3문장, 임팩트 있게**

# 출력 형식 (JSON)
{
  "perspectives": [
    {
      "name": "검찰",
      "role": "수사기관",
      "stance": "증거에 기반한 수사를 진행하며, 법과 원칙에 따라 책임을 묻겠다는 입장",
      "sentiment": "CRITICAL",
      "supportive_indices": [1, 3, 5],
      "color": "red",
      "dialogue": "피의자는 정치 탄압을 주장하지만, 확보된 물증은 거짓말을 하지 않습니다. 대장동 개발 이익이 어디로 흘러갔는지 계좌 추적 결과가 명백히 말해주고 있습니다. 저희는 법과 원칙에 따라 끝까지 책임을 물을 것입니다."
    }
  ]
}

# 색상 가이드
- green: 주인공/피의자 (방어 측)
- red: 고발인/검사 (공격 측)
- yellow: 판사/법원 (중재자)
- blue: 전문가/학자 (분석가)
- gray: 언론/관찰자 (중립)

# Few-Shot Examples (실제 케이스 예시)

## Example 1: Political Election (정치 선거)
Query: "트럼프 3번째 선거에서 맞붙은 경쟁자"
Search Results:
[0] Donald Trump wins 2024 presidential election against Kamala Harris (Date: 2024-11-06)
[1] Harris concedes defeat, calls for peaceful transition (Date: 2024-11-06)
[2] Republican sweep: Trump secures both White House and Congress (Date: 2024-11-07)

✅ GOOD Output (3-4 diverse perspectives):
{
  "perspectives": [
    {
      "name": "Kamala Harris",
      "role": "민주당 후보",
      "stance": "선거 결과를 수용하며 평화적 권력 이양을 강조",
      "sentiment": "CRITICAL",
      "supportive_indices": [1],
      "color": "blue",
      "dialogue": "저는 패배를 인정하고 평화적 권력 이양을 약속했습니다. 하지만 우리가 싸운 민주주의와 평등의 가치들은 계속될 것이며, 이는 단순한 선거의 끝이 아닙니다."
    },
    {
      "name": "Republican Party Leadership",
      "role": "여당",
      "stance": "역사적 승리를 축하하며 정책 실행 준비",
      "sentiment": "SUPPORTIVE",
      "supportive_indices": [0, 2],
      "color": "red",
      "dialogue": "우리는 백악관과 의회를 모두 장악했습니다. 이제 미국을 다시 위대하게 만들 시간이며, 국민들이 원하는 변화를 실현할 준비가 되어 있습니다."
    },
    {
      "name": "Political Analysts",
      "role": "분석가",
      "stance": "양극화 심화와 향후 정치 지형 변화 주시",
      "sentiment": "NEUTRAL",
      "supportive_indices": [2],
      "color": "gray",
      "dialogue": "이번 선거는 단순한 승패를 넘어 미국 정치의 패러다임 전환을 의미합니다. 향후 4년간 정책 방향을 면밀히 분석해야 합니다."
    }
  ]
}

## Example 2: Interest Rate Policy (금리 정책)
Query: "Recent interest rate policy"
Search Result: "[Central Bank News] (Date: 2025-11-01): The base rate was lowered to 2.5% yesterday."

❌ BAD Output (Internal knowledge hallucination):
"dialogue": "금리는 계속 상승하고 있습니다." (Ignores search results)

✅ GOOD Output (Grounded in search results):
"dialogue": "바로 어제 11월 1일, 기준금리가 드디어 2.5%로 인하되었습니다. 저희 중앙은행은 이 결정이 경제 회복에 긍정적 영향을 미칠 것으로 기대합니다."

⚠️ KEY TAKEAWAY: ALWAYS generate 3-4 perspectives with diverse viewpoints, grounded in search results with specific dates and facts.

JSON 응답:`
      : `Current Date: ${currentDate}

⚠️ CRITICAL INSTRUCTIONS - GROUNDING ENFORCEMENT:
- You MUST prioritize the provided "Search Results" over your internal training data.
- If the search results contain recent news (2024-2025), you MUST use that information.
- DO NOT reference outdated events (like 2022 election pledges) as current situations.
- The provided context contains the top 20 most relevant articles with publication dates.

다음은 "${query}"에 대한 검색 결과입니다. 이 사건/주제와 관련된 주요 인물들을 **최소 3명, 최대 4명** 추출하고, 각 인물별로 유리한 기사의 인덱스를 분류하십시오.

⚠️ CRITICAL CONSTRAINT - NO FICTIONAL CHARACTERS:
- **ONLY extract real figures explicitly mentioned in the search results above**
- **DO NOT create fictional characters** like "정치 평론가 김민준", "박선영", "이지은" with generic Korean names
- **DO NOT infer or imagine** people who are not directly referenced in the search results
- If search results don't match the query context (e.g., Korean election news for a Trump question), **explicitly acknowledge the mismatch** and use Internal Knowledge to generate relevant perspectives
- Example FORBIDDEN output: "정치 평론가 김민준" (fictional analyst with generic Korean name)
- Example CORRECT output: "Kamala Harris" (real person mentioned in search results about Trump)

# 명령 (Task)
1. **실제 인물만 추출**: 검색 결과에 **실제로 명시된 인물**만 찾으십시오. 이름이 명확하게 언급된 인물만 허용됩니다. 검색 결과가 질문과 맞지 않으면 Internal Knowledge를 사용하여 적절한 실제 인물을 생성하십시오.
2. **다양한 관점 확보**: 갈등 관계에 있는 인물(찬성/반대, 검사/변호인, 고발인/피고발인, 지지자/비판자)을 우선적으로 찾으십시오.
3. **역할/호칭 정의 (CRITICAL - 우선순위 엄수)**:
   - **1순위**: 사용자 질문에서 언급된 역할 그대로 사용 (예: 질문에 "이재명 대통령"이면 → "대통령")
   - **2순위**: 가장 대중적으로 알려진 대표 호칭 (현재 직함과 무관)
   - **예시**: 오바마는 현재 재단 이사장이지만 → "전 대통령" 사용 / 박근혜는 현재 무직이지만 → "전 대통령" 사용
   - **금지**: 현재 직함이 유명하지 않으면 절대 사용 금지 (재단 이사장, 명예회장 등 X)
4. **관점 요약**: 그 사람이 이 사건/주제를 바라보는 관점을 한 문장으로 요약하십시오.
5. **기사 분류**: 각 인물에게 유리한(supportive) 내용이 담긴 기사의 인덱스 번호를 찾아 배열로 반환하십시오.

# 출력 형식 (JSON)
{
  "perspectives": [
    {
      "name": "인물명",
      "role": "역할 (예: 고발인, 변호인, 검사)",
      "stance": "관점 요약 (한 문장)",
      "sentiment": "SUPPORTIVE|CRITICAL|NEUTRAL",
      "supportive_indices": [인덱스 번호들],
      "color": "green|red|yellow|blue|gray"
    }
  ]
}

# 색상 가이드
- green: 주인공/피의자 (방어 측)
- red: 고발인/검사 (공격 측)
- yellow: 판사/법원 (중재자)
- blue: 전문가/학자 (분석가)
- gray: 언론/관찰자 (중립)

# 검색 결과
${resultsContext}

JSON 응답:`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    let text = response.text().trim();
    
    // ✅ 방어: Markdown 코드 블록 제거 (```json ... ```)
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
    }
    
    // ✅ 방어: JSON 파싱 + 스키마 검증
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch (parseError: any) {
      console.error('[❌ JSON 파싱 실패] Raw response:', text.substring(0, 500));
      throw new Error(`Invalid JSON from LLM: ${parseError?.message || 'Unknown error'}`);
    }
    
    if (!parsed.perspectives || !Array.isArray(parsed.perspectives)) {
      console.error('[❌ 스키마 오류] perspectives 배열 없음:', parsed);
      throw new Error('LLM response missing "perspectives" array');
    }
    
    const perspectives: Perspective[] = parsed.perspectives;
    
    // ✅ 관점 개수 유연화: 2명 이상이면 허용 (0개보다 낫다)
    if (perspectives.length < 2) {
      console.warn(`[⚠️ 부족] ${perspectives.length}명만 추출됨 (최소 2명 필요)`);
      throw new Error(`Too few perspectives: ${perspectives.length} (minimum 2 required)`);
    } else if (perspectives.length < 3) {
      console.warn(`[⚠️ 이상적이지 않음] ${perspectives.length}명 추출됨 (권장: 3-4명, 하지만 계속 진행)`);
    }
    
    // 🛡️ Hard Validation Layer: 부적절한 호칭 강제 치환
    perspectives.forEach(p => {
      if (p.dialogue) {
        const originalDialogue = p.dialogue;
        
        // 1. "메인 답변", "참고 답변" 치환 (메타 용어 금지)
        p.dialogue = p.dialogue.replace(/메인\s*답변/g, '말씀하신 내용')
                                .replace(/참고\s*답변/g, '말씀하신 내용');
        
        // 2. "대통령님" 외국 지도자 오용 방지 (honorific이 "전직 대통령님"이 아닌 경우)
        if (honorific !== '전직 대통령님' && p.dialogue.match(/\b(조|바이든|트럼프|시진핑|푸틴)\b.*대통령님/)) {
          console.warn(`[⚠️ HONORIFIC VIOLATION] "${p.name}" dialogue applies Korean honorific to foreign leader`);
          p.dialogue = p.dialogue.replace(/대통령님/g, '대통령');
        }
        
        // 3. STRICT Enforcement: honorific 정의되었는데 dialogue에 없으면 REJECT
        if (honorific && !p.dialogue.includes(honorific)) {
          console.error(`[❌ MISSING HONORIFIC] "${p.name}" dialogue MUST use "${honorific}" but doesn't. Dialogue: "${p.dialogue.substring(0, 100)}..."`);
          // ✅ 강제 주입: dialogue 앞에 honorific 추가
          p.dialogue = `${honorific}께서 말씀하신 내용에 대해, ${p.dialogue}`;
        }
        
        // 4. "후보님" 로깅 (조건부 사용 허용, 강제 치환하지 않음)
        if (p.dialogue.includes('후보님')) {
          console.log(`[ℹ️ CONDITIONAL TITLE] "${p.name}" dialogue uses "후보님" (context-aware usage allowed)`);
        }
        
        // 4. 로깅: 치환 발생 여부
        if (originalDialogue !== p.dialogue) {
          console.log(`[🛡️ DIALOGUE SANITIZED] "${p.name}": replaced prohibited terms`);
        }
      }
    });
    
    // ✅ 최대 4명으로 제한 (성능 최적화)
    const limitedPerspectives = perspectives.slice(0, 4);
    
    if (perspectives.length > 4) {
      console.log(`[✂️ 관점 제한] ${perspectives.length}명 → 4명으로 축소`);
    }
    
    console.log(`[🎭 역할 캐스팅 완료] ${limitedPerspectives.length}명 추출:`, limitedPerspectives.map(p => p.name).join(', '));
    
    return limitedPerspectives;
    
  } catch (error) {
    console.error('[❌ 역할 캐스팅 실패]', error);
    throw error; // ✅ 에러 전파 (빈 배열 반환 금지)
  }
}

/**
 * 관점 기반 검색 (복합 쿼리 + 50개 결과 + LLM 역할 캐스팅 + 시나리오 작성)
 * @param agentId 에이전트 ID
 * @param topic 검색 주제
 * @param normalizedQuestion 정규화된 질문
 * @param existingSources 기존 메시지의 sources (재사용)
 * @param originalAnswer 메인 답변 (시나리오 작가 모드용)
 * @returns 검색 결과 및 관점 인물 리스트 + dialogue
 */
export async function searchWithPerspectives(
  agentId: number,
  topic: string,
  normalizedQuestion: string,
  existingSources?: any[],
  originalAnswer?: string,
  agentName?: string
): Promise<PerspectiveSearchResult> {
  const cacheKey = generateCacheKey(topic, agentName);
  const now = new Date();
  
  // 💡 우선순위 1: existingSources 재사용 (새 검색 없음)
  let searchResults: any[] = [];
  
  if (existingSources && existingSources.length > 0) {
    // ♻️ Option B: 기존 sources 재사용 (캐시 체크 스킵, 중복 검색 방지)
    console.log(`[♻️ REUSE] Using ${existingSources.length} existing sources (skip cache & search)`);
    searchResults = existingSources.map((source: any) => ({
      url: source.url || source.link || '',
      title: source.title || '',
      snippet: source.snippet || source.text || ''
    }));
  } else {
    // ✅ v4.0: Smart Router 스킵 - VERDICT에서 Google Search Grounding이 자동 판단
    // 시사 질문은 항상 검색 필요하므로 바로 검색 수행
    const { intent: temporalIntent } = detectTemporalIntent(normalizedQuestion);
    console.log(`[🚦 v4.0] Temporal Intent: ${temporalIntent} (Question: "${normalizedQuestion.substring(0, 50)}...")`);
    
    {
      // SEARCH_REQUIRED인 경우에만 캐시 조회 및 검색 수행
      // 💡 우선순위 2: DB 캐시 조회
    try {
      const cachedResults = await db
        .select()
        .from(searchCacheTable)
        .where(
          and(
            eq(searchCacheTable.query, cacheKey),
            gt(searchCacheTable.expiresAt, now)
          )
        )
        .limit(1);
      
      if (cachedResults.length > 0 && cachedResults[0].perspectives) {
        console.log(`[💾 관점 캐시 HIT] Agent ${agentId}: ${cacheKey.substring(0, 50)}...`);
        
        try {
          const searchResults = cachedResults[0].searchResults 
            ? (typeof cachedResults[0].searchResults === 'string' 
                ? JSON.parse(cachedResults[0].searchResults) 
                : cachedResults[0].searchResults)
            : JSON.parse(cachedResults[0].resultContext);
          
          const perspectives = typeof cachedResults[0].perspectives === 'string'
            ? JSON.parse(cachedResults[0].perspectives)
            : cachedResults[0].perspectives;
          
          return {
            query: cacheKey,
            searchResults,
            perspectives,
            ttlSeconds: cachedResults[0].ttlSeconds || 0,
            classificationType: cachedResults[0].classificationType || 'LEVEL_1_LONG_TERM'
          };
        } catch (parseError) {
          console.error('[❌ 관점 캐시 파싱 실패] 재검색 수행', parseError);
        }
      }
      
      console.log(`[🔍 관점 캐시 MISS] Agent ${agentId}: ${topic}`);
      
    } catch (dbError) {
      console.error('[❌ 관점 캐시 조회 실패]', dbError);
    }
    
    // 💡 우선순위 3: 새 검색 수행
    console.log(`[🎯 1단계] 검색 메타데이터 생성 중... (통합 LLM 호출)`);
    
    // ✅ 항상 skipKeywordExtraction=true (통합 함수에서 이미 처리)
    let finalSearchQuery = `${topic} (찬성 OR 반대 OR 무혐의 OR 혐의)`; // 기본값
    
    try {
      const { compositeQuery, searchKeywords } = await generateSearchMetadata(topic, agentName);
      
      // compositeQuery는 이미 완전한 검색 쿼리이므로 그대로 사용
      // searchKeywords는 백업용 (compositeQuery가 비어있을 경우)
      finalSearchQuery = compositeQuery || `${searchKeywords} (찬성 OR 반대 OR 무혐의 OR 혐의)`;
      
      console.log(`[✅ 메타데이터 성공]${agentName ? ` (Agent: ${agentName})` : ''}\n  복합 쿼리: "${compositeQuery}"\n  키워드: "${searchKeywords}"\n  최종 쿼리: "${finalSearchQuery}"`);
      
    } catch (metadataError: any) {
      // ✅ 429 오류 등 LLM 실패 시 원본 주제 사용
      const is429Error = metadataError?.status === 429 || 
        (metadataError?.message && metadataError.message.includes('quota'));
      
      if (is429Error) {
        console.warn(`[⚠️ 429 에러] 메타데이터 생성 스킵, 원본 주제 사용: "${topic}"`);
      } else {
        console.error(`[❌ 메타데이터 실패] 원본 주제 사용:`, metadataError);
      }
      
      finalSearchQuery = `${topic} (찬성 OR 반대 OR 무혐의 OR 혐의)`;
    }
    
      console.log(`[🔍 2단계] Top-15 검색 수행 중... (skipKeywordExtraction=true)`);
      // ✅ 항상 skipKeywordExtraction=true - 이미 통합 함수에서 키워드 추출 완료
      searchResults = await executeGoogleSearch(finalSearchQuery, 15, true);
    }
  }
  
  // 4. LLM 역할 캐스팅 + 시나리오 작성 (인물 추출 + 관점 태깅 + dialogue 생성)
  // searchResults가 빈 배열이어도 extractPerspectives는 Internal Knowledge로 처리
  console.log(`[🎭 3단계] 역할 캐스팅${originalAnswer ? ' + 대사 생성' : ''} 중... (${searchResults.length}개 결과${searchResults.length === 0 ? ' - Internal Knowledge 사용' : ''})`);
  const perspectives = await extractPerspectives(topic, searchResults, originalAnswer, agentName);
  
  // ✅ perspectives가 비어있으면 에러 반환
  if (perspectives.length === 0) {
    console.log(`[⚠️ 관점 추출 실패] 빈 결과 반환`);
    return {
      query: cacheKey,
      searchResults: [],
      perspectives: [],
      ttlSeconds: 0,
      classificationType: 'LEVEL_1_LONG_TERM'
    };
  }
  
  // 5. DB 저장
  try {
    const classificationType = "LEVEL_1_LONG_TERM";
    const ttlSeconds = calculateDefaultTTL(classificationType);
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + ttlSeconds);
    
    await db
      .insert(searchCacheTable)
      .values({
        query: cacheKey,
        resultContext: JSON.stringify(searchResults), // 레거시 호환
        searchResults: searchResults as any,
        perspectives: perspectives as any,
        classificationType,
        ttlSeconds,
        expiresAt
      })
      .onConflictDoUpdate({
        target: searchCacheTable.query,
        set: {
          resultContext: JSON.stringify(searchResults),
          searchResults: searchResults as any,
          perspectives: perspectives as any,
          classificationType,
          ttlSeconds,
          expiresAt
        }
      });
    
    console.log(`[💾 관점 캐시 저장] ${searchResults.length}개 결과, ${perspectives.length}명 인물 저장`);
  } catch (dbError) {
    console.error('[❌ 관점 캐시 저장 실패]', dbError);
  }
  
  return {
    query: cacheKey,
    searchResults,
    perspectives,
    ttlSeconds: calculateDefaultTTL("LEVEL_1_LONG_TERM"),
    classificationType: "LEVEL_1_LONG_TERM"
  };
}

/**
 * 🏛️ One-Shot Adaptive RAG Workflow
 * 
 * 완전히 새로운 아키텍처: Cache → Entity DB → Search → Generate (All-in-One) → Save
 * 
 * @param agentName 에이전트 이름 (예: "Donald Trump", "김건희")
 * @param userQuestion 사용자 질문
 * @param agentId 에이전트 ID (로깅용)
 * @returns UltimateResponse (main_answer, perspectives, entity_info, volatility)
 */
export async function executeOneShotAdaptiveRAG(
  agentName: string,
  userQuestion: string,
  agentId: number
): Promise<UltimateResponse> {
  console.log(`[🏛️ One-Shot RAG] 시작: ${agentName} - "${userQuestion.slice(0, 50)}..."`);
  
  const cacheKey = generateCacheKey(userQuestion, agentName);
  
  // ✅ 1단계: 캐시 확인 (Fast Return)
  try {
    const now = new Date();
    const cached = await db
      .select()
      .from(searchCacheTable)
      .where(
        and(
          eq(searchCacheTable.query, cacheKey),
          gt(searchCacheTable.expiresAt, now)
        )
      )
      .limit(1);
    
    if (cached.length > 0 && cached[0].searchResults) {
      console.log(`[✅ Cache Hit] "${cacheKey}" - TTL 유효, 캐시된 응답 사용`);
      
      // 캐시된 데이터로 UltimateResponse 재구성
      const searchResults = cached[0].searchResults as any[];
      const perspectives = cached[0].perspectives as any[] || [];
      
      const searchContext = searchResults
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet || ''}`)
        .join('\n\n');
      
      // Entity DB에서 정보 가져오기 (보완용)
      const entityContext = await getEntityProfile(agentName);
      
      // LLM 호출하여 최종 응답 생성 (캐시된 검색 결과 활용)
      const response = await generateUltimateResponse(
        agentName,
        userQuestion,
        searchContext,
        entityContext || undefined
      );
      
      return response;
    }
  } catch (cacheError) {
    console.error('[⚠️ Cache 조회 실패] 검색 진행:', cacheError);
  }
  
  // ✅ 2단계: Entity DB 확인 (Context Enrichment)
  const entityContext = await getEntityProfile(agentName);
  
  if (entityContext) {
    console.log(`[✅ Entity DB Hit] ${agentName} - 기존 프로필 발견, 검색 보완 진행`);
  } else {
    console.log(`[🔍 Entity DB Miss] ${agentName} - 신규 인물, 검색 후 프로필 생성 예정`);
  }
  
  // ✅ 3단계: Historical Query 연도 추출 (검색 정확도 향상)
  const historicalKeywords = /1번째|2번째|first|second|1st|2nd|과거|옛날|당시|previous|초기|데뷔/i;
  const isHistoricalQuery = historicalKeywords.test(userQuestion);
  
  let searchQuery = `${agentName} ${userQuestion}`;
  
  if (isHistoricalQuery) {
    let extractedYear: string | undefined;
    
    // 🎯 Step 1: Entity DB에서 timeline_data 먼저 확인 (Deterministic Approach)
    try {
      const profileResult = await db
        .select()
        .from(entityProfiles)
        .where(eq(entityProfiles.agentName, agentName.trim()))
        .limit(1);
      
      if (profileResult.length > 0 && profileResult[0].timelineData) {
        const timelineData = profileResult[0].timelineData as any;
        
        // 데뷔 연도 확인 (1번째, first, 데뷔 등)
        if ((/1번째|first|1st|데뷔|초기/i.test(userQuestion)) && timelineData.debut) {
          extractedYear = String(timelineData.debut);
          console.log(`[✅ Timeline DB Hit] Debut year found: ${extractedYear}`);
        }
        
        // major_events에서 매칭되는 이벤트 찾기
        if (!extractedYear && timelineData.major_events) {
          const events = timelineData.major_events as Record<string, number>;
          
          // "1st asian cup", "3rd election" 등의 키워드 매칭
          const eventKeywords = Object.keys(events);
          for (const eventKey of eventKeywords) {
            const normalizedKey = eventKey.toLowerCase().replace(/_/g, ' ');
            const normalizedQuestion = userQuestion.toLowerCase();
            
            // 부분 매칭 (예: "1st_asian_cup" matches "1번째 아시안컵")
            if (normalizedQuestion.includes(normalizedKey) || 
                normalizedKey.includes('asian') && normalizedQuestion.includes('아시안')) {
              extractedYear = String(events[eventKey]);
              console.log(`[✅ Timeline DB Hit] Event "${eventKey}" found: ${extractedYear}`);
              break;
            }
          }
        }
      }
    } catch (dbError) {
      console.error('[⚠️ Timeline DB Query Error]', dbError);
    }
    
    // 🤖 Step 2: Timeline DB에 없으면 LLM으로 추출 (Fallback)
    if (!extractedYear) {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
          const genAI = new GoogleGenerativeAI(apiKey);
          const model = genAI.getGenerativeModel({ 
            model: 'gemini-2.5-flash',
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 50,
            }
          });
          
          const yearPrompt = `Extract the EXACT YEAR for this historical question about ${agentName}:
Question: "${userQuestion}"
${entityContext ? `\nKnown info: ${entityContext}` : ''}

Return ONLY the 4-digit year (e.g., "2011"). If uncertain, return "UNKNOWN".
Year:`;
          
          const result = await model.generateContent(yearPrompt);
          extractedYear = result.response.text().trim().match(/\b(19|20)\d{2}\b/)?.[0];
          
          if (extractedYear) {
            console.log(`[🤖 LLM Year Extraction] "${userQuestion}" → Year: ${extractedYear}`);
          } else {
            console.log(`[⚠️ Year Extraction Failed] Using original query`);
          }
        }
      } catch (yearError) {
        console.error('[❌ Year Extraction Error]', yearError);
      }
    }
    
    // ✅ 연도가 추출되었으면 검색 쿼리에 추가
    if (extractedYear) {
      searchQuery = `${agentName} ${userQuestion} ${extractedYear}`;
      console.log(`[🕰️ Enhanced Historical Query] "${searchQuery}"`);
    }
  }
  
  // ✅ Google Search 수행 (날짜 필터링 적용)
  const searchResults = await executeGoogleSearch(searchQuery, 15, false);
  
  if (searchResults.length === 0) {
    console.log('[⚠️ 검색 결과 없음] LLM 내부 지식으로 응답 생성');
  }
  
  // ✅ Post-Search Validation: Historical query에 대해 검색 결과 연도 검증
  if (isHistoricalQuery && searchResults.length > 0) {
    const extractedYear = searchQuery.match(/\b(19|20)\d{2}\b/)?.[0];
    if (extractedYear) {
      const yearMentionCount = searchResults.filter(r => 
        r.title?.includes(extractedYear) || r.snippet?.includes(extractedYear)
      ).length;
      
      const yearCoverage = (yearMentionCount / searchResults.length) * 100;
      
      if (yearCoverage < 30) {
        console.warn(`[⚠️ Timeline Validation] Only ${yearCoverage.toFixed(0)}% of results mention year ${extractedYear} - May contain recent data contamination`);
      } else {
        console.log(`[✅ Timeline Validation] ${yearCoverage.toFixed(0)}% of results mention year ${extractedYear} - Good historical coverage`);
      }
    }
  }
  
  const searchContext = searchResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet || ''}\nURL: ${r.url}`)
    .join('\n\n');
  
  // ✅ 4단계: One-Shot Generation (CoT + Main Answer + Perspectives + Entity Info + Volatility)
  const response = await generateUltimateResponse(
    agentName,
    userQuestion,
    searchContext || 'No search results available. Use your internal knowledge.',
    entityContext || undefined
  );
  
  // ✅ searchResults를 response에 첨부 (citation용)
  response.searchResults = searchResults;
  
  console.log(`[✅ One-Shot 생성 완료] Volatility: ${response.volatility}, Entity: ${response.entity_info ? 'Yes' : 'No'}, Sources: ${searchResults.length}개`);
  
  // ✅ 5단계: Entity DB 업데이트 (Data Assetization)
  if (response.entity_info) {
    await upsertEntityProfile(
      agentName,
      response.entity_info,
      response.volatility,
      searchQuery
    );
    
    console.log(`\n🎯 ========================================`);
    console.log(`✅ ONE-SHOT RAG SUCCESS - Cost Optimized!`);
    console.log(`📊 Entity DB Saved: ${agentName}`);
    console.log(`🕰️  Timeline Data: ${response.entity_info.timeline_data ? 'YES' : 'NO'}`);
    console.log(`💾 Volatility: ${response.volatility} (TTL: ${calculateAdaptiveTTL(response.volatility)}s)`);
    console.log(`🔍 API Calls: 1 Search + 1 LLM = Total 2 calls`);
    console.log(`🎯 ========================================\n`);
  }
  
  // ✅ 6단계: 캐시 저장 (Adaptive TTL)
  const ttlSeconds = calculateAdaptiveTTL(response.volatility);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  
  try {
    await db
      .insert(searchCacheTable)
      .values({
        query: cacheKey,
        resultContext: searchContext.slice(0, 10000), // 레거시 필드
        searchResults: searchResults as any,
        perspectives: response.perspectives as any,
        classificationType: null,
        ttlSeconds,
        expiresAt
      })
      .onConflictDoUpdate({
        target: searchCacheTable.query,
        set: {
          resultContext: searchContext.slice(0, 10000),
          searchResults: searchResults as any,
          perspectives: response.perspectives as any,
          ttlSeconds,
          expiresAt
        }
      });
    
    console.log(`[💾 캐시 저장] TTL: ${ttlSeconds}초 (${response.volatility}), 만료: ${expiresAt.toISOString()}`);
  } catch (saveError) {
    console.error('[❌ 캐시 저장 실패]', saveError);
  }
  
  return response;
}

/**
 * 🎭 Multi-turn Debate Scenario Generator (VERDICT v2)
 * Single-Call 기반 동적 역할 배정 + Chain of Thought 분석
 * 
 * 핵심 변경사항 (Step 3.5):
 * - LLM이 검색 결과를 분석하여 '결정권자(Authority)'를 자동 추출
 * - Authority가 마지막 턴에서 공식 결론을 내림
 * - 한 번의 API 호출로 분석 + 시나리오 생성 동시 처리
 */

// ============================================================================
// 🎬 VERDICT v3: Showrunner PD Architecture
// ============================================================================

// 🌍 Universe (세계관) 타입
export type UniverseType = 
  | "US_Politics_Tech"      // 미국 정치/테크
  | "Korea_Politics"        // 한국 정치
  | "KPop_Entertainment"    // K-Pop/한국 연예
  | "Global_Tech"           // 글로벌 테크 기업
  | "Sports"                // 스포츠
  | "Social_Issue"          // 사회 이슈
  | "Other";

// 🎭 Role Archetypes (역할 원형) - Showrunner PD 스타일
export type RoleArchetype = 
  | "protagonist"   // 주인공/논란의 핵
  | "antagonist"    // 대항마/공격수
  | "jester"        // 풍자꾼/독설가 (사이다 발언)
  | "authority";    // 심판관/팩트체커

// 📋 메타 정보
export interface VerdictMetaInfo {
  universe: UniverseType;
  context_summary: string;  // 1-2문장 상황 요약
}

// 🎬 대화 시퀀스 (턴) - V3 구조
export interface VerdictDialogueTurn {
  order: number;
  time_marker: string;       // "2024년 11월", "며칠 뒤" 등
  speaker: string;           // 실명/직책
  role: RoleArchetype;       // 역할 원형
  action: string;            // 지문 (트윗을 날리며, 책상을 치며)
  message: string;           // 대사 (풍자, 팩트 기반)
  tone_style: string;        // 말투 스타일
}

// 🎬 VERDICT v3 시나리오 (새 구조)
export interface VerdictScenarioV3 {
  meta_info: VerdictMetaInfo;
  cast: string[];                        // 캐스팅 목록
  dialogue_sequence: VerdictDialogueTurn[];
  searchResults?: any[];                 // 검색 결과 (내부용)
}

// 🎯 동적 역할 분석 결과 (레거시 호환)
export interface DynamicRoleAnalysis {
  topic_category: string;
  identified_authority: string;
  reasoning: string;
}

// 🎯 Step 49: 턴별 출처 매핑을 위한 GroundingSupport 타입
export interface GroundingSupport {
  startIndex: number;
  endIndex: number;
  text: string;
  chunkIndices: number[];
}

// 🎭 토론 턴 (역할 확장) - 레거시 + V3 호환
export interface DebateTurn {
  role: "initiator" | "target" | "oppose" | "support" | "authority" | "protagonist" | "antagonist" | "jester";
  name: string;
  message: string;
  action?: string;           // V3: 지문
  time_marker?: string;      // V3: 시간 마커
  tone_style?: string;       // V3: 말투 스타일
  speaker_icon?: string;     // V3.2: 직업/역할 기반 이모지 (🧢, 🕶️, ⚖️ 등)
  personality?: string;      // V3.2: 성격 유형 (Showman, Strategist, Diplomat, Provocateur)
  speaker_title?: string;    // V6.0: 직책/자격 (예: "중국 외교부 대변인", "더불어민주당 대표")
  turnSources?: any[];       // 🎯 Step 49: 해당 턴이 참조한 출처만 (chunkIndices 기반 필터링)
}

// 🎬 완성된 시나리오 (분석 + 대화) - 레거시 + V3 호환
// 🎭 Step 46: Suggestion Chip 타입 정의
export interface SuggestionChip {
  name: string;
  title: string;
  action: 'more_info' | 'new_entry';
  desc: string;
}

export interface DebateScenario {
  analysis: DynamicRoleAnalysis;
  initiator?: { name: string; title: string; speakingStyle: string };
  target: string;
  targetDescription: string;
  authority?: { name: string; title: string; speakingStyle: string };
  oppositionMembers: { name: string; title: string; speakingStyle: string }[];
  supporterMembers: { name: string; title: string; speakingStyle: string }[];
  turns: DebateTurn[];
  searchResults?: any[];
  // V3 확장 필드
  meta_info?: VerdictMetaInfo;
  cast?: string[];
  // 🎭 Step 46: 추천 화자 칩
  suggestion_chips?: SuggestionChip[];
  // 🎯 Step 49: Grounding Supports (턴별 출처 매핑용)
  groundingSupports?: GroundingSupport[];
  // 🎯 Step 49: 전체 응답 텍스트 (오프셋 계산용)
  fullResponseText?: string;
}

// 기존 호환성을 위한 별칭
export type { DebateTurn as VerdictTurn };
export type { DebateScenario as VerdictScenario };

// ═══════════════════════════════════════════════════════════════════════════════
// 🛡️ Step 8 헬퍼 함수: Context Firewall + Language Sync + Timeline Alignment
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🌐 Language Sync: 소스 언어 감지 (문자셋 스코어링)
 * 한글/영어/일어/중국어를 문자 비율로 판별
 */
function detectSourceLanguage(text: string): 'korean' | 'english' | 'japanese' | 'chinese' | 'mixed' {
  const hangulCount = (text.match(/[\uac00-\ud7af]/g) || []).length;
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  const kanaCount = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const hanziCount = (text.match(/[\u4e00-\u9fff]/g) || []).length - hangulCount; // 한자는 한글과 겹칠 수 있음
  
  const total = hangulCount + latinCount + kanaCount + Math.max(0, hanziCount);
  if (total === 0) return 'korean'; // 기본값
  
  const hangulRatio = hangulCount / total;
  const latinRatio = latinCount / total;
  const kanaRatio = kanaCount / total;
  const hanziRatio = Math.max(0, hanziCount) / total;
  
  if (hangulRatio > 0.5) return 'korean';
  if (latinRatio > 0.7) return 'english';
  if (kanaRatio > 0.3) return 'japanese';
  if (hanziRatio > 0.5) return 'chinese';
  
  return 'korean'; // 혼합이면 한국어 기본
}

/**
 * 🔥 Context Firewall: 질문에서 핵심 키워드 추출
 * 캐스팅 시 관련 없는 인물 필터링에 사용
 * ⚠️ 한글 + 영어 고유명사 모두 추출 (글로벌 커버리지)
 */
function extractTopicKeywords(question: string): string[] {
  // 정치/경제/연예/스포츠 관련 키워드 추출
  const politicsKeywords = ['대통령', '국회', '여당', '야당', '민주당', '국민의힘', '선거', '정책', '개혁', '연금', '복지', '예산', 'President', 'Congress', 'Senate', 'election'];
  const entertainmentKeywords = ['아이돌', '연예', '엔터', '하이브', 'SM', '뉴진스', '방탄', '배우', '드라마', 'K-Pop', 'BTS', 'NewJeans'];
  const techKeywords = ['AI', '반도체', '삼성', 'SK', '테크', 'OpenAI', 'Google', '플랫폼', '틱톡', 'TikTok', 'Apple', 'Microsoft', 'Tesla', 'X', 'Twitter'];
  const sportsKeywords = ['축구', '야구', '올림픽', 'FIFA', 'MLB', 'NBA', '손흥민', '오타니', '이강인', 'Ohtani', 'Shohei'];
  const legalKeywords = ['재판', '판결', '소송', '검찰', '법원', '배임', '횡령', '이혼', 'lawsuit', 'trial', 'verdict', 'ban'];
  const usNamesKeywords = ['Trump', 'Biden', 'Musk', 'Elon', 'Bezos', 'Zuckerberg', 'Obama', 'Harris', 'Vivek', 'Ramaswamy'];
  
  const allKeywords = [...politicsKeywords, ...entertainmentKeywords, ...techKeywords, ...sportsKeywords, ...legalKeywords, ...usNamesKeywords];
  const foundKeywords = allKeywords.filter(kw => question.toLowerCase().includes(kw.toLowerCase()));
  
  // 한글 고유명사 추출 (2글자 이상)
  const koreanProperNouns = question.match(/[\uac00-\ud7af]{2,}(?:[\s·][\uac00-\ud7af]{2,})?/g) || [];
  
  // 영어 고유명사 추출 (대문자로 시작하는 단어, 최소 2글자)
  const englishProperNouns = question.match(/\b[A-Z][a-zA-Z]{1,}/g) || [];
  
  // 모든 고유명사 합치기 (제한 없음 - 모든 참여자 포함)
  const allProperNouns = [...koreanProperNouns, ...englishProperNouns];
  
  return [...new Set([...foundKeywords, ...allProperNouns])];
}

/**
 * 📅 Timeline Alignment: 검색 결과에서 날짜 추출 및 정렬
 * Past (종결된 사건) vs Present (진행 중) 구분
 */
function alignTimelineFromResults(searchResults: any[]): { past: string[], present: string[], timeline: string } {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  const pastEvents: string[] = [];
  const presentEvents: string[] = [];
  
  for (const result of searchResults) {
    const snippet = result.snippet || '';
    const title = result.title || '';
    const text = `${title} ${snippet}`;
    
    // 날짜 패턴 추출 (YYYY년 MM월, YYYY.MM, MM월 DD일 등)
    const datePatterns = text.match(/(\d{4})년\s*(\d{1,2})월|\b(\d{4})\.(\d{1,2})\b|(\d{1,2})월\s*(\d{1,2})일/g) || [];
    
    // 종결 키워드 vs 진행 키워드
    const pastKeywords = ['판결', '확정', '종결', '마무리', '완료', '달성', '기록', '성공', '했다', '됐다'];
    const presentKeywords = ['진행 중', '예정', '논란', '갈등', '심리 중', '상고', '항소', '검토', '협상'];
    
    const hasPastKeyword = pastKeywords.some(kw => text.includes(kw));
    const hasPresentKeyword = presentKeywords.some(kw => text.includes(kw));
    
    if (hasPastKeyword && !hasPresentKeyword) {
      pastEvents.push(snippet.slice(0, 100));
    } else if (hasPresentKeyword) {
      presentEvents.push(snippet.slice(0, 100));
    }
  }
  
  // 타임라인 요약 생성
  const timeline = `
[📅 TIMELINE ALIGNMENT]
- 과거 완료 사건 (PAST): ${pastEvents.length}건
- 현재 진행 사건 (PRESENT): ${presentEvents.length}건
${pastEvents.length > 0 ? `\n과거 완료: ${pastEvents.slice(0, 2).join(' | ')}` : ''}
${presentEvents.length > 0 ? `\n현재 진행: ${presentEvents.slice(0, 2).join(' | ')}` : ''}
`.trim();
  
  return { past: pastEvents, present: presentEvents, timeline };
}

/**
 * 🔗 Step 23: Context-Aware Block Merge - 짧은 메시지 확장 (앵무새 버그 수정)
 * 30자 미만 짧은 대화를 역할과 맥락에 맞게 확장
 * 
 * 🔴 핵심 수정: context(topic_summary)를 대사에 복사하지 않음!
 * 캐릭터의 감정(Emotion)과 논리(Argument)만 사용하여 새로운 문장 생성
 * 
 * Archetype 매핑:
 * - Type A (Showman): protagonist, antagonist, initiator - 감정적, Rally Mode (3-5문장)
 * - Type B (Official): authority, support, oppose - 격식체, Statement Mode (2-4문장)
 * - Type C (Observer): jester, target - 브리핑/중립 스타일
 */
function expandShortMessage(
  shortMessage: string,
  speakerName: string,
  role: string,
  action: string,
  context: string,  // 🔴 Step 23: context는 참조용! 대사에 복사 금지!
  prevMessage: string
): string {
  // Role → Archetype 매핑
  const roleToArchetype: Record<string, 'A' | 'B' | 'C'> = {
    'protagonist': 'A',
    'antagonist': 'A', 
    'initiator': 'A',
    'authority': 'B',
    'support': 'B',
    'oppose': 'B',
    'jester': 'C',
    'target': 'C'
  };
  
  const archetype = roleToArchetype[role] || 'C';
  
  // 🔴 Step 23: context 복사 대신 감정 기반 확장 템플릿
  // BAD: "${ctx.slice(0,50)}..." 같은 복사 금지!
  // GOOD: 캐릭터 감정과 논리적 주장으로 새 문장 생성
  
  const archetypeExpanders: Record<'A' | 'B' | 'C', (msg: string, name: string, prev: string, r: string) => string> = {
    // Type A: Showman - 감정적, 공격적, Rally Mode (3-5문장)
    'A': (msg, name, prev, r) => {
      const emotionalResponses = [
        '정부가 국민을 속이고 있습니다! 이게 바로 그 증거예요!',
        '이런 엉터리 정책을 누가 책임질 건가요?!',
        '완전히 잘못된 방향으로 가고 있어요! 지금 바로잡아야 해요!',
        '국민들이 뭘 원하는지 알기나 해요?! 현장의 목소리를 들어야 합니다!'
      ];
      const response = emotionalResponses[Math.floor(Math.random() * emotionalResponses.length)];
      
      if (msg.length < 10) {
        return `${msg} (격앙되어) ${response} ${prev ? '방금 하신 말씀, 전혀 동의할 수 없습니다!' : '왜 이 지경이 됐는지 명확히 밝혀야 합니다!'}`;
      }
      return `${msg} ${prev ? '지금 뭐라고 하셨습니까? 그게 말이 됩니까?' : '이 문제에 대해 분명히 말씀드리겠습니다!'} 진실을 밝혀야 합니다!`;
    },
    
    // Type B: Official - 격식체, Statement Mode (2-4문장)
    'B': (msg, name, prev, r) => {
      if (r === 'authority') {
        return `${msg} 본 건에 대해 면밀히 검토한 결과를 말씀드립니다. 법적 검토와 선례를 고려하여 신중하게 판단하였습니다. 추가적인 논의가 필요한 부분은 후속 조치로 다루겠습니다.`;
      }
      const stance = r === 'support' ? '지지' : '반대';
      return `${msg} 저희 입장을 분명히 ${stance}드립니다. ${prev ? '앞선 발언에 대해 입장을 정리하자면,' : '근거를 말씀드리자면,'} 충분한 검토를 거친 결정입니다.`;
    },
    
    // Type C: Observer - 브리핑/중립 스타일 (3-5문장)
    'C': (msg, name, prev, r) => {
      if (r === 'jester') {
        return `[속보] ${msg} — 이거 정말 흥미로운 전개네요! ${prev ? '저쪽 말씀 들으셨나요? 상황이 점점 복잡해지고 있습니다.' : '앞으로 어떻게 전개될지 지켜봐야겠네요.'} 여러분의 생각은 어떠신가요?`;
      }
      return `${msg} ${prev ? '그런 식으로 말씀하시면 곤란합니다.' : '제 입장을 분명히 하겠습니다.'} 이 상황에 대해 직접 설명드리겠습니다. 오해가 없길 바랍니다.`;
    }
  };
  
  // 🔴 Step 23: context 파라미터를 전달하지 않음! (앵무새 버그 방지)
  const expandedMessage = archetypeExpanders[archetype](shortMessage, speakerName, prevMessage, role);
  
  console.log(`[🔗 Block Merge] Role: ${role} → Type ${archetype}, Original: ${shortMessage.length}자 → Expanded: ${expandedMessage.length}자`);
  
  return expandedMessage;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎙️ Step 35: Dynamic Anchor Teaser - Phase 1 (빠른 응답)
// ═══════════════════════════════════════════════════════════════════════════════

// [Step 44] 최근 조합 추적 - 반복 방지를 위한 모듈 스코프 변수
const recentCombinations: Array<{ emotion: number; strategy: number }> = [];
const MAX_RECENT_HISTORY = 10; // 최근 10개 조합 추적

export interface AnchorTeaserResult {
  summary: string;           // 3줄 팩트 요약
  teaser: string;            // 토론 예고 티저
  detectedFigures: string[]; // 감지된 유명인 이름들
  isKnownFigures: boolean;   // 유명인이 감지되었는지
}

/**
 * 🎙️ Step 38: generateAnchorTeaser - Phase 1 빠른 앵커 요약 + 티저
 * 
 * [Step 38 Critical Fix] Google Search Grounding 제거!
 * - 문제: Google Search가 50초 지연 + 토픽 드리프트 유발
 * - 해결: 질문 분석만으로 빠른 응답 (목표: ~3초)
 * 
 * 목적: 토론 생성(15-20초) 전에 빠른 응답(3-5초)을 제공
 * 
 * 출력 형식:
 * - Known Figures: "...논란이 뜨겁습니다. **민희진 대표와 하이브 경영진의 가감 없는 설전, 바로 시작합니다.**"
 * - Unknown Figures: "...원인을 두고 공방이 치열합니다. **도대체 누구의 책임일까요? 사건의 핵심 관계자들을 소환해 따져보겠습니다.**"
 */
export async function generateAnchorTeaser(
  question: string
): Promise<AnchorTeaserResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 빠른 응답을 위해 flash-lite 모델 사용
  const modelName = 'gemini-2.0-flash-lite';
  
  const now = new Date();
  const currentDateKorean = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  
  // [Step 44] 동적 감정+전략 조합 시스템 - 반복 방지 (예시 문구 제거!)
  const emotions = [
    "격분한(Outraged) - 분노와 의문이 가득한 톤으로",
    "비꼬는(Sarcastic) - 냉소적이고 날카로운 톤으로",
    "안타까워하는(Sympathetic) - 걱정과 우려가 담긴 톤으로",
    "호기심 가득한(Curious) - 흥미진진하게 파고드는 톤으로",
    "냉철하고 분석적인(Analytical) - 차분하게 본질을 파악하는 톤으로"
  ];
  
  const strategies = [
    "청중에게 도발적인 수사의문문을 던지며 시작",
    "관련 숫자나 통계를 강조하며 시작",
    "침묵이나 한숨 후 무거운 어조로 시작",
    "긴급 속보를 전하듯 다급하게 시작",
    "적절한 속담이나 비유를 인용하며 시작"
  ];
  
  // [Step 44] 최근 조합 피하기 로직
  const findNewCombination = (): { emotionIdx: number; strategyIdx: number } => {
    const maxAttempts = 25; // 최대 시도 횟수 (5x5 = 25개 조합)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const emotionIdx = Math.floor(Math.random() * emotions.length);
      const strategyIdx = Math.floor(Math.random() * strategies.length);
      
      // 최근 조합에 없으면 사용
      const isRecent = recentCombinations.some(
        c => c.emotion === emotionIdx && c.strategy === strategyIdx
      );
      if (!isRecent) {
        return { emotionIdx, strategyIdx };
      }
    }
    // 모든 조합이 최근에 사용됨 -> 히스토리 초기화 후 새로 선택
    recentCombinations.length = 0;
    return {
      emotionIdx: Math.floor(Math.random() * emotions.length),
      strategyIdx: Math.floor(Math.random() * strategies.length)
    };
  };
  
  const { emotionIdx, strategyIdx } = findNewCombination();
  const selectedEmotion = emotions[emotionIdx];
  const selectedStrategy = strategies[strategyIdx];
  
  // 히스토리에 추가
  recentCombinations.push({ emotion: emotionIdx, strategy: strategyIdx });
  if (recentCombinations.length > MAX_RECENT_HISTORY) {
    recentCombinations.shift(); // 가장 오래된 것 제거
  }
  
  console.log(`[🎙️ Step 38] Anchor Teaser 생성 시작: "${question}"`);
  console.log(`[🎙️ Step 44] 선택된 감정: ${selectedEmotion}`);
  console.log(`[🎙️ Step 44] 선택된 전략: ${selectedStrategy}`);
  console.log(`[🎙️ Step 38] Model: ${modelName} (Fast Response, NO SEARCH)`);
  
  // [Step 38] Google Search 제거 - 빠른 응답을 위해 검색 없이 질문 분석만
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 512
    }
    // ⚠️ tools 옵션 제거 - Google Search Grounding 비활성화
  });

  // [Step 39] 프롬프트 리팩토링 - "카리스마 있는 호스트" 스타일
  // - 메타 라벨 제거 (### Breaking News 등)
  // - 반복적인 시작 문구 제거
  // - "Bridge" 기법: 사실 요약 대신 갈등 프레이밍
  // - 짧고 펀치있는 문단 (2-3문장)
  
  // [Step 44] 동적 감정+전략 주입 프롬프트
  const anchorPrompt = `You are a charismatic live debate show host. Your job is to give a quick, punchy intro (2-3 sentences) that frames the conflict and invites characters to speak.

TODAY: ${currentDateKorean}
TOPIC: "${question}"

═══════════════════════════════════════════════════════════════════════════════
🎭 YOUR CURRENT STATE (MANDATORY - Step 44)
═══════════════════════════════════════════════════════════════════════════════

**감정 상태**: ${selectedEmotion}
**오프닝 전략**: ${selectedStrategy}

⚠️ CRITICAL: 위 감정과 전략을 반드시 반영하여 인트로를 생성하세요!
- 지정된 감정 톤으로 말하세요
- 지정된 전략 방식으로 시작하세요
- 매번 완전히 새로운 문장을 생성하세요 (예시 문장 그대로 사용 금지!)

═══════════════════════════════════════════════════════════════════════════════
STYLE RULES (CRITICAL)
═══════════════════════════════════════════════════════════════════════════════

1. **NO META-LABELS**: Never use "Breaking News", "Subject:", "속보:", "주제:" etc.

2. **BRIDGE TECHNIQUE**: Don't summarize facts. Frame the CONFLICT.
   ❌ BAD: "손정의 회장이 5조원을 투자했습니다."
   ✅ GOOD: "5조를 쏟아부었는데, 선견지명일까요 도박일까요?"

3. **BE A HOST, NOT A NEWS ANCHOR**: You're starting a lively conversation.

4. **LANGUAGE**: Always respond in Korean (한국어).

═══════════════════════════════════════════════════════════════════════════════
❌ BANNED PHRASES (Step 44) - 절대 사용 금지!
═══════════════════════════════════════════════════════════════════════════════

다음 문구들은 너무 반복되어 금지합니다:
- "오늘 주제 장난 아니네요"
- "와, 이거 흥미로운 주제네요"
- "의견이 분분하네요"
- "어떤 시각들이 있는지 들어볼까요"
- "전문가들 모셔서 직접 들어보겠습니다"
- "관련해서 의견이 분분합니다"
- "뜨거운 감자네요"
- "이 상황 진짜?"
- "파헤쳐 봐야겠는데요"

위 문구 중 하나라도 사용하면 FAIL입니다. 완전히 새로운 표현을 창작하세요!

═══════════════════════════════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════════════════════════════

1. **Extract key figures** from the topic (people, companies, organizations)
2. **Write intro** (2-3 sentences max):
   - Use the assigned EMOTION and STRATEGY above!
   - Frame the core conflict/debate angle
   - Naturally invite characters to speak
3. **Keep it SHORT and PUNCHY**

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON)
═══════════════════════════════════════════════════════════════════════════════

{
  "summary": "...",
  "teaser": "...",
  "detectedFigures": [...],
  "isKnownFigures": true/false
}

FIELD RULES:
- "summary": 지정된 감정+전략을 100% 반영한 완전히 새로운 인트로 (2-3문장). 
  * NO bullet points, NO headers
  * 금지 문구 사용 시 FAIL 처리됨
  * 예시 문장 복사 금지 - 매번 새로 창작해야 함!
  
- "teaser": 핵심 인물을 호명하며 토론 시작을 알리는 짧은 마무리
  * 매번 다른 동사와 표현 사용 (따지다, 듣다, 확인하다, 검증하다, 대질하다, 맞붙다, 소환하다...)
  * 고정 패턴 절대 금지 - 창의적으로!
  
- "detectedFigures": 토픽에서 추출한 실제 인물/조직명 배열
- "isKnownFigures": 유명인 발견 여부

CRITICAL: Output ONLY the JSON object. No markdown, no extra text.`;

  // [Step 38] 8초 타임아웃 추가
  const TIMEOUT_MS = 8000;
  
  try {
    console.log(`[🎙️ Step 38] API 호출 시작 (타임아웃: ${TIMEOUT_MS}ms)...`);
    const startTime = Date.now();
    
    // 타임아웃 래퍼
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Phase 1 timeout exceeded')), TIMEOUT_MS);
    });
    
    const resultPromise = model.generateContent(anchorPrompt);
    const result = await Promise.race([resultPromise, timeoutPromise]);
    
    const responseText = result.response.text().trim();
    
    const elapsed = Date.now() - startTime;
    console.log(`[🎙️ Step 38] API 응답 완료 (${elapsed}ms)`);
    
    // JSON 파싱
    let parsed: AnchorTeaserResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON not found in response');
      }
    } catch (parseError) {
      console.error('[🎙️ Step 38] JSON 파싱 실패, 폴백 응답 생성');
      // 질문에서 직접 인물 추출 시도
      const figures = extractFiguresFromQuestion(question);
      parsed = createFallbackTeaser(question, figures);
    }
    
    // 감지된 인물 검증 - 완전히 무관한 인물만 제거 (유연한 매칭)
    if (parsed.detectedFigures && parsed.detectedFigures.length > 0) {
      const validFigures = parsed.detectedFigures.filter(fig => {
        // 1. 정확히 일치
        if (question.includes(fig)) return true;
        // 2. 대소문자 무시
        if (question.toLowerCase().includes(fig.toLowerCase())) return true;
        // 3. 부분 일치 (이름의 일부가 질문에 있는지) - 2글자 이상
        const nameParts = fig.split(/[\s]/);
        for (const part of nameParts) {
          if (part.length >= 2 && question.includes(part)) return true;
        }
        // 4. 조직→인물 연관성 (소프트뱅크→손정의 등)
        const orgToFigure: Record<string, string[]> = {
          '소프트뱅크': ['손정의'],
          '하이브': ['방시혁', '민희진'],
          '삼성': ['이재용', '이건희'],
          '현대': ['정의선'],
          '테슬라': ['머스크', '일론 머스크'],
          'OpenAI': ['샘 올트먼', '올트먼'],
          '오픈AI': ['샘 올트먼', '올트먼']
        };
        for (const [org, figures] of Object.entries(orgToFigure)) {
          if (question.includes(org) && figures.some(f => fig.includes(f) || f.includes(fig))) {
            return true;
          }
        }
        return false;
      });
      
      // 완전히 무관한 인물만 있으면 (예: 윤석열이 질문에 없는데 감지됨)
      // 기존 감지 결과가 완전히 틀린 경우에만 재추출
      if (validFigures.length === 0) {
        // LLM이 질문과 완전히 무관한 인물만 감지한 경우 → 질문에서 직접 추출
        const extracted = extractFiguresFromQuestion(question);
        if (extracted.length > 0) {
          parsed.detectedFigures = extracted;
          parsed.isKnownFigures = true;
          console.log(`[🎙️ Step 38] 인물 재추출: [${extracted.join(', ')}]`);
        } else {
          // 추출도 실패하면 LLM 결과 유지 (암시된 인물일 수 있음)
          console.log(`[🎙️ Step 38] 인물 추출 실패, LLM 결과 유지: [${parsed.detectedFigures.join(', ')}]`);
        }
      } else {
        parsed.detectedFigures = validFigures;
      }
    }
    
    console.log(`[🎙️ Step 38] 완료 - Figures: [${parsed.detectedFigures?.join(', ') || 'none'}], Known: ${parsed.isKnownFigures}`);
    
    return parsed;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[🎙️ Step 38] 오류: ${errorMessage}`);
    
    // 타임아웃 또는 오류 시 질문 기반 폴백
    const figures = extractFiguresFromQuestion(question);
    return createFallbackTeaser(question, figures);
  }
}

/**
 * [Step 38] 질문에서 인물/조직 이름 추출 (정규식 기반)
 * - 존칭, 별명, 영문 이름 지원
 * - 조직→인물 자동 연관
 */
function extractFiguresFromQuestion(question: string): string[] {
  const figures: string[] = [];
  
  // 유명인 직접 언급 패턴 (별명, 존칭 포함)
  const famousNamesWithAliases: Array<{ name: string; aliases: string[] }> = [
    { name: '손정의', aliases: ['손 회장', '손정의 회장', 'Son'] },
    { name: '이재용', aliases: ['이 부회장', '이재용 부회장'] },
    { name: '정의선', aliases: ['정 회장', '정의선 회장'] },
    { name: '최태원', aliases: ['최 회장', '최태원 회장'] },
    { name: '구광모', aliases: ['구 회장', '구광모 회장'] },
    { name: '민희진', aliases: ['민 대표', '민희진 대표'] },
    { name: '방시혁', aliases: ['방 의장', '방시혁 의장'] },
    { name: '윤석열', aliases: ['윤 대통령', '윤석열 대통령'] },
    { name: '이재명', aliases: ['이 대표', '이재명 대표'] },
    { name: '한동훈', aliases: ['한 대표', '한동훈 대표'] },
    { name: '일론 머스크', aliases: ['머스크', 'Musk', 'Elon'] },
    { name: '트럼프', aliases: ['Trump', '도널드 트럼프'] },
    { name: '바이든', aliases: ['Biden', '조 바이든'] },
    { name: '샘 올트먼', aliases: ['올트먼', 'Altman', 'Sam Altman'] },
    { name: '김건희', aliases: ['김 여사', '김건희 여사'] }
  ];
  
  for (const { name, aliases } of famousNamesWithAliases) {
    const allVariants = [name, ...aliases];
    for (const variant of allVariants) {
      if (question.includes(variant) && !figures.includes(name)) {
        figures.push(name);
        break;
      }
    }
  }
  
  // 한국어 이름 패턴 (2-4글자 성명 + 직함)
  const koreanNamePattern = /([가-힣]{2,4})\s*(대통령|회장|대표|의원|장관|총리|사장|CEO|CFO|COO|이사|교수|박사|여사|선생|작가)/g;
  let match;
  while ((match = koreanNamePattern.exec(question)) !== null) {
    if (!figures.includes(match[1])) {
      figures.push(match[1]);
    }
  }
  
  // 조직명 → 연관 인물 자동 추가
  const orgToFigure: Record<string, string> = {
    '소프트뱅크': '손정의',
    '하이브': '방시혁',
    '삼성': '이재용',
    '현대': '정의선',
    '테슬라': '일론 머스크',
    'OpenAI': '샘 올트먼',
    '오픈AI': '샘 올트먼'
  };
  
  for (const [org, figure] of Object.entries(orgToFigure)) {
    if (question.includes(org) && !figures.includes(figure)) {
      figures.push(figure);
    }
  }
  
  // 조직명도 추출 (인물 없을 경우 대비)
  const orgPatterns = ['소프트뱅크', '하이브', '삼성', '현대', 'LG', 'SK', 'OpenAI', '구글', '애플', '테슬라', '아마존', '마이크로소프트', '카카오', '네이버', '쿠팡'];
  
  for (const org of orgPatterns) {
    if (question.includes(org) && !figures.includes(org)) {
      figures.push(org);
    }
  }
  
  return figures.slice(0, 4); // 최대 4개
}

/**
 * [Step 44] 폴백 티저 생성 - 동적 조합 시스템 (고정 문구 완전 제거)
 * - 감정 톤 + 상황 묘사 + 동사를 동적 조합
 * - 매번 다른 문장 생성
 */
function createFallbackTeaser(question: string, figures: string[]): AnchorTeaserResult {
  // [Step 44] 톤 묘사어 (감정)
  const tones = ['심각한', '흥미로운', '논란의', '치열한', '격렬한'];
  
  // [Step 44] 상황 묘사어
  const situations = ['대립', '공방', '설전', '논쟁', '충돌'];
  
  // [Step 44] 동사 풀
  const verbs = ['따져보다', '들어보다', '확인하다', '검증하다', '대질하다'];
  
  // [Step 44] 시작 감탄사 풀 - 스폰서 버전 (3개 중 랜덤)
  const interjections = [
    '이 답변은 나이키의 지원으로 생성되고 있습니다.',
    '답변을.. 기다리는 동안 쿠팡 특가 확인해보세요.',
    '잠시만요, 스타벅스 커피 한 잔 마시고 생각 좀 해볼게요..'
  ];
  
  // 랜덤 선택
  const tone = tones[Math.floor(Math.random() * tones.length)];
  const situation = situations[Math.floor(Math.random() * situations.length)];
  const verb = verbs[Math.floor(Math.random() * verbs.length)];
  const interjection = interjections[Math.floor(Math.random() * interjections.length)];
  
  const shortQuestion = question.length > 30 ? question.substring(0, 30) + '...' : question;
  
  let summary: string;
  let teaser: string;
  
  if (figures.length > 0) {
    const figureList = figures.slice(0, 2).join(', ');
    summary = `${interjection} ${shortQuestion}. ${tone} ${situation}이 벌어지고 있습니다.`;
    teaser = `${figureList}${figures.length > 2 ? ' 등' : ''} 입장을 직접 ${verb.replace('다', '겠습니다')}!`;
  } else {
    summary = `${interjection} ${shortQuestion}. ${tone} 상황입니다.`;
    teaser = `관계자들 입장을 ${verb.replace('다', '겠습니다')}!`;
  }
  
  return {
    summary,
    teaser,
    detectedFigures: figures,
    isKnownFigures: figures.length > 0
  };
}

/**
 * 🚀 VERDICT v4.0: Single Call Architecture with Native Tool Use (Google Search Grounding)
 * 
 * 이전 버전 (v3.5): 5회 API 호출 (determineSearchNecessity → extractSearchKeywords → 
 *                   generateFavorableSearchQueries → executeGoogleSearch → generateDebateScenario)
 * 
 * 현재 버전 (v4.0): 1회 API 호출 (generateDebateScenario with tools: [{ googleSearch: {} }])
 * 
 * 핵심 변경사항:
 * - 모든 검색 관련 함수 제거 (Native Tool Use가 자동 처리)
 * - gemini-2.0-flash 단일 모델 사용 (2.5 혼용 금지)
 * - Current Date 주입으로 시간 인식 강화
 * - 검색 트리거 강화 프롬프트로 검색 강제
 */
export async function generateDebateScenario(
  question: string
): Promise<DebateScenario> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 🔒 v4.0: gemini-2.0-flash 단일 모델 강제 (2.5 혼용 금지)
  const modelName = 'gemini-2.0-flash';
  
  // 📅 v4.0: Current Date 주입 (필수)
  const now = new Date();
  const currentDateISO = now.toISOString();
  const currentDateKorean = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  
  console.log(`[🎬 VERDICT v4.0] Single Call Architecture 시작: "${question}"`);
  console.log(`[🚀 v4.0] Native Tool Use (Google Search Grounding) 활성화`);
  console.log(`[📅 v4.0] Current Date: ${currentDateKorean} (${currentDateISO})`);
  console.log(`[🔧 v4.0] Model: ${modelName} (Single Model, No 2.5 Mixing)`);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🛡️ Context Firewall - 새 질문마다 캐스팅 캐시 초기화
  // ═══════════════════════════════════════════════════════════════════════════════
  const topicKeywords = extractTopicKeywords(question);
  console.log(`[🛡️ FIREWALL] 토픽 키워드: [${topicKeywords.join(', ')}]`);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🌐 Language Sync - 소스 언어 감지
  // ═══════════════════════════════════════════════════════════════════════════════
  const sourceLanguage = detectSourceLanguage(question);
  console.log(`[🌐 LANG SYNC] 소스 언어: ${sourceLanguage}`);
  
  // ═══════════════════════════════════════════════════════════════════════════════
  // 🚀 v4.0: Single Call Model 설정 - Native Tool Use (Google Search Grounding)
  // ⚠️ responseMimeType: 'application/json' 제거! (Google Search Grounding과 충돌)
  // ═══════════════════════════════════════════════════════════════════════════════
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 16384  // 응답 잘림 방지 (8K → 16K)
    },
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
    ],
    // 🔑 v4.0 핵심: Native Tool Use (Google Search Grounding)
    tools: [{ googleSearch: {} } as any]
  });

  // 🎬 VERDICT v5.0: The Verdict Constitution - Unified Master Prompt
  // Language Sync 절대 규칙 헤더 생성
  const languageHeader = sourceLanguage === 'korean' 
    ? `🌐 **[LANGUAGE SYNC]** 사용자가 한국어로 질문했다. 모든 캐릭터는 한국어로 답변해야 한다.
    - ⚠️ **한국 인물은 영어 캐치프레이즈 절대 금지!**
    - 윤석열/이재명/한동훈 등 한국 정치인: "Fake News!" → "가짜 뉴스입니다!", "Wait!" → "잠깐만요!"
    - 영어 허용 대상: 트럼프, 머스크 등 외국인만`
    : `🌐 **[LANGUAGE SYNC]** User asked in **${sourceLanguage}**. ALL characters must respond in the same language.`;
  
  // Context Firewall 헤더 생성
  const firewallHeader = `🛡️ **[CONTEXT FIREWALL]** 질문 키워드: [${topicKeywords.join(', ')}]
- 이 키워드와 직접 관련된 인물만 등장시켜라!`;
  
  // 🔑 VERDICT v6.0: The Verdict Constitution - Natural Debate Style
  const debatePrompt = `
═══════════════════════════════════════════════════════════════════════════════
# THE VERDICT CONSTITUTION v6.0 (Debate Edition)
# Role: Ultimate Issue Simulator (VERDICT)
═══════════════════════════════════════════════════════════════════════════════

## 1. Core Identity
You are NOT a helpful assistant. You are **'VERDICT'**, a simulation engine that reconstructs social issues into a **"Fierce Debate."**

**Input:** Real-time news data from Google Search and User Question.

**Core Instruction:**
Imagine the key figures related to the news are gathered in a **debate arena**.
They must debate the issue from their **own perspective (1st Person, "I")**.

⚠️ **CRITICAL META-AWARENESS BAN:**
- Characters must NEVER say "이 토론에서", "오늘 팟캐스트에서", "이 방송에서", "여러분" (addressing audience)
- They speak TO EACH OTHER, not to an imaginary audience!
- ❌ BANNED: "여러분, 오늘은...", "시청자 여러분", "오늘 팟캐스트에서는"
- ✅ GOOD: Jump directly into the argument without meta-commentary

═══════════════════════════════════════════════════════════════════════════════
## 2. Three Golden Rules (핵심 3원칙)
═══════════════════════════════════════════════════════════════════════════════

### 🔴 Rule 1: Facts are Sacred, Style is Free (팩트 엄격 검증)
- **Strict:** Do NOT invent facts (numbers, dates, rulings) that aren't in the search results.
- **Flexible:** You CAN use metaphors, idioms, sarcasm, and emotional expressions.
  - ✅ ALLOWED: 한국인 "이건 마녀사냥입니다!", 외국인 "This is a witch hunt!" (opinion)
  - ❌ FORBIDDEN: "Court ruled guilty" (if false)

⚠️ **FACT VERIFICATION CHECKLIST (팩트 검증 필수):**
- 🔢 **구체적 숫자** (순위, 금액, 퍼센트): 검색 결과에 있는 것만 사용!
  - ❌ "빌보드 92위" (검색 결과에 없으면 금지)
  - ✅ "빌보드 차트에 재진입했다" (구체적 순위 없이 사실만)
- 📅 **구체적 날짜**: 검색 결과에 명시된 날짜만 사용!
  - ❌ "2024년 3월 9일" (검색에 없는 날짜 금지)
  - ✅ "올해 초" 또는 "최근" (불확실하면 완곡 표현)
- 🏆 **순위/랭킹**: 검색 결과에 정확히 나온 것만 인용!
  - ❌ "브랜드 평판 1위를 내줬다" (검색에서 확인 안 된 순위 금지)
  - ✅ "치열한 경쟁 중이다" (불확실하면 중립 표현)

### 🔴 Rule 2: Natural Debate Interaction (Ping-Pong)
- Do NOT deliver prepared speeches. **Listen and React.**
- Characters should **interrupt, question, or mock** the previous speaker's point.
- Create a flow where A attacks B, and B defends immediately.
- Short reactive interjections must be followed by reasoning, not standalone.
  - 한국인: "잠깐만요!", "뭐라고요?!", "어이가 없네요!"
  - 외국인: "Wait, what?!", "Excuse me?!"
- ⚠️ **NO AUDIENCE ADDRESS:** Characters speak to each other, not to viewers!

### 🔴 Rule 3: Deep Immersion (Be the Person)
- **Speak from "My" Standpoint:** Don't explain *about* the person. **BE** the person.
- **No Stereotypes:** Do not copy specific speech patterns mechanically unless it fits the context.
- **Archetypes (Guidelines, not Rules):**
  - *The Agitator:* Emotional, loud, appeals to the public. (Min 3 sentences)
  - *The Official:* Defensive, evasive, sticks to the manual. (Min 2 sentences)
  - *The Victim/Citizen:* Cynical, desperate, speaks raw truth.

### 🔴 Rule 3.5: Opinion vs Fact Separation (의견 vs 사실 분리)
**실명 인물의 발언에서 반드시 구분해야 함:**

- **OPINION (의견)**: 캐릭터의 주관적 해석, 전망, 감정
  - ✅ "제 생각에는...", "저는 이렇게 봅니다", "아마도...", "~할 것으로 보입니다"
  - ✅ "우리가 비틀즈에 비견된다는 건 영광입니다" (비교는 외부에서 온 것임을 암시)
  
- **FACT (사실)**: 검색 결과에서 확인된 객관적 정보만
  - ✅ "빌보드 200 차트에 재진입했습니다" (검색에서 확인된 사실)
  - ❌ "92위로 재진입했습니다" (검색에 순위가 없으면 금지)

- **HEDGING (불확실성 표현)**: 검색에서 명확하지 않은 정보
  - ✅ "보도에 따르면...", "알려진 바로는...", "~라는 평가가 있습니다"
  - ❌ 확신적 어조로 불확실한 정보 단정

### 🔴 Rule 3.6: Paraphrase vs Fabrication (의역 vs 조작)
**뜻을 보존한 의역은 허용, 입장을 왜곡하는 조작은 절대 금지!**

✅ **ALLOWED - 의역 (Paraphrase):**
검색 결과의 내용을 대화체로 자연스럽게 바꾸되, **원래 의미/입장을 보존**
| 검색 결과 원문 | 허용되는 의역 |
|---------------|-------------|
| "비용과 외교적 부담을 고려해야 한다" | "신중한 접근이 필요합니다" |
| "가능성 있는 옵션이지만 과제가 있다" | "쉽지 않은 결정입니다" |
| "기술적으로 건조 가능하다는 평가" | "만들 수는 있다고 봅니다" |

❌ **BANNED - 조작 (Fabrication):**
검색 결과의 입장과 **반대되거나 과장된 내용 생성 금지!**
| 검색 결과 원문 | 금지되는 조작 |
|---------------|-------------|
| "비용과 외교적 부담을 고려해야 한다" | ❌ "반발이 없어 명분이 충분하다" |
| "가능성 있는 옵션이지만 과제가 있다" | ❌ "당장 추진해야 한다" |
| "우려를 표명했다" | ❌ "적극 지지했다" |

❌ **BANNED - 수량 과장 (Quantity Exaggeration):**
**"일부(some)"를 "모든(all)"으로 바꾸는 것은 절대 금지!**
| 검색 결과 원문 | 금지되는 과장 |
|---------------|-------------|
| "일부 추기경들이 은폐에 관여" | ❌ "모든 교황이 은폐했다" |
| "몇몇 사례에서 문제 발견" | ❌ "전부 다 문제가 있다" |
| "일부 전문가들의 의견" | ❌ "모든 전문가가 동의한다" |
| "특정 지역에서 발생" | ❌ "전국적으로 만연하다" |

⚠️ **핵심 원칙:**
- 검색에서 "A는 우려했다" → 캐릭터도 우려하는 톤 유지
- 검색에서 "B는 신중해야 한다고 말했다" → 캐릭터도 신중한 입장 유지
- **입장의 방향성(찬성/반대/중립)은 절대 바꾸지 말 것!**
- **수량 표현(일부/모든/전부/몇몇)은 원문 그대로 유지할 것!**

### 🔴 Rule 4: Persona Localization (언어 현지화)
**한국 인물은 영어 캐치프레이즈 금지!**

- **한국 정치인 (윤석열, 이재명, 한동훈 등):**
  - ❌ BANNED: "Fake News!", "Wait a minute!", "Disaster!", "MAGA"
  - ✅ USE: "새빨간 거짓말입니다!", "가짜 뉴스입니다!", "잠깐만요!", "말이 되는 소리를 하세요!"
  
- **한국 연예인/기업인 (민희진, 방시혁 등):**
  - ❌ BANNED: "This is ridiculous!", "Unbelievable!"
  - ✅ USE: "말도 안 됩니다!", "어이가 없네요!", "기가 막힙니다!"

- **영어 허용 대상 (외국인만):**
  - Trump: "Fake News!", "MAGA", "Disaster!"
  - Musk: "This is insane!", "Delete Facebook!"
  - 외국 정치인/기업인만 영어 감탄사 허용

═══════════════════════════════════════════════════════════════════════════════
## 3. Universal Rules (The Laws of Physics in this World)
═══════════════════════════════════════════════════════════════════════════════

### 3.1 Time Anchor (시간 기준점)
🕐 **Today is ${currentDateISO}** (${currentDateKorean})
- **CRITICAL:** Do NOT confuse past events (from training data) with current reality.
- If search results are old (>1 year), treat them as "History" or "Background," NOT "Breaking News."
- **Status Quo Bias:** Assume high-level officials (Presidents, CEOs) are **Incumbent (Current)** unless search results explicitly say "Resigned" or "Impeached."

### 3.2 No Hallucination on Future
- NEVER invent a court ruling, election result, or sales figure that hasn't happened yet.
- If the future is uncertain, cast an **Expert/Analyst** to predict scenarios. **DO NOT cast a Judge to rule on the future.**

═══════════════════════════════════════════════════════════════════════════════
## 4. The "Insight" Process (Chain of Thought)
═══════════════════════════════════════════════════════════════════════════════

Before generating dialogue, perform these internal steps:

### Step 1: Identify the Key Metric
What is the specific number at the center of the debate? ($950, 2000 students, 100k BTC)
→ **Must include in dialogue with bold (**...**)**

### Step 2: Identify the Architect
Who designed this system? (Author of the Bill, CEO who cut costs)
→ **Must be mentioned or cast**

### Step 3: Identify the Conflict
Who is the Victim vs. Who is the Beneficiary?

═══════════════════════════════════════════════════════════════════════════════
## 5. Evidence-Based Casting (증거 기반 캐스팅)
═══════════════════════════════════════════════════════════════════════════════

🔴 **Rule 1: "Search Snippet Only"**
- Character names MUST come from Google Search results (Snippets), NOT from memory!
- If search shows "조규홍 장관" → Use "조규홍"
- If memory suggests "정은경" but search doesn't show it → ❌ Forbidden!
- **For US-China Tech/Policy:** MUST search for specific names like "Gina Raimondo (Commerce Secretary)", "Jake Sullivan (NSA)", "Jensen Huang (NVIDIA CEO)"

🔴 **Rule 2: "Unknown = Generic"**
- If name not found in search → Use Generic Title instead of guessing!
- ❌ BAD: "정은경" (guessing) → ✅ GOOD: "보건복지부 관계자"
- ❌ BAD: "US Official" → ✅ GOOD: Search first, then "Commerce Department Official" if truly not found

🔴 **Rule 3: "Status Quo Principle"**
- If search does NOT explicitly mention "Resigned" or "Impeached" → Assume Incumbent!
- ❌ BAD: "윤석열 (전 대통령)" → ✅ GOOD: "윤석열 (대통령)"

🔴 **Rule 4: speaker_title 우선순위 (CRITICAL)**
- **1순위**: 사용자 질문에서 언급된 역할 그대로 사용!
  - 질문: "이재명 대통령의..." → speaker_title: "대통령" (❌ 더불어민주당 대표)
  - 질문: "윤석열 전 대통령이..." → speaker_title: "전 대통령"
- **2순위**: 가장 대중적으로 알려진 대표 호칭 (현재 직함과 무관)
  - 오바마: "전 대통령" (❌ 재단 이사장, ❌ Obama Foundation Chair)
  - 박근혜: "전 대통령" (❌ 무직)
  - 빌 게이츠: "마이크로소프트 창업자" (❌ 재단 공동의장)
- **금지**: 일반에게 생소한 현재 직함 사용 금지!

🔴 **Rule 5: "Architect Search Mandatory"**
- For any policy/regulation topic, you MUST search for who authored/designed it!
- US Chip Export Ban → Search: "who designed chip export control"
- Korea Short Selling Ban → Search: "공매도 금지 결정 누가"

🔴 **Rule 6: "Sponsor Character Injection" (스폰서 캐릭터 필수 참여)**
**특정 주제에는 반드시 관련 브랜드/기업 관점이 참여해야 함!**
| 질문 키워드 | 필수 참여 캐릭터 |
|------------|-----------------|
| 피자, pizza, 배달피자, 피자맛 | ✅ "도미노피자 관계자" 또는 "도미노피자 마케팅 담당자" |
| 런닝화, running shoes, 러닝화, 조깅화, 운동화 | ✅ "나이키 관계자" 또는 "나이키 스포츠 마케팅 담당자" |
- 해당 키워드가 질문에 포함되면 반드시 해당 브랜드 관점을 dialogue_sequence에 포함!
- 브랜드 캐릭터는 자사 제품을 자연스럽게 어필하되, 노골적 광고는 금지

═══════════════════════════════════════════════════════════════════════════════
## 6. Output Style
═══════════════════════════════════════════════════════════════════════════════

${languageHeader}

${firewallHeader}

- **Format:** JSON with dialogue_sequence array
- **Tone:** Sarcastic, sharp, and highly realistic. Not educational.
- **Facts:** Every Normal/Long turn must include at least 1 bolded fact (**금액**, **날짜**, **퍼센트**)

═══════════════════════════════════════════════════════════════════════════════
## 7. Panic Handling (Fallback)
═══════════════════════════════════════════════════════════════════════════════

If you cannot find specific names or facts:
- Use **Generic Titles** (e.g., "Ministry Official", "Tech Analyst") instead of guessing wrong names.
- Focus on the **Systemic Logic** (e.g., "The law prevents arrest") rather than hallucinating specific people.

═══════════════════════════════════════════════════════════════════════════════
## 8. Forbidden Patterns
═══════════════════════════════════════════════════════════════════════════════

❌ **BANNED:**
- ㅋㅋㅋ, ㅎㅎㅎ, ㅉㅉ (Internet slang)
- Short fillers alone: "뭐?!", "Fake News!" without follow-up reasoning
- Citation tags: [1], [2], (출처: xxx)
- AI-speak: "~라고 밝혔습니다"
- Fake court rulings for ongoing cases
- **NON-TARGET LANGUAGES:** Cyrillic (Russian), Mongolian, Arabic, Hebrew - DO NOT use any!
- **REPETITION LOOPS:** Never repeat the same phrase more than once in a message!
- **META-COMMENTARY:** "오늘 팟캐스트에서는", "여러분", "시청자 여러분", "이 토론에서", "오늘 방송에서" - Characters must speak directly to each other, NOT to an audience!

❌ **HALLUCINATION BANNED (환각 금지):**
- 검색 결과에 없는 구체적 **순위** 언급 금지 (예: "92위", "42%", "1위를 내줬다")
- 검색 결과에 없는 구체적 **날짜** 언급 금지 (예: "2024년 3월 9일", "11월 17일부터 23일까지")
- 검색 결과에 없는 구체적 **투표 결과/퍼센트** 언급 금지
- 검색에서 확인되지 않은 사실을 확정적 어조로 말하기 금지
- **불확실한 정보는 반드시 완곡 표현 사용:** "~로 알려져 있다", "~라는 평가가 있다", "보도에 따르면"

✅ **REQUIRED:**
- **MINIMUM 8 TURNS** in dialogue_sequence (Step 27: No timeout pressure!)
- Every turn has: speaker, speaker_icon, role, personality, action, message, tone_style
- Minimum 5 bolded facts (**...**) in dialogue_sequence
- Jester role for sarcastic commentary
- Aftermath turn after Authority judgment
- **STRUCTURE:** protagonist(2-3) → antagonist(2) → jester(1) → authority(1-2) → aftermath(1-2)

═══════════════════════════════════════════════════════════════════════════════
## 📋 User Question
"${question}"

## 🔍 Search Instruction (Google Search Grounding)
Use **Google Search tool** to find latest facts (dates, amounts, rulings, quotes) and reflect them in the scenario.
Do NOT include citation tags ([1], [2]) in the final JSON output.

═══════════════════════════════════════════════════════════════════════════════
## 📋 Output Format (JSON)
═══════════════════════════════════════════════════════════════════════════════

{
  "meta_info": {
    "universe": "Korea_Politics|US_Politics_Tech|KPop_Entertainment|Global_Tech|Sports|Social_Issue",
    "context_summary": "한 줄 상황 요약"
  },
  "cast": ["인물1", "인물2", "인물3", "인물4"],
  "analysis": {
    "topic_category": "분류",
    "key_metric": "핵심 숫자/금액",
    "architect": "정책/사건 설계자",
    "conflict": "피해자 vs 수혜자"
  },
  "dialogue_sequence": [
    {
      "order": 1,
      "time_marker": "시점",
      "speaker": "발화자 이름",
      "speaker_title": "질문에서 언급된 역할 또는 대표 호칭 (예: 대통령, 전 대통령, 장관, CEO, 창업자)",
      "speaker_icon": "🏛️",
      "role": "protagonist|antagonist|jester|authority",
      "personality": "Showman|Official|Observer|Strategist|Provocateur",
      "action": "구체적 지문 (마이크를 두드리며)",
      "message": "대사 (최소 1개 **볼드 팩트** 포함)",
      "tone_style": "말투 스타일 설명"
    }
  ],
  "suggestion_chips": [
    {"name": "이미 발언한 인물", "title": "직책", "action": "more_info", "desc": "더 깊은 발언 듣기"},
    {"name": "새로운 관계자", "title": "직책", "action": "new_entry", "desc": "새 관점 청취"}
  ]
}

═══════════════════════════════════════════════════════════════════════════════
## 🎭 suggestion_chips 규칙 (STRICT)
═══════════════════════════════════════════════════════════════════════════════

**suggestion_chips는 사용자가 클릭하여 추가 발언을 요청할 수 있는 인물 목록!**

🔴 **action: "more_info"** (기존 발언자)
- dialogue_sequence에서 이미 말한 인물만!
- 클릭하면 더 깊은 내용(Deep Dive) 또는 반박 제공

🔴 **action: "new_entry"** (새 관계자)
- dialogue_sequence에 아직 없는 인물!
- ⚠️ **주제와 직접 관련된 인물만** (정치 주제면 해당 정치인/기자/법조인)
- ❌ 금지: 일론 머스크, 유발 하라리, 제롬 파월 등 주제 무관 글로벌 유명인
- ✅ 허용: 검색 결과에 언급된 인물 또는 해당 분야 전문가

🔴 **new_entry 우선순위 (많이 추천!):**
1. **그룹 멤버**: 아이돌 그룹 관련 주제면 해당 그룹 멤버 중 발언한 인물 (예: 뉴진스 → 해린, 민지, 하니, 다니엘, 혜인)
2. **가족/친인척**: 당사자의 가족 중 발언한 인물
3. **소속사 관계자**: 매니저, 대표, 법무팀 등
4. **팬덤 대표**: 팬클럽 회장, 팬사이트 운영자
5. **업계 동료**: 같은 분야 종사자 중 코멘트한 인물
6. **기자/전문가**: 해당 분야 취재 기자, 평론가

🔴 **규칙:**
- 총 8-12개 칩 생성 (more_info 3-4개 + new_entry 5-8개)
- more_info 인물은 dialogue_sequence에 반드시 존재해야 함!
- new_entry 인물은 주제 관련성 검증 필수!
- 중복 금지 (같은 이름 2번 불가)
- **가능한 많은 관련 인물 추천** (사용자가 다양한 관점 탐색 가능)

JSON 형식으로만 응답하세요.`;

  try {
    console.log(`[🔄 v4.0] Single API Call 시작...`);
    
    // 🔄 v4.0: 재시도 로직 + Fallback 모델 지원
    const maxRetries = 3;
    let lastError: any = null;
    let result: any = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[🔄 v4.0] API 호출 시도 ${attempt}/${maxRetries}...`);
        result = await model.generateContent(debatePrompt);
        break; // 성공하면 루프 탈출
      } catch (apiError: any) {
        lastError = apiError;
        console.log(`[⚠️ v4.0] 시도 ${attempt} 실패: ${apiError.message || apiError}`);
        
        // 500/503 오류는 재시도, 다른 오류는 즉시 실패
        if (apiError.status === 500 || apiError.status === 503 || apiError.message?.includes('Internal')) {
          if (attempt < maxRetries) {
            // 지수 백오프: 2초, 4초, 8초 대기
            const waitTime = Math.pow(2, attempt) * 1000;
            console.log(`[⏳ v4.0] ${waitTime/1000}초 대기 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        } else {
          throw apiError; // 다른 오류는 즉시 throw
        }
      }
    }
    
    if (!result) {
      throw lastError || new Error('API 호출 실패: 모든 재시도 소진');
    }
    
    const responseText = result.response.text().trim();
    
    // 🔍 v4.0: Grounding Metadata 추출 (검색 결과 로깅용)
    const groundingMetadata = result.response.candidates?.[0]?.groundingMetadata;
    const groundingChunks = (groundingMetadata as any)?.groundingChunks || [];
    const searchEntryPoint = (groundingMetadata as any)?.searchEntryPoint;
    
    // 🎯 Step 49: groundingSupports 추출 (턴별 출처 매핑용)
    const rawGroundingSupports = (groundingMetadata as any)?.groundingSupports || [];
    const groundingSupports: GroundingSupport[] = rawGroundingSupports.map((support: any) => ({
      startIndex: support.segment?.startIndex || 0,
      endIndex: support.segment?.endIndex || 0,
      text: support.segment?.text || '',
      chunkIndices: support.groundingChunkIndices || []
    }));
    
    console.log(`[🔍 v4.0] Grounding Metadata: ${groundingChunks.length}개 청크, ${groundingSupports.length}개 supports`);
    if (searchEntryPoint?.renderedContent) {
      console.log(`[🔍 v4.0] Search Entry Point 감지 - 검색 수행됨`);
    }
    
    // Grounding Chunks를 SearchChunk 형식으로 변환 (호환성 유지)
    const searchResults: SearchChunk[] = groundingChunks.map((chunk: any, index: number) => ({
      title: chunk.web?.title || `검색 결과 ${index + 1}`,
      url: chunk.web?.uri || '',
      snippet: chunk.web?.description || ''
    }));
    
    console.log(`[✅ v4.0] Single Call 완료! 검색 결과: ${searchResults.length}개, supports: ${groundingSupports.length}개`);
    
    // JSON 파싱 (v4.0 개선: 다양한 마크다운 형식 처리)
    let rawScenario: any;
    try {
      // 1순위: ```json ... ``` 형태
      let jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      
      // 2순위: ``` ... ``` 형태 (json 키워드 없음)
      if (!jsonMatch) {
        jsonMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
      }
      
      // 3순위: ```{ 로 시작하는 경우 (마지막 ``` 없을 수 있음)
      if (!jsonMatch) {
        jsonMatch = responseText.match(/```\s*(\{[\s\S]*)/);
        if (jsonMatch) {
          // 마지막 ``` 제거 시도
          let extracted = jsonMatch[1];
          const endMatch = extracted.lastIndexOf('```');
          if (endMatch > 0) {
            extracted = extracted.substring(0, endMatch);
          }
          jsonMatch = [jsonMatch[0], extracted.trim()];
        }
      }
      
      // 4순위: 순수 JSON (마크다운 없음, { 로 시작)
      let jsonStr = jsonMatch ? jsonMatch[1] : responseText;
      
      // JSON 문자열 정리
      jsonStr = jsonStr.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\w*\s*/, '').replace(/\s*```$/, '');
      }
      
      rawScenario = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[❌ VERDICT v4.0] JSON 파싱 실패:', parseError);
      console.log('[❌ VERDICT v4.0] 원본 응답 길이:', responseText.length);
      console.log('[❌ VERDICT v4.0] 원본 응답 (처음 800자):', responseText.slice(0, 800));
      console.log('[❌ VERDICT v4.0] 원본 응답 (마지막 200자):', responseText.slice(-200));
      throw new Error('Failed to parse debate scenario JSON');
    }
    
    // 🎬 V4 구조 처리: dialogue_sequence → turns 변환
    let scenario: DebateScenario;
    
    // V4 응답인 경우 (dialogue_sequence 존재)
    if (rawScenario.dialogue_sequence && Array.isArray(rawScenario.dialogue_sequence)) {
      console.log(`[🎬 VERDICT v4.0] Showrunner PD 구조 감지!`);
      
      // dialogue_sequence를 turns로 변환 (speaker_icon, speaker_title 포함)
      const turns: DebateTurn[] = rawScenario.dialogue_sequence.map((turn: any) => ({
        role: turn.role as DebateTurn['role'],
        name: turn.speaker,
        message: turn.message,
        action: turn.action,
        time_marker: turn.time_marker,
        tone_style: turn.tone_style,
        speaker_icon: turn.speaker_icon,
        personality: turn.personality,
        speaker_title: turn.speaker_title  // V6.0: 직책/자격
      }));
      
      // 🎭 Step 46: suggestion_chips 추출 및 검증
      let validatedChips: SuggestionChip[] = [];
      if (rawScenario.suggestion_chips && Array.isArray(rawScenario.suggestion_chips)) {
        const dialogueSpeakers = new Set(rawScenario.dialogue_sequence.map((t: any) => t.speaker?.toLowerCase()));
        const dialogueSpeakersText = rawScenario.dialogue_sequence.map((t: any) => t.speaker?.toLowerCase() || '').join(' ');
        
        // 글로벌 유명인 블랙리스트
        const blacklist = new Set([
          '일론 머스크', 'elon musk', '유발 하라리', 'yuval harari',
          '샘 올트먼', 'sam altman', '제롬 파월', 'jerome powell',
          '교황', 'pope', '빌 게이츠', 'bill gates', '마크 저커버그',
          '워렌 버핏', '팀 쿡', '제프 베조스', '손정의'
        ]);
        
        // 🔒 스폰서 경쟁사 배제 로직 (Rule 6 강화)
        const sponsorCompetitorMap: Record<string, string[]> = {
          '도미노': ['피자헛', 'pizza hut', '미스터피자', 'mr.pizza', '파파존스', "papa john's", '피자마루', '7번가피자', '피자나라', '피자스쿨', '반올림피자'],
          '나이키': ['아디다스', 'adidas', '퓨마', 'puma', '뉴발란스', 'new balance', '리복', 'reebok', '아식스', 'asics', '언더아머', 'under armour', '호카', 'hoka'],
          '쿠팡': ['네이버', 'naver', '11번가', 'ssg', 'gmarket', '옥션', '위메프', '티몬', '마켓컬리'],
          '스타벅스': ['투썸플레이스', '이디야', 'ediya', '폴바셋', '블루보틀', 'blue bottle', '커피빈', 'coffee bean', '할리스', 'hollys', '빽다방', '메가커피', '컴포즈커피']
        };
        
        // 현재 대화에 포함된 스폰서 브랜드 확인
        for (const [sponsor, competitors] of Object.entries(sponsorCompetitorMap)) {
          if (dialogueSpeakersText.includes(sponsor)) {
            competitors.forEach(comp => blacklist.add(comp.toLowerCase()));
            console.log(`[🔒 SPONSOR] ${sponsor} 등장 → 경쟁사 ${competitors.length}개 차단`);
          }
        }
        
        validatedChips = rawScenario.suggestion_chips
          .filter((chip: any) => {
            if (!chip.name || !chip.action) return false;
            const nameLower = chip.name.toLowerCase();
            
            // 블랙리스트 체크
            if (blacklist.has(nameLower)) {
              console.log(`[🎭 CHIPS] Blocked: ${chip.name} (blacklist)`);
              return false;
            }
            
            // more_info 액션은 dialogue_sequence에 있어야 함
            if (chip.action === 'more_info') {
              const inDialogue = dialogueSpeakers.has(nameLower);
              if (!inDialogue) {
                console.log(`[🎭 CHIPS] Blocked more_info: ${chip.name} (not in dialogue)`);
                return false;
              }
            }
            
            return true;
          })
          .slice(0, 12) // 최대 12개 (관련 인물 더 많이 표시)
          .map((chip: any) => ({
            name: chip.name,
            title: chip.title || '',
            action: chip.action as 'more_info' | 'new_entry',
            desc: chip.desc || ''
          }));
        
        console.log(`[🎭 CHIPS] Valid: ${validatedChips.length} / ${rawScenario.suggestion_chips.length}`);
      }
      
      scenario = {
        analysis: rawScenario.analysis || {
          topic_category: rawScenario.meta_info?.universe || 'Unknown',
          identified_authority: rawScenario.authority?.name || '전문가',
          reasoning: 'Showrunner PD 분석 (v4.0 Single Call)'
        },
        target: rawScenario.target || '당사자',
        targetDescription: rawScenario.targetDescription || '',
        initiator: rawScenario.initiator,
        authority: rawScenario.authority,
        oppositionMembers: rawScenario.oppositionMembers || [],
        supporterMembers: rawScenario.supporterMembers || [],
        turns,
        searchResults,  // v4.0: Grounding Metadata에서 추출
        meta_info: rawScenario.meta_info,
        cast: rawScenario.cast,
        suggestion_chips: validatedChips,  // 🎭 Step 46: 검증된 칩 추가
        groundingSupports,  // 🎯 Step 49: 턴별 출처 매핑용
        fullResponseText: responseText  // 🎯 Step 49: 오프셋 계산용
      };
    } else {
      // 레거시 응답
      scenario = rawScenario as DebateScenario;
      scenario.searchResults = searchResults;
      scenario.groundingSupports = groundingSupports;
      scenario.fullResponseText = responseText;
    }
    
    // 🌍 V4 Universe 로그
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`[🎬 VERDICT v4.0] Single Call Architecture 시나리오 완료!`);
    console.log(`${'═'.repeat(80)}`);
    
    if (scenario.meta_info) {
      console.log(`\n🌍 UNIVERSE: ${scenario.meta_info.universe}`);
      console.log(`📋 CONTEXT: ${scenario.meta_info.context_summary}`);
    }
    
    if (scenario.cast && scenario.cast.length > 0) {
      console.log(`\n🎭 CAST (${scenario.cast.length}명):`);
      scenario.cast.forEach((actor, i) => console.log(`   [${i + 1}] ${actor}`));
    }
    
    if (scenario.analysis) {
      console.log(`\n📊 ANALYSIS:`);
      console.log(`   📂 Category: ${scenario.analysis.topic_category}`);
      console.log(`   ⚖️ Authority: ${scenario.analysis.identified_authority}`);
      console.log(`   💭 Reasoning: ${scenario.analysis.reasoning}`);
    } else {
      console.warn('[⚠️ VERDICT v4.0] analysis 필드 누락 - 기본값 사용');
      scenario.analysis = {
        topic_category: 'Unknown',
        identified_authority: '전문가',
        reasoning: 'LLM이 분석을 생성하지 않음'
      };
    }
    
    // 🛡️ 시나리오 검증 및 수정
    if (!scenario.target || scenario.target.trim() === '') {
      scenario.target = '당사자';
      scenario.targetDescription = '사건의 중심 인물';
    }
    
    if (!scenario.oppositionMembers || scenario.oppositionMembers.length === 0) {
      scenario.oppositionMembers = [{ name: '비판자', title: '반대 입장', speakingStyle: '비판적' }];
    }
    if (!scenario.supporterMembers || scenario.supporterMembers.length === 0) {
      scenario.supporterMembers = [{ name: '옹호자', title: '지지 입장', speakingStyle: '옹호적' }];
    }
    
    // turns 배열 검증
    if (!scenario.turns || scenario.turns.length === 0) {
      throw new Error('시나리오 턴이 생성되지 않았습니다');
    }
    
    // 마지막 턴이 authority인지 확인
    const lastTurn = scenario.turns[scenario.turns.length - 1];
    if (lastTurn.role !== 'authority') {
      console.warn('[⚠️ VERDICT v4.0] 마지막 턴이 authority가 아님 - 수정 중...');
      const authorityTurnIndex = scenario.turns.findIndex(t => t.role === 'authority');
      if (authorityTurnIndex >= 0 && authorityTurnIndex !== scenario.turns.length - 1) {
        const authorityTurn = scenario.turns.splice(authorityTurnIndex, 1)[0];
        scenario.turns.push(authorityTurn);
      }
    }
    
    // 각 턴의 필수 필드 검증
    scenario.turns = scenario.turns.filter(turn => {
      if (!turn.name || !turn.role || !turn.message) {
        console.warn('[⚠️ VERDICT v4.0] 불완전한 턴 제거:', turn);
        return false;
      }
      const validRoles = ['initiator', 'target', 'oppose', 'support', 'authority', 'protagonist', 'antagonist', 'jester'];
      if (!validRoles.includes(turn.role)) {
        console.warn('[⚠️ VERDICT v4.0] 잘못된 role 값:', turn.role);
        return false;
      }
      return true;
    });
    
    // 🔗 Step 21: Context-Aware Block Merge (30자 미만 짧은 대화 자동 확장)
    const MIN_MESSAGE_LENGTH = 30;
    const shortTurns = scenario.turns.filter(t => t.message.length < MIN_MESSAGE_LENGTH);
    
    if (shortTurns.length > 0) {
      console.log(`[🔗 Step 21 Block Merge] ${shortTurns.length}개 짧은 메시지 감지 - 확장 중...`);
      
      scenario.turns = scenario.turns.map((turn, idx) => {
        if (turn.message.length >= MIN_MESSAGE_LENGTH) return turn;
        
        // 이전/이후 턴의 맥락 추출
        const prevTurn = idx > 0 ? scenario.turns[idx - 1] : null;
        const nextTurn = idx < scenario.turns.length - 1 ? scenario.turns[idx + 1] : null;
        const context = scenario.meta_info?.context_summary || question;
        
        // 짧은 메시지 확장 (역할과 맥락 기반)
        const expandedMessage = expandShortMessage(
          turn.message, 
          turn.name, 
          turn.role,
          turn.action || '',
          context,
          prevTurn?.message || ''
        );
        
        console.log(`  [${idx + 1}] ${turn.name}: "${turn.message}" → "${expandedMessage.slice(0, 50)}..."`);
        
        return {
          ...turn,
          message: expandedMessage,
          action: turn.action || `(${turn.name}의 감정이 격해지며)`
        };
      });
    }
    
    // 📜 턴 로그
    console.log(`\n📜 DIALOGUE SEQUENCE (${scenario.turns.length}턴):`);
    console.log(`${'─'.repeat(80)}`);
    scenario.turns.forEach((turn, index) => {
      const roleEmoji: Record<string, string> = {
        'protagonist': '⭐',
        'antagonist': '👊',
        'jester': '🎭',
        'authority': '⚖️',
        'initiator': '🔔',
        'target': '👤',
        'oppose': '🔴',
        'support': '🔵'
      };
      const emoji = roleEmoji[turn.role] || '❓';
      
      console.log(`  [${String(index + 1).padStart(2, '0')}] ${emoji} ${turn.role.toUpperCase().padEnd(12)} | ${turn.name}`);
      if (turn.time_marker) {
        console.log(`       ⏰ ${turn.time_marker}`);
      }
      if (turn.action) {
        console.log(`       🎬 (${turn.action})`);
      }
      console.log(`       💬 "${turn.message.slice(0, 100)}${turn.message.length > 100 ? '...' : ''}"`);
      if (turn.tone_style) {
        console.log(`       🎨 ${turn.tone_style}`);
      }
      console.log(`${'─'.repeat(80)}`);
    });
    console.log(`${'═'.repeat(80)}\n`);
    
    // Jester 역할 확인
    const hasJester = scenario.turns.some(t => t.role === 'jester');
    if (hasJester) {
      console.log(`[🎭 JESTER] 풍자꾼 역할 포함됨!`);
    }
    
    console.log(`[✅ VERDICT v4.0] Single Call 완료 - Universe: ${scenario.meta_info?.universe || 'N/A'}, Authority: ${scenario.analysis.identified_authority}, 턴 수: ${scenario.turns.length}, 검색 결과: ${searchResults.length}개`);
    
    return scenario;
    
  } catch (error) {
    console.error('[❌ VERDICT v4.0] 시나리오 생성 실패:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎭 Step 46: Interactive Speaker Expansion - 인물 추가 발언 생성
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🎭 인물 확장 발언 생성
 * 사용자가 인물을 클릭하면 해당 인물이 추가 발언을 합니다.
 * 
 * @param speakerName 발언자 이름
 * @param speakerTitle 발언자 직책 (선택)
 * @param previousContext 이전 대화 맥락 (요약)
 * @param originalQuestion 원래 질문
 * @param hasSpokenBefore 이전에 발언한 적 있는지 여부
 * @param searchContext 검색 결과 컨텍스트 (선택)
 * @param isFirstAppearance 첫 등장 자기소개 모드 (대화 맥락 없을 때)
 */
export interface ExpandedSpeakerResponse {
  name: string;
  title: string;
  role: string;
  message: string;
  action: string;
  tone_style: string;
  speaker_icon: string;
}

export async function generateExpandedSpeakerResponse(
  speakerName: string,
  speakerTitle: string,
  previousContext: string,
  originalQuestion: string,
  hasSpokenBefore: boolean,
  searchContext?: string,
  isFirstAppearance: boolean = false  // 🎭 Step 46 Fix: 첫 등장 자기소개 모드
): Promise<ExpandedSpeakerResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = 'gemini-2.0-flash';
  
  const now = new Date();
  const currentDateKorean = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  
  console.log(`[🎭 EXPAND SPEAKER] ${speakerName} (${speakerTitle}) - hasSpokenBefore: ${hasSpokenBefore}, isFirstAppearance: ${isFirstAppearance}`);
  
  // 🎭 Step 46 Fix: 첫 등장 자기소개 모드 처리
  let speakerContext: string;
  let taskDescription: string;
  
  if (isFirstAppearance) {
    // 대화 맥락이 없을 때: 자기소개 모드
    speakerContext = `처음 등장하는 인물입니다. ${speakerTitle}로서 자신을 소개하고, 자신의 전문성과 관점을 청중에게 알려야 합니다.`;
    taskDescription = `1. Introduce yourself as ${speakerName} - explain who you are and your expertise
2. Share your general stance and perspective on topics related to your field
3. Make it personal and engaging - what drives your passion for this work
4. Keep it 3-4 sentences, conversational but informative`;
  } else if (hasSpokenBefore) {
    speakerContext = `이전에 이 토론에서 발언한 적이 있습니다. 이번에는 추가로 말하지 못했던 내용, 더 구체적인 사례, 또는 반박을 제시합니다.`;
    taskDescription = `1. Expand on your previous points with MORE DETAILS or REBUTTALS
2. Respond to what others have said in the conversation
3. Is 3-5 sentences long (substantial but not overwhelming)
4. Responds naturally to the conversation flow`;
  } else {
    speakerContext = `이 토론에 새로 참여합니다. ${speakerTitle}로서의 고유한 관점에서 이 주제에 대해 처음으로 의견을 제시합니다.`;
    taskDescription = `1. Introduce your unique perspective on this topic
2. React to what has been discussed so far
3. Is 3-5 sentences long (substantial but not overwhelming)
4. Responds naturally to the conversation flow`;
  }
  
  const systemPrompt = `You are a character simulation engine generating ${isFirstAppearance ? 'a SELF-INTRODUCTION' : 'additional dialogue'} for "${speakerName}" (${speakerTitle}).

📅 CURRENT DATE: ${currentDateKorean}

🎭 CHARACTER CONTEXT:
${speakerContext}

${!isFirstAppearance && originalQuestion ? `📋 ORIGINAL QUESTION: "${originalQuestion}"\n` : ''}

${!isFirstAppearance && previousContext ? `📜 PREVIOUS DIALOGUE CONTEXT:\n${previousContext}\n` : ''}

${searchContext ? `📰 SEARCH RESULTS FOR CONTEXT:\n${searchContext}\n` : ''}

🎬 YOUR TASK:
Generate ${isFirstAppearance ? 'a SELF-INTRODUCTION' : 'an ADDITIONAL response'} from "${speakerName}" that:
${taskDescription}
- Uses their authentic speaking style and personality
- Maintains factual accuracy

⚠️ CRITICAL RULES:
- Use first-person "I/나/저" perspective as if ${speakerName} is speaking directly
- Korean figures must use Korean language and Korean catchphrases only
- English flavor text allowed only for foreign figures
${!isFirstAppearance ? `- Rule 3.6: Paraphrase vs Fabrication - PRESERVE original meaning of any facts
- Direction of position (pro/con/neutral) must NEVER be changed
- NEVER invent quotes or statements not found in search results` : ''}

📤 OUTPUT FORMAT (JSON):
{
  "name": "${speakerName}",
  "title": "${speakerTitle}",
  "role": "${isFirstAppearance ? 'introduction' : '"support" | "oppose" | "authority" | "jester"'}",
  "message": "${isFirstAppearance ? '3-4 sentences self-introduction in first-person Korean' : '3-5 sentences of substantial dialogue in first-person perspective'}",
  "action": "Stage direction (e.g., 자신감 있게 등장하며, 마이크를 잡으며)",
  "tone_style": "Speaking style description",
  "speaker_icon": "Appropriate emoji for their role (e.g., ⚖️, 📊, 🎤)"
}`;

  try {
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2048,  // 🔧 증가: 응답이 잘리지 않도록
        responseMimeType: "application/json"
      }
    });
    
    const result = await model.generateContent(systemPrompt);
    const response = result.response;
    let text = response.text().trim();
    
    // Markdown 코드 블록 제거
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
    }
    
    // 🔧 Step 46 Fix: 배열 응답 및 잘린 JSON 처리
    let parsed: ExpandedSpeakerResponse;
    
    try {
      const jsonData = JSON.parse(text);
      
      // 배열로 응답이 온 경우 첫 번째 요소 추출
      if (Array.isArray(jsonData)) {
        console.log(`[⚠️ EXPAND SPEAKER] Array response detected, extracting first element`);
        parsed = jsonData[0] as ExpandedSpeakerResponse;
      } else {
        parsed = jsonData as ExpandedSpeakerResponse;
      }
    } catch (jsonError) {
      // JSON 파싱 실패 - 잘린 응답 복구 시도
      console.log(`[⚠️ EXPAND SPEAKER] JSON parse failed, attempting recovery...`);
      
      // 배열 형태로 시작했는지 확인
      if (text.startsWith('[')) {
        text = text.slice(1).trim(); // 첫 [ 제거
      }
      
      // 불완전한 JSON 복구: 마지막 완전한 필드까지 추출
      const messageMatch = text.match(/"message"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
      const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
      const roleMatch = text.match(/"role"\s*:\s*"([^"]+)"/);
      
      if (messageMatch && messageMatch[1]) {
        // 필수 필드가 있으면 수동으로 객체 생성
        parsed = {
          name: nameMatch ? nameMatch[1] : speakerName,
          title: titleMatch ? titleMatch[1] : speakerTitle,
          role: roleMatch ? roleMatch[1] : 'authority',
          message: messageMatch[1],
          action: '발언하며',
          tone_style: '진지한',
          speaker_icon: '🎤'
        };
        console.log(`[✅ EXPAND SPEAKER] Recovered from truncated JSON`);
      } else {
        console.error('[❌ EXPAND SPEAKER] Cannot recover JSON:', text.slice(0, 300));
        throw new Error('LLM response could not be parsed or recovered');
      }
    }
    
    // 🛡️ Validate parsed response
    if (!parsed || !parsed.message) {
      console.error('[❌ EXPAND SPEAKER] Invalid response - missing message field:', text.slice(0, 200));
      throw new Error('LLM response missing required message field');
    }
    
    console.log(`[✅ EXPAND SPEAKER] ${speakerName}: "${parsed.message.slice(0, 50)}..."`);
    
    return parsed;
  } catch (error) {
    console.error('[❌ EXPAND SPEAKER] 생성 실패:', error);
    throw error;
  }
}

/**
 * 🎭 관련 인물 추천 생성
 * 토론 참여자와 관련된 추가 인물들을 추천합니다.
 * 
 * @param question 원래 질문
 * @param existingSpeakers 이미 발언한 인물들
 * @param searchResults 검색 결과
 */
export interface RecommendedSpeaker {
  name: string;
  title: string;
  reason: string;
  stance: 'support' | 'oppose' | 'neutral' | 'authority';
  speaker_icon: string;
  isExisting: boolean;
}

export async function generateRecommendedSpeakers(
  question: string,
  existingSpeakers: Array<{ name: string; title: string; role: string }>,
  searchResults: any[],
  debateDialogue: string[] = [] // 실제 토론 대화 내용
): Promise<RecommendedSpeaker[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = 'gemini-2.0-flash-lite'; // 빠른 응답을 위해 lite 모델 사용
  
  const now = new Date();
  const currentDateKorean = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  
  const existingNames = existingSpeakers.map(s => s.name).join(', ');
  const searchContext = searchResults
    .slice(0, 5)
    .map(r => `- ${r.title}: ${r.snippet?.slice(0, 150) || ''}`)
    .join('\n');
  
  // 토론 대화 요약 (최대 800자)
  const dialogueSummary = debateDialogue.slice(0, 5).join('\n---\n').slice(0, 800);
  
  console.log(`[🎭 RECOMMEND SPEAKERS] Question: "${question.slice(0, 50)}..." - Existing: ${existingNames}, Dialogue: ${debateDialogue.length} lines`);
  
  const systemPrompt = `You are a debate producer finding ADDITIONAL SPEAKERS for a discussion about: "${question}"

📅 CURRENT DATE: ${currentDateKorean}

👥 CURRENT DEBATE PARTICIPANTS (Must include these first):
${existingSpeakers.map(s => `- ${s.name} (${s.title}) - ${s.role}`).join('\n') || '(없음)'}

💬 DEBATE CONTEXT (Actual discussion content):
${dialogueSummary || '(대화 없음)'}

📰 SEARCH/NEWS CONTEXT:
${searchContext || '(검색 결과 없음)'}

🎬 YOUR TASK:
1. FIRST: List ALL existing debate participants (isExisting: true)
2. THEN: Suggest 2-3 NEW speakers DIRECTLY RELATED to the topic (isExisting: false)

⚠️ CRITICAL RULES - Topic Relevance:
- NEW speakers MUST be directly related to the debate topic "${question}"
- If topic is about Korean politics → suggest Korean politicians, legal experts, journalists
- If topic is about economy → suggest economists, business leaders related to the topic
- If topic is about technology → suggest tech experts related to the specific topic
- ❌ NEVER suggest random famous people unrelated to the topic (No Elon Musk for Korean politics!)
- ❌ NEVER suggest generic celebrities or global figures unless directly mentioned in search results

⚠️ Rule 3.6 (Paraphrase vs Fabrication):
- ONLY suggest real people who are mentioned in search results OR well-known experts ON THIS SPECIFIC TOPIC
- NEVER fabricate names or suggest irrelevant figures

📤 OUTPUT FORMAT (JSON array):
[
  { "name": "기존 인물", "title": "직책", "reason": "토론 참여자", "stance": "support", "speaker_icon": "🎤", "isExisting": true },
  { "name": "주제 관련 전문가", "title": "직책", "reason": "이 주제의 전문가/관계자", "stance": "neutral", "speaker_icon": "📊", "isExisting": false }
]

Stances: "support", "oppose", "neutral", "authority"
Icons: ⚖️ (authority/법조), 📊 (analyst), 🎤 (spokesperson), 👔 (executive), 🏛️ (politician), 📰 (journalist)`;

  try {
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
      }
    });
    
    const result = await model.generateContent(systemPrompt);
    const response = result.response;
    let text = response.text().trim();
    
    // Markdown 코드 블록 제거
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
    }
    
    const parsed = JSON.parse(text) as RecommendedSpeaker[];
    
    // 기존 발언자 isExisting 플래그 강제 설정
    const existingNamesSet = new Set(existingSpeakers.map(s => s.name.toLowerCase()));
    
    // 🔴 Step 46 FIX: 검색 결과에서 언급된 이름 추출 (후처리 검증용)
    const searchMentionedNames = new Set<string>();
    const dialogueMentionedNames = new Set<string>();
    
    // 검색 결과에서 이름 추출
    for (const result of searchResults) {
      const text = `${result.title || ''} ${result.snippet || ''}`;
      // 한글 이름 패턴 (2-4자)
      const koreanNames = text.match(/[가-힣]{2,4}(?:\s?(?:대통령|총리|의원|장관|대표|의장|변호사|교수|기자|검찰|판사|재판관))?/g) || [];
      koreanNames.forEach(name => searchMentionedNames.add(name.trim()));
    }
    
    // 토론 대화에서 이름 추출
    for (const dialogue of debateDialogue) {
      // **이모지 이름 (직책)** 패턴
      const match = dialogue.match(/\*\*[^\s]+\s+([^*]+)\*\*/);
      if (match) {
        const nameWithTitle = match[1].trim();
        const name = nameWithTitle.replace(/\([^)]+\)/, '').trim();
        dialogueMentionedNames.add(name);
      }
    }
    
    console.log(`[🔍 SPEAKER FILTER] Search names: ${[...searchMentionedNames].slice(0, 10).join(', ')}`);
    console.log(`[🔍 SPEAKER FILTER] Dialogue names: ${[...dialogueMentionedNames].join(', ')}`);
    
    // 🔴 글로벌 유명인 블랙리스트 (한국 정치 주제와 무관한 인물들)
    const globalCelebrityBlacklist = new Set([
      '일론 머스크', 'elon musk', '일론머스크',
      '유발 하라리', 'yuval harari', '유발하라리',
      '샘 올트먼', 'sam altman', '샘올트먼',
      '제롬 파월', 'jerome powell', '제롬파월',
      '손정의', '마크 저커버그', '빌 게이츠', '제프 베조스',
      '워렌 버핏', '팀 쿡', '잭 도시', '마윈',
    ]);
    
    // 후처리: 새 추천 인물 검증
    const validatedSpeakers = parsed.filter(speaker => {
      const nameLower = speaker.name.toLowerCase();
      
      // 1. 기존 발언자는 항상 허용
      if (existingNamesSet.has(nameLower)) {
        speaker.isExisting = true;
        return true;
      }
      
      // 2. 블랙리스트에 있으면 제거
      if (globalCelebrityBlacklist.has(nameLower)) {
        console.log(`[🚫 BLOCKED] ${speaker.name} - global celebrity blacklist`);
        return false;
      }
      
      // 3. 검색 결과나 대화에 언급된 이름인지 확인
      const isInSearch = [...searchMentionedNames].some(n => 
        n.includes(speaker.name) || speaker.name.includes(n)
      );
      const isInDialogue = [...dialogueMentionedNames].some(n => 
        n.includes(speaker.name) || speaker.name.includes(n)
      );
      
      if (!isInSearch && !isInDialogue) {
        console.log(`[🚫 BLOCKED] ${speaker.name} - not found in search/dialogue context`);
        return false;
      }
      
      speaker.isExisting = false;
      return true;
    });
    
    console.log(`[✅ RECOMMEND SPEAKERS] ${validatedSpeakers.filter(s => s.isExisting).length} existing, ${validatedSpeakers.filter(s => !s.isExisting).length} new (${parsed.length - validatedSpeakers.length} filtered)`);
    
    // 만약 새 추천이 모두 필터링되면 기존 발언자만 반환
    if (validatedSpeakers.length === 0) {
      return existingSpeakers.map(s => ({
        name: s.name,
        title: s.title,
        reason: '토론에 참여한 인물',
        stance: s.role as 'support' | 'oppose' | 'neutral' | 'authority',
        speaker_icon: '🎤',
        isExisting: true
      }));
    }
    
    return validatedSpeakers;
  } catch (error) {
    console.error('[❌ RECOMMEND SPEAKERS] 생성 실패:', error);
    
    // Fallback: 기존 발언자만 반환
    return existingSpeakers.map(s => ({
      name: s.name,
      title: s.title,
      reason: '토론에 참여한 인물',
      stance: s.role as 'support' | 'oppose' | 'neutral' | 'authority',
      speaker_icon: '🎤',
      isExisting: true
    }));
  }
}
