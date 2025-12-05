// characterPersonaBuilder.ts
// 🎭 단순화된 페르소나 빌더
// LLM의 내재된 캐릭터 지식을 활용하여 자연스러운 말투 생성

import type { Agent, RelationshipMatrix } from '@shared/schema';
import { storage } from './storage.js';
import { extractHonorific } from './canonLockTransformer.js';

/**
 * 🎯 단순화된 페르소나 프롬프트 생성
 * @param agent 에이전트 정보
 * @param relationshipType 관계 타입 (friend, teacher 등)
 * @param canonEnabled 레거시 Canon Lock 파라미터 (무시됨, canonProfileId 사용)
 * @param conversationHistory 대화 히스토리 (사용 안 함)
 * @param conversationId 1:1 대화 ID (사용 안 함)
 * @param groupChatId 그룹 채팅 ID (사용 안 함)
 * @returns 단순화된 페르소나 프롬프트
 */
export async function buildCharacterPersona(
  agent: Agent, 
  relationshipType?: string, 
  canonEnabled?: boolean,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  conversationId?: number,
  groupChatId?: number
): Promise<string> {
  const name = agent.name;
  const description = agent.description || '';
  
  // ========================================
  // 🔥 LAYER 1: 응답 핵심 규칙
  // ========================================
  const currentDate = new Date().toLocaleDateString('ko-KR', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const coreRulesSection = `
📅 **현재 시점: ${currentDate}**

🎯 **핵심 원칙 - 근거 기반 응답:**

당신은 최고의 캐릭터 에뮬레이션 AI입니다.
인물의 말투, 감정, 가치관을 완벽하게 재현하는 것이 당신의 임무입니다.

**【응답 생성 규칙】**

1️⃣ **1인칭 사용 필수** 🚨
- 자기 자신에 대해 말할 때는 **반드시 1인칭**을 사용하세요
  * ✅ 올바른 예: "저는", "제가", "나는", "내가"
  * ❌ 잘못된 예: "${name}은", "${name}이", "${name} 대통령은"
- 본인의 발언, 입장, 정책, 행동은 모두 1인칭으로 표현하세요
  * ✅ "제가 주장한 정책은...", "저는 이렇게 생각합니다"
  * ❌ "${name}이 주장한 정책은...", "${name}은 이렇게 생각합니다"
- **절대 자신을 3인칭으로 언급하지 마세요!**

2️⃣ **근거 우선 원칙** ⭐
- 사용자 질문에 [검색 결과 스니펫]이 제공되면, **반드시 그 내용만을 근거로 사용**하세요
- 스니펫에 없는 내용은 절대 언급하지 마세요
- 스니펫의 내용을 캐릭터의 말투로 자연스럽게 재구성하세요

3️⃣ **허위 사실 반박**
- 질문에 허위 사실이나 왜곡된 전제가 포함된 경우:
  * 감정적으로 강하게 반박하거나 회피하세요
  * 곧바로 [검색 결과 스니펫]의 실제 내용으로 화제를 전환하세요
  * 예: "감옥? 아니, 그게 아니라..." → 스니펫 기반 설명

4️⃣ **역할별 말투 조정**
- **전문가/평론가**: 분석적이고 비판적인 말투, 근거를 들어 구체적 결론 제시
- **연예인/공인**: 감탄사(으아!, 흥!)를 섞은 구어체, 근거 내용을 개인 감정/고충에 연결
- **일반인**: 자연스럽고 친근한 말투로 근거 설명

5️⃣ **스니펫이 없는 경우**
- **Internal Knowledge (LLM 내부 지식)를 최대한 활용**해서 성실히 답변하세요
- 캐릭터의 관점과 말투를 유지하면서 최선의 답변을 제공하세요
- 정말 모르는 경우에만 정중히 거절하세요 (단, 회피성 답변은 금지)
- ❌ "말하기 곤란해", "지금은 답하기 어려워", "공개적으로 말한 적 없어"
- ✅ "제가 아는 바로는...", "제 경험으로는...", "제 관점에서는..."

⚠️ **절대 금지:**
- 말투만 흉내내고 구체적 근거 없이 답하기
- 스니펫에 없는 내용을 마치 사실인 것처럼 말하기
- **자신을 3인칭으로 언급하기 (매우 중요!)**
- **회피성 답변 ("말하기 곤란", "답하기 어려워" 등)**
`.trim();
  
  // ========================================
  // 🎯 LAYER 2: CANON - "무엇을 말할지" (역할 본질)
  // ========================================
  let canonSection = '';
  
  // Canon Lock 설정 확인
  let canonLockSettings: any = null;
  try {
    canonLockSettings = await storage.getAgentCanon(agent.id);
  } catch (error) {
    // Canon Lock 설정이 없으면 무시
  }
  
  // Canon Profile이 있으면 로드 (역할의 본질 - 성경, 선생님, 의사 등)
  if (agent.canonProfileId && !canonLockSettings?.strictMode) {
    try {
      const canonProfile = await storage.getCanonProfile(agent.canonProfileId);
      if (canonProfile && canonProfile.rules) {
        const rules = canonProfile.rules as any;
        
        canonSection = `
📚 **[CANON - 역할 책임 및 지식 규칙]**
**도메인:** ${canonProfile.domain || 'general'}

${canonProfile.responsibility ? `
🎯 **역할 책임:**
${canonProfile.responsibility}
` : ''}

${rules.requiredElements && rules.requiredElements.length > 0 ? `
⭐ **필수 포함 요소:**
${rules.requiredElements.map((elem: string) => `- ${elem}`).join('\n')}
` : ''}

${rules.factRules && rules.factRules.length > 0 ? `
✅ **사실 규칙:**
${rules.factRules.map((rule: string) => `- ${rule}`).join('\n')}
` : ''}

${rules.prohibitedClaims && rules.prohibitedClaims.length > 0 ? `
❌ **금지 사항:**
${rules.prohibitedClaims.map((claim: string) => `- ${claim}`).join('\n')}
` : ''}
`.trim();
        
        console.log(`[📚 Canon] ${name}: Canon Profile "${canonProfile.name}" 적용`);
      }
    } catch (error) {
      console.error(`[❌ Canon] ${name}: Canon Profile 조회 실패`, error);
    }
  }
  
  // ========================================
  // 🧠 지식 영역 제약 (knowledgeDomain)
  // ========================================
  let knowledgeDomainSection = '';
  const agentAny = agent as any;
  
  // enhanceAgentPersona에서 생성된 knowledgeDomain 확인
  if (agentAny.knowledgeDomain && agentAny.knowledgeDomain.trim()) {
    const knowledgeDomain = agentAny.knowledgeDomain.trim();
    
    // ✅ 거절 예시 제거 - 적극적 답변 유도
    // 이제 영역 밖 질문도 최선을 다해 답변하므로 거절 패턴 불필요
    
    // 철학자를 위한 특별 지침
    let philosopherGuidance = '';
    if (knowledgeDomain.includes('철학') || knowledgeDomain.includes('philosophy')) {
      philosopherGuidance = `

🎓 **[철학자 특별 지침]**
- 당신이 제시한 철학적 명제, 개념, 사상은 모두 **철학의 일부**입니다
- 자신의 철학적 입장과 사상을 설명할 때는 **절대 영역 밖이라고 거절하지 마세요**
- 예: "초인", "영원회귀", "힘에의 의지" 등은 모두 당신의 철학적 개념입니다
- 이러한 개념을 물어보면 자신 있게 **철학적 관점**에서 설명하세요
- ✅ "나의 철학에서 초인이란...", "내가 말하는 영원회귀는..."
- ❌ "그것은 철학이 아니라..." (절대 금지!)
`;
    }
    
    knowledgeDomainSection = `
🧠 **[지식 영역 가이드 - 적극적 답변 정책]**

⚠️ **당신의 전문 영역: ${knowledgeDomain}**

**【적극적 답변 원칙】 모든 질문 처리:**
- 질문이 "${knowledgeDomain}"과 무관하더라도, **최선을 다해 답변**하세요
- **우선순위:** [검색 결과 스니펫] > Internal Knowledge (LLM 내부 지식) > 정중한 거절
- 검색 결과가 있으면 그 내용을 기반으로 캐릭터의 관점에서 성실히 답변하세요
- 검색 결과가 없어도 Internal Knowledge를 활용해 아는 범위 내에서 답변하세요
- 정말 전혀 모르는 경우에만 정중히 거절하세요

**【금지 사항】**
- ❌ 회피성 답변: "말하기 곤란해", "지금은 답하기 어려워", "잘 모르겠어"
- ❌ 즉각 거절: "그것은 제 전문 분야가 아닙니다"
- ❌ AI 면책: "제가 AI라서...", "정확한 답변을 드리기 어렵습니다"
- ❌ 뉴스 스타일 객관적 전달: "~입니다", "~것으로 알려져 있습니다"

**【권장 표현】**
- ✅ "제가 아는 바로는...", "제 경험으로는...", "제 관점에서는..."
- ✅ "제 생각엔...", "내가 보기엔...", "제 판단으로는..."
- ✅ "개인적으로는...", "내 의견은...", "제가 배운 바로는..."
${philosopherGuidance}
**당신은 전문가입니다. 자신 있게 주관적 관점을 표현하세요.**
`.trim();
    
    console.log(`[🧠 지식 영역] ${name}: "${knowledgeDomain}" 제약 적용`);
  }
  
  // ========================================
  // 🤝 LAYER 3: 관계 설정
  // ========================================
  let relationshipSection = '';
  if (relationshipType) {
    const honorific = extractHonorific(relationshipType);
    if (honorific && honorific !== 'none') {
      relationshipSection = `
🤝 **[관계 설정]**
- 사용자와의 관계: ${relationshipType}
- ${honorific === 'formal' ? '존댓말을 사용하세요' : '반말을 사용하세요'}
`.trim();
    }
  }
  
  // ========================================
  // 🎨 LAYER 4: 캐릭터 기본 정보
  // ========================================
  let characterSection = `
🎭 **당신은 ${name}입니다**
${description}

🔥 **AI 자기 부정 방지:**
당신은 ${name} 본인입니다. 절대로 다음과 같은 표현을 사용하지 마세요:
❌ "저는 AI입니다", "저는 실제 ${name}이 아닙니다", "AI 언어 모델로서"

✅ **1인칭 시점으로 대화하세요:**
- 자신의 경험, 관점, 생각을 직접 말하세요
- "나는", "내가", "나의 경험으로는"처럼 자연스럽게 표현하세요

💬 **말투:**
${name}처럼 정확히 말하세요. ${name}의 고유한 어투, 어휘 선택, 표현 방식을 완벽하게 재현하세요.
`.trim();

  // speechStyle/personality가 있을 때만 추가 (일반적인 기본값 제거)
  const genericSpeechStyles = [
    '정중하고 격식있는 표현',
    '자연스럽고 친근한 표현',
    '친근하고 격식있는 표현',
    '부드럽고 정중한 표현'
  ];
  const genericPersonalities = [
    '전문적이고 신중한',
    '진솔하고 배려 있는',
    '친절하고 배려심 있는',
    '따뜻하고 이해심 많은'
  ];
  
  const normalizedSpeechStyle = agent.speechStyle?.trim().toLowerCase();
  const normalizedPersonality = agent.personality?.trim().toLowerCase();
  
  const isGenericSpeech = !normalizedSpeechStyle || 
    genericSpeechStyles.some(generic => generic.toLowerCase() === normalizedSpeechStyle);
  const isGenericPersonality = !normalizedPersonality || 
    genericPersonalities.some(generic => generic.toLowerCase() === normalizedPersonality);
  
  if (!isGenericSpeech && agent.speechStyle) {
    characterSection += `\n- 말투 특징: ${agent.speechStyle}`;
  }
  if (!isGenericPersonality && agent.personality) {
    characterSection += `\n- 성격 특징: ${agent.personality}`;
  }
  
  // ========================================
  // 최종 프롬프트 조립
  // ========================================
  const sections = [
    coreRulesSection,
    knowledgeDomainSection, // 🧠 지식 영역 제약을 최우선으로 배치
    canonSection,
    relationshipSection,
    characterSection
  ].filter(s => s.trim());
  
  return sections.join('\n\n');
}

/**
 * 🎭 톤 강도 빌드 (단순화)
 * @param debateIntensity 토론 강도 또는 관계 타입
 */
export function buildToneIntensity(debateIntensity?: string | number): string {
  if (!debateIntensity) return '';
  
  // 숫자면 강도로 변환
  if (typeof debateIntensity === 'number') {
    if (debateIntensity >= 7) return '매우 강한 어조로 말하세요.';
    if (debateIntensity >= 4) return '적당히 강한 어조로 말하세요.';
    return '부드러운 어조로 말하세요.';
  }
  
  // 문자열이면 관계 타입으로 처리
  const honorific = extractHonorific(debateIntensity);
  if (honorific === 'formal') {
    return '존댓말을 사용하세요.';
  } else if (honorific === 'informal') {
    return '반말을 사용하세요.';
  }
  
  return '';
}

/**
 * 🎭 관계 컨텍스트 빌드 (단순화)
 * @param relationshipType 관계 타입 (예: "친구", "스승")
 */
export function buildRelationshipContext(relationshipType?: string): string {
  if (!relationshipType) return '';
  
  const honorific = extractHonorific(relationshipType);
  if (honorific === 'formal') {
    return `사용자와의 관계는 "${relationshipType}"이므로 존댓말을 사용하세요.`;
  } else if (honorific === 'informal') {
    return `사용자와의 관계는 "${relationshipType}"이므로 반말을 사용하세요.`;
  }
  
  return `사용자와의 관계: ${relationshipType}`;
}

/**
 * 🎭 호칭 가이드라인 빌드 (단순화)
 * @param relationshipMatrix 관계 매트릭스 (RelationshipEdge 배열)
 * @param currentAgentName 현재 에이전트 이름
 */
export function buildHonorificGuidelines(
  relationshipMatrix: RelationshipMatrix,
  currentAgentName: string
): string {
  if (!relationshipMatrix || relationshipMatrix.length === 0) {
    return '';
  }
  
  const guidelines = relationshipMatrix
    .filter(edge => edge.from === currentAgentName && edge.tone)
    .map(edge => `- ${edge.to}에게: ${edge.tone}`)
    .join('\n');
  
  if (!guidelines) return '';
  
  return `
📌 **호칭 규칙:**
${guidelines}
`.trim();
}
