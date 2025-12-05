import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * 간단한 키워드 중복 기반 유사도 검사 (빠른 휴리스틱 필터)
 * @param text1 첫 번째 텍스트
 * @param text2 두 번째 텍스트
 * @returns 0.0 (완전 다름) ~ 1.0 (완전 같음)
 */
function calculateKeywordOverlap(text1: string, text2: string): number {
  // 단어 추출 (한글, 영어, 숫자만, 조사/접속사 제외)
  const extractKeywords = (text: string): Set<string> => {
    const stopWords = new Set(['은', '는', '이', '가', '을', '를', '에', '에서', '의', '로', '와', '과', '도', '만', '이다', '있다', '없다', 'the', 'a', 'an', 'is', 'are', 'was', 'were']);
    return new Set(
      text
        .toLowerCase()
        .match(/[가-힣a-z0-9]+/g)
        ?.filter(word => word.length > 1 && !stopWords.has(word)) || []
    );
  };
  
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);
  
  if (keywords1.size === 0 || keywords2.size === 0) {
    return 0;
  }
  
  // Jaccard similarity
  const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
  const union = new Set([...keywords1, ...keywords2]);
  
  return intersection.size / union.size;
}

/**
 * 두 질문 사이의 주제 유사도를 검사합니다.
 * @param previousQuestion 이전 질문
 * @param newQuestion 새로운 질문
 * @returns true = 주제 전환 발생 (다른 주제), false = 같은 주제 계속
 */
export async function isTopicChange(
  previousQuestion: string,
  newQuestion: string
): Promise<boolean> {
  // 이전 질문이 없으면 주제 전환 아님
  if (!previousQuestion || previousQuestion.trim() === "") {
    return false;
  }
  
  // 🔍 1단계: 빠른 휴리스틱 필터 (키워드 중복 검사)
  const keywordSimilarity = calculateKeywordOverlap(previousQuestion, newQuestion);
  console.log(`[주제 전환 감지] 키워드 유사도: ${(keywordSimilarity * 100).toFixed(1)}%`);
  
  // 키워드 유사도가 30% 이상이면 같은 주제로 판단 (Gemini 호출 스킵)
  if (keywordSimilarity >= 0.3) {
    console.log(`[주제 전환 감지] 같은 주제 (휴리스틱) - Gemini 호출 스킵`);
    return false;
  }
  
  // 🤖 2단계: Gemini API로 정밀 판단 (키워드 유사도 낮을 때만)
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.3, // 낮은 temperature로 일관성 있는 판단
        responseMimeType: "application/json",
      },
    });

    const prompt = `당신은 대화 주제 변화 감지 전문가입니다. 두 질문을 비교하여 주제가 바뀌었는지 판단해주세요.

**이전 질문:**
"${previousQuestion}"

**새로운 질문:**
"${newQuestion}"

**판단 기준:**
- **같은 주제 (false)**: 두 질문이 같은 인물, 사건, 개념에 대한 후속 질문이거나 관련된 내용
  - 예: "트럼프 정부 셧다운?" → "그걸 어떻게 해결했나요?" (같은 주제)
  - 예: "AI 윤리란?" → "AI 윤리의 문제점은?" (같은 주제)
  
- **다른 주제 (true)**: 완전히 다른 인물, 사건, 개념으로 주제가 전환됨
  - 예: "정부 셧다운?" → "한국 방문에서 원자력 잠수함 승인 이유?" (다른 주제)
  - 예: "AI 윤리?" → "양자컴퓨터 원리는?" (다른 주제)

**출력 형식 (JSON):**
\`\`\`json
{
  "isTopicChange": true | false,
  "reason": "판단 근거 (1-2 문장)"
}
\`\`\`

**주의:**
- 미묘한 연관성보다는 명확한 주제 전환만 감지하세요
- 애매하면 같은 주제로 판단하세요 (false)`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const analysis: { isTopicChange: boolean; reason: string } = JSON.parse(text);
    
    console.log(`[주제 전환 감지] 이전: "${previousQuestion.slice(0, 30)}..." → 새: "${newQuestion.slice(0, 30)}..."`);
    console.log(`[주제 전환 감지] 결과: ${analysis.isTopicChange ? '주제 전환 ✅' : '같은 주제 ❌'} - ${analysis.reason}`);
    
    return analysis.isTopicChange;
    
  } catch (error) {
    console.error("[주제 전환 감지 실패]:", error);
    // 에러 시 안전하게 주제 전환 아닌 것으로 처리 (기존 동작 유지)
    return false;
  }
}

/**
 * 주제 전환이 감지되면 대화 히스토리를 축소합니다.
 * @param conversationHistory 전체 대화 히스토리
 * @param isTopicChanged 주제 전환 여부
 * @returns 축소된 대화 히스토리
 */
export function reduceHistoryOnTopicChange(
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  isTopicChanged: boolean
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!isTopicChanged) {
    return conversationHistory;
  }
  
  // 주제가 바뀌면 최근 2개 유지 (user/assistant 쌍)
  // 최소한의 톤 컨텍스트와 직전 대화 흐름 유지
  const reduced = conversationHistory.slice(-2);
  
  console.log(`[주제 전환 감지] 대화 히스토리 축소: ${conversationHistory.length}개 → ${reduced.length}개`);
  
  return reduced;
}

/**
 * 대화 히스토리를 준비합니다 (주제 전환 감지 포함)
 * @param messages 전체 메시지 배열
 * @param currentUserMessage 현재 사용자 질문
 * @param maxHistory 최대 히스토리 개수 (기본: 5)
 * @returns 준비된 대화 히스토리
 */
export async function prepareConversationHistory(
  messages: Array<{ senderId: string | null; content: string }>,
  currentUserMessage: string,
  maxHistory: number = 5
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  try {
    // 기본 히스토리 생성
    let conversationHistory = messages.slice(-maxHistory).map(msg => ({
      role: msg.senderId ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));
    
    // 히스토리가 2개 이상일 때만 주제 전환 감지
    if (conversationHistory.length >= 2) {
      // 이전 사용자 질문 찾기 (역순 검색)
      let previousUserQuestion = '';
      for (let i = conversationHistory.length - 1; i >= 0; i--) {
        if (conversationHistory[i].role === 'user') {
          previousUserQuestion = conversationHistory[i].content;
          break;
        }
      }
      
      if (previousUserQuestion) {
        const topicChanged = await isTopicChange(previousUserQuestion, currentUserMessage);
        conversationHistory = reduceHistoryOnTopicChange(conversationHistory, topicChanged);
      }
    }
    
    return conversationHistory;
    
  } catch (error) {
    console.error("[대화 히스토리 준비 실패]:", error);
    // 에러 시 기본 히스토리 반환 (주제 전환 감지 없이)
    return messages.slice(-maxHistory).map(msg => ({
      role: msg.senderId ? 'user' as const : 'assistant' as const,
      content: msg.content
    }));
  }
}
