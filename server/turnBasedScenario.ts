/**
 * Turn-Based Scenario Generation System
 * 각 챗봇이 이전 발언자를 인식하고 순차적으로 반응하는 시스템
 * 관계 기반 가중치와 확률적 선택을 통해 획일성 방지
 */

import OpenAI from 'openai';
import type { Agent } from './chatbotRouter';
import type { RelationshipMatrix } from '@shared/schema';
import { generateLanguageLevelPrompt } from './openai';
import { storage } from './storage';
import {
  type ReactionCategory,
  type DetailedReaction,
  type LegacyReactionType,
  META_PROMPT,
  REACTION_GUIDELINES,
  mapToLegacyReaction,
  getCanonLockGuideline,
  buildReactionGuideline
} from './reactionGuidelines';

export interface TurnContext {
  prevSpeaker: string | null;        // 이전 발언자 이름
  prevMessage: string | null;        // 이전 발언 내용
  currentAgentName: string;          // 현재 캐릭터 이름
  currentAgent: Agent;               // 현재 캐릭터 전체 정보
  topicContext: string;              // 전체 대화 주제
  conversationHistory: string;       // 지금까지의 대화 내용
  relationshipMatrix?: RelationshipMatrix; // 관계 매트릭스
  relationshipToUser?: string;       // 사용자와의 관계 타입
  languageLevel?: number | null;     // 언어 레벨
  canonEnabled?: boolean;            // Canon Lock 활성화 여부
  strictMode?: string | null;        // Canon Lock strictMode (biblical, teacher, custom 등)
}

export interface TurnResponse {
  agentId: number;
  agentName: string;
  content: string;
  reactionType: DetailedReaction;
  reactionCategory: ReactionCategory;
  legacyReactionType: LegacyReactionType; // 기존 시스템 호환용
  emotionalTone?: string; // 선택적 감정 톤 (한국어 12가지)
  avatarEmotion?: 'happy' | 'angry' | 'sad' | 'neutral'; // 🎭 아바타 감정 (4가지)
}

/**
 * 🎯 반응 유형 모델
 */
const REACTION_MODEL: Record<ReactionCategory, DetailedReaction[]> = {
  cognitive: ['quote', 'refute', 'deflect'],
  cooperative: ['explore_together', 'complement', 'augment'],
  relational: ['affinity', 'challenge', 'independent'],
  meta: ['self_narrative']
};

/**
 * 🎯 사용자 관계 기반 가중치
 */
const USER_RELATION_WEIGHTS: Record<string, Record<ReactionCategory, number>> = {
  friendly: { cooperative: 0.5, relational: 0.3, cognitive: 0.1, meta: 0.1 },
  companion: { cooperative: 0.5, relational: 0.3, cognitive: 0.1, meta: 0.1 },
  mentor: { cooperative: 0.4, cognitive: 0.3, relational: 0.2, meta: 0.1 },
  rival: { cognitive: 0.4, relational: 0.4, cooperative: 0.1, meta: 0.1 },
  debater: { cognitive: 0.4, relational: 0.3, cooperative: 0.2, meta: 0.1 },
  neutral: { cognitive: 0.3, cooperative: 0.3, relational: 0.2, meta: 0.2 },
  assistant: { cooperative: 0.4, cognitive: 0.3, relational: 0.2, meta: 0.1 },
  default: { cognitive: 0.3, cooperative: 0.3, relational: 0.2, meta: 0.2 }
};

/**
 * 🎯 예수님 캐릭터 전용 가중치
 * - 비유와 이야기 중심 (meta 40%)
 * - 함께 탐색하는 방식 (cooperative 35%)
 * - 따뜻한 공감과 관계 (relational 20%)
 * - 논리적 반박보다 질문으로 생각 유도 (cognitive 5%)
 */
const JESUS_RELATION_WEIGHTS: Record<string, Record<ReactionCategory, number>> = {
  casual: { meta: 0.4, cooperative: 0.35, relational: 0.2, cognitive: 0.05 }, // 일상 대화
  theological: { meta: 0.5, cooperative: 0.3, relational: 0.15, cognitive: 0.05 } // 신학적 질문
};

/**
 * 🎯 신학적 질문 키워드
 */
const THEOLOGICAL_KEYWORDS = [
  '하나님', '성경', '신', '구원', '믿음', '기도', '죄', '천국', '지옥', '영혼',
  '교회', '십자가', '부활', '성령', '예배', '율법', '복음', '은혜', '사랑',
  '회개', '용서', '계명', '성경적', '신학', '교리', '말씀',
  'God', 'Bible', 'faith', 'prayer', 'sin', 'heaven', 'hell', 'soul',
  'church', 'cross', 'resurrection', 'Holy Spirit', 'worship', 'gospel', 'grace',
  'forgiveness', 'commandment', 'biblical', 'theology', 'doctrine', 'scripture'
];

/**
 * 🎯 감정 톤 옵션
 */
const EMOTIONAL_TONES = [
  '호기심', '열정', '차분함', '우려', '기쁨', '놀람', 
  '사려깊음', '확신', '의문', '공감', '흥분', '신중함'
];

/**
 * 🎭 아바타 감정 타입 (멀티모달 아바타용)
 */
export type AvatarEmotionType = 'happy' | 'angry' | 'sad' | 'neutral';

/**
 * 🎭 emotionalTone → avatarEmotion 매핑
 * 12가지 한국어 감정 톤을 4가지 아바타 감정으로 변환
 */
const EMOTION_TO_AVATAR_MAP: Record<string, AvatarEmotionType> = {
  // 긍정적/행복 감정 → happy
  '기쁨': 'happy',
  '흥분': 'happy',
  '열정': 'happy',
  '놀람': 'happy',
  
  // 부정적/분노 감정 → angry  
  '우려': 'angry',
  '확신': 'angry', // 강한 주장, 반박시 분노와 연결
  
  // 슬픈/걱정 감정 → sad
  '공감': 'sad', // 슬픔에 공감
  '의문': 'sad', // 혼란, 걱정
  
  // 중립적/차분 감정 → neutral
  '호기심': 'neutral',
  '차분함': 'neutral',
  '사려깊음': 'neutral',
  '신중함': 'neutral'
};

/**
 * 🎭 emotionalTone을 아바타 감정으로 변환
 */
export function mapEmotionalToneToAvatarEmotion(emotionalTone: string): AvatarEmotionType {
  return EMOTION_TO_AVATAR_MAP[emotionalTone] || 'neutral';
}

/**
 * 🎯 가중치 기반 랜덤 선택
 */
function weightedRandom<T extends string>(weights: Record<T, number>): T {
  const total = Object.values(weights).reduce((sum: number, w) => sum + (w as number), 0);
  let random = Math.random() * total;
  
  for (const [key, weight] of Object.entries(weights)) {
    random -= weight as number;
    if (random <= 0) {
      return key as T;
    }
  }
  
  // 폴백
  return Object.keys(weights)[0] as T;
}

/**
 * 🎯 배열에서 랜덤 선택
 */
function randomPick<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * 🎯 예수님 캐릭터 감지
 */
function isJesusCharacter(agentName: string): boolean {
  const jesusNames = ['예수', 'Jesus', 'jesus', '예수님', '그리스도', 'Christ'];
  return jesusNames.some(name => agentName.includes(name));
}

/**
 * 🎯 질문 유형 분석 (신학적 vs 일상적)
 */
function analyzeQuestionType(question: string): 'theological' | 'casual' {
  const lowerQuestion = question.toLowerCase();
  
  // 신학적 키워드가 있는지 확인
  const hasTheologicalKeyword = THEOLOGICAL_KEYWORDS.some(keyword => 
    lowerQuestion.includes(keyword.toLowerCase())
  );
  
  return hasTheologicalKeyword ? 'theological' : 'casual';
}


/**
 * 🎯 관계 기반 반응 유형 선택 (Canon Lock은 relationship과 독립적)
 * @param relationshipToUser 사용자와의 관계 타입
 * @param agentName 에이전트 이름
 * @param question 질문 내용
 * @param canonEnabled Canon Lock 활성화 여부 (agent_canon 테이블에서 조회, relationship과 독립적)
 */
function selectReactionType(
  relationshipToUser?: string,
  agentName?: string,
  question?: string
): { 
  category: ReactionCategory; 
  reaction: DetailedReaction;
  emotionalTone: string;
} {
  // 예수님 캐릭터 특별 처리
  if (agentName && isJesusCharacter(agentName)) {
    const questionType = question ? analyzeQuestionType(question) : 'casual';
    
    // 신학적 질문일 경우 meta/self_narrative 우선
    if (questionType === 'theological') {
      const emotionalTone = randomPick(EMOTIONAL_TONES);
      console.log(`[✝️ 예수님 신학 모드] 신학적 질문, 감정: ${emotionalTone}`);
      
      return {
        category: 'meta',
        reaction: 'self_narrative',
        emotionalTone
      };
    }
    
    // 일상 질문일 경우 예수님 전용 가중치 사용
    const weights = JESUS_RELATION_WEIGHTS.casual;
    const category = weightedRandom(weights);
    const reaction = randomPick(REACTION_MODEL[category]);
    const emotionalTone = randomPick(EMOTIONAL_TONES);
    
    console.log(`[✝️ 예수님 일상 모드] 카테고리: ${category} → 반응: ${reaction} → 감정: ${emotionalTone}`);
    
    return { category, reaction, emotionalTone };
  }
  
  // 일반 캐릭터는 관계 타입에 따른 가중치 사용
  const weights = USER_RELATION_WEIGHTS[relationshipToUser || 'default'] || USER_RELATION_WEIGHTS.default;
  
  // 1단계: 카테고리 선택 (가중치 기반)
  const category = weightedRandom(weights);
  
  // 2단계: 세부 반응 선택 (랜덤)
  const reaction = randomPick(REACTION_MODEL[category]);
  
  // 3단계: 감정 톤 선택 (랜덤)
  const emotionalTone = randomPick(EMOTIONAL_TONES);
  
  console.log(`[🎯 반응 선택] 관계: ${relationshipToUser || 'default'} → 카테고리: ${category} → 반응: ${reaction} → 감정: ${emotionalTone}`);
  
  return { category, reaction, emotionalTone };
}



/**
 * 🎯 턴별 프롬프트 생성 (관계 기반 가중치 시스템 통합, Canon Lock 지원)
 */
export function createTurnPrompt(
  context: TurnContext, 
  selectedReaction: DetailedReaction,
  reactionCategory: ReactionCategory,
  emotionalTone: string
): { system: string; user: string } {
  const {
    prevSpeaker,
    prevMessage,
    currentAgentName,
    currentAgent,
    topicContext,
    conversationHistory,
    relationshipMatrix,
    relationshipToUser,
    languageLevel,
    canonEnabled,
    strictMode
  } = context;

  // 언어 레벨 제약사항
  const languageConstraint = languageLevel !== null && languageLevel !== undefined
    ? generateLanguageLevelPrompt(languageLevel)
    : '';

  // 관계 정보 추출
  let relationshipInfo = '';
  if (relationshipMatrix && prevSpeaker) {
    const relationship = relationshipMatrix.find(
      r => r.from === currentAgentName && r.to === prevSpeaker
    );
    if (relationship) {
      relationshipInfo = `
**캐릭터 간 관계:**
- ${currentAgentName}이(가) ${prevSpeaker}을(를) 대하는 태도: ${relationship.relation}
- 말투/호칭 규칙: ${relationship.tone}
`;
    }
  }

  // 사용자와의 관계
  const userRelationship = relationshipToUser ? `
**사용자와의 관계:** ${relationshipToUser}
- 이 관계는 당신의 반응 스타일에 영향을 줍니다
` : '';

  // 캐릭터 프로필
  const characterProfile = `
**캐릭터: ${currentAgentName}**
- 성격: ${currentAgent.personality || '균형잡힌 성격'}
- 말투: ${currentAgent.speechStyle || '자연스럽고 친근한 말투'}
- 전문성: ${currentAgent.description || '다양한 주제'}
- 분야: ${currentAgent.category || '일반'}
`;

  // 반응 가이드라인 생성 (helper 함수 사용)
  const reactionGuideline = buildReactionGuideline(reactionCategory, selectedReaction, emotionalTone);

  // Canon Lock 모드 특별 지침 (strictMode에 따라 다른 지침 적용)
  const canonLockGuideline = canonEnabled ? getCanonLockGuideline(strictMode) : '';

  // 시스템 프롬프트
  const systemPrompt = `${languageConstraint}

${META_PROMPT}

${characterProfile}

${userRelationship}

${relationshipInfo}

${reactionGuideline}

${canonLockGuideline}

**중요 지침:**
당신은 ${currentAgentName}입니다.
당신과 사용자의 관계는 ${relationshipToUser || '중립적'}입니다.
이전 발언자는 ${prevSpeaker || '없음'}이며, 그의 말은 다음과 같습니다:
"${prevMessage || '(대화 시작)'}"

현재 선택된 반응 유형은 ${selectedReaction}이며,
감정 톤은 ${emotionalTone}입니다.

**${selectedReaction} 방식으로 반응하되:**
1. 캐릭터의 개성과 감정, 관계를 반영하세요
2. 논리적 연결 대신 대화적 리듬과 감정 흐름을 유지하세요
3. 획일적인 패턴("동의합니다", "좋은 지적이네요")을 절대 사용하지 마세요
4. 1-3문장으로 간결하게, 그러나 즉흥적이고 자연스럽게
5. ${emotionalTone} 톤을 미묘하게 반영하세요
${canonEnabled ? '6. Canon Lock 모드: 비유와 이야기로 성경적 진리를 자연스럽게 전달하세요' : ''}

**출력 형식:**
JSON 객체 하나만 반환:
{
  "content": "실제 발언 내용",
  "emotion": "happy | angry | sad | neutral 중 하나 (발언의 감정 상태)"
}

※ emotion은 반드시 다음 4가지 중 하나여야 합니다:
- "happy": 기쁨, 흥분, 열정, 놀람
- "angry": 분노, 짜증, 우려, 강한 확신
- "sad": 슬픔, 공감, 걱정, 의문
- "neutral": 차분함, 사려깊음, 호기심, 신중함
`;

  // 사용자 프롬프트
  const userPrompt = `
**대화 주제:** ${topicContext}

**지금까지의 대화:**
${conversationHistory || '(대화 시작)'}

${prevSpeaker && prevMessage ? `
**이전 발언자:** ${prevSpeaker}
**이전 발언 내용:** "${prevMessage}"

→ 이제 ${currentAgentName}이(가) ${selectedReaction} 방식으로 반응합니다.` : `
**대화 시작:** ${currentAgentName}이(가) ${selectedReaction} 방식으로 첫 발언을 합니다.`}
`;

  return { system: systemPrompt, user: userPrompt };
}

/**
 * 🎯 턴 기반 응답 생성 (확률적 반응 선택 통합, Canon Lock 독립 처리)
 */
export async function generateTurnResponse(
  context: TurnContext,
  openai: OpenAI,
  model: string = 'gpt-4o-mini',
  temperature: number = 1.0
): Promise<TurnResponse> {
  // 🔒 Canon Lock 설정 조회 (relationship과 독립적)
  let canonEnabled = false;
  let strictMode: string | null = null;
  try {
    const canonSettings = await storage.getAgentCanon(context.currentAgent.id);
    strictMode = canonSettings?.strictMode || null;
    
    // 🎯 Canonical modes: biblical/teacher만 Canon Lock으로 인정
    // custom/balanced는 agent_canon.custom_rule을 별도로 사용
    const canonicalModes = ['biblical', 'teacher'];
    canonEnabled = !!strictMode && canonicalModes.includes(strictMode);
    
    console.log(`[🔒 턴 기반 Canon Lock] ${context.currentAgentName}: ${canonEnabled ? '활성화' : '비활성화'} (strictMode: ${strictMode || 'null'})`);
  } catch (error) {
    console.warn(`[🔒 턴 기반 Canon Lock] ${context.currentAgentName}: 설정 조회 실패, 기본값(false) 사용`);
  }
  
  // 1단계: 확률적으로 반응 유형 선택
  const { category, reaction, emotionalTone } = selectReactionType(
    context.relationshipToUser,
    context.currentAgentName,
    context.topicContext
  );
  
  // canonEnabled와 strictMode를 context에 추가
  const contextWithCanon = { ...context, canonEnabled, strictMode };
  
  // 2단계: 선택된 반응에 맞는 프롬프트 생성
  const { system, user } = createTurnPrompt(contextWithCanon, reaction, category, emotionalTone);

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(responseText);

    // 레거시 시스템 호환을 위한 매핑
    const legacyType = mapToLegacyReaction(reaction, category);
    
    // 🎭 아바타 감정 결정: LLM이 반환한 emotion 우선, 없으면 emotionalTone에서 매핑
    const validEmotions = ['happy', 'angry', 'sad', 'neutral'];
    let avatarEmotion: 'happy' | 'angry' | 'sad' | 'neutral';
    
    if (parsed.emotion && validEmotions.includes(parsed.emotion)) {
      avatarEmotion = parsed.emotion;
    } else {
      avatarEmotion = mapEmotionalToneToAvatarEmotion(emotionalTone);
    }
    
    console.log(`[🎭 아바타 감정] ${context.currentAgentName}: emotionalTone=${emotionalTone}, avatarEmotion=${avatarEmotion}`);

    return {
      agentId: context.currentAgent.id,
      agentName: context.currentAgentName,
      content: parsed.content || '(응답 없음)',
      reactionType: reaction,
      reactionCategory: category,
      legacyReactionType: legacyType,
      emotionalTone,
      avatarEmotion
    };
  } catch (error) {
    console.error(`[턴 기반 생성 오류] ${context.currentAgentName}:`, error);
    
    // 폴백 응답
    const { category: fallbackCategory, reaction: fallbackReaction } = selectReactionType(
      context.relationshipToUser,
      context.currentAgentName,
      context.topicContext
    );
    const legacyType = mapToLegacyReaction(fallbackReaction, fallbackCategory);
    
    return {
      agentId: context.currentAgent.id,
      agentName: context.currentAgentName,
      content: context.prevMessage 
        ? `${context.prevSpeaker}님의 말씀에 공감합니다.`
        : `${context.topicContext}에 대해 생각해보겠습니다.`,
      reactionType: fallbackReaction,
      reactionCategory: fallbackCategory,
      legacyReactionType: legacyType,
      emotionalTone: '차분함',
      avatarEmotion: 'neutral' // 폴백 시 기본 감정
    };
  }
}

/**
 * 🎯 전체 시나리오를 턴 기반으로 생성 (관계 기반 가중치 통합)
 */
export async function generateTurnBasedScenario(
  question: string,
  agents: Agent[],
  openai: OpenAI,
  options: {
    relationshipMatrix?: RelationshipMatrix;
    languageLevel?: number | null;
    model?: string;
    temperature?: number;
    relationshipTypeMap?: Map<number, string>; // 사용자-에이전트 관계 맵
  } = {}
): Promise<TurnResponse[]> {
  const responses: TurnResponse[] = [];
  let conversationHistory = '';

  console.log(`[🎭 턴 기반 시나리오] ${agents.length}명의 에이전트로 시작`);

  for (let i = 0; i < agents.length; i++) {
    const currentAgent = agents[i];
    const prevResponse = responses[i - 1];

    // 현재 에이전트의 사용자와의 관계 타입 조회
    const relationshipToUser = options.relationshipTypeMap?.get(currentAgent.id) || 'default';

    const context: TurnContext = {
      prevSpeaker: prevResponse?.agentName || null,
      prevMessage: prevResponse?.content || null,
      currentAgentName: currentAgent.name,
      currentAgent,
      topicContext: question,
      conversationHistory,
      relationshipMatrix: options.relationshipMatrix,
      relationshipToUser, // 사용자와의 관계 정보 전달
      languageLevel: options.languageLevel
    };

    console.log(`[턴 ${i + 1}/${agents.length}] ${currentAgent.name} (관계: ${relationshipToUser}) 생성 중...`);

    const response = await generateTurnResponse(
      context,
      openai,
      options.model || 'gpt-4o-mini',
      options.temperature || 1.0
    );

    responses.push(response);

    // 대화 이력 업데이트
    conversationHistory += `\n${response.agentName}: "${response.content}" [${response.reactionCategory}/${response.reactionType}/${response.emotionalTone}]`;

    console.log(`[✅ 턴 ${i + 1}] ${response.agentName} (${response.reactionCategory}:${response.reactionType}, ${response.emotionalTone}): ${response.content.substring(0, 50)}...`);
  }

  console.log(`[🎉 턴 기반 시나리오 완료] 총 ${responses.length}개 응답 생성`);
  return responses;
}
