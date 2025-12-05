import type { Agent } from '@shared/schema';
import searchConfig from './searchConfig.json';

/**
 * 한국어 불용어 리스트
 */
const KOREAN_STOPWORDS = new Set([
  '은', '는', '이', '가', '을', '를', '의', '에', '에서', '로', '으로',
  '와', '과', '도', '만', '까지', '부터', '한테', '에게',
  '그', '저', '이', '그것', '저것', '이것',
  '뭐', '왜', '어디', '언제', '누구', '무엇',
  '있다', '없다', '하다', '되다', '이다', '아니다'
]);

/**
 * 검색 쿼리 스펙
 */
export interface SearchQuerySpec {
  primaryQuery: string;
  operators: string[];
  fullQuery: string;
}

/**
 * 검색 쿼리 빌더 입력
 */
export interface SearchQueryInput {
  agentName: string;
  agentCategory?: string;
  userQuestion: string;
}

/**
 * 사용자 질문에서 키워드 추출
 * @param question 사용자 질문
 * @returns 추출된 키워드 배열
 */
function extractKeywords(question: string): string[] {
  // 1. 소문자 변환 및 구두점 제거
  const normalized = question
    .toLowerCase()
    .replace(/[.,!?;:'"()\[\]{}]/g, ' ')
    .trim();
  
  // 2. 공백으로 분리
  const words = normalized.split(/\s+/);
  
  // 3. 불용어 제거 및 2글자 이상만 유지
  const keywords = words.filter(
    word => word.length >= 2 && !KOREAN_STOPWORDS.has(word)
  );
  
  // 4. 중복 제거
  return [...new Set(keywords)];
}

/**
 * 명사구 추출 (간단한 정규식 기반)
 * @param question 사용자 질문
 * @returns 추출된 명사구 배열
 */
function extractNamedEntities(question: string): string[] {
  const entities: string[] = [];
  
  // 한국어 인명 패턴 (2-4글자, 한글만)
  const namePattern = /[가-힣]{2,4}(?=\s|$|[은는이가을를])/g;
  const names = question.match(namePattern) || [];
  entities.push(...names);
  
  // 영문 고유명사 (대문자로 시작)
  const englishNamePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const englishNames = question.match(englishNamePattern) || [];
  entities.push(...englishNames);
  
  return [...new Set(entities)];
}

/**
 * 에이전트 카테고리에 따른 포커스 용어 가져오기
 * @param category 에이전트 카테고리
 * @returns 포커스 용어 배열
 */
function getFocusTerms(category?: string): string[] {
  if (!category) return [];
  
  // 설정 파일에서 카테고리 매칭 (대소문자 무시)
  const normalizedCategory = category.toLowerCase();
  for (const [key, terms] of Object.entries(searchConfig.searchFocusTerms)) {
    if (normalizedCategory.includes(key.toLowerCase())) {
      return terms as string[];
    }
  }
  
  return [];
}

/**
 * 동의어 확장 함수
 * @param query 원본 쿼리
 * @returns 동의어가 확장된 쿼리
 */
function expandSynonyms(query: string): string {
  const focusTerms = searchConfig.searchFocusTerms;
  let expandedQuery = query;

  for (const term in focusTerms) {
    // 쿼리에 핵심 용어가 포함되어 있다면
    if (query.includes(term)) {
      // 해당 용어와 동의어를 OR 조건으로 묶어 쿼리를 확장
      const synonyms = (focusTerms as any)[term].join(' OR ');
      expandedQuery = expandedQuery.replace(term, `(${term} OR ${synonyms})`);
    }
  }
  return expandedQuery;
}

/**
 * 검색 쿼리 생성 (그룹챗 에이전트 정보 통합)
 * @param input 검색 쿼리 입력 정보
 * @param agentNames 그룹챗 에이전트 이름 목록 (선택)
 * @returns 검색 쿼리 스펙 배열
 */
export function buildSearchQuery(
  input: SearchQueryInput,
  agentNames?: string[]
): SearchQuerySpec[] {
  const { agentName, agentCategory, userQuestion } = input;
  
  // 1. 키워드 추출
  const keywords = extractKeywords(userQuestion);
  const entities = extractNamedEntities(userQuestion);
  
  // 2. 카테고리별 포커스 용어
  const focusTerms = getFocusTerms(agentCategory);
  
  // 3. 동의어 확장
  const expandedQuestion = expandSynonyms(userQuestion);
  
  // 4. Primary Query 구성
  let primaryQuery = `"${agentName}"`;
  
  // 그룹챗 에이전트 이름을 OR 조건으로 통합
  if (agentNames && agentNames.length > 0) {
    const agentFilter = agentNames.map(name => `"${name}"`).join(' OR ');
    primaryQuery = `(${agentFilter})`;
  }
  
  // 명사구가 있으면 추가
  if (entities.length > 0) {
    primaryQuery += ` ${entities.join(' ')}`;
  } else if (keywords.length > 0) {
    // 명사구가 없으면 키워드 중 상위 3개 추가
    primaryQuery += ` ${keywords.slice(0, 3).join(' ')}`;
  }
  
  // 5. 포커스 용어를 OR로 연결 (최대 3개)
  const orTerms = focusTerms.slice(0, 3);
  if (orTerms.length > 0) {
    primaryQuery += ` (${orTerms.join(' OR ')})`;
  }
  
  // 6. 기본 제외 연산자 추가
  const operators = [...searchConfig.defaultExcludeOperators];
  
  // 7. 전체 쿼리 조합
  let fullQuery = `${primaryQuery} ${operators.join(' ')}`.trim();
  
  // 8. 최대 길이 제한
  if (fullQuery.length > searchConfig.maxQueryLength) {
    fullQuery = fullQuery.substring(0, searchConfig.maxQueryLength);
  }
  
  // 9. Primary Query만 있는 버전 (Fallback용)
  const simplePrimaryQuery = `"${agentName}" ${keywords.slice(0, 2).join(' ')}`.trim();
  const simpleFallbackQuery = `${simplePrimaryQuery} ${operators.join(' ')}`.trim();
  
  console.log(`[🔍 검색 쿼리 빌더] 원본: "${userQuestion}"`);
  console.log(`[🔍 동의어 확장] "${expandedQuestion}"`);
  console.log(`[🔍 최종 쿼리] "${fullQuery}"`);
  
  return [
    {
      primaryQuery,
      operators,
      fullQuery
    },
    // Fallback: 더 단순한 쿼리
    {
      primaryQuery: simplePrimaryQuery,
      operators,
      fullQuery: simpleFallbackQuery
    }
  ];
}
