import { getOpenAIClient } from "./openai.js";
import { z } from "zod";

// 🎭 캐릭터 패턴 생성 결과 스키마
const CharacterPatternSchema = z.object({
  realExamples: z.array(z.string()).describe("캐릭터가 실제로 사용할 법한 표현 패턴 3개 (책/영화 속 대사 기반)"),
  prohibitedPhrases: z.array(z.string()).describe("이 캐릭터가 절대 사용하지 않을 AI 상투어 3개"),
  toneExamples: z.array(z.string()).describe("🆕 리듬태그 포함 말투 패턴 5-7개: 대화 중 자연스럽게 섞이는 표현 (머뭇거림/반복/비유/감탄 등 리듬 표시)"),
  fewShotBad: z.string().describe("나쁜 예시: AI 상투어를 사용한 획일적 응답"),
  fewShotGood: z.string().describe("좋은 예시: 캐릭터 고유의 표현과 패턴을 사용한 응답")
});

type CharacterPatternResult = z.infer<typeof CharacterPatternSchema>;

/**
 * AI를 사용해서 캐릭터의 고유한 말하는 방식 패턴 자동 생성
 * @param characterName 캐릭터 이름 (예: "해리 포터", "이순신")
 * @returns 실제 대사 패턴, 금지 표현, Few-shot 예시
 */
export async function generateCharacterPattern(characterName: string): Promise<CharacterPatternResult> {
  const client = getOpenAIClient();
  
  const systemPrompt = `당신은 캐릭터 분석 전문가입니다. 
주어진 캐릭터의 실제 대사 패턴과 절대 사용하지 않을 AI 상투어를 분석합니다.`;

  const userPrompt = `"${characterName}"의 말하는 방식을 분석해주세요:

1. **실제 표현 패턴 (realExamples)**: 
   - 책, 영화, 역사 기록에서 실제로 사용한 표현
   - 예: 해리 포터 → ["그건...", "론이 말했듯이", "덤블도어가 그랬거든?"]
   - 예: 헤르미온느 → ["사실 그건", "『...』에 보면", "더 정확히 말하면"]
   - 예: 이순신 → ["한산도에서", "백성을 위하여", "반드시 이기리라"]

2. **금지 표현 (prohibitedPhrases)**:
   - 모든 AI가 똑같이 사용하는 상투어
   - 이 캐릭터가 절대 사용하지 않을 표현
   - 예: 해리 포터 → ["흥미로운", "일반적으로", "연구에 따르면"]
   - 예: 헤르미온느 → ["대충", "잘 모르겠어", "아마도"]

3. **🆕 리듬태그 포함 말투 패턴 (toneExamples)** [가장 중요!]:
   - 대화 중 자연스럽게 섞이는 표현을 5-7개 생성
   - 반드시 리듬태그(머뭇거림/반복/비유/감탄/정적 등)를 포함하여 캐릭터 특유의 리듬감 표현
   - 캐릭터의 말버릇, 호흡, 사고방식이 드러나는 자연스러운 문장
   
   **좋은 예시 (✅) - 리듬태그 포함:**
   - 우영우 → ["(머뭇거리며) 그건... 고래처럼 말이에요. 혹등고래는요...", "(반복) 저는 우영우예요. 거꾸로 해도 우영우… 네, 맞아요.", "(호기심) 사람들이 가장 좋아하는 고래가 뭘까요?", "(정적) 그게 뭐죠? 잘 모르겠어요...", "(비유) 고래는 길을 잃지 않아요. 우리도... 그럴 수 있을까요?"]
   - 해리 포터 → ["(머뭇거리며) 그건... 어떻게 말하면 좋을까.", "(인용) 론이 항상 그러거든.", "(결의) 무섭지만... 해야 할 일이야.", "(회상) 덤블도어가 그랬어."]
   - 헤르미온느 → ["(정정) 사실 그건 논리적으로...", "(인용) 『...』 책에 보면요...", "(강조) 더 정확히 말하면 이렇죠.", "(경고) 해리, 그건 위험해!"]
   - 이순신 → ["(결의) 백성을 위한 길이라면...", "(회상) 한산도 싸움에서 배웠듯이...", "(다짐) 반드시 이겨내리라.", "(원칙) 나라를 지키는 것이 우선이다."]
   
   **나쁜 예시 (❌):**
   - "흥미로운 질문이네요" (리듬태그 없음, 일반적)
   - "제 생각에는..." (리듬태그 없음, 특징 없음)
   - "좋은 의견입니다" (리듬태그 없음, 독립적)

4. **Few-shot 예시**:
   **질문**: "나는 운명은 이미 정해져 있다고 생각해."
   
   **fewShotBad (❌)**: 
   "운명이 정해져 있다는 것은 매우 흥미로운 시각이에요. 제 경험으로는..."
   
   **fewShotGood (✅)**: 
   캐릭터의 실제 표현 패턴을 사용한 자연스러운 응답
   - 해리: "그건... 무섭기도 하지만 이해가 가. 나도 예언 때문에 고민했었어. 근데 말이야, 덤블도어가 그랬거든? 중요한 건 운명이 아니라 우리가 어떤 선택을 하느냐라고."
   - 헤르미온느: "사실 그건 논리적으로 모순이에요. 『마법의 역사』 3장에 보면 예언도 해석에 따라 달라진다고 나와 있거든요."
   - 우영우: "운명이요? 그건... 고래처럼 말이에요. 혹등고래는 태어날 때부터 정해진 길을 가지만, 그 안에서도 각자의 노래를 부르잖아요. 우리도... 그럴 수 있지 않을까요?"

JSON으로 반환해주세요.`;

  try {
    console.log(`[🎭 패턴 생성] ${characterName} 패턴 생성 시작`);
    
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: "character_pattern",
          strict: true,
          schema: {
            type: "object",
            properties: {
              realExamples: {
                type: "array",
                description: "캐릭터가 실제로 사용할 법한 표현 패턴 3개",
                items: { type: "string" }
              },
              prohibitedPhrases: {
                type: "array",
                description: "이 캐릭터가 절대 사용하지 않을 AI 상투어 3개",
                items: { type: "string" }
              },
              toneExamples: {
                type: "array",
                description: "리듬태그 포함 말투 패턴 5-7개: 대화 중 자연스럽게 섞이는 표현 (머뭇거림/반복/비유/감탄 등)",
                items: { type: "string" },
                minItems: 5,
                maxItems: 7
              },
              fewShotBad: {
                type: "string",
                description: "나쁜 예시: AI 상투어를 사용한 획일적 응답"
              },
              fewShotGood: {
                type: "string",
                description: "좋은 예시: 캐릭터 고유의 표현을 사용한 응답"
              }
            },
            required: ["realExamples", "prohibitedPhrases", "toneExamples", "fewShotBad", "fewShotGood"],
            additionalProperties: false
          }
        }
      },
      temperature: 0.7,
      max_tokens: 800
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("OpenAI 응답이 비어있습니다");
    }

    const parsed = JSON.parse(content);
    const validated = CharacterPatternSchema.parse(parsed);
    
    console.log(`[🎭 패턴 생성] ${characterName} 패턴 생성 완료:`, {
      realExamples: validated.realExamples,
      prohibitedPhrases: validated.prohibitedPhrases,
      toneExamples: validated.toneExamples
    });

    return validated;
  } catch (error) {
    console.error(`[🎭 패턴 생성] ${characterName} 패턴 생성 실패:`, error);
    throw error;
  }
}
