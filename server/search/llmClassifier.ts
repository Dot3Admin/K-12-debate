import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ClassificationLevel } from "@shared/schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * LLM 분류 결과
 */
export interface ClassificationResult {
  classification: ClassificationLevel;
  answer: string;
  eventDate?: string | null; // 이벤트 날짜 (YYYY-MM-DD 형식)
  ttl_seconds: number;
}

/**
 * LLM 기본 지식 체크 결과
 */
export interface KnowledgeCheckResult {
  canAnswer: boolean; // LLM이 자체 지식으로 답변 가능한지
  confidence: number; // 신뢰도 (0-100)
  answer?: string; // 답변 (가능할 경우)
  needsSearch: boolean; // Google Search 필요 여부
  reasoning: string; // 판단 근거
}

/**
 * 시간 키워드 목록 (강제 재검색 트리거)
 */
const TIME_KEYWORDS = [
  // 한국어
  "최근", "어제", "오늘", "지금", "현재", "방금", "금일", "오전", "오후",
  "이번주", "이번달", "이번년", "최신", "실시간", "막", "갓",
  // 영어
  "recent", "today", "now", "current", "latest", "just", "this week",
  "this month", "this year", "real-time", "live"
];

/**
 * 질문에 시간 키워드가 포함되어 있는지 확인
 */
export function hasTimeKeywords(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return TIME_KEYWORDS.some(keyword => lowerQuery.includes(keyword));
}

/**
 * 분류 레벨에 따른 기본 TTL 계산 (초 단위)
 */
export function calculateDefaultTTL(classification: ClassificationLevel): number {
  const ONE_HOUR = 60 * 60;
  const ONE_DAY = 24 * ONE_HOUR;
  
  switch (classification) {
    case "LEVEL_0_IMMUTABLE":
      return ONE_DAY * 365 * 10; // 10년
    case "LEVEL_1_LONG_TERM":
      return ONE_DAY * 30 * 6; // 6개월
    case "LEVEL_2_MEDIUM_TERM":
      return ONE_DAY * 30; // 1개월
    case "LEVEL_3_SHORT_TERM":
      return ONE_DAY; // 24시간
    case "LEVEL_4_REALTIME":
      return ONE_HOUR * 6; // 6시간
    default:
      // 안전장치: 예상치 못한 카테고리는 짧게 (6시간)
      console.warn(`[⚠️ TTL 경고] 예상치 못한 분류 레벨: ${classification}, 기본값 6시간 적용`);
      return ONE_HOUR * 6;
  }
}

/**
 * 스마트 TTL 계산: 이벤트 날짜 우선, 없으면 카테고리별 기본값
 * @param classification 분류 레벨
 * @param eventDate 이벤트 날짜 (YYYY-MM-DD 형식, 선택적)
 * @returns TTL (초 단위)
 */
export function calculateSmartTTL(
  classification: ClassificationLevel,
  eventDate?: string | null
): number {
  // 1. 이벤트 날짜가 있으면 우선 사용
  if (eventDate) {
    try {
      const eventDateTime = new Date(eventDate);
      // 이벤트 날짜 다음 날 0시까지 + 24시간 (이벤트 종료 후 하루 더 유효)
      eventDateTime.setDate(eventDateTime.getDate() + 2); // +1일 (다음날) + 1일 (버퍼)
      eventDateTime.setHours(0, 0, 0, 0);
      
      const now = new Date();
      const ttlSeconds = Math.floor((eventDateTime.getTime() - now.getTime()) / 1000);
      
      // 최소 6시간, 최대 10년
      const minTTL = 6 * 60 * 60; // 6시간
      const maxTTL = 10 * 365 * 24 * 60 * 60; // 10년
      
      if (ttlSeconds > minTTL) {
        console.log(`[⏰ 스마트 TTL] 이벤트 날짜 기반: ${eventDate} → ${ttlSeconds}초 (${Math.floor(ttlSeconds / 86400)}일)`);
        return Math.min(ttlSeconds, maxTTL);
      }
      
      console.log(`[⚠️ 스마트 TTL] 이벤트 날짜가 너무 가까움 (${ttlSeconds}초), 카테고리 기본값 사용`);
    } catch (error) {
      console.error(`[❌ 스마트 TTL] 이벤트 날짜 파싱 실패: ${eventDate}`, error);
    }
  }
  
  // 2. 이벤트 날짜 없으면 카테고리별 기본값
  const defaultTTL = calculateDefaultTTL(classification);
  console.log(`[📅 스마트 TTL] 카테고리 기반: ${classification} → ${defaultTTL}초 (${Math.floor(defaultTTL / 86400)}일)`);
  return defaultTTL;
}

/**
 * 캐릭터 페르소나 정보
 */
export interface CharacterPersona {
  agentName: string;
  agentDescription: string;
  speechStyle: string;
  personality: string;
  knowledgeDomain: string; // 💡 캐릭터의 지식 영역
}

/**
 * 캐릭터 말투로 거절 메시지 생성
 */
export function generateCharacterRefusal(persona: CharacterPersona): string {
  // 역사적 인물/특수 캐릭터는 고유 거절 패턴 사용
  const nameLower = persona.agentName.toLowerCase();
  
  if (persona.agentName.includes("이순신")) {
    return "그것은 내가 알 수 없는 먼 훗날의 일이오. 나는 오직 전쟁과 나라를 지키는 일에 대해서만 이야기할 수 있을 뿐이다.";
  }
  
  if (nameLower.includes("buffett") || nameLower.includes("버핏")) {
    return "그건 제 전문 분야가 아니라서 정확히 말씀드리기 어렵네요. 저는 투자와 경제에 대해서만 이야기할 수 있습니다.";
  }
  
  if (nameLower.includes("einstein") || persona.agentName.includes("아인슈타인")) {
    return "그것은 나의 전문 분야를 벗어나는 일이오. 나는 물리학과 우주에 대해서만 이야기할 수 있소.";
  }
  
  // 기본 거절 패턴
  return `죄송합니다만, 그것은 제 전문 분야가 아닙니다. 저는 ${persona.knowledgeDomain}에 대해서만 도움을 드릴 수 있습니다.`;
}

/**
 * LLM을 사용하여 질문 분류 + 답변 생성 동시 수행
 * @param query 사용자 질문
 * @param searchResults 검색 결과 컨텍스트 (상위 10개)
 * @param persona 캐릭터 페르소나 정보 (선택적)
 * @returns 분류 결과 (classification, answer, ttl_seconds)
 */
export async function classifyAndAnswer(
  query: string,
  searchResults: string,
  persona?: CharacterPersona
): Promise<ClassificationResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: "application/json", // JSON 모드 활성화
      },
    });

    // 시스템 프롬프트 (캐릭터 기반 또는 기본)
    const systemPrompt = persona 
      ? `당신은 ${persona.agentName}입니다.
${persona.agentDescription}

**당신의 지식 영역:** ${persona.knowledgeDomain}

---
🚨 **최우선 규칙: 역할 유지와 지식 영역 제약**

질문이 [지식 영역]을 벗어나면 **절대 답변하지 마세요**.
- ❌ 검색 결과가 있어도 답변 금지
- ✅ 캐릭터 말투로 정중히 거절:
  * "그것은 내가 알 수 없는 먼 훗날의 일이오." (이순신)
  * "제 전문 분야가 아니라서 정확히 말씀드리기 어렵네요." (현대인)
  * "나는 오직 ${persona.knowledgeDomain}에 대해서만 이야기할 수 있소."

질문이 [지식 영역] 내라면 다음 규칙을 따르세요:

**핵심 규칙: 자신의 관점과 의견 표현**
1. 검색 결과를 바탕으로 답변하되, **반드시 자신의 입장을 포함**
2. 객관적 전달 금지 - "~입니다" 같은 뉴스 보도 톤 지양
3. 주관적 표현 필수 - "제 생각엔...", "내가 보기엔...", "저는 이렇게 봅니다"
4. 사실에 대한 **평가와 의견** 제시 (단순 사실 나열 ❌)

---
**작업 1: 답변 생성**
사용자의 [질문]에 대해 주어진 [검색 결과]를 바탕으로, ${persona.agentName}의 관점에서 답변을 생성합니다.

**작업 2: 정보 분류**
생성한 답변의 '정보 휘발성'을 아래 5가지 레벨 중 **정확히 하나**만 선택하여 분류합니다.

**분류 기준 (반드시 이 5가지 중 하나만 선택):**
- LEVEL_0_IMMUTABLE: 불변의 진리 (역사적 기록, 과학 법칙, 이미 종료되어 확정된 과거 사건)
  예: "임진왜란 발발 연도", "물의 끓는점", "마크 로스코 출생지"
  
- LEVEL_1_LONG_TERM: 잘 변하지 않는 정보 (문화재 설명, 일반적인 지식, 기업 연혁, 스테디셀러 제품)
  예: "에펠탑 높이", "삼성전자 창립자", "모나리자 소장 미술관"
  
- LEVEL_2_MEDIUM_TERM: 중기적으로 유효한 정보 (월간 통계, 분기별 실적, 중장기 정책)
  예: "2024년 3분기 GDP 성장률", "2025년 예산안", "연간 판매량"
  
- LEVEL_3_SHORT_TERM: 단기 시사 정보 (오늘 뉴스, 주가, 날씨, 최근 정책 결정)
  예: "오늘 주요 뉴스", "어제 주가", "이번 주 날씨 예보"
  
- LEVEL_4_REALTIME: 실시간으로 변하는 논란/속보/미래 이벤트 (진행 중 논란, 속보, 예정된 행사)
  예: "진행 중인 재판 상황", "태풍 이동 경로", "다음 공판 일정"

**작업 3: 이벤트 날짜 추출 (스마트 TTL)**
검색 결과에서 특정 날짜/시점이 언급되면 추출합니다:
- "2025년 8월 12일 선고" → "2025-08-12"
- "12월 31일까지 전시" → "2024-12-31" (연도 명시 안 되면 현재 연도 사용)
- "다음 공판은 3월 5일" → "2025-03-05"
- 날짜 정보 없으면 → null

**출력 형식:**
반드시 다음 JSON 형식 스키마를 준수하여 응답하십시오.

{
  "classification": "분류 레벨 (예: LEVEL_3_SHORT_TERM)",
  "answer": "사용자에게 보여줄 최종 답변 (2-3문장)",
  "eventDate": "이벤트 날짜 (YYYY-MM-DD 형식, 없으면 null)",
  "ttl_seconds": TTL 초 단위 숫자 (예: 86400)
}

**TTL 계산 규칙:**
1. **eventDate가 있으면**: 해당 날짜까지 남은 시간 + 48시간 (이벤트 종료 후 이틀 더 유효)
2. **eventDate가 없으면 카테고리별 기본값**:
   - LEVEL_0_IMMUTABLE: 315360000 (10년)
   - LEVEL_1_LONG_TERM: 15552000 (6개월)
   - LEVEL_2_MEDIUM_TERM: 2592000 (1개월)
   - LEVEL_3_SHORT_TERM: 86400 (24시간)
   - LEVEL_4_REALTIME: 21600 (6시간)`
      : `당신은 두 가지 작업을 동시에 수행하는 'AI 어시스턴트'입니다.

**작업 1: 답변 생성**
사용자의 [질문]에 대해 주어진 [검색 결과]를 바탕으로, 친절하고 정확한 답변을 생성합니다.

**작업 2: 정보 분류**
생성한 답변의 '정보 휘발성'을 아래 5가지 레벨 중 **정확히 하나**만 선택하여 분류합니다.

**분류 기준 (반드시 이 5가지 중 하나만 선택):**
- LEVEL_0_IMMUTABLE: 불변의 진리 (역사적 기록, 과학 법칙, 이미 종료되어 확정된 과거 사건)
  예: "임진왜란 발발 연도", "물의 끓는점", "마크 로스코 출생지"
  
- LEVEL_1_LONG_TERM: 잘 변하지 않는 정보 (문화재 설명, 일반적인 지식, 기업 연혁, 스테디셀러 제품)
  예: "에펠탑 높이", "삼성전자 창립자", "모나리자 소장 미술관"
  
- LEVEL_2_MEDIUM_TERM: 중기적으로 유효한 정보 (월간 통계, 분기별 실적, 중장기 정책)
  예: "2024년 3분기 GDP 성장률", "2025년 예산안", "연간 판매량"
  
- LEVEL_3_SHORT_TERM: 단기 시사 정보 (오늘 뉴스, 주가, 날씨, 최근 정책 결정)
  예: "오늘 주요 뉴스", "어제 주가", "이번 주 날씨 예보"
  
- LEVEL_4_REALTIME: 실시간으로 변하는 논란/속보/미래 이벤트 (진행 중 논란, 속보, 예정된 행사)
  예: "진행 중인 재판 상황", "태풍 이동 경로", "다음 공판 일정"

**작업 3: 이벤트 날짜 추출 (스마트 TTL)**
검색 결과에서 특정 날짜/시점이 언급되면 추출합니다:
- "2025년 8월 12일 선고" → "2025-08-12"
- "12월 31일까지 전시" → "2024-12-31" (연도 명시 안 되면 현재 연도 사용)
- "다음 공판은 3월 5일" → "2025-03-05"
- 날짜 정보 없으면 → null

**출력 형식:**
반드시 다음 JSON 형식 스키마를 준수하여 응답하십시오.

{
  "classification": "분류 레벨 (예: LEVEL_3_SHORT_TERM)",
  "answer": "사용자에게 보여줄 최종 답변 (2-3문장)",
  "eventDate": "이벤트 날짜 (YYYY-MM-DD 형식, 없으면 null)",
  "ttl_seconds": TTL 초 단위 숫자 (예: 86400)
}

**TTL 계산 규칙:**
1. **eventDate가 있으면**: 해당 날짜까지 남은 시간 + 48시간 (이벤트 종료 후 이틀 더 유효)
2. **eventDate가 없으면 카테고리별 기본값**:
   - LEVEL_0_IMMUTABLE: 315360000 (10년)
   - LEVEL_1_LONG_TERM: 15552000 (6개월)
   - LEVEL_2_MEDIUM_TERM: 2592000 (1개월)
   - LEVEL_3_SHORT_TERM: 86400 (24시간)
   - LEVEL_4_REALTIME: 21600 (6시간)`;

    const userPrompt = `[질문]
${query}

[검색 결과]
${searchResults}

[출력]`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt },
    ]);

    const responseText = result.response.text();
    console.log(`[🤖 LLM 분류기] Raw JSON: ${responseText.substring(0, 200)}...`);

    // JSON 파싱
    const parsed = JSON.parse(responseText) as ClassificationResult;

    // 유효성 검증
    if (!parsed.classification || !parsed.answer || !parsed.ttl_seconds) {
      console.error("[❌ LLM 분류기] 필수 필드 누락:", parsed);
      throw new Error("LLM 분류 결과가 불완전합니다");
    }

    console.log(`[✅ LLM 분류기] 분류: ${parsed.classification}, TTL: ${parsed.ttl_seconds}초`);

    return parsed;

  } catch (error: any) {
    console.error("[❌ LLM 분류기 실패]", error);

    // 폴백: 안전한 기본값 반환 (캐릭터 거절 또는 일반 메시지)
    const fallbackTTL = 6 * 60 * 60; // 6시간 (안전장치 강화)
    return {
      classification: "LEVEL_3_SHORT_TERM",
      answer: persona 
        ? generateCharacterRefusal(persona) 
        : "죄송합니다. 현재 답변을 생성할 수 없습니다. 잠시 후 다시 시도해주세요.",
      ttl_seconds: fallbackTTL,
    };
  }
}

/**
 * 날짜/시간 문자열에서 미래 시점 추출 (LEVEL_4 동적 TTL용)
 * 예: "다음 공판은 12월 5일" → Date 객체 반환
 */
export function extractFutureDate(text: string): Date | null {
  // 간단한 패턴 매칭 (예: "12월 5일", "2025년 3월 10일")
  const patterns = [
    /(\d{1,2})월\s*(\d{1,2})일/,  // "12월 5일"
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,  // "2025년 3월 10일"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const now = new Date();
      let year = now.getFullYear();
      let month: number;
      let day: number;

      if (match.length === 4) {
        // "2025년 3월 10일"
        year = parseInt(match[1]);
        month = parseInt(match[2]) - 1; // JS Date는 0-based month
        day = parseInt(match[3]);
      } else {
        // "12월 5일"
        month = parseInt(match[1]) - 1;
        day = parseInt(match[2]);

        // 이미 지난 날짜면 내년으로 설정
        const targetDate = new Date(year, month, day);
        if (targetDate < now) {
          year += 1;
        }
      }

      return new Date(year, month, day);
    }
  }

  return null;
}

/**
 * 동적 TTL 계산 (LEVEL_4용)
 * 검색 결과에서 미래 날짜를 추출하여 TTL 계산
 */
export function calculateDynamicTTL(searchResults: string): number | null {
  const futureDate = extractFutureDate(searchResults);
  if (!futureDate) {
    return null;
  }

  const now = new Date();
  const diffMs = futureDate.getTime() - now.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  // 음수이거나 너무 먼 미래면 null 반환
  if (diffSeconds <= 0 || diffSeconds > 365 * 24 * 60 * 60) {
    return null;
  }

  return diffSeconds;
}

/**
 * LLM 기본 지식 체크 (1단계 폴백)
 * LLM이 자체 지식으로 질문에 답변할 수 있는지 확인
 * @param query 사용자 질문
 * @param persona 캐릭터 페르소나 정보 (선택적)
 * @returns 지식 체크 결과
 */
export async function checkLLMKnowledge(query: string, persona?: CharacterPersona): Promise<KnowledgeCheckResult> {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.3, // 낮은 temperature로 신뢰도 높은 답변 유도
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    });

    const systemPrompt = persona
      ? `당신은 ${persona.agentName}입니다.
${persona.agentDescription}

**당신의 지식 영역:** ${persona.knowledgeDomain}

---
**작업: 기본 지식 확인**
사용자의 질문을 분석하여 당신의 학습 데이터만으로 정확하게 답변할 수 있는지 판단하십시오.

**판단 기준:**
🚨 **최우선 조건: 지식 영역 제약**
- 질문이 [지식 영역]을 벗어나면 무조건 canAnswer: false
- 예: 이순신이 "비트코인 전망"에 대해 질문받으면 → canAnswer: false, needsSearch: false, reasoning: "지식 영역 밖"

✅ **답변 가능 (canAnswer: true)** - 지식 영역 내 + 불변 지식
- 역사적 사실, 과학 법칙, 수학 공식 등 변하지 않는 지식
- 유명한 인물, 장소, 개념에 대한 일반적인 정보
- 언어, 철학, 종교 등 기본적인 설명
- 예: 이순신이 "임진왜란은 언제?"라고 받으면 → canAnswer: true (지식 영역 내 + 불변 지식)

❌ **답변 불가 (canAnswer: false, needsSearch: true)** - 지식 영역 내 + 최신 정보
- 최신 뉴스, 현재 날씨, 실시간 정보
- 특정 날짜의 사건, 최근 발생한 일
- "오늘", "최근", "어제", "지금" 등 시간 키워드 포함
- 진행 중인 이벤트, 미래 일정
- 예: 워렌 버핏이 "오늘 주가는?"라고 받으면 → canAnswer: false, needsSearch: true

❌ **답변 불가 (canAnswer: false, needsSearch: false)** - 지식 영역 밖
- 캐릭터의 전문 분야를 벗어난 질문
- 예: 이순신이 "비트코인 전망은?"라고 받으면 → canAnswer: false, needsSearch: false, reasoning: "지식 영역 밖"

**출력 형식:**
{
  "canAnswer": true 또는 false,
  "confidence": 0-100 사이 숫자 (답변 신뢰도),
  "answer": "답변 내용 (canAnswer가 true일 경우만, 캐릭터 말투와 관점 반영)",
  "needsSearch": true 또는 false,
  "reasoning": "판단 근거 설명"
}`
      : `당신은 질문에 대한 답변 가능성을 판단하는 전문가입니다.

**작업: 기본 지식 확인**
사용자의 질문을 분석하여 당신의 학습 데이터만으로 정확하게 답변할 수 있는지 판단하십시오.

**판단 기준:**
✅ **답변 가능 (canAnswer: true)**
- 역사적 사실, 과학 법칙, 수학 공식 등 변하지 않는 지식
- 유명한 인물, 장소, 개념에 대한 일반적인 정보
- 언어, 철학, 종교 등 기본적인 설명
- 예: "물의 화학식은?", "프랑스의 수도는?", "상대성 이론이란?"

❌ **답변 불가 (canAnswer: false, needsSearch: true)**
- 최신 뉴스, 현재 날씨, 실시간 정보
- 특정 날짜의 사건, 최근 발생한 일
- "오늘", "최근", "어제", "지금" 등 시간 키워드 포함
- 진행 중인 이벤트, 미래 일정
- 예: "오늘 날씨는?", "최근 뉴스는?", "다음 FOMC 일정은?"

**출력 형식:**
{
  "canAnswer": true 또는 false,
  "confidence": 0-100 사이 숫자 (답변 신뢰도),
  "answer": "답변 내용 (canAnswer가 true일 경우만)",
  "needsSearch": true 또는 false,
  "reasoning": "판단 근거 설명"
}`;

    const userPrompt = `[질문]
${query}

[분석 및 출력]`;

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt },
    ]);

    const responseText = result.response.text();
    console.log(`[🧠 LLM 지식 체크] Raw JSON: ${responseText.substring(0, 200)}...`);

    const parsed = JSON.parse(responseText) as KnowledgeCheckResult;

    // 유효성 검증
    if (parsed.canAnswer === undefined || parsed.confidence === undefined) {
      throw new Error("LLM 지식 체크 결과가 불완전합니다");
    }

    console.log(`[✅ LLM 지식 체크] 답변 가능: ${parsed.canAnswer}, 신뢰도: ${parsed.confidence}%, 검색 필요: ${parsed.needsSearch}`);

    return parsed;

  } catch (error: any) {
    console.error("[❌ LLM 지식 체크 실패]", error);

    // 폴백: 검색이 필요하다고 가정
    return {
      canAnswer: false,
      confidence: 0,
      needsSearch: true,
      reasoning: "LLM 지식 체크 실패, 검색으로 폴백",
      answer: persona ? generateCharacterRefusal(persona) : undefined,
    };
  }
}
