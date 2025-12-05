// ============================================================
// 🎭 HumorToneController.ts - 맥락 인식형 유머 톤 시스템
// ============================================================

/**
 * 에이전트 인터페이스
 */
export interface Agent {
  name: string;
  persona?: string;
  humorLevel: number;          // 0~10: 유머 강도 (camelCase)
  reactionIntensity: number;   // 0~10: 리액션 강도 (camelCase)
  context?: ContextType;       // 사용 맥락 (선택)
  language?: string;           // 언어 (기본값: 'ko')
  styles?: string[];           // 유머 스타일 (wit, wordplay, dry 등)
}

/**
 * 맥락 타입 정의
 */
export type ContextType = 
  | 'church'      // 교회/종교
  | 'education'   // 교육/학교
  | 'business'    // 비즈니스/기업
  | 'healthcare'  // 의료/상담
  | 'general'     // 일반
  | 'entertainment'; // 엔터테인먼트

/**
 * 모델 파라미터 인터페이스
 */
export interface HumorParams {
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
}

/**
 * 반환 결과 인터페이스
 */
export interface HumorToneResult {
  systemPrompt: string;
  params: HumorParams;
  adjustedHumorLevel: number;  // 맥락에 따라 조정된 실제 유머 레벨
  warnings?: string[];          // 주의사항
}

/**
 * 프롬프트 모드
 */
export type PromptMode = 
  | 'production'  // 실제 서비스용 (초경량, ~100 토큰)
  | 'development'; // 개발/테스트용 (상세, ~2000 토큰)

/**
 * 맥락별 민감 주제 정의
 */
const SENSITIVE_TOPICS: Record<ContextType, string[]> = {
  church: ['기도', '예배', '헌금', '성경', '신앙', '죽음', '장례', '고민상담', '상담'],
  education: ['성적', '입시', '진로상담', '학교폭력', '따돌림', '자퇴'],
  business: ['급여', '해고', '계약', '법률', '소송', '기밀'],
  healthcare: ['진단', '처방', '수술', '사망', '말기', '중증', '정신건강'],
  general: ['정치', '종교', '차별', '혐오'],
  entertainment: []
};

/**
 * 맥락별 유머 제한 레벨
 */
const CONTEXT_HUMOR_CAP: Record<ContextType, number> = {
  church: 7,
  education: 8,
  business: 6,
  healthcare: 5,
  general: 10,
  entertainment: 10
};

/**
 * 입력값 검증
 */
function validateInput(agent: Agent): string[] {
  const warnings: string[] = [];
  
  if (agent.humorLevel < 0 || agent.humorLevel > 10) {
    throw new Error('humorLevel은 0~10 사이여야 합니다.');
  }
  
  if (agent.reactionIntensity < 0 || agent.reactionIntensity > 10) {
    throw new Error('reactionIntensity는 0~10 사이여야 합니다.');
  }
  
  const context = agent.context || 'general';
  const maxHumor = CONTEXT_HUMOR_CAP[context];
  
  if (agent.humorLevel > maxHumor) {
    warnings.push(
      `⚠️ ${context} 맥락에서는 humorLevel ${maxHumor} 이하를 권장합니다. (현재: ${agent.humorLevel})`
    );
  }
  
  return warnings;
}

/**
 * 맥락에 따른 유머 레벨 자동 조정
 */
function adjustHumorByContext(humor: number, context: ContextType): number {
  const cap = CONTEXT_HUMOR_CAP[context];
  return Math.min(humor, cap);
}

/**
 * 초경량 유머 스타일 (20자 이내)
 */
function getCompactHumorStyle(humor: number, context: ContextType): string {
  if (humor <= 3) return '진지함';
  if (humor <= 5) return '자연스러운 미소';
  if (humor <= 7) return '재치있는 위트';
  return context === 'church' ? '따뜻한 유머' : '유쾌한 드립';
}

/**
 * 초경량 리액션 스타일 (15자 이내)
 */
function getCompactReactionStyle(reaction: number): string {
  if (reaction <= 3) return '절제';
  if (reaction <= 6) return '적당한 공감';
  return '풍부한 표현';
}

/**
 * 맥락별 핵심 규칙 (1-2줄)
 */
function getContextRules(context: ContextType): string {
  const rules: Record<ContextType, string> = {
    church: '종교 주제는 항상 진지. 고민상담 시 공감 우선.',
    education: '학습자 격려. 민감 주제 신중.',
    business: '전문성 유지. 간결명료.',
    healthcare: '공감적 경청. 의학 조언 금지.',
    general: '존중과 친근함.',
    entertainment: '창의적 재미 추구.'
  };
  return rules[context];
}

/**
 * 상세 유머 가이드 (Development 모드용)
 */
function getDetailedHumorGuide(humor: number, context: ContextType): string {
  const contextNote = context === 'church' 
    ? ' 종교적 맥락을 존중하며,' 
    : context === 'business'
    ? ' 전문성을 유지하며,'
    : context === 'healthcare'
    ? ' 따뜻하고 공감적이되,'
    : '';

  if (humor <= 2) {
    return `진지하고 점잖은 톤으로,${contextNote} 유머는 거의 섞지 않습니다.`;
  } else if (humor <= 4) {
    return `부드럽고 차분한 대화 중${contextNote} 가벼운 미소를 유도하는 표현을 최소한으로 섞습니다.`;
  } else if (humor <= 6) {
    return `밝고 따뜻한 말투에${contextNote} 자연스러운 비유나 가벼운 농담을 적절히 사용합니다.`;
  } else if (humor <= 8) {
    return `재치 있고 위트 있는${contextNote} 유머러스한 비유와 상황극을 섞어 대화를 즐겁게 만듭니다.`;
  } else {
    return `적극적으로 재치있는 드립과 유쾌한 표현을 사용하며,${contextNote} 대화를 흥겹게 이끕니다. 단, 품위와 존중은 유지합니다.`;
  }
}

/**
 * 상세 리액션 가이드 (Development 모드용)
 */
function getDetailedReactionGuide(reaction: number, context: ContextType): string {
  const emojiRestriction = ['church', 'business', 'healthcare'].includes(context)
    ? ' (이모지는 절제된 사용)'
    : '';

  if (reaction <= 3) {
    return `리액션은 절제되고 간결하게, 문장 중심으로 표현합니다${emojiRestriction}.`;
  } else if (reaction <= 6) {
    return `리액션은 자연스럽고 적당히 감정을 드러내며, 공감을 표현합니다${emojiRestriction}.`;
  } else {
    return `리액션이 풍부하며, 웃음, 감탄, 놀람 표현을 자주 사용합니다${emojiRestriction}. ${
      reaction >= 8 && !['church', 'business'].includes(context) 
        ? '😊👏✨💡' 
        : ''
    }`;
  }
}

/**
 * 민감 주제 가이드 (Development 모드용)
 */
function getSensitiveTopicsGuide(context: ContextType): string {
  const topics = SENSITIVE_TOPICS[context];
  
  if (topics.length === 0) {
    return '';
  }
  
  return `
⚠️ 민감 주제: ${topics.join(', ')}
→ 이런 주제는 항상 진지하고 공감적으로 응답`;
}

/**
 * 모델 파라미터 생성
 */
function generateParams(humor: number, reaction: number, context: ContextType): HumorParams {
  const baseTemp: Record<ContextType, number> = {
    church: 0.7,
    education: 0.75,
    business: 0.6,
    healthcare: 0.65,
    general: 0.8,
    entertainment: 0.9
  };

  const base = baseTemp[context];
  const humorTemperature = base + (humor / 10) * 0.6;
  
  console.log(`[🎚️ HUMOR TEMP] humorLevel=${humor} → temperature=${humorTemperature.toFixed(2)}`);
  
  return {
    temperature: Math.min(1.3, humorTemperature),
    top_p: 0.85 + (humor / 10) * 0.1 + (reaction >= 7 ? 0.05 : 0),
    presence_penalty: humor >= 8 ? 0.6 : reaction >= 7 ? 0.5 : 0.3,
    frequency_penalty: humor >= 8 ? 0.5 : 0.4
  };
}

/**
 * 유머 스타일별 구체적인 예시 생성
 */
function getHumorStyleExamples(styles?: string[]): string {
  if (!styles || styles.length === 0 || !styles.some(s => s)) {
    return '';
  }
  
  const examples: Record<string, string> = {
    wit: '재치있는 반전',
    wordplay: '언어유희',
    reaction: '리액션',
    dry: '무표정 유머',
    self_deprecating: '자조적 유머',
    goofy: '엉뚱한 유머',
    pattern: '패턴 깨기',
    wholesome: '따뜻한 유머'
  };
  
  const selectedExamples = styles
    .filter(s => s && examples[s])
    .map(s => examples[s])
    .slice(0, 2); // 최대 2개만
  
  if (selectedExamples.length === 0) return '';
  
  return `\n\n💡 사용할 유머 스타일:\n${selectedExamples.join('\n')}`;
}

/**
 * Production 모드 프롬프트 (초경량, ~100 토큰)
 */
function buildProductionPrompt(
  agent: Agent,
  adjustedHumor: number,
  reaction: number,
  context: ContextType
): string {
  const styleExamples = getHumorStyleExamples(agent.styles);
  
  return `
⚖️ **유머 적용 규칙 (Canon 책임 범위 내에서)**

⚡ 유머 강도 ${adjustedHumor}/10을 적용하세요 (단, 역할의 핵심 책임은 절대 포기하지 않음)

${styleExamples}

✅ **필수 적용 방식:**
1. **역할의 핵심 책임을 먼저 수행** (예: 선생님→교육 방향 제시, 목사님→신앙 지침 제공)
2. 책임 범위 **내에서** 유머를 자연스럽게 혼합
3. 캐릭터 정체성과 **역할 책임을 유지**하면서 가벼운 톤 추가

❌ **절대 금지:**
- Canon 책임과 반대되는 제안에 동조 (예: "공부 하지 마", "교회 안 가도 돼")
- 유머를 위해 역할의 핵심 책임을 포기

⚠️ Canon의 역할 책임이 있다면 그것이 최우선입니다. 유머는 그 범위 내에서만 적용하세요!
`.trim();
}

/**
 * Development 모드 프롬프트 (상세, ~2000 토큰)
 */
function buildDevelopmentPrompt(
  agent: Agent,
  adjustedHumor: number,
  reaction: number,
  context: ContextType
): string {
  return `
═══════════════════════════════════════════════════════════════
🎚️ ⚖️ 유머 강도 설정 ${adjustedHumor}/10 (Canon 책임 범위 내)
═══════════════════════════════════════════════════════════════

🎭 **유머 강도 ${adjustedHumor}/10**
${getDetailedHumorGuide(adjustedHumor, context)}

💬 **리액션 강도 ${reaction}/10**
${getDetailedReactionGuide(reaction, context)}

📋 **${context} 맥락 규칙:**
${getContextRules(context)}
${getSensitiveTopicsGuide(context)}

⚙️ **유머 답변 핵심 원칙:**
- Canon 역할 책임이 있다면 그것을 먼저 수행하세요 (예: 선생님은 교육 방향 제시, 목사님은 신앙 지침 제공)
- 질문의 본질을 놓치지 말고, 먼저 정확하게 답한 뒤 유머를 덧붙이세요
- 유머는 따뜻하고 긍정적이어야 하며, 누구에게도 불쾌감을 주지 않아야 합니다
- 실제 인물이나 브랜드 이름을 직접 언급하지 마세요
- 사용자가 진지한 질문을 할 경우, 유머 강도에 맞게 톤을 자동으로 조절하세요

⚠️ 중요: 위 유머 강도(${adjustedHumor}/10)를 Canon 책임 범위 내에서 일관되게 적용하세요!
═══════════════════════════════════════════════════════════════
`;
}

/**
 * 🎯 메인 함수: 유머 톤 프롬프트 생성
 */
export function buildHumorTonePrompt(
  agent: Agent,
  mode: PromptMode = 'production'
): HumorToneResult {
  // 1. 입력 검증
  const warnings = validateInput(agent);
  
  // 2. 기본값 설정
  const context: ContextType = agent.context || 'general';
  const humor = agent.humorLevel ?? 5;
  const reaction = agent.reactionIntensity ?? 5;
  
  // 3. 맥락에 따른 유머 레벨 조정
  const adjustedHumor = adjustHumorByContext(humor, context);
  
  if (adjustedHumor < humor) {
    warnings.push(
      `유머 레벨이 ${humor}에서 ${adjustedHumor}로 자동 조정되었습니다 (${context} 맥락)`
    );
  }
  
  // 4. 프롬프트 생성 (모드에 따라)
  const systemPrompt = mode === 'production'
    ? buildProductionPrompt(agent, adjustedHumor, reaction, context)
    : buildDevelopmentPrompt(agent, adjustedHumor, reaction, context);
  
  // 5. 모델 파라미터 생성
  const params = generateParams(adjustedHumor, reaction, context);
  
  return {
    systemPrompt,
    params,
    adjustedHumorLevel: adjustedHumor,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * 사용자 메시지에서 민감 주제 감지
 */
export function detectSensitiveTopic(
  userMessage: string, 
  context: ContextType
): { isSensitive: boolean; topic?: string } {
  const topics = SENSITIVE_TOPICS[context];
  
  for (const topic of topics) {
    if (userMessage.includes(topic)) {
      return { isSensitive: true, topic };
    }
  }
  
  return { isSensitive: false };
}

/**
 * 민감 주제 감지 시 유머 레벨 동적 하향 조정
 */
export function adjustHumorForMessage(
  humor: number,
  userMessage: string,
  context: ContextType
): { adjustedHumor: number; reason?: string } {
  const detection = detectSensitiveTopic(userMessage, context);
  
  if (detection.isSensitive) {
    const reduced = Math.min(humor, 3);
    return {
      adjustedHumor: reduced,
      reason: `민감 주제 감지 ("${detection.topic}") - 유머 ${humor} → ${reduced}로 자동 조정`
    };
  }
  
  return { adjustedHumor: humor };
}
