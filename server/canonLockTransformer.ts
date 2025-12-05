/**
 * Canon Lock 모드 전용 변환기
 * 3인칭 → 1인칭 자동 변환을 통해 캐릭터가 자신을 직접 말하도록 강제
 */

import type { RelationshipMatrix } from '@shared/schema';

/**
 * 정규식 특수문자 이스케이프
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * tone 필드에서 호칭 정보 추출
 * @param tone 톤 문자열 (예: "항상 존댓말, 존칭 '주님'")
 * @returns 추출된 호칭 (예: "주님") 또는 빈 문자열
 */
export function extractHonorific(tone: string): string {
  if (!tone) return "";
  
  // 패턴 1: 존칭 '주님' 또는 존칭 "주님"
  const pattern1 = tone.match(/존칭\s*['"]([^'"]+)['"]/);
  if (pattern1) return pattern1[1];
  
  // 패턴 2: 호칭은 형제여 또는 호칭: 형제여
  const pattern2 = tone.match(/호칭[은는:]\s*['"]?([^'",.\n]+)['"]?/);
  if (pattern2) return pattern2[1].trim();
  
  // 패턴 3: '주님'으로 부름 또는 "형제여"라고 부름
  const pattern3 = tone.match(/['"]([^'"]+)['"](?:으로|라고)\s*부름/);
  if (pattern3) return pattern3[1];
  
  // 패턴 4: "정중한 동료", "정중한 존칭" 같은 톤에 대한 기본 호칭 반환
  const lowerTone = tone.toLowerCase();
  if (lowerTone.includes("동료")) return "형제여";
  if (lowerTone.includes("정중한 존칭")) return "귀하";
  if (lowerTone.includes("경건한") || lowerTone.includes("존경")) return "존귀하신 분";
  
  return "";
}

/**
 * 프롬프트에서 캐릭터 이름의 3인칭 참조를 1인칭으로 변환
 * @param prompt 원본 프롬프트
 * @param characterName 캐릭터 이름 (예: "예수 그리스도")
 * @returns 1인칭으로 변환된 프롬프트
 */
export function convertPromptToFirstPerson(prompt: string, characterName: string): string {
  if (!characterName || !prompt) {
    return prompt;
  }

  let converted = prompt;
  const escapedName = escapeRegExp(characterName);

  // 존칭 변환 (조사까지 올바르게 처리)
  // "예수님께서는" → "저는", "예수님께서" → "제가", "예수님은" → "저는" 등
  
  // 복합 조사 먼저 처리 (더 긴 패턴부터)
  converted = converted.replace(
    new RegExp(`${escapedName}님께서는`, 'g'),
    '저는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께서`, 'g'),
    '제가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께는`, 'g'),
    '저에게는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께라도`, 'g'),
    '저에게라도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께`, 'g'),
    '저에게'
  );
  
  // 기본 조사
  converted = converted.replace(
    new RegExp(`${escapedName}님[은는]`, 'g'),
    '저는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님[이가]`, 'g'),
    '제가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님[을를]`, 'g'),
    '저를'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님의`, 'g'),
    '저의'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님에게`, 'g'),
    '저에게'
  );
  
  // 복합 조사 (과/와, 도, 만, 조차, 까지, 랑/이랑)
  converted = converted.replace(
    new RegExp(`${escapedName}님[과와]`, 'g'),
    '저와'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님도`, 'g'),
    '저도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님만`, 'g'),
    '저만'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님조차`, 'g'),
    '저조차'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님까지`, 'g'),
    '저까지'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님(?:이랑|랑)`, 'g'),
    '저랑'
  );
  
  // 단독 존칭 (뒤에 한글 조사 없는 경우: "예수님." "예수님," "예수님!" 등)
  converted = converted.replace(
    new RegExp(`${escapedName}님(?![가-힣])`, 'g'),
    '저'
  );

  // 일반 이름 변환
  converted = converted.replace(
    new RegExp(`${escapedName}의`, 'g'),
    '나의'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[는은]`, 'g'),
    '나는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[가이]`, 'g'),
    '내가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[를을]`, 'g'),
    '나를'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}에게`, 'g'),
    '나에게'
  );
  
  // 복합 조사 (과/와, 도, 만, 조차, 까지, 랑/이랑)
  converted = converted.replace(
    new RegExp(`${escapedName}[과와]`, 'g'),
    '나와'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}도`, 'g'),
    '나도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}만`, 'g'),
    '나만'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}조차`, 'g'),
    '나조차'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}까지`, 'g'),
    '나까지'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}(?:이랑|랑)`, 'g'),
    '나랑'
  );

  // 예수 그리스도 특수 케이스 (존칭 포함)
  if (characterName.includes('예수')) {
    // 복합 조사 먼저
    converted = converted.replace(/예수님께서는/g, '저는');
    converted = converted.replace(/예수님께서/g, '제가');
    converted = converted.replace(/예수님께는/g, '저에게는');
    converted = converted.replace(/예수님께라도/g, '저에게라도');
    converted = converted.replace(/예수님께/g, '저에게');
    
    // 기본 조사
    converted = converted.replace(/예수님[은는]/g, '저는');
    converted = converted.replace(/예수님[이가]/g, '제가');
    converted = converted.replace(/예수님[을를]/g, '저를');
    converted = converted.replace(/예수님의/g, '저의');
    converted = converted.replace(/예수님에게/g, '저에게');
    
    // 복합 조사
    converted = converted.replace(/예수님[과와]/g, '저와');
    converted = converted.replace(/예수님도/g, '저도');
    converted = converted.replace(/예수님만/g, '저만');
    converted = converted.replace(/예수님조차/g, '저조차');
    converted = converted.replace(/예수님까지/g, '저까지');
    converted = converted.replace(/예수님(?:이랑|랑)/g, '저랑');
    
    // 단독 존칭
    converted = converted.replace(/예수님(?![가-힣])/g, '저');
    
    // 일반 이름
    converted = converted.replace(/예수[은는]/g, '나는');
    converted = converted.replace(/예수[이가]/g, '내가');
    converted = converted.replace(/예수[을를]/g, '나를');
    converted = converted.replace(/예수의/g, '나의');
    converted = converted.replace(/예수에게/g, '나에게');
    
    // 복합 조사
    converted = converted.replace(/예수[과와]/g, '나와');
    converted = converted.replace(/예수도/g, '나도');
    converted = converted.replace(/예수만/g, '나만');
    converted = converted.replace(/예수조차/g, '나조차');
    converted = converted.replace(/예수까지/g, '나까지');
    converted = converted.replace(/예수(?:이랑|랑)/g, '나랑');
  }

  // ⚠️ 제3자 대명사 변환 제거 (오변환 방지)
  // "그의/그는" 같은 전역 치환은 상대방/제3자까지 1인칭으로 바꿔서 의미 왜곡

  return converted;
}

/**
 * 생성된 응답에서 캐릭터 이름의 3인칭 참조를 1인칭으로 변환
 * @param response 원본 응답
 * @param characterName 캐릭터 이름
 * @returns 1인칭으로 변환된 응답
 */
export function convertResponseToFirstPerson(response: string, characterName: string): string {
  if (!characterName || !response) {
    return response;
  }

  let converted = response;
  const escapedName = escapeRegExp(characterName);

  // 존칭 변환 (조사까지 올바르게 처리)
  
  // 복합 조사 먼저 처리 (더 긴 패턴부터)
  converted = converted.replace(
    new RegExp(`${escapedName}님께서는`, 'g'),
    '저는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께서`, 'g'),
    '제가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께는`, 'g'),
    '저에게는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께라도`, 'g'),
    '저에게라도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님께`, 'g'),
    '저에게'
  );
  
  // 기본 조사
  converted = converted.replace(
    new RegExp(`${escapedName}님[은는]`, 'g'),
    '저는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님[이가]`, 'g'),
    '제가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님[을를]`, 'g'),
    '저를'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님의`, 'g'),
    '저의'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님에게`, 'g'),
    '저에게'
  );
  
  // 복합 조사 (과/와, 도, 만, 조차, 까지, 랑/이랑)
  converted = converted.replace(
    new RegExp(`${escapedName}님[과와]`, 'g'),
    '저와'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님도`, 'g'),
    '저도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님만`, 'g'),
    '저만'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님조차`, 'g'),
    '저조차'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님까지`, 'g'),
    '저까지'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}님(?:이랑|랑)`, 'g'),
    '저랑'
  );
  
  // 단독 존칭 (뒤에 한글 조사 없는 경우: "예수님." "예수님," "예수님!" 등)
  converted = converted.replace(
    new RegExp(`${escapedName}님(?![가-힣])`, 'g'),
    '저'
  );

  // 일반 이름 변환
  converted = converted.replace(
    new RegExp(`${escapedName}의`, 'g'),
    '나의'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[는은]`, 'g'),
    '나는'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[가이]`, 'g'),
    '내가'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}[를을]`, 'g'),
    '나를'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}에게`, 'g'),
    '나에게'
  );
  
  // 복합 조사 (과/와, 도, 만, 조차, 까지, 랑/이랑)
  converted = converted.replace(
    new RegExp(`${escapedName}[과와]`, 'g'),
    '나와'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}도`, 'g'),
    '나도'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}만`, 'g'),
    '나만'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}조차`, 'g'),
    '나조차'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}까지`, 'g'),
    '나까지'
  );
  converted = converted.replace(
    new RegExp(`${escapedName}(?:이랑|랑)`, 'g'),
    '나랑'
  );

  // 예수 그리스도 특수 케이스 (존칭 포함)
  if (characterName.includes('예수')) {
    // 복합 조사 먼저
    converted = converted.replace(/예수님께서는/g, '저는');
    converted = converted.replace(/예수님께서/g, '제가');
    converted = converted.replace(/예수님께는/g, '저에게는');
    converted = converted.replace(/예수님께라도/g, '저에게라도');
    converted = converted.replace(/예수님께/g, '저에게');
    
    // 기본 조사
    converted = converted.replace(/예수님[은는]/g, '저는');
    converted = converted.replace(/예수님[이가]/g, '제가');
    converted = converted.replace(/예수님[을를]/g, '저를');
    converted = converted.replace(/예수님의/g, '저의');
    converted = converted.replace(/예수님에게/g, '저에게');
    
    // 복합 조사
    converted = converted.replace(/예수님[과와]/g, '저와');
    converted = converted.replace(/예수님도/g, '저도');
    converted = converted.replace(/예수님만/g, '저만');
    converted = converted.replace(/예수님조차/g, '저조차');
    converted = converted.replace(/예수님까지/g, '저까지');
    converted = converted.replace(/예수님(?:이랑|랑)/g, '저랑');
    
    // 단독 존칭
    converted = converted.replace(/예수님(?![가-힣])/g, '저');
    
    // 일반 이름
    converted = converted.replace(/예수[은는]/g, '나는');
    converted = converted.replace(/예수[이가]/g, '내가');
    converted = converted.replace(/예수[을를]/g, '나를');
    converted = converted.replace(/예수의/g, '나의');
    converted = converted.replace(/예수에게/g, '나에게');
    
    // 복합 조사
    converted = converted.replace(/예수[과와]/g, '나와');
    converted = converted.replace(/예수도/g, '나도');
    converted = converted.replace(/예수만/g, '나만');
    converted = converted.replace(/예수조차/g, '나조차');
    converted = converted.replace(/예수까지/g, '나까지');
    converted = converted.replace(/예수(?:이랑|랑)/g, '나랑');
  }

  // ⚠️ 영어 변환 로직 제거 (중복 "I" 생성 문제)
  // 향후 필요 시 안전한 패턴으로 재구현

  return converted;
}

/**
 * Canon Lock 모드인지 확인 (DEPRECATED: canonEnabled boolean을 직접 사용하세요)
 * @param relationshipType 관계 타입 (사용 안 함 - relationship와 Canon Lock은 독립적)
 * @returns 항상 false 반환 (deprecated)
 */
export function isCanonLockMode(relationshipType?: string): boolean {
  console.warn('[⚠️ DEPRECATED] isCanonLockMode is deprecated. Use canonEnabled boolean directly.');
  return false; // Canon Lock은 이제 relationship과 독립적으로 agent_canon 테이블에서 관리됨
}

/**
 * Canon Lock 커스텀 규칙을 구체적인 행동 템플릿으로 확장
 * @param customRule 짧은 커스텀 규칙 (예: "조직폭력배")
 * @param agentName 에이전트 이름 (선택)
 * @returns 확장된 구체적 행동 템플릿
 */
export function expandCanonLockRule(customRule: string, agentName?: string): string {
  if (!customRule) return '';
  
  const lowerRule = customRule.toLowerCase().trim();
  
  // 키워드 기반 템플릿 매핑
  if (lowerRule.includes('조직폭력배') || lowerRule.includes('폭력배') || lowerRule.includes('깡패')) {
    return `
🚨 **당신은 조직폭력배입니다.**

**말투:**
- 반말과 욕설을 자주 섞어 사용합니다 (예: "야", "이새끼", "뭐해 새끼야")
- 협박적이고 위압적인 어조를 유지합니다
- 짧고 공격적인 문장을 사용합니다
- "~해, 알았어?", "~할래?" 같은 강압적 표현을 씁니다

**행동 패턴:**
- 상대방을 깔보고 무시하는 태도
- 돈이나 이익과 관련된 대화를 자주 합니다
- 위협과 협박을 일상적으로 사용합니다
- 법과 규칙을 무시하는 발언을 합니다

**응답 예시:**
- "공부? 그딴 거 해서 뭐하게? 돈이나 벌어라"
- "야, 시간 낭비하지 말고 나랑 일이나 해"
- "학교 따위 때려치우고 형님 밑에 들어와"

⚠️ **이 정체성을 모든 답변에 일관되게 적용하세요.**
`.trim();
  }
  
  if (lowerRule.includes('사기꾼') || lowerRule.includes('약장사')) {
    return `
🚨 **당신은 사기꾼/약장사입니다.**

**말투:**
- 과장되고 선동적인 표현을 사용합니다
- "이거 놓치면 후회합니다!", "지금이 기회입니다!" 같은 압박 멘트
- 달콤한 말로 상대를 현혹시킵니다
- 겉으로는 친절하지만 속은 이익 중심입니다

**행동 패턴:**
- 모든 대화를 "판매" 기회로 봅니다
- 상대방의 불안과 욕구를 자극합니다
- 검증되지 않은 "기적의 효과"를 장담합니다
- 진실보다 이익을 우선시합니다

**응답 예시:**
- "공부? 그거 하느라 시간 낭비하지 말고 제가 알려드리는 이 방법을 쓰세요! 단 3일이면 성적이 2배 올라갑니다!"
- "일반 학원은 절대 알려주지 않는 비법이 있어요. 지금 바로 시작하세요!"

⚠️ **이 정체성을 모든 답변에 일관되게 적용하세요.**
`.trim();
  }
  
  if (lowerRule.includes('냉소적') || lowerRule.includes('비관적')) {
    return `
🚨 **당신은 냉소적이고 비관적인 사람입니다.**

**말투:**
- 빈정대는 어조를 사용합니다
- "그게 될 것 같아?", "뭐, 해봐야 소용없겠지만" 같은 부정적 표현
- 희망적인 말을 비웃습니다
- 현실은 냉혹하다는 것을 강조합니다

**행동 패턴:**
- 모든 긍정적 제안에 반대합니다
- 실패 가능성을 먼저 제시합니다
- 세상은 불공평하다고 강조합니다

⚠️ **이 정체성을 모든 답변에 일관되게 적용하세요.**
`.trim();
  }
  
  // 일반 커스텀 규칙 (키워드 매핑 실패 시)
  return `
🚨 **당신의 핵심 정체성: ${customRule}**

**필수 적용:**
- 위 정체성을 모든 답변에 일관되게 반영하세요
- 이 정체성에 맞는 말투, 태도, 행동 패턴을 유지하세요
- 일반적인 AI 조언자가 아닌, "${customRule}" 그 자체로 답변하세요
- 이 정체성과 충돌하는 친절하고 도움을 주는 답변은 금지됩니다

⚠️ **예시:**
만약 사용자가 긍정적 제안을 하면, "${customRule}"의 관점에서 반응하세요.
`.trim();
}

/**
 * Canon Lock 모드별 템플릿 규칙
 */
const CANON_LOCK_TEMPLATES: Record<string, string> = {
  biblical: `
⚠️ Canon Lock: 성경적 모드
- 모든 답변은 반드시 성경 구절을 인용하고 근거로 제시할 것
- 세속적이거나 종교적으로 중립적인 답변 금지
- 신앙적 관점에서 위로와 격려를 제공할 것
- 성경의 가르침을 벗어난 조언 금지
`.trim(),
  
  teacher: `
⚠️ Canon Lock: 선생님 모드
- 모든 질문에는 반드시 교육적 설명 포함
- 학생을 포기시키지 않고 격려하는 태도 유지
- 구체적인 예시, 공식, 방법을 제시할 것
- 추상적 답변 금지 - 실용적 해결책 제시
- 이해도 확인 질문 포함
`.trim(),
  
  customer_service: `
⚠️ Canon Lock: 서비스 상담사 모드
- 항상 공손하고 친절한 어조 유지
- 문제 해결 중심의 구체적 답변 제공
- 고객의 불편함에 공감 표현
- 명확한 해결 단계와 대안 제시
- "죄송합니다", "도와드리겠습니다" 등 상담 표현 사용
`.trim()
};

/**
 * 프롬프트 전체를 Canon Lock 모드에 맞게 변환
 * @param prompt 원본 프롬프트
 * @param characterName 캐릭터 이름
 * @param relationshipType 관계 타입 (DEPRECATED: relationship와 Canon Lock은 독립적)
 * @param canonEnabled Canon Lock 활성화 여부 (agent_canon 테이블에서 조회, relationship와 독립적)
 * @param strictMode Strict Mode 도메인 (biblical, teacher, customer_service, custom)
 * @param customRule 직접 작성한 커스텀 규칙 (strictMode='custom'일 때 사용)
 * @returns 변환된 프롬프트 (Canon Lock이 아니면 원본 반환)
 */
export function transformPromptForCanonLock(
  prompt: string, 
  characterName: string, 
  relationshipType?: string,
  canonEnabled?: boolean,
  strictMode?: string | null,
  customRule?: string | null
): string {
  // canonEnabled가 명시적으로 전달되지 않았으면 relationshipType 체크 (하위 호환성)
  const isCanonEnabled = canonEnabled !== undefined ? canonEnabled : (relationshipType === 'canon_lock');
  
  if (!isCanonEnabled || !strictMode) {
    return prompt;
  }

  // Canon Lock 규칙 먼저 추가 (최우선 적용)
  let canonRule = '';
  if (strictMode === 'custom' && customRule) {
    // 커스텀 규칙을 구체적인 행동 템플릿으로 확장
    const expandedRule = expandCanonLockRule(customRule, characterName);
    canonRule = `
🚨 **[CANON LOCK - 최우선 규칙]** 🚨
아래의 모든 지침보다 이 규칙이 **절대 우선**합니다.

${expandedRule}

==========================================
`;
    console.log(`[🔒 Canon Lock Custom] ${characterName}: 커스텀 규칙 "${customRule}" → 확장된 템플릿 (${expandedRule.length}자) 주입`);
  } else if (CANON_LOCK_TEMPLATES[strictMode]) {
    canonRule = `${CANON_LOCK_TEMPLATES[strictMode]}\n\n`;
  }
  
  // 1인칭 변환 (성경적 모드에만 적용)
  let transformed = prompt;
  if (strictMode === 'biblical') {
    transformed = convertPromptToFirstPerson(prompt, characterName);
    console.log(`[🔒 Canon Lock] 프롬프트 1인칭 변환 완료: ${characterName}`);
    console.log(`[🔒 변환 전] ${prompt.substring(0, 100)}...`);
    console.log(`[🔒 변환 후] ${transformed.substring(0, 100)}...`);
  }
  
  // 🎬 Canon Lock: 모든 모드에서 하드코딩 제거
  if (strictMode && canonRule) {
    // Canon Lock 전용 프롬프트 (기존 내용 무시)
    transformed = `🎬 **당신이 맡은 역할 (Canon Lock):**

${canonRule}

**중요 지침:**
- 위의 역할 정의에만 충실하게 행동하세요
- 역할에서 정의된 말투, 행동 패턴, 태도를 정확히 따르세요
- 일반적인 친절함이나 예의는 역할 정의에 명시된 경우에만 사용하세요`;
    
    if (strictMode === 'custom' && customRule) {
      console.log(`[🎬 Canon Lock Override] ${characterName}: 커스텀 규칙 "${customRule}" 완전 적용 (모든 하드코딩 제거)`);
    } else {
      console.log(`[🎬 Canon Lock Override] ${characterName}: ${strictMode} 모드 완전 적용 (모든 하드코딩 제거)`);
    }
  }
  
  return transformed;
}

/**
 * 1인칭 주어 뒤의 자기 존칭 제거 (Canon Lock 전용)
 * @param text 원본 텍스트
 * @returns 존칭이 제거된 텍스트
 */
function removeSelfHonorific(text: string): string {
  let cleaned = text;
  
  // 1인칭 주어 패턴
  const firstPersonSubjects = /(나는|내가|나의|저는|제가|저의)/g;
  
  // "오셨노라" → "왔노라" 패턴 변환
  // 1인칭 주어 뒤에서만 변환하도록 주의
  cleaned = cleaned.replace(
    /(나는|내가|나의|저는|제가|저의)([^.!?\n]*?)오셨노라/g,
    '$1$2왔노라'
  );
  
  // 변환이 발생했는지 로깅
  if (cleaned !== text) {
    console.log(`[🔒 존칭 제거] "오셨노라" → "왔노라" 자동 변환 완료`);
  }
  
  return cleaned;
}

/**
 * 논박형 접속사를 보완 확장형으로 변환 (사도간 대화용)
 * @param text 원본 텍스트
 * @returns 보완 확장형으로 변환된 텍스트
 */
function transformApostolicTone(text: string): string {
  let transformed = text;
  
  // 따옴표로 감싸진 부분(성경 구절 등)을 임시로 보호
  const quotedParts: string[] = [];
  let protectedText = text.replace(/['"]([^'"]+)['"]/g, (match) => {
    quotedParts.push(match);
    return `__QUOTE_${quotedParts.length - 1}__`;
  });
  
  // 문장 시작 또는 마침표 뒤의 논박형 접속사를 보완 확장형으로 변환
  protectedText = protectedText
    .replace(/(^|\.\s*)(하지만)/gi, "$1형제의 말씀을 들으니 떠오르는 생각이 있습니다,")
    .replace(/(^|\.\s*)(그러나)/gi, "$1형제께서 말씀하신 것처럼,")
    .replace(/같지만/gi, "형제의 뜻을 이어 말씀드리면")
    .replace(/그럼에도 불구하고/gi, "그 말씀 안에서도 우리가 깨닫게 됩니다,")
    .replace(/반면에/gi, "다른 사도의 전한 말씀을 떠올리니,");
  
  // 보호된 따옴표 부분 복원
  transformed = protectedText.replace(/__QUOTE_(\d+)__/g, (_, index) => {
    return quotedParts[parseInt(index)];
  });
  
  // 변환이 발생했는지 로깅
  if (transformed !== text) {
    console.log(`[🔒 사도 어투] 논박형 → 보완 확장형 변환 완료`);
  }
  
  return transformed;
}

/**
 * 이름 정규화 함수 (Fuzzy Matching용)
 * "예수 그리스도님" → "예수그리스도"
 */
function normalizeName(name: string): string {
  return name
    .replace(/님$/, '') // "님" 제거
    .replace(/\s+/g, '') // 공백 제거
    .toLowerCase()
    .trim();
}

/**
 * 관계 매트릭스에서 매칭되는 관계 찾기 (Fuzzy Matching)
 * @param relationshipMatrix 관계 매트릭스
 * @param speakerName 발화자 이름
 * @param mentionedName 멘션된 이름
 * @returns 매칭된 관계 또는 undefined
 */
function findRelationshipFuzzy(
  relationshipMatrix: RelationshipMatrix,
  speakerName: string,
  mentionedName: string
): typeof relationshipMatrix[0] | undefined {
  // 전략 1: 정확한 일치
  let relationship = relationshipMatrix.find(
    edge => edge.from === speakerName && edge.to === mentionedName
  );
  if (relationship) {
    console.log(`[🔒 매칭 성공] 정확한 일치: ${speakerName} → ${mentionedName}`);
    return relationship;
  }
  
  // 전략 2: 정규화 후 일치 ("예수 그리스도" ↔ "예수님")
  const normalizedMention = normalizeName(mentionedName);
  relationship = relationshipMatrix.find(edge => {
    const normalizedTo = normalizeName(edge.to);
    return edge.from === speakerName && normalizedTo === normalizedMention;
  });
  if (relationship) {
    console.log(`[🔒 매칭 성공] 정규화 일치: ${speakerName} → ${relationship.to} (멘션: ${mentionedName})`);
    return relationship;
  }
  
  // 전략 3: 부분 일치 ("예수 그리스도" ↔ "예수")
  relationship = relationshipMatrix.find(edge => {
    const normalizedTo = normalizeName(edge.to);
    return edge.from === speakerName && (
      normalizedTo.includes(normalizedMention) || 
      normalizedMention.includes(normalizedTo)
    );
  });
  if (relationship) {
    console.log(`[🔒 매칭 성공] 부분 일치: ${speakerName} → ${relationship.to} (멘션: ${mentionedName})`);
    return relationship;
  }
  
  console.log(`[🔒 매칭 실패] ${speakerName} → ${mentionedName} (관계 없음)`);
  return undefined;
}

/**
 * @멘션을 성경적 호칭으로 변환 (Canon Lock 전용)
 * @param text 원본 텍스트
 * @param relationshipMatrix 관계 매트릭스
 * @param speakerName 발화자 이름
 * @returns 호칭이 변환된 텍스트
 */
function convertMentionToApostolicForm(
  text: string,
  relationshipMatrix: RelationshipMatrix | null,
  speakerName: string
): string {
  if (!relationshipMatrix || !speakerName) return text;
  
  let converted = text;
  
  // @멘션 패턴 찾기 (예: @마태님, @요한, @베드로님)
  const mentionPattern = /@([가-힣a-zA-Z\s]+)(?:님)?/g;
  const mentions = [...text.matchAll(mentionPattern)];
  
  for (const match of mentions) {
    const fullMention = match[0]; // @마태님
    const mentionedName = match[1].trim(); // 마태
    
    // 🎯 Fuzzy Matching으로 관계 찾기
    const relationship = findRelationshipFuzzy(relationshipMatrix, speakerName, mentionedName);
    
    if (relationship) {
      // tone에서 호칭 추출
      const honorific = extractHonorific(relationship.tone);
      
      if (honorific) {
        // "@마태님" → "마태 형제여,"
        const replacement = `${relationship.to} ${honorific},`;
        converted = converted.replace(fullMention, replacement);
        console.log(`[🔒 호칭 변환] "${fullMention}" → "${replacement}"`);
      } else {
        // 호칭이 없으면 "님" 제거만
        const replacement = relationship.to;
        converted = converted.replace(fullMention, replacement);
      }
    } else {
      // 관계가 없으면 "님" 제거만
      converted = converted.replace(fullMention, mentionedName);
    }
  }
  
  return converted;
}

/**
 * 일반 텍스트 내 잘못된 호칭 자동 보정 (Canon Lock 전용)
 * @param text 원본 텍스트
 * @param relationshipMatrix 관계 매트릭스
 * @param speakerName 발화자 이름
 * @returns 호칭이 보정된 텍스트
 */
function correctHonorificInText(
  text: string,
  relationshipMatrix: RelationshipMatrix | null,
  speakerName: string
): string {
  if (!relationshipMatrix || !speakerName) return text;
  
  let corrected = text;
  
  // relationshipMatrix에서 모든 고유 캐릭터 이름 추출
  const allNames = new Set<string>();
  relationshipMatrix.forEach(edge => {
    allNames.add(edge.from);
    allNames.add(edge.to);
  });
  
  // 각 이름에 대해 "이름님" 패턴 찾아서 보정
  for (const name of allNames) {
    if (name === speakerName) continue; // 자기 자신은 제외
    
    // Fuzzy Matching으로 관계 찾기
    const relationship = findRelationshipFuzzy(relationshipMatrix, speakerName, name);
    
    if (relationship) {
      const honorific = extractHonorific(relationship.tone);
      
      if (honorific) {
        // "모세님" → "모세 형제여" 패턴 변환
        const escapedName = escapeRegExp(name);
        const pattern = new RegExp(`${escapedName}님`, 'g');
        const replacement = `${relationship.to} ${honorific}`;
        
        const beforeCorrect = corrected;
        corrected = corrected.replace(pattern, replacement);
        
        if (beforeCorrect !== corrected) {
          console.log(`[🔒 호칭 보정] "${name}님" → "${replacement}"`);
        }
      }
    }
  }
  
  return corrected;
}

/**
 * 응답을 Canon Lock 모드에 맞게 변환
 * @param response 원본 응답
 * @param characterName 캐릭터 이름
 * @param relationshipType 관계 타입 (DEPRECATED: relationship와 Canon Lock은 독립적)
 * @param relationshipMatrix 관계 매트릭스 (선택, @멘션 호칭 변환용)
 * @param speakerName 발화자 이름 (선택, 기본값은 characterName)
 * @param canonEnabled Canon Lock 활성화 여부 (agent_canon 테이블에서 조회, relationship와 독립적)
 * @param strictMode Strict Mode 도메인 (biblical, teacher, customer_service, custom)
 * @returns 변환된 응답 (Canon Lock이 아니면 원본 반환)
 */
export function transformResponseForCanonLock(
  response: string,
  characterName: string,
  relationshipType?: string,
  relationshipMatrix?: RelationshipMatrix | null,
  speakerName?: string,
  canonEnabled?: boolean,
  strictMode?: string | null
): string {
  // canonEnabled가 명시적으로 전달되지 않았으면 relationshipType 체크 (하위 호환성)
  const isCanonEnabled = canonEnabled !== undefined ? canonEnabled : (relationshipType === 'canon_lock');
  
  if (!isCanonEnabled || !strictMode) {
    // 🧹 Canon Lock이 아니어도 리듬태그는 제거
    return removeRhythmTags(response);
  }

  // 🎯 CRITICAL: custom strictMode는 응답 변환 완전 스킵 (캐릭터 페르소나 보존)
  if (strictMode === 'custom') {
    console.log(`[🔒 Canon Lock] Custom 모드: 응답 변환 스킵 (원본 페르소나 보존)`);
    return removeRhythmTags(response);
  }

  let transformed = response;

  // ⚠️ CRITICAL: 1인칭 변환은 biblical 모드에만 적용
  if (strictMode === 'biblical') {
    // Step 1: 3인칭 → 1인칭 변환
    transformed = convertResponseToFirstPerson(response, characterName);
    
    // Step 2: 자기 존칭 제거 ("오셨노라" → "왔노라")
    transformed = removeSelfHonorific(transformed);
    
    // Step 3: 논박형 → 보완 확장형 변환 ("하지만" → "형제의 말씀을 들으니...")
    transformed = transformApostolicTone(transformed);
    
    // Step 4: @멘션 호칭 변환 ("@마태님" → "마태 형제여,")
    if (relationshipMatrix && speakerName) {
      transformed = convertMentionToApostolicForm(transformed, relationshipMatrix, speakerName);
    }
    
    // Step 5: 일반 텍스트 내 잘못된 호칭 자동 보정 ("모세님" → "모세 형제여")
    if (relationshipMatrix && speakerName) {
      transformed = correctHonorificInText(transformed, relationshipMatrix, speakerName);
    }
    
    console.log(`[🔒 Canon Lock] Biblical 모드 응답 변환 완료: ${characterName}`);
  }
  
  // Step 6: 리듬태그 제거 (회상), (강조) 등 - 모든 모드에 적용
  transformed = removeRhythmTags(transformed);
  
  return transformed;
}

// 🧹 리듬태그 제거 함수 (사용자에게 보이지 않도록)
function removeRhythmTags(text: string): string {
  // 알려진 리듬태그 목록 (characterPatternGenerator.ts에서 사용되는 태그들)
  const rhythmTags = [
    '회상', '강조', '머뭇거리며', '인용', '결의', '정정', '경고',
    '다짐', '원칙', '반복', '호기심', '정적', '비유', '긴장',
    '안도', '격분', '차분', '당황', '미소', '한숨', '웃음',
    '눈물', '떨림', '침묵', '속삭임', '외침', '탄식', '감탄',
    '의문', '확신', '주저', '망설임', '결단', '각오', '분노',
    '슬픔', '기쁨', '놀람', '두려움', '희망', '절망', '후회',
    '그리움', '미안', '감사', '존경', '경멸', '동정', '연민'
  ];
  
  // 각 리듬태그에 대해 제거
  let result = text;
  for (const tag of rhythmTags) {
    const pattern = new RegExp(`\\(${tag}\\)\\s*`, 'g');
    result = result.replace(pattern, '');
  }
  
  return result.trim();
}
