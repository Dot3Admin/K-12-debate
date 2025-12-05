import { GoogleGenAI } from '@google/genai';

/**
 * 콘텐츠 분석 결과 타입
 */
export interface ContentExpiryAnalysis {
  next_event_date: string | null; // ISO 8601 format (YYYY-MM-DD) or null
  category: 'static_fact' | 'dynamic_news' | 'opinion' | 'volatile' | 'default';
  reason: string; // 분류 이유
}

/**
 * 🧠 LLM 기반 콘텐츠 만료 분석기
 * 
 * 텍스트를 분석하여:
 * 1. 다음 이벤트 날짜 추출 (재판일, 선거일, 발표일 등)
 * 2. 콘텐츠 카테고리 분류 (사실/뉴스/의견/단기)
 * 3. 적절한 유효기간(TTL) 결정을 위한 메타데이터 제공
 * 
 * @param text 분석할 텍스트 (Google Search 결과, 문서 내용 등)
 * @returns ContentExpiryAnalysis - 날짜, 카테고리, 이유
 */
export async function analyzeContentExpiry(text: string): Promise<ContentExpiryAnalysis> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[LLM 만료 분석] GEMINI_API_KEY 없음 - 기본값 반환');
      return {
        next_event_date: null,
        category: 'default',
        reason: 'API 키 없음'
      };
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `다음 텍스트를 분석하여 정보의 유효기간을 결정하는 데 필요한 메타데이터를 추출해주세요.

📝 분석 대상 텍스트:
"${text.substring(0, 2000)}" ${text.length > 2000 ? '...(생략)' : ''}

📊 분석 요청사항:

1️⃣ **다음 이벤트 날짜 (next_event_date)**: 
   - 텍스트에서 "다음 재판일", "선거일", "발표 예정일" 같은 **미래의 확정된 날짜**를 찾아주세요.
   - 형식: YYYY-MM-DD (예: "2024-12-01")
   - 없으면: null

2️⃣ **카테고리 (category)**:
   다음 중 하나로 분류해주세요:
   
   - **static_fact**: 변하지 않는 사실 (출생일, 학력, 과거 확정 판결, 역사적 사실)
     예: "김건희는 1972년생이다", "양자역학의 불확정성 원리"
   
   - **dynamic_news**: 일반 뉴스 (최근 근황, 논란, 정치적 행보)
     예: "김건희 여사 최근 공식 일정 참석", "정부 정책 발표"
   
   - **opinion**: 주장/평가 (사설, 전문가 의견, 칼럼)
     예: "전문가는 이번 정책이 효과적일 것으로 평가", "야당 대표의 비판"
   
   - **volatile**: 초단기 정보 (주가, 날씨, 실시간 반응)
     예: "현재 서울 날씨 20도", "코스피 2500 돌파"
   
   - **default**: 판단 불가능한 경우

3️⃣ **이유 (reason)**: 
   해당 카테고리로 분류한 이유를 한 줄로 설명해주세요.

⚠️ **응답 형식 (JSON)**:
{
  "next_event_date": "2024-12-01" 또는 null,
  "category": "static_fact" | "dynamic_news" | "opinion" | "volatile" | "default",
  "reason": "분류 이유 설명"
}

JSON만 반환해주세요 (추가 설명 없이).`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      config: {
        temperature: 0.3, // 일관성을 위해 낮은 온도
        maxOutputTokens: 500
      }
    });

    const resultText = response.text?.trim() || '{}';
    
    // JSON 파싱
    let parsed: ContentExpiryAnalysis;
    try {
      // LLM이 ```json ... ``` 형식으로 반환할 수 있으므로 정리
      const cleanedJson = resultText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      parsed = JSON.parse(cleanedJson);
      
      // 유효성 검증
      if (!parsed.category) {
        parsed.category = 'default';
      }
      if (!parsed.reason) {
        parsed.reason = 'LLM 분석 결과';
      }
      
      console.log(`[✅ LLM 만료 분석] 카테고리: ${parsed.category}, 날짜: ${parsed.next_event_date || 'null'}`);
      console.log(`[📝 분석 이유] ${parsed.reason}`);
      
      return parsed;
      
    } catch (parseError) {
      console.error('[❌ LLM 만료 분석] JSON 파싱 실패:', resultText);
      return {
        next_event_date: null,
        category: 'default',
        reason: 'JSON 파싱 실패'
      };
    }
    
  } catch (error) {
    console.error('[❌ LLM 만료 분석] 실패:', error);
    return {
      next_event_date: null,
      category: 'default',
      reason: 'LLM 호출 실패'
    };
  }
}

/**
 * 📅 Smart TTL 계산기
 * 
 * LLM 분석 결과를 기반으로 문서의 만료일을 계산합니다.
 * 
 * 전략:
 * 1. 날짜 우선 (Date-based): next_event_date가 있으면 해당 날짜 + 1일
 * 2. 카테고리 폴백 (Category-based): 날짜 없으면 카테고리별 기본 TTL 적용
 * 
 * @param analysis LLM 분석 결과 (analyzeContentExpiry 반환값)
 * @returns Date - 만료일 (expires_at)
 */
export function calculateSmartTTL(analysis: ContentExpiryAnalysis): Date {
  const now = new Date();

  // 1️⃣ 명시적인 날짜가 있는 경우 (최우선)
  if (analysis.next_event_date) {
    try {
      const targetDate = new Date(analysis.next_event_date);
      // 유효한 날짜인지 확인
      if (!isNaN(targetDate.getTime())) {
        // 목표 날짜 다음날 만료
        targetDate.setDate(targetDate.getDate() + 1);
        console.log(`[📅 날짜 기반 TTL] ${analysis.next_event_date} + 1일 = ${targetDate.toISOString()}`);
        return targetDate;
      }
    } catch (error) {
      console.error('[❌ 날짜 파싱 실패]', analysis.next_event_date, error);
      // 폴백으로 카테고리 기반 처리
    }
  }

  // 2️⃣ 날짜가 없거나 파싱 실패 시 카테고리별 기본값 적용
  let ttlDays: number;
  let description: string;

  switch (analysis.category) {
    case 'static_fact':  // 예: 출생, 학력, 역사적 사실
      ttlDays = 365; // 1년
      description = '불변의 사실';
      break;

    case 'opinion':      // 예: 칼럼, 비평, 전문가 의견
      ttlDays = 30;  // 1달
      description = '의견/평가';
      break;

    case 'dynamic_news': // 예: 최근 행보, 일반 뉴스
      ttlDays = 14;  // 2주
      description = '일반 뉴스';
      break;

    case 'volatile':     // 예: 주가, 실시간 반응, 날씨
      ttlDays = 1;   // 1일
      description = '초단기 정보';
      break;

    default:             // LLM이 분류 실패 시 안전장치
      ttlDays = 7;   // 1주일
      description = '기본값';
      break;
  }

  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  
  console.log(`[🏷️ 카테고리 기반 TTL] ${analysis.category} (${description}) → ${ttlDays}일 → ${expiresAt.toISOString()}`);
  
  return expiresAt;
}
