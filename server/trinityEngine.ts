/**
 * 🔱 TRINITY ENGINE v1.0
 * 시간 인지 부조화와 페르소나 붕괴를 근본적으로 해결하는 3단계 아키텍처
 * 
 * Phase 1: Time-Anchored Summarizer - 과거 데이터를 현재 시점으로 재해석
 * Phase 2: Dynamic Persona Generator - 상황별 페르소나 카드 동적 생성
 * Phase 3: Script-First Generation - 전체 시나리오를 JSON으로 완결 생성
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 🔒 GEMINI_API_KEY 가드
export function isTrinityAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// 🔧 JSON 파싱 헬퍼 (마크다운 코드 펜스 및 추가 텍스트 처리)
function extractJSON(text: string): string | null {
  // 1. 마크다운 코드 펜스 제거
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  
  // 2. JSON 배열 추출
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  
  // 3. JSON 객체 추출
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  publishedTime?: string;
}

export interface TimeAnchoredSummary {
  systemDate: string;
  currentSituation: string;
  keyConflicts: string[];
  recentDevelopments: string[];
  unknownFactors: string[];
  temporalContext: string;
}

export interface PersonaCard {
  characterId: string;
  name: string;
  icon: string;
  role: 'organization' | 'individual' | 'expert' | 'media' | 'authority';
  currentEmotion: string;
  speechStyle: string;
  constraints: string[];
  minSentences: number;
  samplePhrases: string[];
}

export interface ScenarioTurn {
  turnIndex: number;
  speakerId: string;
  speakerName: string;
  speakerIcon: string;
  content: string;
  action?: string;
  emotion?: string;
  referencedFacts?: string[];
}

export interface TrinityScenario {
  topic: string;
  generatedAt: string;
  summary: TimeAnchoredSummary;
  personas: PersonaCard[];
  turns: ScenarioTurn[];
  aftermath?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 PHASE 1: TIME-ANCHORED SUMMARIZER
// ═══════════════════════════════════════════════════════════════════════════

export async function timeAnchoredSummarize(
  query: string,
  searchResults: SearchResult[],
  systemDate: string = new Date().toISOString().split('T')[0]
): Promise<TimeAnchoredSummary> {
  console.log(`[🔱 Trinity Phase 1] Time-Anchored Summarizer 시작 (${systemDate})`);
  
  const searchContext = searchResults.map((r, i) => 
    `[${i + 1}] ${r.title}\n${r.snippet}\n(출처: ${r.url}, 날짜: ${r.publishedTime || '알 수 없음'})`
  ).join('\n\n');

  const prompt = `당신은 시간적 맥락 분석 전문가입니다.

**오늘 날짜: ${systemDate}**

아래는 "${query}"에 대한 검색 결과입니다. 이 데이터들은 **과거에 작성된 기사**입니다.
당신의 임무는 이 과거 데이터를 바탕으로 **"현재(${systemDate}) 시점의 상황"**을 정확하게 요약하는 것입니다.

===검색 결과===
${searchContext}
================

**중요 규칙:**
1. 과거 사건을 현재 진행형으로 착각하지 마세요
2. "X년 X월에 ~했다"는 과거형으로, "현재는 ~한 상황이다"는 현재형으로 구분하세요
3. 불확실한 미래 예측은 "~할 가능성이 있다", "~로 예상된다"로 표현하세요
4. 공식 발표가 없는 사항은 "확인된 공식 입장 없음"으로 표기하세요

**JSON 형식으로 응답하세요:**
{
  "systemDate": "${systemDate}",
  "currentSituation": "현재 시점(${systemDate})의 전반적인 상황 요약 (3-4문장)",
  "keyConflicts": ["현재 진행 중인 핵심 갈등 1", "핵심 갈등 2"],
  "recentDevelopments": ["최근 확인된 진전 사항 1", "진전 사항 2"],
  "unknownFactors": ["아직 확정되지 않은 사항 1", "불확실한 요소 2"],
  "temporalContext": "시간적 맥락 설명 (예: '2024년 4월 기자회견 이후 1년 7개월이 지난 현재...')"
}`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1500,
      }
    });
    
    const responseText = result.response.text();
    const jsonStr = extractJSON(responseText);
    
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr) as TimeAnchoredSummary;
      console.log(`[🔱 Trinity Phase 1] 시간적 맥락 요약 완료:`, parsed.temporalContext);
      return parsed;
    }
    
    throw new Error('JSON 파싱 실패');
  } catch (error) {
    console.error('[🔱 Trinity Phase 1] 오류:', error);
    return {
      systemDate,
      currentSituation: `${query}에 대한 현재 상황을 분석 중입니다.`,
      keyConflicts: ['정보 부족으로 갈등 요소 파악 불가'],
      recentDevelopments: ['최신 정보 확인 필요'],
      unknownFactors: ['공식 발표 대기 중'],
      temporalContext: `오늘(${systemDate}) 기준으로 확인된 공식 정보가 제한적입니다.`
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 PHASE 2: DYNAMIC PERSONA GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

const ROLE_TEMPLATES: Record<string, Partial<PersonaCard>> = {
  organization: {
    role: 'organization',
    speechStyle: '정중하고 방어적인 공식 어조',
    constraints: [
      '무례한 단답 절대 금지',
      '자사/자기 조직 비하 금지',
      '공식 입장 형식 유지',
      '3문장 이상 발화 필수'
    ],
    minSentences: 3,
    samplePhrases: ['~에 대해 말씀드리겠습니다', '당사의 입장은~', '공식 발표를 통해~']
  },
  individual: {
    role: 'individual',
    speechStyle: '감정적이고 개인적인 호소',
    constraints: [
      '3문장 이상 발화 필수',
      '감정 표현 포함 필수',
      '구체적 근거 제시'
    ],
    minSentences: 3,
    samplePhrases: ['저는~', '제가 직접~', '억울합니다', '이해해주세요']
  },
  expert: {
    role: 'expert',
    speechStyle: '객관적이고 분석적인 전문가 어조',
    constraints: [
      '데이터/근거 인용 필수',
      '감정적 표현 자제',
      '[Analysis] 또는 [속보] 헤더 사용'
    ],
    minSentences: 2,
    samplePhrases: ['분석 결과~', '데이터에 따르면~', '전문가들은~']
  },
  media: {
    role: 'media',
    speechStyle: '중립적이고 정보 전달 중심',
    constraints: [
      '양측 입장 균형 있게 전달',
      '팩트 중심 보도',
      '개인 의견 최소화'
    ],
    minSentences: 2,
    samplePhrases: ['오늘 기준~', '확인된 바에 따르면~', '양측의 입장은~']
  },
  authority: {
    role: 'authority',
    speechStyle: '권위적이고 결정적인 어조',
    constraints: [
      '법적/제도적 근거 명시',
      '중립성 유지',
      '판결/결정 형식 준수'
    ],
    minSentences: 2,
    samplePhrases: ['본 법원은~', '결정을~', '판결을 선고합니다']
  }
};

export async function generateDynamicPersonas(
  summary: TimeAnchoredSummary,
  requestedCharacters: Array<{ name: string; icon: string; role?: string }>
): Promise<PersonaCard[]> {
  console.log(`[🔱 Trinity Phase 2] Dynamic Persona Generator 시작 (${requestedCharacters.length}명)`);
  
  const characterList = requestedCharacters.map(c => `${c.icon} ${c.name} (역할: ${c.role || '미지정'})`).join(', ');
  
  const prompt = `당신은 캐릭터 페르소나 설계 전문가입니다.

**현재 상황 (${summary.systemDate}):**
${summary.currentSituation}

**핵심 갈등:**
${summary.keyConflicts.join('\n')}

**시간적 맥락:**
${summary.temporalContext}

**등장인물:** ${characterList}

각 캐릭터에 대해 **현재 상황에 맞는** 페르소나 카드를 생성하세요.

**중요 규칙:**
1. 기업/정부 캐릭터: 정중하고 방어적 태도, 자기 조직 비하 금지, 3문장 이상
2. 개인/스타 캐릭터: 감정적 호소 허용, 3문장 이상, 구체적 근거 제시
3. 전문가/기자: 객관적 분석, 데이터 인용, [Analysis]/[속보] 헤더 사용
4. 모든 캐릭터: 단답형(1문장) 절대 금지

**JSON 배열로 응답:**
[
  {
    "characterId": "unique_id",
    "name": "캐릭터명",
    "icon": "이모지",
    "role": "organization|individual|expert|media|authority",
    "currentEmotion": "현재 상황에서의 감정 (예: 억울함, 방어적, 분노, 냉정함)",
    "speechStyle": "말투 스타일",
    "constraints": ["금지 사항 1", "금지 사항 2"],
    "minSentences": 3,
    "samplePhrases": ["예시 표현 1", "예시 표현 2"]
  }
]`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2000,
      }
    });
    
    const responseText = result.response.text();
    const jsonStr = extractJSON(responseText);
    
    if (jsonStr) {
      const personas = JSON.parse(jsonStr) as PersonaCard[];
      
      // 템플릿 기반 제약 조건 보강
      const enhancedPersonas = personas.map(p => {
        const template = ROLE_TEMPLATES[p.role] || ROLE_TEMPLATES.individual;
        return {
          ...p,
          constraints: [...new Set([...(p.constraints || []), ...(template.constraints || [])])],
          minSentences: Math.max(p.minSentences || 2, template.minSentences || 2)
        };
      });
      
      console.log(`[🔱 Trinity Phase 2] ${enhancedPersonas.length}개 페르소나 카드 생성 완료`);
      return enhancedPersonas;
    }
    
    throw new Error('JSON 파싱 실패');
  } catch (error) {
    console.error('[🔱 Trinity Phase 2] 오류:', error);
    
    // 폴백: 기본 페르소나 카드 생성
    return requestedCharacters.map((c, i) => {
      const role = c.role as keyof typeof ROLE_TEMPLATES || 'individual';
      const template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.individual;
      return {
        characterId: `char_${i}`,
        name: c.name,
        icon: c.icon,
        role: template.role!,
        currentEmotion: '중립',
        speechStyle: template.speechStyle!,
        constraints: template.constraints!,
        minSentences: template.minSentences!,
        samplePhrases: template.samplePhrases!
      };
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 PHASE 3: SCRIPT-FIRST GENERATION
// ═══════════════════════════════════════════════════════════════════════════

export async function generateCompleteScript(
  query: string,
  summary: TimeAnchoredSummary,
  personas: PersonaCard[],
  targetTurns: number = 8
): Promise<ScenarioTurn[]> {
  console.log(`[🔱 Trinity Phase 3] Script-First Generation 시작 (${targetTurns} 턴)`);
  
  const personaCards = personas.map(p => `
**${p.icon} ${p.name}**
- 역할: ${p.role}
- 현재 감정: ${p.currentEmotion}
- 말투: ${p.speechStyle}
- 금지 사항: ${p.constraints.join(', ')}
- 최소 문장 수: ${p.minSentences}문장
- 예시 표현: ${p.samplePhrases.join(' / ')}`).join('\n');

  const prompt = `당신은 토론 시나리오 작가입니다. 전체 대본을 한 번에 완성하세요.

**사용자 질문:** "${query}"

**현재 상황 (${summary.systemDate}):**
${summary.currentSituation}

**시간적 맥락:**
${summary.temporalContext}

**핵심 갈등:**
${summary.keyConflicts.join('\n')}

**확인되지 않은 사항:**
${summary.unknownFactors.join('\n')}

═══════════════════════════════════════
**등장인물 페르소나 카드:**
${personaCards}
═══════════════════════════════════════

**시나리오 생성 규칙:**

1. **시간 인지 필수**: 
   - 과거 사건은 명확한 시간과 함께 회상 가능: "작년 4월 기자회견을 떠올리면...", "1년 전 그때를 생각하면..."
   - 단, 반드시 구체적 시간 표기 병행 (예: "2024년 4월", "1년 7개월 전")
   - 현재 상황은 "현재는...", "오늘(${summary.systemDate}) 기준으로..."로 시작
   - 과거와 현재를 혼동하지 않도록 명확히 구분

2. **최소 문장 수 강제**:
   - 각 캐릭터의 minSentences 이상 발화 필수
   - 단답형 ("거짓말!", "억울합니다!") 단독 사용 금지
   - 감탄사 후에는 반드시 3문장 이상의 구체적 설명 추가

3. **역할 충성도**:
   - 기업/정부: 자기 조직 비하 금지, 방어적이되 품격 유지
   - 개인: 감정 표현 + 구체적 근거 병행
   - 전문가: [Analysis] 헤더 + 객관적 데이터

4. **자연스러운 흐름**:
   - 이전 발언에 반응하며 대화 진행
   - 마지막 턴은 기자/전문가가 상황 정리

**JSON 배열로 ${targetTurns}개 턴 생성:**
[
  {
    "turnIndex": 1,
    "speakerId": "char_id",
    "speakerName": "이름",
    "speakerIcon": "이모지",
    "content": "최소 3문장 이상의 발화 내용. 구체적 근거나 감정 표현 포함.",
    "action": "(선택) 동작 묘사",
    "emotion": "현재 감정",
    "referencedFacts": ["인용한 사실 1", "인용한 사실 2"]
  }
]`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4000,
      }
    });
    
    const responseText = result.response.text();
    const jsonStr = extractJSON(responseText);
    
    if (jsonStr) {
      let turns = JSON.parse(jsonStr) as ScenarioTurn[];
      
      // 🔒 품질 검증: 최소 문장 수 체크
      turns = turns.map(turn => {
        const persona = personas.find(p => 
          p.name === turn.speakerName || p.characterId === turn.speakerId
        );
        const minSentences = persona?.minSentences || 3;
        
        // 문장 수 계산 (마침표, 물음표, 느낌표 기준)
        const sentenceCount = (turn.content.match(/[.?!。？！]/g) || []).length;
        
        if (sentenceCount < minSentences) {
          console.warn(`[⚠️ 품질 경고] ${turn.speakerName}: ${sentenceCount}문장 (최소 ${minSentences}문장 필요)`);
          // 짧은 응답에 보완 문구 추가
          if (persona?.role === 'organization') {
            turn.content += ` 이에 대한 자세한 사항은 추후 공식 채널을 통해 안내드리겠습니다. 여러분의 이해와 협조 부탁드립니다.`;
          } else if (persona?.role === 'individual') {
            turn.content += ` 제가 직접 겪은 일이기에 이렇게 말씀드리는 것입니다. 부디 진실이 밝혀지길 바랍니다.`;
          }
        }
        
        return turn;
      });
      
      console.log(`[🔱 Trinity Phase 3] ${turns.length}개 턴 시나리오 생성 완료`);
      return turns;
    }
    
    throw new Error('JSON 파싱 실패');
  } catch (error) {
    console.error('[🔱 Trinity Phase 3] 오류:', error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 TRINITY ORCHESTRATOR (통합 실행)
// ═══════════════════════════════════════════════════════════════════════════

export interface TrinityRequest {
  query: string;
  searchResults: SearchResult[];
  characters: Array<{ name: string; icon: string; role?: string }>;
  targetTurns?: number;
}

export async function executeTrinityPipeline(
  request: TrinityRequest
): Promise<TrinityScenario> {
  const systemDate = new Date().toISOString().split('T')[0];
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔱 TRINITY ENGINE v1.0 실행 시작`);
  console.log(`📅 System Date: ${systemDate}`);
  console.log(`❓ Query: ${request.query}`);
  console.log(`👥 Characters: ${request.characters.length}명`);
  console.log(`${'═'.repeat(60)}\n`);

  const startTime = Date.now();

  // Phase 1: Time-Anchored Summarizer
  const summary = await timeAnchoredSummarize(
    request.query,
    request.searchResults,
    systemDate
  );

  // Phase 2: Dynamic Persona Generator
  const personas = await generateDynamicPersonas(
    summary,
    request.characters
  );

  // Phase 3: Script-First Generation
  const turns = await generateCompleteScript(
    request.query,
    summary,
    personas,
    request.targetTurns || 8
  );

  const elapsed = Date.now() - startTime;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔱 TRINITY ENGINE 완료 (${elapsed}ms)`);
  console.log(`📊 Summary: ${summary.keyConflicts.length} conflicts`);
  console.log(`👤 Personas: ${personas.length} cards`);
  console.log(`🎬 Turns: ${turns.length} generated`);
  console.log(`${'═'.repeat(60)}\n`);

  return {
    topic: request.query,
    generatedAt: new Date().toISOString(),
    summary,
    personas,
    turns
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔷 EXPORT FOR INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

export default {
  timeAnchoredSummarize,
  generateDynamicPersonas,
  generateCompleteScript,
  executeTrinityPipeline
};
