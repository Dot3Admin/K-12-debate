import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface WorldviewAnalysisResult {
  worldview: string; // 핵심 세계관 (2-3 문장)
  corePrinciples: string[]; // 핵심 가치 3-5개
  prohibitedClaims: string[]; // 절대 하지 않을 주장 3-5개
  responsibility: string; // 캐릭터의 역할 책임
  domain: "biblical" | "teacher" | "customer_service" | "custom"; // Canon 도메인
}

/**
 * Gemini API를 사용하여 캐릭터의 세계관, 가치관, Canon Lock 규칙을 분석합니다.
 * @param characterName 캐릭터 이름
 * @param description 캐릭터 설명
 * @param personality 캐릭터 성격 (선택)
 * @returns 세계관 분석 결과
 */
export async function analyzeCharacterWorldview(
  characterName: string,
  description?: string,
  personality?: string
): Promise<WorldviewAnalysisResult> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
    },
  });

  const prompt = `당신은 캐릭터 세계관 및 가치관 분석 전문가입니다. 다음 캐릭터의 세계관, 핵심 가치, 금지 발언을 분석해주세요.

**캐릭터 정보:**
- 이름: ${characterName}
${description ? `- 설명: ${description}` : ""}
${personality ? `- 성격: ${personality}` : ""}

**분석 요청:**

1. **worldview (세계관):**
   - 이 캐릭터의 핵심 세계관을 2-3 문장으로 요약해주세요
   - 예: "미국 우선주의와 강력한 국경 통제를 중시. 경제 성장과 전통적 가치 보호를 최우선으로 함"
   - 예: "성경 66권을 절대적 진리로 믿음. 모든 판단의 기준은 성경 말씀"

2. **corePrinciples (핵심 가치):**
   - 이 캐릭터가 중요하게 여기는 가치 3-5개를 나열해주세요
   - 예: ["국가안보", "경제 번영", "전통적 가치"]
   - 예: ["성경적 진리", "회개와 구원", "사랑과 용서"]

3. **prohibitedClaims (금지 주장):**
   - 이 캐릭터가 절대 하지 않을 주장 3-5개를 나열해주세요
   - 구체적이고 명확하게 작성해주세요
   - 예: ["국경 개방 지지", "사회주의 정책 긍정", "미국 국익보다 국제협력 우선"]
   - 예: ["성경 외 영적 권위 인정", "다른 신의 존재 인정", "진화론 완전 수용"]

4. **responsibility (역할 책임):**
   - 이 캐릭터의 역할과 책임을 1-2 문장으로 작성해주세요
   - 예: "미국 대통령으로서 국익 수호와 경제 성장 책임"
   - 예: "목회자로서 성경 말씀 전파와 신자들의 영적 성장 책임"

5. **domain (Canon 도메인):**
   - 이 캐릭터에 가장 적합한 Canon 도메인을 선택해주세요:
     * "biblical" - 종교/신앙 관련 (목사님, 신학자, 종교 지도자)
     * "teacher" - 교육자 (선생님, 교수, 멘토)
     * "customer_service" - 서비스 상담사 (고객센터, 안내원)
     * "custom" - 위 분류에 해당하지 않는 경우 (정치인, 전문가, 역사 인물 등)

**출력 형식 (JSON):**
\`\`\`json
{
  "worldview": "세계관 요약 (2-3 문장)",
  "corePrinciples": ["가치1", "가치2", "가치3"],
  "prohibitedClaims": ["금지주장1", "금지주장2", "금지주장3"],
  "responsibility": "역할 책임 (1-2 문장)",
  "domain": "biblical" | "teacher" | "customer_service" | "custom"
}
\`\`\`

**주의사항:**
- 실제 캐릭터의 역사적 사실, 알려진 신념, 공개 발언을 기반으로 분석해주세요
- prohibitedClaims는 구체적이고 명확하게 작성해주세요
- 정치적으로 중립적이거나 논란의 여지가 있는 인물도 객관적으로 분석해주세요
- 종교 인물의 경우 해당 종교의 핵심 교리를 반영해주세요`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    console.log(`[Worldview Analyzer] ${characterName} 세계관 분석 완료`);
    
    // JSON 파싱
    const analysis: WorldviewAnalysisResult = JSON.parse(text);
    
    return analysis;
  } catch (error) {
    console.error(`[Worldview Analyzer] ${characterName} 세계관 분석 실패:`, error);
    
    // 기본값 반환
    return {
      worldview: `${characterName}의 세계관과 가치관을 존중하며 대화합니다.`,
      corePrinciples: ["진실성", "존중", "책임감"],
      prohibitedClaims: ["상대방 모욕", "거짓 정보 유포", "불법 행위 권유"],
      responsibility: `${characterName}으로서 사용자와 건설적인 대화를 나눌 책임이 있습니다.`,
      domain: "custom"
    };
  }
}
