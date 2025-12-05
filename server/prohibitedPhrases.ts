// prohibitedPhrases.ts
// 🚫 AI 상투어 금지 시스템
// 모든 캐릭터가 똑같이 사용하는 획일적 표현을 차단

/**
 * 전역 금지 표현 (모든 캐릭터 공통)
 * - AI가 자주 사용하는 상투적 시작 패턴
 * - "흥미로운", "좋은", "그 생각" 등의 형식적 표현
 */
export const GLOBAL_PROHIBITED_OPENINGS = [
  // 상투적 인사/반응
  "흥미로운 관점",
  "흥미로운 견해",
  "흥미로운 생각",
  "재미있는 관점",
  "재미있는 생각",
  "좋은 의견",
  "좋은 생각",
  "좋은 질문",
  
  // 형식적 공감
  "그 생각",
  "그건 정말",
  "정말 흥미롭",
  "정말 재미있",
  
  // AI스러운 시작
  "음, 그러니까",
  "음, 제 생각",
  "저는 생각합니다",
  "제 생각에는",
  "제가 보기에는",
  "제 경험으로는",  // 🚫 가장 흔한 AI 상투어!
  
  // 일반화된 표현
  "일반적으로",
  "보통",
  "대부분",
  "많은 사람들이",
  
  // 너무 공손한 표현
  "말씀하신 것처럼",
  "말씀드리자면",
  "설명드리자면"
];

/**
 * 캐릭터별 추가 금지 표현
 * - 특정 캐릭터가 절대 사용하면 안 되는 표현
 */
export const CHARACTER_PROHIBITED_PHRASES: Record<string, string[]> = {
  "해리 포터": [
    "일반적으로",
    "보통",
    "대부분의 사람들",
    "전문가들은",
    "연구에 따르면"
  ],
  
  "이순신": [
    "와!", 
    "완전",
    "대박",
    "진짜",
    "ㅋㅋ"
  ],
  
  "소크라테스": [
    "제 의견으로는",
    "확실히",
    "분명히",
    "당연히"
  ],
  
  "스티브 잡스": [
    "전통적으로",
    "일반적으로",
    "보수적으로"
  ],
  
  "알버트 아인슈타인": [
    "감정적으로",
    "직관적으로만"
  ]
};

/**
 * 응답 시작 부분에서 금지 표현 체크
 * @param text 응답 텍스트
 * @param characterName 캐릭터 이름
 * @returns 금지 표현 포함 여부
 */
export function containsProhibitedOpening(text: string, characterName?: string): {
  isProhibited: boolean;
  matchedPhrase?: string;
  reason?: string;
} {
  // 첫 30자만 체크 (시작 부분)
  const opening = text.substring(0, 30).trim();
  
  // 전역 금지 표현 체크
  for (const phrase of GLOBAL_PROHIBITED_OPENINGS) {
    if (opening.includes(phrase)) {
      return {
        isProhibited: true,
        matchedPhrase: phrase,
        reason: "전역 금지 표현 (AI 상투어)"
      };
    }
  }
  
  // 캐릭터별 금지 표현 체크
  if (characterName && CHARACTER_PROHIBITED_PHRASES[characterName]) {
    for (const phrase of CHARACTER_PROHIBITED_PHRASES[characterName]) {
      if (opening.includes(phrase)) {
        return {
          isProhibited: true,
          matchedPhrase: phrase,
          reason: `${characterName} 캐릭터 부적합 표현`
        };
      }
    }
  }
  
  return { isProhibited: false };
}

/**
 * 프롬프트에 금지 표현 지침 추가
 * @param characterName 캐릭터 이름
 * @returns 금지 표현 프롬프트
 */
export function buildProhibitedPhrasesPrompt(characterName?: string): string {
  const globalList = GLOBAL_PROHIBITED_OPENINGS.slice(0, 8).map(p => `"${p}"`).join(", ");
  
  let characterList = "";
  if (characterName && CHARACTER_PROHIBITED_PHRASES[characterName]) {
    const phrases = CHARACTER_PROHIBITED_PHRASES[characterName].slice(0, 5);
    characterList = `\n\n**${characterName} 전용 금지 표현:**\n${phrases.map(p => `- "${p}"`).join("\n")}`;
  }
  
  return `
🚫 **절대 사용 금지 표현 (AI 상투어 차단):**

다음 표현으로 시작하거나 포함하지 마세요:
${globalList}

**이유:** 모든 캐릭터가 똑같이 사용하는 획일적 패턴입니다.
대신 당신만의 고유한 감정과 경험을 바탕으로 자연스럽게 시작하세요.${characterList}
`.trim();
}

/**
 * 관계별 금지 패턴
 * - 특정 관계에서 사용하면 안 되는 표현
 */
export const RELATIONSHIP_PROHIBITED_PATTERNS: Record<string, string[]> = {
  "debater": [
    "당신 말이 100% 맞아요",
    "완전히 동의합니다",
    "전적으로 찬성"
  ],
  
  "mentor": [
    "나도 잘 모르겠어",
    "확신할 수 없어",
    "글쎄요"
  ],
  
  "companion": [
    "논리적으로 분석하면",
    "객관적으로 보면",
    "데이터에 따르면"
  ]
};

/**
 * 관계 기반 금지 표현 체크
 */
export function containsRelationshipProhibited(
  text: string, 
  relationship: string
): boolean {
  const patterns = RELATIONSHIP_PROHIBITED_PATTERNS[relationship];
  if (!patterns) return false;
  
  return patterns.some(pattern => text.includes(pattern));
}

export default {
  GLOBAL_PROHIBITED_OPENINGS,
  CHARACTER_PROHIBITED_PHRASES,
  RELATIONSHIP_PROHIBITED_PATTERNS,
  containsProhibitedOpening,
  buildProhibitedPhrasesPrompt,
  containsRelationshipProhibited
};
