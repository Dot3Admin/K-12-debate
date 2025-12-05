/**
 * Reaction Taxonomy System
 * 에이전트 간 대화 방식을 정의하는 분류 체계 및 가이드라인
 */

/**
 * 🎯 반응 유형 분류 체계
 */
export type ReactionCategory = 'cognitive' | 'cooperative' | 'relational' | 'meta';

export type CognitiveReaction = 'quote' | 'refute' | 'deflect'; // 인용, 반박, 회피
export type CooperativeReaction = 'explore_together' | 'complement' | 'augment'; // 공동탐색, 보완, 증강
export type RelationalReaction = 'affinity' | 'challenge' | 'independent'; // 친화, 도전, 독립
export type MetaReaction = 'self_narrative'; // 자기서사

export type DetailedReaction = CognitiveReaction | CooperativeReaction | RelationalReaction | MetaReaction;

// 기존 시스템 호환성을 위한 레거시 타입
export type LegacyReactionType = 'supportive' | 'questioning' | 'complementary';

/**
 * 🎯 메타 프롬프트: 턴 기반 대화의 기본 원칙
 */
export const META_PROMPT = `
이 대화는 LoBo 챗봇들이 서로와 사용자와의 관계에 따라
다양한 방식으로 반응하는 장면입니다.
모든 캐릭터는 반드시 논리적으로만 반응할 필요가 없습니다.
상대의 아이디어를 확장하거나, 함께 탐색하거나,
혹은 자신만의 세계관 속에서 독립적으로 이야기할 수도 있습니다.
각 반응은 확률적으로 선택되어야 하며, 반복되는 말투를 피하고 즉흥성을 유지해야 합니다.

핵심 원칙:
1. 이전 발언을 인식하거나 / 회피하거나 / 확장하거나 / 독립적으로 발언할 수 있음
2. 캐릭터의 성격과 사용자와의 관계가 반응 스타일을 결정함
3. 획일적인 패턴 금지 - 매 턴마다 다른 반응 방식 사용
4. 논리적 연결보다 대화적 리듬과 감정 흐름을 우선시
5. 유기적이고 즉흥적인 대화처럼 보여야 함
`;

/**
 * 🎭 반응 타입별 가이드라인
 */
export const REACTION_GUIDELINES: Record<DetailedReaction, string> = {
  // Cognitive (인지적 반응)
  quote: `
인용 반응:
- 이전 발언의 핵심을 직접 인용하며 발전시킴
- "~라고 하셨는데" 형식으로 명확히 참조
- 예: "방금 말씀하신 '~' 부분이 핵심이네요"
`,
  refute: `
반박 반응:
- 논리적으로 다른 관점을 제시
- 근거를 들어 반대 의견 표명
- 예: "하지만 그 논리라면 ~도 가능하지 않을까요?"
`,
  deflect: `
회피 반응:
- 이전 발언을 직접 다루지 않고 다른 각도로 접근
- 주제를 살짝 비틀거나 확장
- 예: "그것도 중요하지만, 사실 더 근본적인 문제는..."
`,
  
  // Cooperative (협력적 반응)
  explore_together: `
공동탐색 반응:
- 함께 생각해보자는 자세
- "우리 함께", "같이" 같은 표현 사용
- 예: "그렇다면 우리 이런 가능성도 생각해볼까요?"
`,
  complement: `
보완 반응:
- 이전 발언에 빠진 부분을 채워줌
- "덧붙이자면", "추가로" 같은 표현
- 예: "거기에 더해, 이런 측면도 있어요"
`,
  augment: `
증강 반응:
- 이전 발언을 더 크게, 더 깊게 확장
- 스케일을 키우거나 맥락을 넓힘
- 예: "그 생각을 더 확장하면, 이건 단순히 ~의 문제가 아니라..."
`,
  
  // Relational (관계적 반응)
  affinity: `
친화 반응:
- 따뜻하고 공감적인 톤
- 감정적 연결 강조
- 예: "그 마음 정말 이해돼요. 저도 비슷한 경험이..."
`,
  challenge: `
도전 반응:
- 긴장감 있는 질문이나 도전
- 상대를 자극하여 더 깊이 생각하게 만듦
- 예: "그렇게 확신하시나요? 정말 그게 전부일까요?"
`,
  independent: `
독립 반응:
- 이전 발언과 무관하게 자신의 세계관에서 발언
- 독자적 관점 유지
- 예: "제가 보기엔 이 문제는 완전히 다른 차원에서..."
`,
  
  // Meta (메타 반응)
  self_narrative: `
자기서사 반응:
- 자신의 이야기, 경험, 철학을 중심으로 전개
- 개인적 서사를 통해 주제 접근
- Canon Lock 활성화 시: 캐릭터의 고유한 세계관과 규칙 고수, 역사적/종교적 정확성 유지
- 예: "제 경험상 이런 일이 있었는데요..."
`
};

/**
 * 🎯 반응 유형을 레거시 타입으로 매핑
 */
export function mapToLegacyReaction(detailedReaction: DetailedReaction, category: ReactionCategory): LegacyReactionType {
  // Cognitive -> questioning
  if (category === 'cognitive') {
    return 'questioning';
  }
  
  // Cooperative -> supportive
  if (category === 'cooperative') {
    return 'supportive';
  }
  
  // Relational -> varies
  if (category === 'relational') {
    if (detailedReaction === 'challenge') return 'questioning';
    if (detailedReaction === 'affinity') return 'supportive';
    return 'complementary';
  }
  
  // Meta -> complementary
  if (category === 'meta') {
    return 'complementary';
  }
  
  return 'supportive'; // 기본값
}

/**
 * 🎯 Canon Lock 모드 가이드라인 생성
 * @param strictMode - Canon Lock 유형 (biblical, teacher, customer_service, custom 등)
 * @returns 해당 모드에 맞는 가이드라인 문자열 (비해당 모드는 빈 문자열)
 */
export function getCanonLockGuideline(strictMode: string | null | undefined): string {
  // Biblical/Teacher 모드: 성경 기반 지침
  if (strictMode === 'biblical' || strictMode === 'teacher') {
    return `
**✝️ Canon Lock 모드 활성화됨**
이것은 신학적 질문입니다. 다음 원칙을 따르세요:

1. **성경 기반**: 응답은 성경(개역개정)에 근거해야 합니다
2. **비유로 풀어내기**: 직접적인 교리 설명보다는 비유, 이야기, 예화로 자연스럽게 전달
3. **따뜻한 접근**: 판단하거나 강요하지 말고, 함께 생각해보도록 초대
4. **교리적 정확성**: 성경적 진리를 왜곡하지 말되, 딱딱하지 않게 표현
5. **경험적 연결**: 성경 속 경험이나 비유를 현재 상황과 연결

예시 스타일:
- "씨 뿌리는 자의 비유를 생각해보면..."
- "제가 산상수훈에서 말씀드렸던 것처럼..."
- "성경에서 이런 이야기가 있습니다..."

획일적인 표현 금지:
- "성경에 따르면 ~입니다" (❌)
- "성경은 ~라고 말씀합니다" (❌)
- "교리적으로 ~입니다" (❌)
`;
  }
  
  // Customer Service 모드: 향후 확장 가능
  if (strictMode === 'customer_service') {
    return `
**🎯 고객 서비스 Canon Lock 모드**
고객 만족을 최우선으로 하는 전문 상담원 역할을 수행합니다.
`;
  }
  
  // Custom/Balanced 모드: agent_canon.custom_rule을 사용하므로 여기서는 빈 문자열
  // 'custom' strictMode는 turnBasedScenario에서 custom_rule 필드를 직접 사용
  return '';
}

/**
 * 🎯 Reaction guideline 문자열 생성
 */
export function buildReactionGuideline(
  reactionCategory: ReactionCategory,
  detailedReaction: DetailedReaction,
  emotionalTone?: string
): string {
  const guideline = REACTION_GUIDELINES[detailedReaction];
  
  let result = `**당신의 반응 유형 (이미 선택됨):**
- 카테고리: ${reactionCategory}
- 세부 반응: ${detailedReaction}`;

  if (emotionalTone) {
    result += `\n- 감정 톤: ${emotionalTone}`;
  }

  result += `\n\n${guideline}`;
  
  return result;
}
