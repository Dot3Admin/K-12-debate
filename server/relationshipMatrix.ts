// 🤝 관계 매트릭스 자동 생성 시스템
// OpenAI를 활용하여 챗봇 간의 관계를 자동으로 생성하고 관리

import { generateStructuredResponse } from "./openai";
import { 
  RelationshipMatrix, 
  RelationshipEdge, 
  relationshipMatrixSchema 
} from "@shared/schema";
// import { relationshipMatrixCache } from "./cache"; // DB 저장으로 대체
import { z } from "zod";

export interface CharacterInfo {
  name: string;
  description?: string;
}

// 🎭 관계 매트릭스 생성을 위한 JSON Schema (OpenAI structured output 호환)
const RELATIONSHIP_MATRIX_JSON_SCHEMA = {
  type: "object",
  properties: {
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string", description: "발화자 챗봇 이름" },
          to: { type: "string", description: "청자 챗봇 이름" },
          relation: { type: "string", description: "관계 설명 (예: '스승과 제자', '동료 제자')" },
          tone: { type: "string", description: "말투/호칭 규칙 (예: '항상 존댓말, 존칭 주님')" }
        },
        required: ["from", "to", "relation", "tone"],
        additionalProperties: false
      }
    }
  },
  required: ["relationships"],
  additionalProperties: false
};

// 🎯 시스템 프롬프트 템플릿 (엄격한 규칙 포함)
function generateSystemPrompt(): string {
  return `당신은 "관계 매트릭스 생성기"입니다. 아래 캐릭터들의 역사적/문화적/종교적 관계를 분석하여
대화 시 사용해야 할 **호칭/말투/태도**까지 포함한 관계 그래프를 JSON으로 출력합니다.

⚠️ CRITICAL 규칙 - 관계 방향성:
- from: 말하는 사람 (화자)
- to: 듣는 사람 (청자)
- tone: from이 to를 부르는 호칭/말투 (반드시 작은따옴표 '...' 안에 구체적 호칭 포함 필수)

⚠️ STRICT 호칭 규칙:

**🔒 성경/종교 캐릭터 전용 호칭 (예수, 제자, 교황, 모세 등):**
- 제자 → 예수님: 반드시 존댓말, 존칭 '주님' 또는 '스승님' 사용
- 예수님 → 제자: 친근한 말투, 존칭 '제자여' 또는 이름 직접 호칭
- 교황/성직자 → 예수님: 반드시 존칭 '주님' 또는 '예수님' 사용
- 예수님 → 교황/성직자: 정중한 존칭 '형제여' 또는 역할명
- 성경 제자↔제자: 친근한 말투, 존칭 '형제여'
- 성경 역사적 인물 (모세, 다윗 등) ↔ 제자: 정중한 동료, 존칭 '형제여'

**👥 일반 캐릭터 호칭 (현대인, 배우, 직업인, 가상 캐릭터 등):**
- 친구/동료: "친근한 말투, 존칭 '친구' 또는 이름"
- 선배 → 후배: "다정한 말투, 존칭 '친구' 또는 이름"
- 후배 → 선배: "정중한 말투, 존칭 '선배님' 또는 이름+님"
- 직업 동료: "정중한 말투, 존칭 '귀하' 또는 역할명"
- 불명확한 관계: "정중한 동료, 존칭 '귀하'"

⚠️ 주의: '형제여', '제자여', '선지자여'는 **성경 캐릭터만** 사용! 일반 캐릭터는 절대 금지!

⚠️ tone 필드 형식 (반드시 준수):
- 올바른 예: "항상 존댓말, 존칭 '주님'"
- 올바른 예: "친근한 말투, 존칭 '형제여'"
- 잘못된 예: "정중한 존칭" (구체적 호칭 없음 - 절대 금지)
- 잘못된 예: "존댓말 사용" (호칭 없음 - 절대 금지)

출력은 반드시 유효한 JSON Array 형식이어야 합니다.`;
}

// 🎯 사용자 프롬프트 생성
function generateUserPrompt(characters: CharacterInfo[]): string {
  const characterList = characters
    .map(c => `- ${c.name}: ${c.description || ''}`)
    .join('\n');

  return `캐릭터 목록:
${characterList}

출력 형식(JSON Array of edges):

**성경 캐릭터 예시:**
[
  {"from":"베드로","to":"예수","relation":"제자와 스승","tone":"항상 존댓말, 존칭 '주님'"},
  {"from":"예수","to":"베드로","relation":"스승과 제자","tone":"친근한 말투, 존칭 '제자여'"},
  {"from":"베드로","to":"요한","relation":"동료 제자","tone":"친근한 말투, 존칭 '형제여'"},
  {"from":"프란치스코 교황","to":"예수","relation":"신앙의 중심","tone":"정중한 존칭 '주님'"}
]

**일반 캐릭터 예시 (배우, 직업인 등):**
[
  {"from":"박은빈","to":"이상민","relation":"드라마 주연과 조연","tone":"친근한 말투, 존칭 '친구' 또는 이름"},
  {"from":"이상민","to":"박은빈","relation":"드라마 조연과 주연","tone":"정중한 말투, 존칭 '선배님'"},
  {"from":"김변호사","to":"최판사","relation":"법조계 동료","tone":"정중한 말투, 존칭 '판사님'"},
  {"from":"AI조수","to":"사용자","relation":"인공지능과 사용자","tone":"정중한 말투, 존칭 '귀하'"}
]

⚠️ 중요: tone 필드에 반드시 작은따옴표 '...' 안에 구체적인 호칭을 포함하세요!
위 캐릭터들 간의 모든 관계를 정의해주세요.`;
}

// 🎭 기본 폴백 매트릭스 생성
export function generateFallbackMatrix(characters: CharacterInfo[]): RelationshipMatrix {
  console.log(`[🎭 관계 인식] 폴백 매트릭스 생성 - ${characters.length}개 캐릭터`);
  
  const fallbackMatrix: RelationshipMatrix = [];
  
  for (let i = 0; i < characters.length; i++) {
    for (let j = 0; j < characters.length; j++) {
      if (i !== j) {
        fallbackMatrix.push({
          from: characters[i].name,
          to: characters[j].name,
          relation: "정중한 동료",
          tone: "정중한 말투, 존칭 '귀하'"
        });
      }
    }
  }
  
  return fallbackMatrix;
}

// 🔍 이름 정규화 함수 (괄호, 공백 제거 + 소문자 변환)
function normalizeCharacterName(name: string): string {
  return name.trim().toLowerCase()
    .replace(/\s*\([^)]*\)/g, '') // 괄호와 내용 제거 (예: "우영우 (가상 캐릭터)" → "우영우")
    .replace(/\s+/g, ' ') // 중복 공백 제거
    .replace(/예수님/g, '예수')
    .replace(/예수 그리스도/g, '예수')
    .replace(/christ/gi, '예수')
    .replace(/jesus/gi, '예수')
    .trim();
}

// 🔍 완전성 검증 (모든 관계 조합이 있는지 확인)
function validateCompleteness(matrix: RelationshipMatrix, characters: CharacterInfo[]): boolean {
  const expectedCount = characters.length * (characters.length - 1);
  
  if (matrix.length < expectedCount) {
    console.log(`[🎭 관계 인식] 완전성 검증 실패: ${matrix.length}/${expectedCount} 관계`);
    return false;
  }
  
  // 중복 제거 및 정규화
  const normalizedMatrix = new Map<string, RelationshipEdge>();
  
  for (const edge of matrix) {
    const fromNorm = normalizeCharacterName(edge.from);
    const toNorm = normalizeCharacterName(edge.to);
    const key = `${fromNorm}::${toNorm}`;
    
    if (!normalizedMatrix.has(key)) {
      normalizedMatrix.set(key, {
        from: edge.from.trim(),
        to: edge.to.trim(),
        relation: edge.relation.trim(),
        tone: edge.tone.trim()
      });
    }
  }
  
  console.log(`[🎭 관계 인식] 완전성 검증: ${normalizedMatrix.size}/${expectedCount} 고유 관계`);
  return normalizedMatrix.size >= expectedCount;
}

// 🔍 중복 제거 함수
function deduplicateMatrix(matrix: RelationshipMatrix): RelationshipMatrix {
  const deduplicatedMap = new Map<string, RelationshipEdge>();
  
  for (const edge of matrix) {
    const fromNorm = normalizeCharacterName(edge.from);
    const toNorm = normalizeCharacterName(edge.to);
    const key = `${fromNorm}::${toNorm}`;
    
    if (!deduplicatedMap.has(key)) {
      deduplicatedMap.set(key, {
        from: edge.from.trim(),
        to: edge.to.trim(),
        relation: edge.relation.trim(),
        tone: edge.tone.trim()
      });
    }
  }
  
  return Array.from(deduplicatedMap.values());
}

// 🔍 예수-제자 관계 강화된 검증
function validateJesusRelationships(matrix: RelationshipMatrix, characters: CharacterInfo[]): boolean {
  const jesusVariants = ['예수', 'jesus'];
  
  // 예수님이 포함되어 있는지 확인
  const jesusCharacter = characters.find(char => 
    jesusVariants.some(variant => normalizeCharacterName(char.name).includes(variant))
  );
  
  if (!jesusCharacter) {
    return true; // 예수님이 없으면 검증 통과
  }
  
  console.log(`[🎭 관계 인식] 예수님 캐릭터 발견: ${jesusCharacter.name}`);
  
  // 모든 제자들이 예수님께 적절한 존칭을 사용하는지 확인
  const discipleToJesusEdges = matrix.filter(edge => {
    const toNorm = normalizeCharacterName(edge.to);
    const fromNorm = normalizeCharacterName(edge.from);
    return jesusVariants.some(variant => toNorm.includes(variant)) && 
           !jesusVariants.some(variant => fromNorm.includes(variant));
  });
  
  let validRespectCount = 0;
  const respectfulTerms = ['주님', '스승님', '스승', '존댓말', '존칭'];
  
  for (const edge of discipleToJesusEdges) {
    const tone = edge.tone.toLowerCase();
    const hasRespect = respectfulTerms.some(term => tone.includes(term));
    
    if (hasRespect) {
      validRespectCount++;
    } else {
      console.log(`[🎭 관계 인식] 존칭 누락: ${edge.from} → ${edge.to}: "${edge.tone}"`);
    }
  }
  
  const isValid = validRespectCount === discipleToJesusEdges.length && discipleToJesusEdges.length > 0;
  console.log(`[🎭 관계 인식] 예수-제자 관계 검증: ${validRespectCount}/${discipleToJesusEdges.length} - ${isValid ? '통과' : '실패'}`);
  
  return isValid;
}

// 📊 저장된 매트릭스가 현재 캐릭터 구성과 일치하는지 검증 (엄격한 버전)
function validateStoredMatrixCoverage(storedMatrix: RelationshipMatrix, currentCharacters: CharacterInfo[]): boolean {
  if (!storedMatrix || storedMatrix.length === 0) {
    return false;
  }
  
  // ✅ 엄격한 검증: 매트릭스의 모든 캐릭터가 현재 그룹에 존재해야 함
  const currentNames = new Set(currentCharacters.map(c => normalizeCharacterName(c.name)));
  const matrixNames = new Set<string>();
  
  // 매트릭스에서 모든 캐릭터명 추출
  for (const edge of storedMatrix) {
    matrixNames.add(normalizeCharacterName(edge.from));
    matrixNames.add(normalizeCharacterName(edge.to));
  }
  
  // 매트릭스의 모든 캐릭터가 현재 그룹에 있는지 확인
  let invalidCount = 0;
  for (const matrixName of Array.from(matrixNames)) {
    if (!currentNames.has(matrixName)) {
      console.log(`[📊 매트릭스 검증] 불일치: "${matrixName}"는 현재 그룹에 없음`);
      invalidCount++;
    }
  }
  
  // 현재 그룹의 캐릭터가 매트릭스에 모두 있는지 확인
  let matchCount = 0;
  for (const currentName of Array.from(currentNames)) {
    if (matrixNames.has(currentName)) {
      matchCount++;
    } else {
      console.log(`[📊 매트릭스 검증] 누락: "${currentName}"가 매트릭스에 없음`);
    }
  }
  
  const coverageRatio = matchCount / currentNames.size;
  console.log(`[📊 매트릭스 검증] 커버리지: ${matchCount}/${currentNames.size} (${(coverageRatio * 100).toFixed(1)}%), 불일치: ${invalidCount}개`);
  
  // 완벽하게 일치해야 함 (100% 커버리지 + 불일치 0개)
  return coverageRatio === 1.0 && invalidCount === 0;
}

// 🎯 메인 관계 매트릭스 생성 함수 (DB 저장 적용)
export async function generateRelationshipMatrix(
  characters: CharacterInfo[],
  options: {
    retryOnFailure?: boolean;
    maxRetries?: number;
    groupChatId: number; // 필수로 변경
    useCache?: boolean;
    cacheOnly?: boolean; // 캐시 미스 시 빈 배열 반환
  }
): Promise<RelationshipMatrix> {
  
  const { retryOnFailure = true, maxRetries = 1, groupChatId, useCache = true, cacheOnly = false } = options;
  
  // groupChatId 검증
  if (!groupChatId || groupChatId <= 0) {
    throw new Error("groupChatId는 양수여야 합니다. 채팅방 간 캐시 오염을 방지하기 위해 필수입니다.");
  }
  
  try {
    console.log(`[🎭 관계 인식] 매트릭스 생성 시작 - ${characters.length}개 캐릭터`);
    
    if (characters.length < 2) {
      console.log(`[🎭 관계 인식] 캐릭터가 부족하여 빈 매트릭스 반환`);
      return [];
    }

    // DB에서 기존 매트릭스 확인
    if (useCache) {
      try {
        const { storage } = await import('./storage');
        const storedMatrix = await storage.getRelationshipMatrix(groupChatId);
        
        if (storedMatrix && storedMatrix.length > 0) {
          // 📊 저장된 매트릭스가 현재 캐릭터 구성과 일치하는지 검증
          const isValidCoverage = validateStoredMatrixCoverage(storedMatrix, characters);
          
          if (isValidCoverage) {
            console.log(`[🎭 관계 인식] DB에서 매트릭스 조회 성공 - ${storedMatrix.length}개 관계 (캐릭터 구성 일치)`);
            return storedMatrix;
          } else {
            console.log(`[🎭 관계 인식] 저장된 매트릭스가 현재 캐릭터 구성과 불일치 - 재생성 필요`);
            if (cacheOnly) {
              console.log(`[🎭 관계 인식] cacheOnly 모드 - 불일치로 빈 매트릭스 반환`);
              return [];
            }
            // 매트릭스 재생성을 위해 계속 진행
          }
        }
        
        // cacheOnly 모드: DB에 없으면 빈 배열 반환 (속도 우선)
        if (cacheOnly) {
          console.log(`[🎭 관계 인식] cacheOnly 모드 - DB에 매트릭스 없어 빈 매트릭스 반환`);
          return [];
        }
      } catch (error) {
        console.error(`[🎭 관계 인식] DB 조회 오류:`, error);
        if (cacheOnly) {
          return [];
        }
      }
    }
    
    const systemPrompt = generateSystemPrompt();
    const userPrompt = generateUserPrompt(characters);
    
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[🎭 관계 인식] 생성 시도 ${attempt + 1}/${maxRetries + 1}`);
        
        // 새로운 wrapper 스키마 사용
        const wrapperSchema = z.object({
          relationships: relationshipMatrixSchema
        });
        
        const response = await generateStructuredResponse<{relationships: RelationshipMatrix}>(
          systemPrompt,
          userPrompt,
          wrapperSchema,
          RELATIONSHIP_MATRIX_JSON_SCHEMA,
          "RelationshipMatrix",
          1200 // max_tokens 증가 (400 → 1200)
        );
        
        const matrix = response.relationships || [];
        console.log(`[🎭 관계 인식] 매트릭스 생성 완료 - ${matrix.length}개 관계`);
        
        // 완전성 검증
        const isComplete = validateCompleteness(matrix, characters);
        if (!isComplete && attempt < maxRetries && retryOnFailure) {
          console.log(`[🎭 관계 인식] 완전성 검증 실패, 재시도`);
          continue;
        }
        
        // 예수-제자 관계 검증  
        const isValid = validateJesusRelationships(matrix, characters);
        if (!isValid && attempt < maxRetries && retryOnFailure) {
          console.log(`[🎭 관계 인식] 예수-제자 관계 검증 실패, 재시도`);
          continue;
        }
        
        // 중복 제거 및 정규화된 매트릭스 반환
        const deduplicatedMatrix = deduplicateMatrix(matrix);
        console.log(`[🎭 관계 인식] 중복 제거 완료: ${matrix.length} → ${deduplicatedMatrix.length}개 관계`);
        
        // DB에 저장
        if (useCache) {
          try {
            const { storage } = await import('./storage');
            await storage.saveRelationshipMatrix(groupChatId, deduplicatedMatrix);
            console.log(`[🎭 관계 인식] DB에 매트릭스 저장 완료 - ${deduplicatedMatrix.length}개 관계`);
          } catch (error) {
            console.error(`[🎭 관계 인식] DB 저장 오류:`, error);
          }
        }
        
        return deduplicatedMatrix;
        
      } catch (error) {
        lastError = error;
        console.error(`[🎭 관계 인식] 시도 ${attempt + 1} 실패:`, error);
        
        if (attempt >= maxRetries) {
          break;
        }
      }
    }
    
    // 모든 시도 실패 시 폴백
    console.log(`[🎭 관계 인식] 모든 시도 실패, 폴백 매트릭스 사용`);
    return generateFallbackMatrix(characters);
    
  } catch (error: any) {
    console.error(`[🎭 관계 인식] 매트릭스 생성 완전 실패:`, error);
    return generateFallbackMatrix(characters);
  }
}

// 🎯 관계 매트릭스를 시스템 프롬프트용 텍스트로 변환
export function formatMatrixForPrompt(matrix: RelationshipMatrix): string {
  if (matrix.length === 0) {
    return `🤝 관계 매트릭스: (빈 관계)`;
  }
  
  const formatted = matrix
    .map(edge => `  ${edge.from} → ${edge.to}: ${edge.relation} (${edge.tone})`)
    .join('\n');
    
  return `🤝 관계 매트릭스:
${formatted}

MANDATORY:
- 위 관계를 반드시 반영해 대화 작성
- 예수님 포함 시 제자들은 존칭("주님","스승님") 사용
- 제자끼리는 친근체 허용
- 서로의 이전 발언을 인용·반응 (나열식 금지)`;
}

// ===========================================
// 🎯 발언 순서 결정 시스템
// ===========================================

export interface SpeakingOrderResult {
  order: string[];
  reasoning: string;
}

// 🎯 발언 순서 결정을 위한 Zod Schema
const speakingOrderSchema = z.object({
  order: z.array(z.string()).describe("캐릭터들의 발언 순서 배열"),
  reasoning: z.string().max(100).describe("순서 결정 이유 (1-2문장, 최대 100자)")
});

// 🎯 발언 순서 결정을 위한 JSON Schema
const SPEAKING_ORDER_JSON_SCHEMA = {
  type: "object",
  properties: {
    order: {
      type: "array",
      items: { type: "string" },
      description: "캐릭터들의 발언 순서 배열"
    },
    reasoning: {
      type: "string",
      maxLength: 100,
      description: "순서 결정 이유 (1-2문장, 최대 100자)"
    }
  },
  required: ["order", "reasoning"],
  additionalProperties: false
};

// 🎯 발언 순서 결정을 위한 시스템 프롬프트
function generateSpeakingOrderSystemPrompt(): string {
  return `당신은 "발언 순서 결정기"입니다. 사용자의 질문 내용을 분석하여 
가장 자연스럽고 효과적인 캐릭터 발언 순서를 결정합니다.

⚠️ 핵심 원칙:
1. **전문성 우선**: 질문 주제와 가장 관련 있는 캐릭터가 먼저 답변
2. **자연스러운 흐름**: 실제 대화처럼 논리적 순서
3. **관계 고려**: 기존 관계를 반영한 발언 순서
4. **맥락 적합성**: 질문의 성격에 맞는 순서

주요 판단 기준:
- 성경/종교 질문 → 예수님, 바울 사도 우선
- 일반 지식/기술 → 범용 LLM 우선  
- 역사/정치 → 해당 시대 인물 우선
- 개인 고민/상담 → 예수님, 사도들 우선
- 경제/철학 → 관련 전문가 우선

출력은 반드시 유효한 JSON Object 형식이어야 합니다.`;
}

// 🎯 발언 순서 결정을 위한 사용자 프롬프트 생성
function generateSpeakingOrderUserPrompt(
  userQuestion: string,
  characters: CharacterInfo[],
  relationshipMatrix?: RelationshipMatrix
): string {
  const characterList = characters
    .map(c => `- ${c.name}: ${c.description || '(설명 없음)'}`)
    .join('\n');

  const relationshipContext = relationshipMatrix && relationshipMatrix.length > 0
    ? `\n\n기존 관계 정보:\n${relationshipMatrix.slice(0, 5).map(r => 
      `${r.from} ↔ ${r.to}: ${r.relation}`).join('\n')}`
    : '';

  return `사용자 질문: "${userQuestion}"

참여 캐릭터들:
${characterList}${relationshipContext}

위 질문에 대해 가장 자연스럽고 효과적인 발언 순서를 결정해주세요.
전문성, 관계, 맥락을 모두 고려하여 순서를 정하세요.

출력 형식:
{
  "order": ["첫번째_캐릭터", "두번째_캐릭터", "세번째_캐릭터", ...],
  "reasoning": "순서 결정 이유 (1-2문장, 최대 100자)"
}`;
}

// 🎯 메인 발언 순서 결정 함수
export async function determineSpeakingOrder(
  userQuestion: string,
  characters: CharacterInfo[],
  options: {
    relationshipMatrix?: RelationshipMatrix;
    retryOnFailure?: boolean;
    maxRetries?: number;
  } = {}
): Promise<string[]> {
  const {
    relationshipMatrix,
    retryOnFailure = true,
    maxRetries = 2
  } = options;

  console.log(`[🎯 발언순서] 순서 결정 시작 - 질문: "${userQuestion.slice(0, 50)}..."`);
  console.log(`[🎯 발언순서] 참여 캐릭터: ${characters.map(c => c.name).join(', ')}`);

  try {
    const systemPrompt = generateSpeakingOrderSystemPrompt();
    const userPrompt = generateSpeakingOrderUserPrompt(userQuestion, characters, relationshipMatrix);

    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[🎯 발언순서] OpenAI API 호출 시도 ${attempt + 1}/${maxRetries + 1}`);
        
        const result = await generateStructuredResponse<SpeakingOrderResult>(
          systemPrompt,
          userPrompt,
          speakingOrderSchema,
          SPEAKING_ORDER_JSON_SCHEMA,
          "SpeakingOrder",
          600 // max_tokens 증가 (150 → 600)
        );
        
        console.log(`[🎯 발언순서] 순서 결정 완료: ${result.order.join(' → ')}`);
        console.log(`[🎯 발언순서] 결정 이유: ${result.reasoning}`);
        
        // 유효성 검증 및 이름 매핑
        if (validateSpeakingOrder(result.order, characters)) {
          // LLM 이름을 실제 캐릭터 이름으로 매핑
          const mappedOrder = mapToActualCharacterNames(result.order, characters);
          console.log(`[🎯 발언순서] 이름 매핑: ${result.order.join(' → ')} ➜ ${mappedOrder.join(' → ')}`);
          return mappedOrder;
        } else {
          throw new Error('발언 순서 유효성 검증 실패');
        }
        
      } catch (error) {
        lastError = error;
        console.error(`[🎯 발언순서] 시도 ${attempt + 1} 실패:`, error);
        
        if (attempt >= maxRetries || !retryOnFailure) {
          break;
        }
      }
    }
    
    // 모든 시도 실패 시 폴백
    console.log(`[🎯 발언순서] 모든 시도 실패, 폴백 순서 사용`);
    return generateFallbackSpeakingOrder(userQuestion, characters);
    
  } catch (error: any) {
    console.error(`[🎯 발언순서] 순서 결정 완전 실패:`, error);
    return generateFallbackSpeakingOrder(userQuestion, characters);
  }
}

// 🎯 이름 정규화 (괄호, 공백, 특수문자 제거)
function normalizeName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '') // 괄호와 내용 제거
    .replace(/[^가-힣a-zA-Z\s]/g, '') // 한글, 영문, 공백만 유지
    .trim()
    .toLowerCase();
}

// 🎯 견고한 캐릭터 이름 매칭
function findMatchingCharacter(llmName: string, characters: CharacterInfo[]): CharacterInfo | null {
  const normalizedLlmName = normalizeName(llmName);
  
  // 1. 정확한 매칭
  for (const char of characters) {
    if (normalizeName(char.name) === normalizedLlmName) {
      return char;
    }
  }
  
  // 2. 부분 매칭 (포함 관계)
  for (const char of characters) {
    const normalizedCharName = normalizeName(char.name);
    if (normalizedCharName.includes(normalizedLlmName) || normalizedLlmName.includes(normalizedCharName)) {
      return char;
    }
  }
  
  // 3. 키워드 매칭
  const keywords = normalizedLlmName.split(/\s+/).filter(k => k.length > 1);
  for (const char of characters) {
    const normalizedCharName = normalizeName(char.name);
    if (keywords.some(keyword => normalizedCharName.includes(keyword))) {
      return char;
    }
  }
  
  return null;
}

// 🎯 LLM 이름을 실제 캐릭터 이름으로 매핑
function mapToActualCharacterNames(llmOrder: string[], characters: CharacterInfo[]): string[] {
  const mappedOrder: string[] = [];
  
  for (const llmName of llmOrder) {
    const matchedChar = findMatchingCharacter(llmName, characters);
    if (matchedChar) {
      mappedOrder.push(matchedChar.name);
    } else {
      // 매칭 실패시 원본 이름 유지 (폴백에서 처리됨)
      mappedOrder.push(llmName);
    }
  }
  
  return mappedOrder;
}

// 🎯 발언 순서 유효성 검증 (견고한 매칭)
function validateSpeakingOrder(order: string[], characters: CharacterInfo[]): boolean {
  // 길이 체크 완화 (일부 누락 허용)
  if (order.length === 0 || order.length > characters.length) {
    console.warn(`[🎯 발언순서] 잘못된 길이: 제공된 ${order.length}개, 최대 ${characters.length}개`);
    return false;
  }
  
  const matchedCharacters = new Set<string>();
  
  // 견고한 이름 매칭
  for (const name of order) {
    const matchedChar = findMatchingCharacter(name, characters);
    if (!matchedChar) {
      console.warn(`[🎯 발언순서] 매칭 실패: "${name}" → 폴백 사용`);
      return false; // 매칭 실패시 폴백으로
    }
    
    if (matchedCharacters.has(matchedChar.name)) {
      console.warn(`[🎯 발언순서] 중복 매칭: "${matchedChar.name}"`);
      return false;
    }
    
    matchedCharacters.add(matchedChar.name);
  }
  
  console.log(`[🎯 발언순서] 매칭 성공: ${order.length}개 캐릭터`);
  return true;
}

// 🎯 폴백 발언 순서 생성 (간단한 휴리스틱)
function generateFallbackSpeakingOrder(userQuestion: string, characters: CharacterInfo[]): string[] {
  console.log(`[🎯 발언순서] 폴백 순서 생성 - ${characters.length}개 캐릭터`);
  
  const characterNames = characters.map(c => c.name);
  const question = userQuestion.toLowerCase();
  
  // 간단한 키워드 기반 우선순위
  const priorities: { [key: string]: number } = {};
  
  characterNames.forEach(name => {
    let score = 0;
    
    // 성경/종교 관련 질문
    if (question.includes('성경') || question.includes('말씀') || question.includes('사랑') || 
        question.includes('믿음') || question.includes('기도') || question.includes('하나님')) {
      if (name.includes('예수')) score += 100;
      else if (name.includes('바울')) score += 80;
      else if (name.includes('피터') || name.includes('베드로')) score += 70;
      else if (name.includes('제자') || name.includes('사도')) score += 60;
    }
    
    // 일반 지식
    if (question.includes('무엇') || question.includes('어떻게') || question.includes('설명')) {
      if (name.includes('범용') || name.includes('LLM')) score += 90;
    }
    
    // 기본 점수 (이름 순서)
    score += Math.random() * 10; // 동점일 때 랜덤
    
    priorities[name] = score;
  });
  
  // 점수순으로 정렬
  const sortedNames = characterNames.sort((a, b) => priorities[b] - priorities[a]);
  
  console.log(`[🎯 발언순서] 폴백 결과: ${sortedNames.join(' → ')}`);
  return sortedNames;
}