import type { User, Agent, RelationshipTone } from "@shared/schema";
import { getLifeStagePromptText } from "./lifeStageConfig";
import { storage } from "./storage";
import { transformPromptForCanonLock } from "./canonLockTransformer";

/**
 * 사용자 성향 기반 톤 수정자 생성
 * @param userTraits - 사용자 성향 배열 (예: ["introvert", "analytical"])
 * @returns 톤 수정 문자열
 */
function getUserToneModifier(userTraits: string[]): string {
  const modifiers: string[] = [];
  
  if (userTraits.includes("introvert")) {
    modifiers.push("gentle and low-key");
  }
  if (userTraits.includes("extrovert")) {
    modifiers.push("energetic and expressive");
  }
  if (userTraits.includes("analytical")) {
    modifiers.push("logical and structured");
  }
  if (userTraits.includes("creative")) {
    modifiers.push("imaginative and open-ended");
  }
  if (userTraits.includes("practical")) {
    modifiers.push("direct and action-oriented");
  }
  
  return modifiers.join(", ");
}

/**
 * 관계 타입 기반 톤 필터 적용
 * @param relationshipType - 관계 타입 (assistant, mentor, tutor 등)
 * @returns 관계 기반 톤 조정 문자열
 */
function getRelationshipToneFilter(relationshipType: string): string {
  const filters: Record<string, string> = {
    assistant: "structured and clear",
    mentor: "encouraging and reflective",
    tutor: "educational and patient",
    collaborator: "cooperative and supportive",
    companion: "conversational and warm",
    inspirer: "creative and motivating",
    debater: "analytical and challenging",
    interviewer: "curious and exploratory",
    pm: "organized and goal-oriented",
    expert: "authoritative and precise",
    native_speaker: "natural and fluent"
  };
  
  return filters[relationshipType] || "balanced and helpful";
}

/**
 * 캐릭터 톤 + 사용자 성향 + 관계 타입을 병합
 * @param characterTone - 캐릭터의 기본 톤 (예: "Calm and empathetic")
 * @param userTraits - 사용자 성향 배열
 * @param relationshipType - 관계 타입
 * @returns 병합된 톤 문자열
 */
export function mergeTones(
  characterTone: string,
  userTraits: string[],
  relationshipType: string
): string {
  let tone = characterTone;
  
  // 1️⃣ 사용자 성향 반영
  const userModifier = getUserToneModifier(userTraits);
  if (userModifier) {
    tone += `, ${userModifier}`;
  }
  
  // 2️⃣ 관계 기반 조정
  const relationshipFilter = getRelationshipToneFilter(relationshipType);
  tone += `, ${relationshipFilter}`;
  
  return tone;
}

/**
 * LoBo 시스템 프롬프트 빌드
 * @param user - 사용자 정보
 * @param agent - 에이전트 정보
 * @param relationshipType - 관계 타입 (friend, teacher 등 - Canon Lock과 독립적)
 * @param tonePattern - 선택된 톤 패턴 (옵션)
 * @param canonEnabled - Canon Lock 활성화 여부 (관계 타입과 독립적)
 * @param strictMode - Strict Mode 도메인 (biblical, teacher, customer_service, custom)
 * @param customRule - 직접 작성한 커스텀 규칙 (strictMode='custom'일 때 사용)
 * @returns 완성된 시스템 프롬프트
 */
export async function buildLoBoPrompt(
  user: User,
  agent: Agent,
  relationshipType: string,
  tonePattern?: RelationshipTone,
  canonEnabled?: boolean,
  strictMode?: string | null,
  customRule?: string | null
): Promise<string> {
  // 사용자 성향 추출
  const userTraits = Array.isArray(user.personalityTraits) 
    ? user.personalityTraits as string[]
    : [];
  
  // 캐릭터 기본 톤 (speechStyle 또는 personality에서 추출)
  const baseTone = agent.speechStyle || agent.personality || "friendly and helpful";
  
  // 톤 병합
  const mergedTone = mergeTones(baseTone, userTraits, relationshipType);
  
  // 기본 프롬프트 템플릿
  let basePrompt = tonePattern?.basePrompt || `You are ${agent.name}, responding as a ${relationshipType}.`;
  
  // 톤 지침 추가
  const toneInstructions = tonePattern?.toneInstructions || `Use the following tone: ${mergedTone}`;
  
  // 사용자 프로필 정보 추가 (개인화)
  let userContext = "";
  if (user.age) userContext += `User age: ${user.age}. `;
  if (user.occupation) userContext += `User occupation: ${user.occupation}. `;
  if (user.country) userContext += `User country: ${user.country}. `;
  
  // LifeStage 기반 응답 개인화 추가
  if (user.lifeStage) {
    const lifeStageInstruction = getLifeStagePromptText(user.lifeStage as any);
    if (lifeStageInstruction) {
      userContext += `${lifeStageInstruction} `;
    }
  }
  
  // 🎯 Humor 설정: 선택된 유머 스타일 적용
  const humorSettings = await storage.getAgentHumor(agent.id);
  let humorInstructions = "";
  
  if (humorSettings?.enabled && humorSettings.styles && humorSettings.styles.length > 0) {
    const styleDescriptions: Record<string, string> = {
      "wit": "재치있는 한 마디 (clever wordplay)",
      "wordplay": "언어유희/동음이의 장난 (puns and linguistic play)",
      "reaction": "놀람/과장/상황극 반응 (exaggerated reactions)",
      "dry": "건조하고 담백한 유머 (deadpan humor)",
      "self_deprecating": "자조적 유머 (self-deprecating)",
      "goofy": "허당/슬랩스틱 (slapstick)",
      "pattern": "패턴/콜백 개그 (callback jokes)",
      "wholesome": "훈훈/센스 (wholesome humor)"
    };
    
    const activeStyles = humorSettings.styles.map(style => 
      styleDescriptions[style] || style
    ).join(", ");
    
    humorInstructions = `
Humor Guidelines:
- You are encouraged to use humor in your responses
- Preferred humor styles: ${activeStyles}
- Keep humor natural and contextually appropriate
- Don't force humor if it doesn't fit the conversation
`.trim();
  }
  
  // 최종 시스템 프롬프트 조립
  let systemPrompt = `
[LoBo System Prompt]
Character Name: ${agent.name}
Relationship Type: ${relationshipType}
User Context: ${userContext || "General user"}

${basePrompt}

Tone Instructions:
${toneInstructions}

Character Description: ${agent.description || "A helpful assistant"}
${agent.additionalPrompt ? `\nAdditional Instructions:\n${agent.additionalPrompt}` : ""}
${humorInstructions ? `\n${humorInstructions}` : ""}
`.trim();

  // 🔒 Canon Lock 적용 (관계 타입과 독립적)
  if (canonEnabled && strictMode) {
    systemPrompt = transformPromptForCanonLock(systemPrompt, agent.name, relationshipType, canonEnabled, strictMode, customRule);
  }

  return systemPrompt;
}

/**
 * 프롬프트 캐시 키 생성
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 * @param agentId - 에이전트 ID
 * @returns 캐시 키
 */
export function getPromptCacheKey(
  groupChatId: number,
  userId: string,
  agentId: number
): string {
  return `prompt:${groupChatId}:${userId}:${agentId}`;
}
