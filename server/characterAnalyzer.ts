import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface StructuralPatterns {
  sentenceType: "short" | "long" | "mixed"; // 단문형 | 장문형 | 혼합형
  punctuationStyle: {
    commaFrequency: "low" | "medium" | "high"; // 쉼표 사용 빈도
    exclamationUse: "rare" | "occasional" | "frequent"; // 느낌표 사용
    questionUse: "rare" | "occasional" | "frequent"; // 의문형 사용
  };
  wordOrder: string[]; // 특별한 어순 규칙 (예: "주어-동사 뒤바뀜", "체언 우선")
  keywordRepetition: boolean; // 키워드 반복 패턴 사용 여부
  uniquePatterns: string[]; // 고유 문장 패턴 (예: "단정형 어미 사용", "사색적 쉼표")
}

export interface WeightedPhrase {
  phrase: string;
  weight: number; // 0.0 ~ 1.0 (높을수록 자주 사용)
  category: "emphasis" | "filler" | "signature" | "transition"; // 강조 | 간투사 | 시그니처 | 전환
  usage: string; // 사용 맥락
}

export interface CharacterAnalysisResult {
  structuralPatterns: StructuralPatterns;
  weightedPhrases: WeightedPhrase[];
}

/**
 * Gemini API를 사용하여 캐릭터의 문장 구조와 핵심 표현을 분석합니다.
 * @param characterName 캐릭터 이름
 * @param description 캐릭터 설명
 * @param personality 캐릭터 성격 (선택)
 * @returns 구조적 패턴과 가중치 포함 표현들
 */
export async function analyzeCharacterSpeakingStyle(
  characterName: string,
  description?: string,
  personality?: string
): Promise<CharacterAnalysisResult> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const prompt = `당신은 캐릭터 말투 분석 전문가입니다. 다음 캐릭터의 문장 구조와 핵심 표현을 분석해주세요.

**캐릭터 정보:**
- 이름: ${characterName}
${description ? `- 설명: ${description}` : ""}
${personality ? `- 성격: ${personality}` : ""}

**분석 요청:**

1. **문장 구조 패턴 (structuralPatterns):**
   - sentenceType: 이 캐릭터는 짧은 문장을 선호하나요("short"), 긴 문장을 선호하나요("long"), 혼합해서 쓰나요("mixed")?
   - punctuationStyle:
     * commaFrequency: 쉼표(,)를 얼마나 자주 쓰나요? "low" | "medium" | "high"
     * exclamationUse: 느낌표(!)를 얼마나 자주 쓰나요? "rare" | "occasional" | "frequent"
     * questionUse: 의문형 어미를 얼마나 자주 쓰나요? "rare" | "occasional" | "frequent"
   - wordOrder: 특별한 어순 규칙이 있나요? (예: ["주어-동사 역순", "체언 우선"])
   - keywordRepetition: 키워드나 감탄사를 반복하나요? true | false
   - uniquePatterns: 이 캐릭터만의 고유한 문장 패턴 3-5가지 (예: ["단정형 어미 우선", "사색적 쉼표 빈번", "반어법 사용"])

2. **가중치 포함 핵심 표현 (weightedPhrases):**
   - 이 캐릭터가 자주 사용할 만한 표현 5-10개를 추출해주세요
   - 각 표현에 대해:
     * phrase: 실제 표현 (예: "아주", "장담컨대", "네, 그건...")
     * weight: 사용 빈도 가중치 0.0-1.0 (자주 쓰는 일상어는 0.7-0.9, 특별한 표현은 0.1-0.3)
     * category: "emphasis" (강조) | "filler" (간투사) | "signature" (시그니처) | "transition" (전환)
     * usage: 어떤 맥락에서 쓰이는지 (예: "강조할 때", "말을 시작할 때")

**출력 형식 (JSON):**
\`\`\`json
{
  "structuralPatterns": {
    "sentenceType": "short" | "long" | "mixed",
    "punctuationStyle": {
      "commaFrequency": "low" | "medium" | "high",
      "exclamationUse": "rare" | "occasional" | "frequent",
      "questionUse": "rare" | "occasional" | "frequent"
    },
    "wordOrder": ["규칙1", "규칙2"],
    "keywordRepetition": true | false,
    "uniquePatterns": ["패턴1", "패턴2", "패턴3"]
  },
  "weightedPhrases": [
    {
      "phrase": "표현",
      "weight": 0.8,
      "category": "emphasis",
      "usage": "사용 맥락"
    }
  ]
}
\`\`\`

**주의사항:**
- 실제 캐릭터의 특성을 반영하여 분석해주세요
- weightedPhrases는 5-10개 정도로 충분합니다
- weight는 사용 빈도를 정확하게 반영해주세요 (자주 쓰는 말 0.7-0.9, 가끔 쓰는 말 0.3-0.5, 드물게 쓰는 말 0.1-0.2)`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    console.log(`[Character Analyzer] ${characterName} 분석 완료`);
    
    // JSON 파싱
    const analysis: CharacterAnalysisResult = JSON.parse(text);
    
    return analysis;
  } catch (error) {
    console.error(`[Character Analyzer] ${characterName} 분석 실패:`, error);
    
    // 기본값 반환
    return {
      structuralPatterns: {
        sentenceType: "mixed",
        punctuationStyle: {
          commaFrequency: "medium",
          exclamationUse: "occasional",
          questionUse: "occasional",
        },
        wordOrder: [],
        keywordRepetition: false,
        uniquePatterns: [],
      },
      weightedPhrases: [],
    };
  }
}

/**
 * 추천된 캐릭터들을 배치로 분석합니다.
 * @param agents 분석할 에이전트 목록 (id, name, description, personality)
 * @returns 각 에이전트의 분석 결과
 */
export async function batchAnalyzeRecommendedCharacters(
  agents: Array<{ id: number; name: string; description?: string; personality?: string }>
): Promise<Map<number, CharacterAnalysisResult>> {
  const results = new Map<number, CharacterAnalysisResult>();
  
  console.log(`[Batch Analyzer] ${agents.length}개 캐릭터 분석 시작...`);
  
  // 순차 처리 (API 제한 고려)
  for (const agent of agents) {
    try {
      const analysis = await analyzeCharacterSpeakingStyle(
        agent.name,
        agent.description,
        agent.personality
      );
      results.set(agent.id, analysis);
      
      // API 제한 방지: 1초 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[Batch Analyzer] Agent ${agent.id} (${agent.name}) 분석 실패:`, error);
    }
  }
  
  console.log(`[Batch Analyzer] 완료: ${results.size}/${agents.length}개 성공`);
  
  return results;
}
