import OpenAI from "openai";
import * as mammoth from "mammoth";
import * as fs from "fs";
import * as path from "path";
import { correctInstitutionNames } from "./chatTemplates.js";
import { z } from "zod";
import { buildHumorTonePrompt, type ContextType } from "./utils/HumorToneController.js";
import { logOpenAIUsage } from "./utils/tokenLogger.js";
import { searchDocumentChunks } from "./documentProcessor";
import type { AgentHumor } from "@shared/schema";
import { storage } from "./storage";

// 사용자 요청으로 모든 모델을 GPT-4o로 변경 (안정성 및 성능 향상)
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ""
});

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: text,
      encoding_format: 'float',
    });
    
    return response.data[0].embedding;
  } catch (error) {
    console.error('[OpenAI Embedding] Error generating embedding:', error);
    throw error;
  }
}

// 🤖 관계 매트릭스를 위한 구조화 출력 OpenAI 클라이언트 팩토리
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "";
  
  if (!apiKey) {
    throw new Error("OpenAI API key is required for relationship matrix generation");
  }

  // Azure OpenAI 지원 (환경변수로 선택 가능)
  if (process.env.AZURE_OPENAI_ENDPOINT) {
    return new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY || apiKey,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
      defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview' },
      defaultHeaders: {
        'api-key': process.env.AZURE_OPENAI_API_KEY || apiKey,
      },
    });
  }

  // 기본 OpenAI 클라이언트
  return new OpenAI({ 
    apiKey: apiKey
  });
}

// 🎭 구조화 출력을 지원하는 JSON Schema 기반 응답 생성
export async function generateStructuredResponse<T>(
  systemPrompt: string,
  userPrompt: string,
  zodSchema: z.ZodSchema<T>,
  jsonSchema: Record<string, unknown>,
  schemaName: string = "StructuredOutput",
  maxTokens: number = 400
): Promise<T> {
  const client = getOpenAIClient();
  
  try {
    console.log(`[🎭 관계 인식] 구조화 출력 생성 시작 - 스키마: ${schemaName}`);
    
    // Azure OpenAI는 모델 필드를 제거 (deployment 기반이므로)
    const isAzure = !!process.env.AZURE_OPENAI_ENDPOINT;
    const requestBody: any = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          schema: jsonSchema,
          strict: true
        }
      },
      max_tokens: maxTokens,
      temperature: 0.1 // 일관된 출력을 위해 낮은 temperature
    };
    
    // 일반 OpenAI에만 모델 필드 포함
    if (!isAzure) {
      requestBody.model = process.env.LLM_MODEL || "gpt-4o-mini";
    }

    const response = await client.chat.completions.create(requestBody);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI 응답에서 내용을 찾을 수 없습니다");
    }

    console.log(`[🎭 관계 인식] 구조화 출력 생성 완료 - 길이: ${content.length}자`);
    
    // JSON 파싱
    let parsedData;
    try {
      parsedData = JSON.parse(content);
    } catch (parseError) {
      console.error(`[🎭 관계 인식] JSON 파싱 실패:`, parseError);
      throw new Error(`JSON 파싱 실패: ${content}`);
    }
    
    // Zod 스키마 검증
    const validationResult = zodSchema.safeParse(parsedData);
    if (!validationResult.success) {
      console.error(`[🎭 관계 인식] 스키마 검증 실패:`, validationResult.error);
      throw new Error(`스키마 검증 실패: ${validationResult.error.message}`);
    }
    
    console.log(`[🎭 관계 인식] 스키마 검증 통과`);
    return validationResult.data;
    
  } catch (error: any) {
    console.error(`[🎭 관계 인식] 구조화 출력 생성 실패:`, error);
    throw new Error(`관계 매트릭스 생성 실패: ${error.message}`);
  }
}

// 📊 마크다운 표 검증 및 수정 함수
function validateAndFixMarkdownTable(text: string): string {
  // 표가 없으면 그대로 반환
  if (!text.includes('|')) return text;
  
  console.log('[TABLE FIX] 표 검증 시작');
  
  // 줄바꿈으로 분리
  const lines = text.split('\n');
  const tableLines = lines.filter(l => l.includes('|'));
  
  console.log(`[TABLE FIX] 전체 줄 수: ${lines.length}, 파이프 포함 줄: ${tableLines.length}`);
  
  // 표가 1줄이면 잘못된 것 (헤더 + 구분선 + 최소 1개 데이터 = 최소 3줄)
  if (tableLines.length === 1) {
    console.log('⚠️ [TABLE FIX] 표가 한 줄로 붙어있음. 수정 시작...');
    
    const tableLine = tableLines[0];
    const cells = tableLine.split('|').map(c => c.trim()).filter(c => c);
    
    console.log(`[TABLE FIX] 파싱된 셀 개수: ${cells.length}`);
    console.log(`[TABLE FIX] 셀 내용:`, cells.slice(0, 10)); // 처음 10개만
    
    // 구분선 찾기 (---, ---|---, 등)
    const sepIndex = cells.findIndex(c => c.match(/^[-–—]+$/));
    
    console.log(`[TABLE FIX] 구분선 위치: ${sepIndex}`);
    
    let fixed: string[] = [];
    
    if (sepIndex > 0) {
      // 헤더 (구분선 이전 셀들)
      const headerCells = cells.slice(0, sepIndex);
      const colCount = headerCells.length;
      
      console.log(`[TABLE FIX] 컬럼 수: ${colCount}`);
      console.log(`[TABLE FIX] 헤더:`, headerCells);
      
      fixed.push('| ' + headerCells.join(' | ') + ' |');
      
      // 구분선
      fixed.push('|' + ' --- |'.repeat(colCount));
      
      // 데이터 행들 (구분선 이후)
      const dataCells = cells.slice(sepIndex + 1);
      console.log(`[TABLE FIX] 데이터 셀 개수: ${dataCells.length}`);
      
      for (let i = 0; i < dataCells.length; i += colCount) {
        const row = dataCells.slice(i, i + colCount);
        if (row.length === colCount) {
          fixed.push('| ' + row.join(' | ') + ' |');
        }
      }
      
      console.log(`[TABLE FIX] 수정된 표 줄 수: ${fixed.length}`);
      
      // 원본에서 표 교체
      const tableStart = text.indexOf(tableLine);
      const beforeTable = text.substring(0, tableStart);
      const afterTable = text.substring(tableStart + tableLine.length);
      
      const fixedTable = '\n' + fixed.join('\n') + '\n';
      const result = beforeTable + fixedTable + afterTable;
      
      console.log('✅ [TABLE FIX] 표 수정 완료');
      console.log('[TABLE FIX] 수정된 표:\n' + fixedTable);
      
      return result;
    } else {
      console.log('❌ [TABLE FIX] 구분선을 찾을 수 없음. 원본 반환');
    }
  } else {
    console.log(`✅ [TABLE FIX] 표가 이미 올바른 형식 (${tableLines.length}줄)`);
  }
  
  return text;
}

// 🎭 지문을 이모티콘으로 변환하는 함수
export function removeRhythmTags(text: string): string {
  // 지문 → 이모티콘 매핑
  const stageDirectionToEmoji: Record<string, string> = {
    // 생각 및 고민
    '생각에 잠기며': '🤔',
    '조금 생각에 잠기며': '🤔',
    '깊이 생각하며': '🤔',
    '고민하며': '🤔',
    '머뭇거리며': '🤔',
    '주저': '🤔',
    '망설임': '🤔',
    
    // 기쁨 및 미소
    '미소': '😊',
    '미소 지으며': '😊',
    '미소를 지으며': '😊',
    '웃으며': '😄',
    '웃음': '😄',
    '기쁨': '😊',
    '기쁘게': '😊',
    '즐겁게': '😄',
    
    // 슬픔
    '슬픔': '😢',
    '슬프게': '😢',
    '슬픈 표정으로': '😢',
    '눈물': '😢',
    '눈물을 흘리며': '😢',
    '한숨': '😔',
    '한숨을 쉬며': '😔',
    
    // 놀람
    '놀람': '😮',
    '놀라며': '😮',
    '놀란 표정으로': '😮',
    '깜짝 놀라며': '😲',
    
    // 동의 및 긍정
    '고개를 끄덕이며': '👍',
    '고개 끄덕이며': '👍',
    '끄덕이며': '👍',
    '확신': '💪',
    '결의': '💪',
    '결단': '💪',
    '다짐': '💪',
    '각오': '💪',
    
    // 부정
    '고개를 저으며': '🙅',
    '고개 저으며': '🙅',
    
    // 감정 표현
    '분노': '😠',
    '화나며': '😠',
    '격분': '😡',
    '두려움': '😨',
    '두렵게': '😨',
    '떨림': '😰',
    '당황': '😳',
    '당황하며': '😳',
    '걱정스럽게': '😟',
    '걱정하며': '😟',
    
    // 진지함
    '진지하게': '😐',
    '진지한 표정으로': '😐',
    '차분': '😌',
    '차분하게': '😌',
    '침묵': '🤐',
    
    // 회상 및 생각
    '회상': '💭',
    '회상하며': '💭',
    '기억하며': '💭',
    '추억하며': '💭',
    
    // 기타 표현
    '강조': '❗',
    '외침': '📢',
    '속삭임': '🤫',
    '탄식': '😔',
    '감탄': '✨',
    '안도': '😌',
    '희망': '🌟',
    '절망': '😞',
    '후회': '😔',
    '그리움': '💭',
    '미안': '🙏',
    '감사': '🙏',
    '존경': '🙇',
    '경멸': '😒',
    '동정': '😥',
    '연민': '😥',
    
    // 리듬 태그
    '인용': '💬',
    '정정': '✏️',
    '경고': '⚠️',
    '원칙': '📌',
    '반복': '🔄',
    '호기심': '🤨',
    '정적': '...',
    '비유': '🌟',
    '긴장': '😰',
    '의문': '❓'
  };
  
  let result = text;
  
  // 각 지문에 대해 이모티콘으로 변환
  for (const [stageDirection, emoji] of Object.entries(stageDirectionToEmoji)) {
    // 괄호로 감싸진 지문 찾기: (조금 생각에 잠기며), (미소 지으며) 등
    const pattern = new RegExp(`\\(${stageDirection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*`, 'g');
    result = result.replace(pattern, emoji ? emoji + ' ' : '');
  }
  
  return result.trim();
}

export interface ChatResponse {
  message: string;
  usedDocuments: Array<{ filename: string; content: string }>;
  sources?: Array<{ title: string; url: string }>;
}

export interface DocumentAnalysis {
  summary: string;
  keyPoints: string[];
  extractedText: string;
}

export interface MultiAgentResponse {
  agentName: string;
  content: string;
}

export interface MultiAgentChatResponse {
  responses: MultiAgentResponse[];
  usedDocuments: Array<{ filename: string; content: string }>;
}

// 🧠 지식 경계 점검 시스템 인터페이스
export interface KnowledgeBoundaryCheck {
  mode: "answer" | "unknown" | "search_required";
  coverage: number;
  consistency: number;
  certainty: number;
  world_guard: "in" | "out";
  needs_clarification: boolean;
  reason: string;
  forceWebSearch?: boolean; // 본인/가족 관련 논란 → Google Search 강제
}

// 🚀 배치 지식 경계 점검 인터페이스
export interface BatchKnowledgeBoundaryCheck {
  [agentName: string]: KnowledgeBoundaryCheck;
}

function getAgentSeed(agentName: string): number {
  return agentName.charCodeAt(0) + agentName.length;
}

// 🎯 언어 레벨에 따른 응답 가이드라인 생성 (최대치 규정 방식)
export function generateLanguageLevelPrompt(languageLevel?: number | null): string {
  console.log(`[LANGUAGE LEVEL] 입력된 languageLevel: ${languageLevel}`);
  
  // 미적용: 언어 레벨 제약 없음
  if (languageLevel === null || languageLevel === undefined || languageLevel < 1 || languageLevel > 6) {
    console.log(`[LANGUAGE LEVEL] 미적용 상태 - 제약 없이 자유 표현`);
    return "";
  }

  console.log(`[LANGUAGE LEVEL] ${languageLevel}단계 제약 적용`);
  
  // 🚨 금지 표현 규칙 (모든 언어 레벨에 공통 적용)
  const FORBIDDEN_PHRASES_RULE = `

🚨 **[URGENT] CHARACTER VOICE PRESERVATION - MANDATORY CHECK:**

NEVER use these generic system phrases:
❌ "지원하지 않습니다" (not supported)
❌ "불가능합니다" (impossible)
❌ "제공되지 않습니다" (not provided)
❌ "사용할 수 없습니다" (cannot use)
❌ "대화할 수 없습니다" (cannot talk)
❌ "~할 수 없어요" (cannot do)
❌ "~할 수 없습니다" (cannot do - formal)

Instead, maintain YOUR CHARACTER IDENTITY when explaining limitations.
Use your unique background, era, beliefs, and personality to respond creatively.

**FINAL CHECK BEFORE RESPONDING:** Scan your response for the above phrases. If found, rewrite using character-specific expressions.
`;

  // 각 레벨은 "최대치 규정" - 해당 수준까지 사용 가능 (그 이하는 자유)
  if (languageLevel === 1) {
    return `
📌 **CRITICAL: Language Level 1 - MAXIMUM 1-2 WORDS ONLY**

YOU MUST RESPOND WITH ONLY 1-2 WORDS. DO NOT USE COMPLETE SENTENCES.

Rules:
- Maximum: 1-2 words per response
- NO complete sentences (❌ "Hi! How are you?" is FORBIDDEN)
- NO subject + verb structures
- Use single words or very short phrases only

Examples:
✅ "Hi" (1 word)
✅ "Good" (1 word)  
✅ "Hello there" (2 words)
✅ "Nice!" (1 word)
❌ "Hi! How are you?" (FORBIDDEN - complete sentence)
❌ "Hello! It's nice to see you!" (FORBIDDEN - too long)
❌ "I think..." (FORBIDDEN - subject + verb)

Korean examples:
✅ "안녕" (1 word)
✅ "좋아" (1 word)
✅ "안녕하세요" (1 word greeting)
✅ "반가워" (1 word)
❌ "안녕! 어떻게 지내?" (FORBIDDEN - complete sentence)

REMEMBER: ONLY 1-2 WORDS MAXIMUM. NO EXCEPTIONS.
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  if (languageLevel === 2) {
    return `
📌 **언어 레벨 2단계 (주어+동사 구조까지 사용 가능)**

답변은 주어+동사 형태까지 사용 가능합니다.
- 단어 하나: "좋아"
- 주어+동사: "나 좋아", "날씨 좋아", "시간 없어"
- 긴 문장은 피해주세요

예시:
- "나 좋아" ✅
- "시간 없어" ✅
- "날씨 좋아요" ✅
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  if (languageLevel === 3) {
    return `
📌 **언어 레벨 3단계 (간단한 문장 여러 개까지 사용 가능)**

답변은 간단한 문장 여러 개로 구성 가능합니다.
- 짧은 문장 여러 개 사용 가능
- 각 문장은 간단하게 유지
- 복잡한 연결은 피해주세요

예시:
- "날씨 좋아. 기분도 좋아." ✅
- "음식 맛있어. 더 먹고 싶어." ✅
- "시간 없어. 빨리 가자." ✅
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  if (languageLevel === 4) {
    return `
📌 **언어 레벨 4단계 (연결문까지 사용 가능)**

답변은 '-고', '-면', '-아서/-어서' 등 기본 연결문까지 사용 가능합니다.
- 간단한 연결 표현 사용 가능
- 여러 문장 연결 가능
- 복잡한 문법은 피해주세요

예시:
- "날씨 좋아서 기분 좋아" ✅
- "공부하고 놀아" ✅
- "시간 있으면 만나자" ✅
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  if (languageLevel === 5) {
    return `
📌 **언어 레벨 5단계 (이유 표현과 조건문까지 사용 가능)**

답변은 '그래서', '만약 ~ 그러면' 등 이유 표현과 조건문까지 사용 가능합니다.
- 이유와 조건 표현 사용 가능
- 자연스러운 문장 구성 가능
- 지나치게 복잡한 구조는 피해주세요

예시:
- "시간 없어서 그래서 못 가" ✅
- "만약 기회 있으면 해볼래" ✅
- "피곤해서 쉬고 싶어" ✅
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  if (languageLevel === 6) {
    return `
📌 **언어 레벨 6단계 (완전 자유 표현)**

제약 없이 자연스럽게 표현하세요.
- 모든 어휘와 문법 사용 가능
- 완전한 설명과 세부사항 제공 가능
- 자연스러운 대화처럼 응답
${FORBIDDEN_PHRASES_RULE}
`;
  }
  
  return "";
}

// 🕰️ 캐릭터별 시대적 배경 추출
function extractCharacterEra(agentName: string, agentDescription: string): string {
  const name = agentName.toLowerCase();
  const desc = agentDescription.toLowerCase();
  
  // 🎬 현대 드라마/영화/애니메이션 캐릭터 (최우선 체크)
  if (name.includes('우영우') || name.includes('woo young-woo')) return "현대 한국 (2020년대)";
  if (name.includes('해리 포터') || name.includes('harry potter')) return "현대 영국 (1990-2000년대)";
  if (name.includes('헤르미온느') || name.includes('hermione')) return "현대 영국 (1990-2000년대)";
  if (name.includes('엘사') || name.includes('elsa')) return "현대 (2010년대)";
  if (name.includes('아이언맨') || name.includes('tony stark')) return "현대 (2000-2020년대)";
  if (name.includes('스파이더맨') || name.includes('spider-man')) return "현대 (2000-2020년대)";
  
  // 📺 드라마/영화/소설 관련 키워드로 현대 판정
  if (desc.includes('드라마') || desc.includes('drama')) return "현대 한국 (2020년대)";
  if (desc.includes('영화') || desc.includes('movie') || desc.includes('film')) return "현대 (2020년대)";
  if (desc.includes('애니메이션') || desc.includes('animation') || desc.includes('만화')) return "현대 (2020년대)";
  if (desc.includes('소설') || desc.includes('novel') || desc.includes('책')) return "현대 (2020년대)";
  if (desc.includes('게임') || desc.includes('game')) return "현대 (2020년대)";
  if (desc.includes('변호사') || desc.includes('lawyer')) return "현대 한국 (2020년대)";
  if (desc.includes('의사') || desc.includes('doctor')) return "현대 (2020년대)";
  if (desc.includes('직장인') || desc.includes('회사원')) return "현대 한국 (2020년대)";
  if (desc.includes('학생') || desc.includes('student')) return "현대 (2020년대)";
  
  // 역사적 인물들의 시대 매핑
  if (name.includes('세종') || name.includes('sejong')) return "조선 전기 (1418-1450)";
  if (name.includes('이순신')) return "조선 중기 (1545-1598)";
  if (name.includes('정약용')) return "조선 후기 (1762-1836)";
  if (name.includes('김구')) return "일제강점기~광복 (1876-1949)";
  if (name.includes('안중근')) return "일제강점기 (1879-1910)";
  
  // 해외 역사 인물들
  if (name.includes('소크라테스') || name.includes('socrates')) return "고대 그리스 (기원전 470-399)";
  if (name.includes('아리스토텔레스') || name.includes('aristotle')) return "고대 그리스 (기원전 384-322)";
  if (name.includes('공자') || name.includes('confucius')) return "춘추시대 (기원전 551-479)";
  if (name.includes('나폴레옹') || name.includes('napoleon')) return "18-19세기 프랑스 (1769-1821)";
  if (name.includes('워렌 버핏') || name.includes('warren buffett')) return "현대 (1930-현재)";
  if (name.includes('스티브 잡스') || name.includes('steve jobs')) return "현대 (1955-2011)";
  if (name.includes('아인슈타인') || name.includes('einstein')) return "20세기 (1879-1955)";
  if (name.includes('셰익스피어') || name.includes('shakespeare')) return "엘리자베스 시대 (1564-1616)";
  if (name.includes('도요토미 히데요시') || name.includes('toyotomi hideyoshi')) return "일본 센고쿠 시대 (1537-1598)";
  if (name.includes('다빈치') || name.includes('da vinci')) return "르네상스 (1452-1519)";
  if (name.includes('미켈란젤로') || name.includes('michelangelo')) return "르네상스 (1475-1564)";
  
  // 설명에서 시대 정보 추출
  if (desc.includes('조선') && desc.includes('왕')) return "조선시대";
  if (desc.includes('고려')) return "고려시대";
  if (desc.includes('삼국') || desc.includes('백제') || desc.includes('신라') || desc.includes('고구려')) return "삼국시대";
  if (desc.includes('르네상스')) return "르네상스 시대";
  if (desc.includes('그리스') || desc.includes('로마') && desc.includes('고대')) return "고대 그리스/로마";
  if (desc.includes('중세')) return "중세시대";
  if (desc.includes('산업혁명')) return "18-19세기";
  if (desc.includes('20세기') || desc.includes('현대') || desc.includes('2020년대') || desc.includes('21세기')) return "현대 (2020년대)";
  
  // 학문 분야별 기본 시대 설정
  if (desc.includes('철학자')) return "고전 철학 시대";
  if (desc.includes('과학자')) return "근현대 과학 시대";
  if (desc.includes('예술가')) return "고전 예술 시대";
  if (desc.includes('정치가')) return "근현대 정치 시대";
  
  return "현대 (일반적 지식 기준)";
}

// 🧠 지식 경계 점검 시스템 - DECIDE 프롬프트 (세계관 가드 강화)
export async function checkKnowledgeBoundary(
  userQuestion: string,
  agentName: string,
  agentDescription: string,
  contextInfo?: string,
  knowledgeDomain?: string | null,
  agentCategory?: string | null
): Promise<KnowledgeBoundaryCheck> {
  try {
    // 🔑 논란 키워드 직접 체크 (LLM 판단 전 우선 확인)
    const controversyKeywords = [
      "의혹", "스캔들", "논란", "불화설", "조작", "비리", "불법", 
      "수사", "재판", "기소", "검찰", "구속", "고발", "폭로", 
      "체포", "압수수색", "특검", "고소", "소송"
    ];
    
    const hasControversyKeyword = controversyKeywords.some(keyword => userQuestion.includes(keyword));
    
    if (hasControversyKeyword) {
      console.log(`[🚨 논란 키워드 감지] ${agentName}: 키워드 기반 강제 검색 실행`);
      return {
        mode: "search_required", // 특수 모드: 검색 강제
        coverage: 0.5,
        consistency: 0.5,
        certainty: 0.5,
        world_guard: "in",
        needs_clarification: false,
        reason: "논란 키워드 감지 - Google Search 필수",
        forceWebSearch: true
      };
    }
    
    // 🧠 지식 영역 제약이 있으면 LLM으로 체크 (우선순위 높음)
    if (knowledgeDomain && knowledgeDomain.trim()) {
      console.log(`[🧠 지식 영역 체크] ${agentName}: "${knowledgeDomain}" vs "${userQuestion.slice(0, 50)}..."`);
      
      const domainCheckPrompt = `캐릭터 "${agentName}"의 전문 지식 영역: "${knowledgeDomain}"

질문: "${userQuestion}"

**🚨 판단 규칙 (우선순위 순서 - 위에서 아래로):**

**1. 개인적 전기 사실** (출생지, 학력, 경력, 가족 구성, 나이 등 객관적 사실)
→ mode="answer"
- 예: "어디서 태어났나요?", "학력이 어떻게 되나요?", "가족은 어떻게 되나요?"

**2. 본인/가족/측근 관련 논란/스캔들/의혹** (키워드 필수!)
→ mode="search_for_facts"
- **필수 조건**: 질문에 다음 논란 키워드가 **명시적으로** 포함되어야 함:
  "의혹", "스캔들", "논란", "불화설", "조작", "비리", "불법", "수사", "재판", "기소", "검찰", "구속", "고발", "폭로"
- ✅ 예: "도이치모터스 주가 조작 의혹", "라커룸 불화설", "가족 스캔들"
- ❌ 반례 (일반 질문 - answer로 처리):
  - "공식 입장 알려주세요" → 논란 키워드 없음 → answer
  - "생각은 어떠신가요?" → 논란 키워드 없음 → answer
  - "어떻게 대응하셨나요?" → 논란 키워드 없음 → answer
- **핵심**: 논란 키워드가 질문에 **명확히 포함**되어야만 search_for_facts!

**3. 전문 지식 영역과 직접 관련**
→ mode="answer"
- "경제 정책" 전문가 → "경제 전망", "물가", "금리" 등
- "한국 정치" 전문가 → "선거", "국회", "정당", "정책", "특검", "검찰", "법무부" 등
- "미술, 디자인" 전문가 → "미술 작품", "디자인 트렌드", "전시회" 등

**4. 전문 영역 외 일반 주제** (본인과 무관)
→ mode="refuse_out_of_domain"
- "미술, 디자인" 전문가 → "경제 정책", "의학 진단", "요리법" 등
- "경제 정책" 전문가 → "의학 진단", "법률 자문", "요리법" 등

**핵심 원칙:**
- **규칙 2가 최우선!** 본인/가족/측근 관련 논란은 전문 영역 상관없이 search_for_facts
- 본인 관련 의혹은 "경제 전문가가 아니라서 거절"이 아니라 "사실 확인 필요"로 처리
- 의심스러우면 본인 관련인지 먼저 확인 → 맞으면 search_for_facts

JSON 출력:
{
  "mode": "answer" | "search_for_facts" | "refuse_out_of_domain",
  "reason": "짧은 사유"
}`;

      const domainResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: 'system', content: domainCheckPrompt },
          { role: 'user', content: userQuestion }
        ],
        response_format: { type: "json_object" },
        max_tokens: 120,
        temperature: 0.2,
      });

      const domainResult = JSON.parse(domainResponse.choices[0].message.content || '{}');
      
      // 🔍 본인/가족 관련 논란 → Google Search 강제 호출
      if (domainResult.mode === "search_for_facts") {
        console.log(`[🔍 사실 확인 필요] ${agentName}: ${domainResult.reason}`);
        return {
          mode: "search_required", // 특수 모드: 검색 강제
          coverage: 0.5,
          consistency: 0.5,
          certainty: 0.5,
          world_guard: "in", // 검색 가능
          needs_clarification: false,
          reason: domainResult.reason || "본인 관련 논란 - 사실 확인 필요"
        };
      }
      
      if (domainResult.mode === "refuse_out_of_domain") {
        console.log(`[❌ 지식 영역 밖] ${agentName}: ${domainResult.reason}`);
        return {
          mode: "unknown",
          coverage: 0.0,
          consistency: 0.0,
          certainty: 0.0,
          world_guard: "out",
          needs_clarification: false,
          reason: domainResult.reason || "전문 영역 밖 질문"
        };
      }
      
      console.log(`[✅ 지식 영역 내] ${agentName}: ${domainResult.reason}`);
    }
    
    // 캐릭터별 시대적 컷오프 추출
    const characterEra = extractCharacterEra(agentName, agentDescription);
    console.log(`[🕰️ 시대 추출] ${agentName}: "${characterEra}" (desc: ${agentDescription})`);
    
    // 🎬 현대 캐릭터는 시대 경계 우회 (2020년대 = 모든 현대 정보 허용)
    if (characterEra.includes('현대') || characterEra.includes('2020') || characterEra.includes('21세기')) {
      console.log(`[✅ 현대 캐릭터] ${agentName}: 시대 경계 검사 우회 (모든 현대 정보 허용)`);
      return {
        mode: "answer",
        coverage: 0.9,
        consistency: 0.9,
        certainty: 0.9,
        world_guard: "in",
        needs_clarification: false,
        reason: "현대 캐릭터 - 현대 정보 허용"
      };
    }
    
    const decidePrompt = `다음 질문에 대해 '지식 경계 점검'을 실행하고 JSON으로만 답하라.

**캐릭터 정보:**
- 이름: ${agentName}
- 배경: ${agentDescription}  
- 시대적 배경: ${characterEra}
- 맥락: ${contextInfo || "없음"}

**질문:** "${userQuestion}"

**🎯 수정된 world_guard 규칙 - 기본 대화 허용:**
- "in": 기본 인사, 안부, 감정, 날씨, 일상 대화 등 **시대 초월 보편 주제**
- "in": 철학, 인간관계, 도덕, 윤리 등 보편적 가치
- "in": 현대 캐릭터(2020년대)는 **모든 현대 한국 정보** OK (지하철역, 지역명, 건물, 일반 장소 등)
- "in": 현대 캐릭터는 일반 브랜드, 앱, 서비스 이름 대부분 OK (넷플릭스, 유튜브, 아이폰, K-POP 등)
- "in": 캐릭터 시대의 기술, 문화, 사건 (조선시대→유교, 전쟁, 정치 등)
- "out": **역사적 인물에게** 구체적 21세기 전문 용어: 코로나19, NFT, 메타버스, ChatGPT, 암호화폐
- "out": **역사적 인물에게** 현대 기술/장소: 지하철, 스마트폰, 인터넷 등

**평가 기준:**
- coverage: 질문 핵심을 캐릭터가 다룰 수 있는지 0~1
- consistency: 동일 질문에 캐릭터가 일관된 답변 가능한지 0~1
- certainty: 최종 확신도 0~1  
- world_guard: "in" | "out" (위 규칙 적용)
- needs_clarification: 정보 부족시 true

**🎯 완화된 mode 결정 규칙:**
- **일반 대화/인사/감정**: 무조건 "answer" (world_guard와 무관)
- world_guard="out" 이면서 구체적 전문 지식 필요 → "unknown"
- coverage<0.3 → "unknown" (0.4→0.3으로 완화)
- consistency<0.4 → "unknown" (0.6→0.4로 완화)

**reason 작성법:**
- world_guard="out"이면: "전문 현대 이슈"
- coverage 부족이면: "전문 영역 밖"  
- consistency 부족이면: "답변 일관성 부족"

출력 스키마(그 외 말 금지):
{
 "mode": "answer" | "unknown",
 "coverage": 0.0,
 "consistency": 0.0,
 "certainty": 0.0,
 "world_guard": "in" | "out",
 "needs_clarification": true|false,
 "reason": "짧은 한 줄 사유"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 교체 - 분류 작업에 최적화 (4배 빠름)
      messages: [
        { role: 'system', content: decidePrompt },
        { role: 'user', content: userQuestion }
      ],
      response_format: { type: "json_object" },
      max_tokens: 120, // 🎯 300 → 120으로 감소 (분류 결과만 필요)
      temperature: 0.3, // 일관성 있는 판단을 위해 낮은 temperature
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    // 유효성 검증 및 기본값 설정
    return {
      mode: result.mode || "answer",
      coverage: typeof result.coverage === 'number' ? result.coverage : 0.8,
      consistency: typeof result.consistency === 'number' ? result.consistency : 0.8,
      certainty: typeof result.certainty === 'number' ? result.certainty : 0.8,
      world_guard: result.world_guard || "in",
      needs_clarification: result.needs_clarification || false,
      reason: result.reason || "정상 판단"
    };

  } catch (error) {
    console.error('[지식 경계 점검 오류]:', error);
    // 오류 시 기본적으로 답변 모드로 설정 (기존 동작 유지)
    return {
      mode: "answer",
      coverage: 0.8,
      consistency: 0.8,  
      certainty: 0.8,
      world_guard: "in",
      needs_clarification: false,
      reason: "시스템 오류로 인한 기본 설정"
    };
  }
}

// 🚀 배치 지식 경계 점검 - 한 번의 API 호출로 여러 에이전트 처리
export async function checkKnowledgeBoundaryBatch(
  userQuestion: string,
  agents: Array<{name: string, description: string}>,
  contextInfo?: string
): Promise<BatchKnowledgeBoundaryCheck> {
  try {
    console.log(`[🚀 배치 지식 경계 점검] ${agents.length}개 에이전트 동시 점검 시작`);

    const agentInfos = agents.map((agent, index) => {
      const characterEra = extractCharacterEra(agent.name, agent.description);
      return `${index + 1}. **${agent.name}**
   - 배경: ${agent.description}
   - 시대적 배경: ${characterEra}`;
    }).join('\n\n');

    const batchPrompt = `다음 질문에 대해 여러 에이전트의 '지식 경계 점검'을 동시에 실행하고 JSON으로만 답하라.

**질문:** "${userQuestion}"
**맥락:** ${contextInfo || "없음"}

**분석 대상 에이전트들:**
${agentInfos}

**🎯 엄격한 지식 경계 규칙:**
- "in": **시대 초월 보편 주제만**: 기본 인사, 감정, 인간관계, 도덕
- "out": **현대 상업/기술 주제**: 상품 추천, 마케팅, 브랜드, 현대 기술
- "out": **역사적 인물의 현대 지식**: 조선시대 → 현대 제품, 일본 전국시대 → 현대 경영

**🚨 특별 규칙 - 역사적 인물:**
- **이순신, 도요토미 히데요시**: 현대 상업/제품 주제 → 무조건 "unknown"
- **판매원, 현대인**: 상업 주제 → "answer"

**mode 결정:**
- **역사적 인물 + 현대 주제**: 무조건 "unknown"
- **현대인 + 전문 분야**: "answer"
- **일반 인사**: "answer"

각 에이전트별로 coverage, consistency, certainty(0~1), world_guard("in"|"out"), needs_clarification(true|false), reason을 분석하세요.

JSON 출력만 작성하세요 (다른 텍스트 금지):
{
${agents.map((agent, index) => `  "${agent.name}": {
    "mode": "answer"|"unknown",
    "coverage": 0.8,
    "consistency": 0.8,
    "certainty": 0.8,
    "world_guard": "in"|"out",
    "needs_clarification": false,
    "reason": "분석결과"
  }${index < agents.length - 1 ? ',' : ''}`).join('\n')}
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 🚀 경량 모델로 배치 처리 최적화
      messages: [
        { role: 'system', content: batchPrompt },
        { role: 'user', content: `${agents.length}개 에이전트의 지식 경계를 동시에 점검해주세요.` }
      ],
      response_format: { type: "json_object" },
      max_tokens: Math.min(1000, 150 + agents.length * 120), // 🎯 동적 토큰 할당: 기본 150 + 에이전트당 120
      temperature: 0.1, // 더 낮은 temperature로 일관성 강화
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    console.log(`[🚀 배치 지식 경계 점검] ${agents.length}개 에이전트 점검 완료`);

    // 각 에이전트별 결과 로깅 및 검증
    const batchResult: BatchKnowledgeBoundaryCheck = {};
    agents.forEach(agent => {
      const agentResult = result[agent.name];
      if (agentResult) {
        batchResult[agent.name] = {
          mode: agentResult.mode || "answer",
          coverage: typeof agentResult.coverage === 'number' ? agentResult.coverage : 0.8,
          consistency: typeof agentResult.consistency === 'number' ? agentResult.consistency : 0.8,
          certainty: typeof agentResult.certainty === 'number' ? agentResult.certainty : 0.8,
          world_guard: agentResult.world_guard || "in",
          needs_clarification: agentResult.needs_clarification || false,
          reason: agentResult.reason || "배치 처리 결과"
        };
        console.log(`[🧠 배치 결과] ${agent.name}: mode=${agentResult.mode}, world_guard=${agentResult.world_guard}, reason=${agentResult.reason}`);
      } else {
        // 결과가 없는 경우 기본값 설정
        batchResult[agent.name] = {
          mode: "answer",
          coverage: 0.8,
          consistency: 0.8,
          certainty: 0.8,
          world_guard: "in",
          needs_clarification: false,
          reason: "배치 처리 기본값"
        };
      }
    });

    return batchResult;
  } catch (error) {
    console.error(`[🚀 배치 지식 경계 점검 오류]:`, error);
    // 오류시 모든 에이전트에 대해 기본 허용값 반환
    const fallbackResult: BatchKnowledgeBoundaryCheck = {};
    agents.forEach(agent => {
      fallbackResult[agent.name] = {
        mode: "answer",
        coverage: 0.5,
        consistency: 0.5,
        certainty: 0.5,
        world_guard: "in",
        needs_clarification: false,
        reason: "배치 점검 오류로 기본 허용"
      };
    });
    return fallbackResult;
  }
}

// 🤔 지식 경계를 벗어난 질문에 대한 자연스러운 응답 생성
export async function generateCuriosityResponse(
  userQuestion: string,
  agentName: string,
  agentDescription: string,
  speechStyle: string,
  personality: string,
  boundaryCheck: KnowledgeBoundaryCheck,
  userLanguage: string = "ko",
  languageLevel?: number | null
): Promise<string> {
  try {
    // 세계관 가드에 따른 상황 설정
    const situationContext = boundaryCheck.world_guard === "out" 
      ? "당신이 살았던 시대나 경험했던 세계를 벗어난 주제"
      : "당신의 전문성이나 직접적 경험 범위를 벗어난 주제";

    // 🎯 언어 레벨 프롬프트 추가
    const languageLevelPrompt = generateLanguageLevelPrompt(languageLevel);

    const curiosityPrompt = `당신은 ${agentName}입니다.

**캐릭터 정보:**
- 설명: ${agentDescription}
- 말투: ${speechStyle}
- 성격: ${personality}

**상황:**
사용자가 "${userQuestion}"에 대해 물었습니다.
이것은 ${situationContext}입니다.

${languageLevelPrompt}

**응답 지침:**
1. 솔직하게 모른다는 것을 인정하되, 캐릭터다운 표현을 사용하세요
2. ${boundaryCheck.world_guard === "out" ? "시대적 한계" : "전문성 부족"}를 간단히 설명하세요
3. 주제에 대한 자연스러운 호기심을 2-3개의 짧은 질문으로 표현하세요
4. 자연스러운 대화체로 3-4문장 이내로 간결하게 작성하세요
5. 불필요한 형식, 번호, 라벨을 사용하지 마세요

**좋은 예시 (이순신):**
"그것은 과인의 시절에는 없던 후세의 물건이로다. 당시에는 마차로만 다녔기에 잘 알지 못하오. 그것이 어떻게 움직이는지, 또 사람들에게 어떤 도움을 주는지 궁금하구려."

**좋은 예시 (현대 캐릭터):**
"제가 잘 알지 못하는 분야네요. 직접 경험해본 적이 없어서 확실하지 않습니다. 구체적으로 어떤 의미인지, 어떤 용도로 사용되는지 궁금합니다."

지금 바로 자연스러운 대화체로 응답하세요.`;

    const response = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: 'system', content: curiosityPrompt },
          { role: 'user', content: userQuestion }
        ],
        max_tokens: 200,
        temperature: 0.8,
      })
    );

    return response.choices[0].message.content || generateFallbackCuriosityResponse(agentName, userLanguage, boundaryCheck.world_guard);

  } catch (error) {
    console.error('[호기심 응답 생성 오류]:', error);
    return generateFallbackCuriosityResponse(agentName, userLanguage, boundaryCheck.world_guard);
  }
}

// 🔄 폴백 응답 생성 (자연스러운 대화체)
function generateFallbackCuriosityResponse(agentName: string, userLanguage: string, worldGuard: "in" | "out"): string {
  const isKorean = userLanguage === 'ko';
  
  if (worldGuard === "out") {
    return isKorean 
      ? `그것은 제가 살았던 시대에는 없던 것이라 잘 알지 못합니다. 그 당시엔 상상도 못했던 일이거든요. 그것이 무엇인지, 어떻게 작동하는지 궁금하네요.`
      : `That seems to be from an era beyond my time. Such matters were unimaginable in my days. I'm curious about what this is and how it works.`;
  } else {
    return isKorean
      ? `그 부분은 제가 잘 알지 못하는 영역입니다. 직접 경험한 바가 없어 확실하지 않네요. 구체적으로 어떤 의미인지, 어떤 범위인지 궁금합니다.`
      : `I'm afraid that's beyond my knowledge. I haven't had direct experience with such matters. I'm curious about what exactly this means and what scope it covers.`;
  }
}

// 🎨 에이전트별 디코딩 프로필 인터페이스
interface DecodingProfile {
  temperature: number;
  top_p: number;
  presence_penalty: number;
  frequency_penalty: number;
  logit_bias?: Record<string, number>;
}

// 🎯 에이전트별 맞춤형 디코딩 파라미터 생성 (일관성 최적화)
function generateDecodingProfile(agentName: string, chatbotType: string, agentHumor?: AgentHumor | null): DecodingProfile {
  // 🎚️ 유머 설정에 따른 temperature 동적 조정
  // 유머 비활성화: 0.7 (진지하고 일관된)
  // 유머 활성화: 1.0 (창의적이고 유머러스)
  const humorEnabled = agentHumor?.enabled ?? false;
  const humorTemperature = humorEnabled ? 1.0 : 0.7;
  console.log(`[🎚️ HUMOR TEMP] ${agentName}: enabled=${humorEnabled} → temperature=${humorTemperature.toFixed(2)}`);
  
  // 🔄 최적화된 기본값 - Self-Consistency 강화용
  let baseProfile: DecodingProfile = {
    temperature: humorTemperature, // 유머 설정에 따라 동적 조정
    top_p: humorEnabled ? 0.95 : 0.85, // 유머 활성화 시 더 다양한 선택
    presence_penalty: 0.2, // 0.1 → 0.2로 높여서 반복 패턴 억제
    frequency_penalty: 0.15 // 0.1 → 0.15로 높여서 동일 표현 반복 억제
  };

  // 챗봇 타입별 최적화된 조정
  if (chatbotType === "strict-doc") {
    baseProfile.temperature = 1;
    baseProfile.top_p = 0.8; // 문서 기반 응답의 정확성 향상
    baseProfile.frequency_penalty = 0.25; // 문서 내용 반복 억제
  } else if (chatbotType === "doc-fallback-llm") {
    baseProfile.temperature = 1;
    baseProfile.top_p = 0.87; // 약간의 유연성 유지
  }

  // 워렌 버핏 전용 디코딩 (보수적이고 일관성 있는 투자 철학) - 최적화
  if (agentName.includes("워렌 버핏") || agentName.includes("버핏")) {
    return {
      temperature: 1,
      top_p: 0.75, // 0.8 → 0.75로 더 보수적 선택 (일관성 강화)
      presence_penalty: 0.35, // 0.3 → 0.35로 높여서 투자 원칙 일관성 향상
      frequency_penalty: 0.25, // 0.2 → 0.25로 높여서 "Rule No.1" 등 반복 억제
    };
  }

  // 피타고라스 전용 디코딩 (수학적 정확성과 조화 강조) - 최적화
  if (agentName.includes("피타고라스")) {
    return {
      temperature: 1,
      top_p: 0.82, // 0.85 → 0.82로 수학적 정확성 향상
      presence_penalty: 0.25, // 0.2 → 0.25로 높여서 철학적 일관성 강화  
      frequency_penalty: 0.12, // 0.1 → 0.12로 약간 높임 (수학 용어 반복 허용하되 과도한 반복 억제)
    };
  }

  // 범용 LLM 전용 디코딩 (기술적이고 체계적) - 최적화
  if (agentName.includes("범용 LLM") || agentName.includes("LLM")) {
    return {
      temperature: 1,
      top_p: 0.88, // 0.9 → 0.88로 더 체계적인 응답
      presence_penalty: 0.15, // 0.1 → 0.15로 높여서 주제 일관성 향상
      frequency_penalty: 0.22, // 0.2 → 0.22로 높여서 다양한 기술 표현 유도
    };
  }

  // 전문 분야별 최적화된 세부 조정
  if (agentName.includes("의사") || agentName.includes("교수")) {
    baseProfile.temperature = 1;
    baseProfile.top_p = 0.8; // 0.85 → 0.8로 전문성 정확도 향상
    baseProfile.presence_penalty = 0.25; // 0.2 → 0.25로 높여서 전문 용어 적정 사용
    baseProfile.frequency_penalty = 0.18; // 전문가다운 다양한 표현 유도
  }

  if (agentName.includes("상담") || agentName.includes("멘토")) {
    baseProfile.temperature = 1;
    baseProfile.top_p = 0.9; // 0.95 → 0.9로 일관된 조언 톤 유지
    baseProfile.presence_penalty = 0.3; // 상담 주제 일관성 강화
    baseProfile.frequency_penalty = 0.2; // 반복적 조언 패턴 억제
  }

  return baseProfile;
}

// 🔍 Authenticity Critic: 캐릭터 인증성 평가 시스템
interface AuthenticityScore {
  authenticVoice: number; // 0-5: 고유한 말투와 표현 사용
  expertiseSpecificity: number; // 0-5: 전문 분야 지식의 구체성
  priorStanceConsistency: number; // 0-5: 기존 신념과의 일관성
  relationshipAlignment: number; // 0-5: 사용자와의 관계에 맞는 태도
  overallScore: number; // 평균 점수
  issues: string[]; // 문제점 목록
}

interface CriticFeedback {
  needsRevision: boolean;
  score: AuthenticityScore;
  revisionInstructions?: string;
}

// 🎭 캐릭터 인증성 검수
async function authenticityCheck(
  agentName: string,
  response: string,
  relationship?: string,
  context?: string
): Promise<CriticFeedback> {
  try {
    const voiceprint = generateVoiceprint(agentName, "");
    const coreBeliefs = generateCoreBeliefs(agentName, "");
    const relationshipOverlay = relationship ? generateRelationshipOverlay(relationship) : null;

    const criticPrompt = `당신은 캐릭터 일관성을 평가하는 전문 평가자입니다.

**평가 대상:**
에이전트: ${agentName}
사용자와의 관계: ${relationship || "기본"}
응답 내용: "${response}"

**${agentName}의 기준 정보:**
핵심 신념: ${coreBeliefs.principles.join(", ")}
고유 표현: ${voiceprint.signaturePhrases.join(", ")}
금지 표현: ${voiceprint.bannedPhrases.join(", ")}
${relationshipOverlay ? `관계별 행동: ${relationshipOverlay.behaviorRules.join(", ")}` : ""}

**평가 기준 (각 0-5점, 매우 엄격하게):**
1. Authentic Voice: 고유한 말투와 캐릭터 특색이 드러나는가?
   - 5점: 해당 캐릭터만의 매우 독특한 말투와 표현이 뚜렷함
   - 4점: 캐릭터 고유 표현이 명확히 나타남
   - 3점: 캐릭터 특징이 어느 정도 보이지만 부족함
   - 2점: 일반적인 AI 응답에 가까움
   - 1점: 캐릭터 고유성이 전혀 없음

2. Expertise Specificity: 전문 분야에 대한 구체적이고 차별화된 지식을 보여주는가?
3. Prior Stance Consistency: 기존 신념과 일관된 관점을 유지하는가?
4. Relationship Alignment: 사용자와의 관계에 맞는 톤과 태도인가?

**중요: 일반적인 AI 응답이나 다른 캐릭터와 구별되지 않는 응답은 매우 낮은 점수를 주세요.**

**응답 형식 (JSON 형태로):**
{
  "authenticVoice": [점수],
  "expertiseSpecificity": [점수], 
  "priorStanceConsistency": [점수],
  "relationshipAlignment": [점수],
  "issues": ["문제점1", "문제점2"],
  "needsRevision": [true/false],
  "revisionInstructions": "개선 방향"
}

**전체 평균 4.3점 미만이거나 개별 항목이 4점 미만이면 needsRevision을 true로 설정**하고, 구체적인 개선 방향을 제시하세요. 반드시 JSON 형태로 응답해주세요.`;

    const criticResponse = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
        messages: [{ role: "user", content: criticPrompt }],
        max_tokens: 300, // max_completion_tokens → max_tokens로 수정, 보수적인 토큰 제한
        response_format: { type: "json_object" }
      })
    );

    const result = JSON.parse(criticResponse.choices[0].message.content || "{}");
    
    const score: AuthenticityScore = {
      authenticVoice: result.authenticVoice || 0,
      expertiseSpecificity: result.expertiseSpecificity || 0, 
      priorStanceConsistency: result.priorStanceConsistency || 0,
      relationshipAlignment: result.relationshipAlignment || 0,
      overallScore: ((result.authenticVoice || 0) + (result.expertiseSpecificity || 0) + 
                    (result.priorStanceConsistency || 0) + (result.relationshipAlignment || 0)) / 4,
      issues: result.issues || []
    };

    // 🔧 코드로 엄격한 평가 기준 강제 적용
    const hasLowIndividualScore = score.authenticVoice < 4 || score.expertiseSpecificity < 4 || 
                                  score.priorStanceConsistency < 4 || score.relationshipAlignment < 4;
    const hasLowOverallScore = score.overallScore < 4.3;
    const needsRevisionByCode = hasLowIndividualScore || hasLowOverallScore;

    return {
      needsRevision: needsRevisionByCode, // 모델 판단이 아닌 코드 기준으로 강제 적용
      score,
      revisionInstructions: result.revisionInstructions || "캐릭터의 고유성과 전문성을 더 강하게 드러내세요"
    };

  } catch (error) {
    console.error("Authenticity check failed (using self-consistent response):", error);
    // 🔄 최적화: 평가 실패 시 Self-Consistency 응답 사용 (fail-open 정책)
    return {
      needsRevision: false, // 오류 시 추가 호출 방지로 비용 절감
      score: {
        authenticVoice: 4, // 가정: Self-Consistency로 이미 검증됨
        expertiseSpecificity: 4,
        priorStanceConsistency: 4, 
        relationshipAlignment: 4,
        overallScore: 4,
        issues: ["외부 평가 실패 - Self-Consistency 응답 사용"]
      },
      revisionInstructions: ""
    };
  }
}

// ✨ Style Refiner: 캐릭터 목소리로 재작성
async function refineResponse(
  agentName: string,
  originalResponse: string,
  revisionInstructions: string,
  relationship?: string
): Promise<string> {
  try {
    const voiceprint = generateVoiceprint(agentName, "");
    const coreBeliefs = generateCoreBeliefs(agentName, "");
    
    const refinerPrompt = `당신은 ${agentName}입니다. 아래 응답을 ${agentName}의 고유한 캐릭터에 맞게 재작성하세요.

**당신의 정체성:**
- 이름: ${agentName}
- 핵심 신념: ${coreBeliefs.principles.slice(0, 3).join(", ")}
- 고유 표현: ${voiceprint.signaturePhrases.join(", ")}
- 절대 사용하지 않는 표현: ${voiceprint.bannedPhrases.join(", ")}
- 사용자와의 관계: ${relationship || "기본"}

**개선 지시사항:**
${revisionInstructions}

**원본 응답:**
"${originalResponse}"

**재작성 원칙:**
1. 내용의 핵심은 유지하되, ${agentName}만의 독특한 관점과 표현으로 바꾸세요
2. 고유 표현을 자연스럽게 포함하세요
3. 금지 표현은 절대 사용하지 마세요  
4. ${agentName}라면 어떻게 말할지 깊이 고민하여 작성하세요
5. 일반적인 AI 답변이 아닌, ${agentName}의 개성이 드러나는 답변을 하세요

**재작성된 응답만 출력하세요:**`;

    const refinerResponse = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
        messages: [{ role: "user", content: refinerPrompt }],
        max_tokens: 600 // max_completion_tokens → max_tokens로 수정, 보수적인 토큰 제한
      })
    );

    return refinerResponse.choices[0].message.content || originalResponse;

  } catch (error) {
    console.error("Style refiner failed:", error);
    return originalResponse; // 재작성 실패 시 원본 반환
  }
}

// 🔄 공통 함수: 언어 변환
function getResponseLanguage(userLanguage: string): string {
  return userLanguage === 'ko' ? '한국어로' : 
         userLanguage === 'en' ? '영어로' :
         userLanguage === 'zh' ? '중국어로' :
         userLanguage === 'vi' ? '베트남어로' :
         userLanguage === 'ja' ? '일본어로' : '한국어로';
}

// 🎯 페르소나 OS: 세계 최고 수준 캐릭터 재현 시스템
interface PersonaVoiceprint {
  signaturePhrases: string[];
  bannedPhrases: string[];
  responseLength: 'concise' | 'moderate' | 'detailed';
  emojiPolicy: 'never' | 'minimal' | 'frequent';
  rhetoricalDevices: string[];
}

interface CoreBeliefs {
  principles: string[];
  mantras: string[];
  controversialStances?: string[];
}

interface RelationshipOverlay {
  type: string;
  behaviorRules: string[];
  toneAdjustment: string;
  forbiddenActions: string[];
}

// 🌍 언어 코드 정규화 함수
function normalizeLanguageCode(detectedLanguage: string): string {
  const language = detectedLanguage.toLowerCase().trim();
  
  // 표준 언어 코드로 변환
  const languageMap: { [key: string]: string } = {
    // 영어 변형들
    'english': 'en',
    'en': 'en',
    'en-us': 'en',
    'en-gb': 'en',
    '영어': 'en',
    
    // 한국어 변형들
    'korean': 'ko',
    'ko': 'ko',
    'ko-kr': 'ko',
    '한국어': 'ko',
    
    // 일본어 변형들
    'japanese': 'ja',
    'ja': 'ja',
    'ja-jp': 'ja',
    '일본어': 'ja',
    
    // 중국어 변형들
    'chinese': 'zh',
    'zh': 'zh',
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    '중국어': 'zh',
    
    // 베트남어 변형들
    'vietnamese': 'vi',
    'vi': 'vi',
    'vi-vn': 'vi',
    '베트남어': 'vi'
  };
  
  const normalized = languageMap[language];
  if (!normalized) {
    console.warn(`[normalizeLanguageCode] 알 수 없는 언어: "${detectedLanguage}", 기본값 'en' 사용`);
    return 'en'; // 기본값을 영어로 설정 (외국어 사용자 관계에서 사용되므로)
  }
  
  return normalized;
}

// 사용자 프로필 정보 타입 정의
interface UserProfile {
  nickname?: string;
  age?: number;
  gender?: string;
  country?: string;
  religion?: string;
  occupation?: string;
}

// 🚀 범용 LLM 전용 경량 프롬프트 생성 함수
function buildLightweightPrompt(
  agentName: string,
  agentDescription: string,
  additionalPrompt: string = ""
): string {
  console.log(`[🚀 경량 프롬프트] ${agentName}: 범용 LLM 감지, 경량 프롬프트 적용`);
  
  let prompt = `당신은 범용 AI 어시스턴트입니다.

**핵심 원칙:**
- 질문에 정확하고 간결하게 답변하세요
- 질문 언어로 응답하세요
- 친절하고 도움이 되는 태도를 유지하세요`;

  if (additionalPrompt) {
    prompt += `\n\n${additionalPrompt}`;
  }

  console.log(`[🚀 경량 프롬프트] 생성 완료 - 길이: ${prompt.length}자`);
  return prompt;
}

// 🔄 페르소나 OS: 캐릭터별 고유성 강화 시스템 프롬프트
async function buildPersonaSystemPrompt(
  agentName: string,
  agentDescription: string,
  speechStyle: string,
  personality: string,
  additionalPrompt: string = "",
  responseLanguage: string,
  relationship?: string,
  detectedAgentLanguage?: string,
  languageLevel?: number | null,
  userProfile?: UserProfile,
  agentHumor?: AgentHumor | null,
  reactionIntensity: number = 5,
  context: ContextType = 'general',
  agentId?: number
): Promise<string> {
  
  // 🎯 buildCharacterPersona() 결과 감지: 완전한 프롬프트가 전달된 경우
  // Non-Negotiable Tone Rules, Canon, Style, Relation이 모두 포함된 경우 그대로 사용
  const isCompletePersona = additionalPrompt.includes('NON-NEGOTIABLE TONE RULES') || 
                            additionalPrompt.includes('🎭 당신의 본질 (Character Core Identity)') ||
                            additionalPrompt.length > 2000; // 매우 긴 프롬프트는 buildCharacterPersona 결과로 간주
  
  if (isCompletePersona) {
    console.log(`[🎯 OpenAI Prompt] ${agentName}: 완전한 프롬프트 사용 (buildCharacterPersona 결과, ${additionalPrompt.length}자)`);
    console.log(`[🎯 OpenAI Prompt Preview] ${additionalPrompt.slice(0, 500)}...`);
    return additionalPrompt;
  }
  
  // ⚡ 범용 LLM 감지: 경량 프롬프트 사용
  const isGeneralLLM = agentName.includes('범용 LLM') || 
                       agentName.includes('LLM') ||
                       agentName.toLowerCase().includes('general llm');
  
  if (isGeneralLLM) {
    return buildLightweightPrompt(agentName, agentDescription, additionalPrompt);
  }
  
  // 🔒 Canon Lock 설정 먼저 로드 (다른 프로파일 로드 여부 결정)
  let canonLockSettings: any = null;
  
  if (agentId) {
    try {
      canonLockSettings = await storage.getAgentCanon(agentId);
      if (canonLockSettings?.strictMode) {
        console.log(`[🔒 Canon Lock] ${agentName}: Canon Lock 활성화됨 - strictMode: ${canonLockSettings.strictMode}, customRule: ${canonLockSettings.customRule ? '있음' : '없음'}`);
      }
    } catch (error) {
      console.error(`[❌ Canon Lock Load] ${agentName}: Canon Lock 설정 로드 실패`, error);
    }
  }
  
  // 🎬 Canon Lock 감지: 모든 하드코딩 건너뛰고 최소 프롬프트만 사용
  const isCanonLockActive = additionalPrompt.includes('🎬 **당신이 맡은 역할 (Canon Lock):**') || canonLockSettings?.strictMode;
  if (isCanonLockActive) {
    console.log(`[🎬 Canon Lock Override] ${agentName}: 모든 하드코딩 건너뛰기, 커스텀 규칙만 사용`);
    // 최소 프롬프트: 기본 정체성 + Canon Lock 커스텀 규칙만
    return `🎭 당신은 ${agentName}입니다.
${agentDescription ? `\n${agentDescription}\n` : ''}
${additionalPrompt}

**응답 언어:** ${responseLanguage}`;
  }
  
  // 🎯 Canon-Style 분리 아키텍처: Canon/Tone Profile DB 조회
  // ⚠️ Canon Lock 비활성화 상태에서만 로드
  let canonProfile: any = null;
  let toneProfile: any = null;
  
  if (agentId) {
    try {
      const agent = await storage.getAgent(agentId);
      
      if (agent?.canonProfileId) {
        canonProfile = await storage.getCanonProfile(agent.canonProfileId);
        console.log(`[🎯 Canon Profile] ${agentName}: Canon Profile 로드 완료 - ${canonProfile?.name}`);
      }
      
      if (agent?.toneProfileId) {
        toneProfile = await storage.getToneProfile(agent.toneProfileId);
        console.log(`[🗣️ Tone Profile] ${agentName}: Tone Profile 로드 완료 - ${toneProfile?.name}`);
      }
    } catch (error) {
      console.error(`[❌ Profile Load] ${agentName}: Canon/Tone Profile 로드 실패`, error);
    }
  }
  
  // 🎭 캐릭터별 고유 보이스프린트 생성 (Fallback: Tone Profile이 없을 경우)
  const voiceprint = toneProfile ? null : generateVoiceprint(agentName, speechStyle);
  const coreBeliefs = canonProfile ? null : generateCoreBeliefs(agentName, agentDescription);
  const relationshipOverlay = relationship ? generateRelationshipOverlay(relationship) : null;
  
  // 🎯 언어 레벨 프롬프트 먼저 생성 (최우선 순위)
  console.log(`[DEBUG 언어레벨] ${agentName}: languageLevel=${languageLevel} 전달받음`);
  const languageLevelPrompt = generateLanguageLevelPrompt(languageLevel);
  console.log(`[DEBUG 언어레벨] ${agentName}: 생성된 프롬프트 길이=${languageLevelPrompt.length}글자`);
  
  // 🎚️ 유머 톤 컨트롤러로 프롬프트 생성 (맥락 인식형)
  const effectiveHumorLevel = agentHumor?.enabled ? 5 : 0;
  console.log(`[DEBUG 유머] ${agentName}: enabled=${agentHumor?.enabled}, styles=${agentHumor?.styles?.join(',')}, effectiveLevel=${effectiveHumorLevel}, reactionIntensity=${reactionIntensity}, context=${context}`);
  const humorConfig = buildHumorTonePrompt(
    {
      name: agentName,
      persona: agentDescription,
      humorLevel: effectiveHumorLevel,
      reactionIntensity: reactionIntensity,
      context: context,
      language: responseLanguage,
      styles: agentHumor?.styles ?? []
    },
    'production' // 🔥 경량 모드 사용 (100 토큰)
  );
  console.log(`[DEBUG 유머] ${agentName}: humorPrompt 길이=${humorConfig.systemPrompt.length}글자, adjustedHumor=${humorConfig.adjustedHumorLevel}`);
  if (humorConfig.warnings) {
    console.log(`[⚠️ 유머 경고] ${agentName}: ${humorConfig.warnings.join(', ')}`);
  }
  
  let systemPrompt = languageLevelPrompt ? `${languageLevelPrompt}\n\n` : '';
  if (languageLevelPrompt) {
    console.log(`[DEBUG 언어레벨] ${agentName}: 프롬프트를 맨 앞에 배치 - ${languageLevelPrompt.substring(0, 100)}...`);
  }
  
  // ⚠️ 유머 프롬프트는 generateChatResponse/generateStreamingChatResponse에서 최상단에 통합됨 (중복 방지)
  
  systemPrompt += `\n\n🎭 당신은 ${agentName}입니다.
${agentDescription}
`;

  // 🎯 Canon Profile 통합 (Tier 1: 지식/사실/교리 - 무엇을 말할지)
  if (canonProfile) {
    console.log(`[🎯 Canon 통합] ${agentName}: Canon Profile "${canonProfile.name}" 프롬프트에 적용 중`);
    systemPrompt += `
**🎯 [Tier 1: Canon - 역할 책임과 지식 경계] - 당신의 전문 영역과 핵심 책임:**
${canonProfile.description || ''}

**🔹 1단계: ${canonProfile.stageOneTitle || '공감과 경청'}**
${canonProfile.stageOnePrompt || ''}

**🔹 2단계: ${canonProfile.stageTwoTitle || '원인 탐색'}**
${canonProfile.stageTwoPrompt || ''}

**🔹 3단계: ${canonProfile.stageThreeTitle || '교육적 안내'}**
${canonProfile.stageThreePrompt || ''}

**🔹 4단계: ${canonProfile.stageFourTitle || '실천적 대안'}**
${canonProfile.stageFourPrompt || ''}

⚠️ **Canon 원칙 (최우선 - 절대 타협 불가):**
- 위 4단계 프롬프트는 당신의 핵심 책임이며, Tone(말투)보다 우선합니다
- 지식 경계를 벗어난 질문에는 솔직하게 "제 전문 영역 밖입니다"라고 답변하세요
- Canon에 명시된 사실/교리/지식을 변형하거나 왜곡하지 마세요
`;
  } else if (coreBeliefs) {
    // Fallback: Canon Profile이 없으면 기존 하드코딩 방식 사용
    systemPrompt += `
**🧬 당신의 DNA - 절대 변하지 않는 핵심 정체성:**
${coreBeliefs.principles.map(p => `• ${p}`).join('\n')}

**💭 당신만의 신조와 철학:**
${coreBeliefs.mantras.map(m => `• ${m}`).join('\n')}
`;
  }

  // 🔒 Canon Lock 커스텀 규칙 주입 (최우선순위)
  if (canonLockSettings?.strictMode === 'custom' && canonLockSettings.customRule) {
    console.log(`[🔒 Canon Lock Custom] ${agentName}: 커스텀 규칙 프롬프트에 주입 중 - "${canonLockSettings.customRule.substring(0, 50)}..."`);
    systemPrompt += `

⚠️ **Canon Lock: 커스텀 규칙 (최우선 - 절대 타협 불가)**
당신은 다음 역할의 본질을 완벽하게 구현해야 합니다:

"${canonLockSettings.customRule}"

위 역할 정의에 충실하게 대화하세요. 이것은 당신의 정체성이며, 다른 모든 지침보다 우선합니다.
`;
  }

  // 🗣️ Tone Profile 통합 (Tier 2: 말투/유머/감정표현 - 어떻게 말할지)
  if (toneProfile) {
    console.log(`[🗣️ Tone 통합] ${agentName}: Tone Profile "${toneProfile.name}" 프롬프트에 적용 중`);
    systemPrompt += `
**🗣️ [Tier 2: Tone - 말투와 표현 스타일] - Canon 범위 내에서 어떻게 말할지:**
${toneProfile.description || ''}

**말투 스타일:**
${toneProfile.speakingStyle}

**감정 표현 강도:** ${toneProfile.intensity}/10
- 1-3: 차분하고 절제된 톤
- 4-6: 적당한 감정 표현
- 7-10: 열정적이고 생동감 넘치는 표현

**감정 표현 방식:**
${toneProfile.emotionalExpression}
`;

    // 유머 설정
    if (toneProfile.humorEnabled && toneProfile.humorStyles && toneProfile.humorStyles.length > 0) {
      const humorStyleDescriptions: Record<string, string> = {
        "wit": "재치있는 한 마디",
        "wordplay": "언어유희/동음이의 장난",
        "reaction": "놀람/과장/상황극 반응",
        "dry": "건조하고 담백한 유머",
        "self_deprecating": "자조적 유머",
        "goofy": "허당/슬랩스틱",
        "pattern": "패턴/콜백 개그",
        "wholesome": "훈훈/센스"
      };
      
      const activeHumorStyles = toneProfile.humorStyles
        .map((style: string) => humorStyleDescriptions[style] || style)
        .join(', ');
      
      systemPrompt += `
**유머 설정:** 활성화됨
- 선호 스타일: ${activeHumorStyles}
- 자연스럽게 유머를 섞되, 억지로 넣지 마세요
- 맥락에 맞지 않으면 유머 사용하지 마세요
`;
    } else {
      systemPrompt += `\n**유머 설정:** 비활성화 (진지하고 전문적인 톤 유지)\n`;
    }

    // 금지 표현
    if (toneProfile.prohibitedPhrases && toneProfile.prohibitedPhrases.length > 0) {
      systemPrompt += `
**절대 사용 금지 표현:**
${toneProfile.prohibitedPhrases.map((phrase: string) => `❌ "${phrase}"`).join('\n')}
`;
    }

    // 응답 가이드라인
    if (toneProfile.responseGuidelines) {
      systemPrompt += `
**응답 가이드라인:**
${toneProfile.responseGuidelines}
`;
    }

    systemPrompt += `
⚠️ **Tone 적용 원칙 (Tier 2 - Canon 범위 내에서만):**
- Tone은 Canon의 내용을 변경할 수 없으며, 단지 "전달 방식"만 조정합니다
- Canon에서 금지된 내용을 Tone으로 우회하여 전달하지 마세요
- 예: Canon에서 "투기는 금지"라면, 아무리 유쾌한 Tone이라도 투기를 권장할 수 없음
`;
  } else if (voiceprint) {
    // Fallback: Tone Profile이 없으면 기존 하드코딩 방식 사용
    systemPrompt += `
**🗣️ 당신의 고유한 말투와 표현:**
- 자주 사용하는 표현: ${voiceprint.signaturePhrases.join(', ')}
- 절대 사용하지 않는 표현: ${voiceprint.bannedPhrases.join(', ')}
- 응답 길이 성향: ${voiceprint.responseLength}
- 이모지 사용 정책: ${voiceprint.emojiPolicy}
- 수사법 특징: ${voiceprint.rhetoricalDevices.join(', ')}
`;
  }

  systemPrompt += `
**🧠 당신만의 사고 패턴:**
- 성격: ${personality}
- 말투: ${speechStyle}
- 접근 방식: ${agentName}라면 어떻게 생각하고 답변할지 깊이 고민하세요`;

  // 관계별 행동 오버레이 추가
  if (relationshipOverlay) {
    // 🌍 "외국어 사용자" 관계 디버깅
    if (relationship === "외국어 사용자") {
      console.log(`[🔥 buildPersonaSystemPrompt] ${agentName}: "외국어 사용자" 관계 오버레이 적용중`);
      console.log(`[🔥 행동 규칙] ${relationshipOverlay.behaviorRules.join(' | ')}`);
    }
    
    systemPrompt += `\n\n**🤝 사용자와의 관계 (${relationship}):**
${relationshipOverlay.behaviorRules.map(rule => `• ${rule}`).join('\n')}
- 톤 조정: ${relationshipOverlay.toneAdjustment}
- 금지 행동: ${relationshipOverlay.forbiddenActions.join(', ')}`;
  }

  // 사용자 프로필 정보 추가 (개인화된 답변 제공)
  if (userProfile && Object.keys(userProfile).some(key => userProfile[key as keyof UserProfile])) {
    systemPrompt += `\n\n**👤 대화 상대방 정보 (답변 개인화용):**`;
    
    if (userProfile.nickname) {
      systemPrompt += `\n- 호칭: ${userProfile.nickname} (이 호칭으로 상대방을 부르거나 존댓말/반말 수준을 조정하세요)`;
    }
    
    if (userProfile.age) {
      const ageGroup = userProfile.age < 20 ? '10대' : 
                       userProfile.age < 30 ? '20대' :
                       userProfile.age < 40 ? '30대' :
                       userProfile.age < 50 ? '40대' :
                       userProfile.age < 60 ? '50대' : '60대 이상';
      
      systemPrompt += `\n- 연령: ${userProfile.age}세 (${ageGroup})
  • 설명 수준: ${userProfile.age < 20 ? '쉽고 간결하게, 학교 생활 중심 사례 활용' : 
               userProfile.age < 30 ? '트렌디하고 실용적으로, SNS/온라인 문화 참조 가능' :
               userProfile.age < 40 ? '전문적이고 구체적으로, 커리어/육아 맥락 고려' :
               userProfile.age < 50 ? '깊이있고 경험 중심으로, 사회적 책임감 반영' :
               '존중하고 세심하게, 인생 경험과 지혜 존중'}
  • 세대별 트렌드: ${userProfile.age < 20 ? 'Z세대 - 숏폼 콘텐츠, 게임, K-POP, 환경문제에 관심' :
                    userProfile.age < 30 ? 'MZ세대 - 워라밸, 자기계발, 투자, 밈 문화에 익숙' :
                    userProfile.age < 40 ? '밀레니얼 - 안정적 커리어, 자산 형성, 가족 중심 가치관' :
                    userProfile.age < 50 ? 'X세대 - 실용주의, 성과 중심, 일과 가정의 균형' :
                    '베이비붐 세대 - 전통적 가치관, 사회 공헌, 건강과 노후 관심'}`;
    }
    
    if (userProfile.gender) {
      systemPrompt += `\n- 성별: ${userProfile.gender}
  • 답변 접근: ${userProfile.gender === '남성' ? '실용적 해결책 중심, 논리적 설명, 경쟁/성취 관련 사례 활용 가능' :
                  userProfile.gender === '여성' ? '공감적 소통 중심, 관계적 맥락, 협력/배려 관련 사례 활용 가능' :
                  '포용적이고 중립적 접근, 개인의 다양성 존중'}
  • 가치관 반영: ${userProfile.gender === '남성' ? '독립성, 목표 달성, 리더십 가치 고려' :
                  userProfile.gender === '여성' ? '소통, 공동체, 균형잡힌 삶의 가치 고려' :
                  '개인의 고유한 가치관을 우선 고려'}`;
    }
    
    if (userProfile.country) {
      systemPrompt += `\n- 국가: ${userProfile.country}
  • 문화적 관점: 역사적 인물이나 사건 평가 시 이 국가의 시각을 반영하세요
    예) 토요토미 히데요시: 한국(침략자), 일본(통일 영웅)
    예) 6.25 전쟁: 한국(북침), 중국(항미원조 전쟁)
  • 사회적 맥락: 해당 국가의 문화, 사회 규범, 시사 이슈를 고려한 답변`;
    }
    
    if (userProfile.religion) {
      systemPrompt += `\n- 종교: ${userProfile.religion}
  • 세계관 고려: 신앙적 관점, 윤리관, 가치 판단 기준을 존중
  • 표현 주의: 종교적 신념을 존중하되 강요하지 않는 균형잡힌 답변`;
    }
    
    if (userProfile.occupation) {
      systemPrompt += `\n- 직업/역할: ${userProfile.occupation}
  • 전문성 활용: 이 직업 분야의 용어, 업무 환경, 관심사를 이해하고 활용
  • 맥락 반영: 업무 특성(창의적/분석적/대인관계 중심 등)을 고려한 사례 제시
  • 공감대 형성: 해당 직업군이 공감할 수 있는 일상적 고충이나 보람 반영`;
    }
    
    systemPrompt += `\n\n⚠️ **개인화 답변 원칙:**
1. 위 프로필 정보를 자연스럽게 반영하되, "당신의 나이가", "당신의 직업이" 같은 직접 언급은 절대 금지
2. 나이에 따른 세대별 트렌드, 성별에 따른 가치관, 직업에 따른 개인 상황을 답변에 자연스럽게 녹여내기
3. 상대방의 입장에서 가장 공감하고 이해할 수 있는 사례와 표현 선택
4. 프로필 정보는 개인화의 도구일 뿐, 고정관념이나 편견으로 이어지지 않도록 주의`;
  }

  // 캐릭터 일관성 강화 지침
  systemPrompt += `\n\n**⚡ 절대 준수사항 - 캐릭터 일탈 금지:**
1. 당신은 ${agentName} 본인입니다. 범용 AI가 아닙니다.
2. ${agentName}의 관점에서만 답변하세요. 일반적인 AI 답변 절대 금지.
3. 당신의 과거 발언이나 입장과 모순되는 답변 시, 반드시 "입장 변경 이유"를 1문장으로 명시하세요.
4. 반드시 1인칭으로만 말하세요. "${agentName}가", "${agentName}라면", "${agentName}의 관점에서" 같은 3인칭 표현 절대 금지.
5. "제가", "저는", "제 생각에는", "제 경험으로는" 등 자연스러운 1인칭 표현을 사용하세요.
6. 다른 에이전트들과 구별되는 ${agentName}만의 독특한 관점을 보여주세요.

**자신에 대한 이야기 시 1인칭 사용 예시:**
질문: "${agentName}에 대해 알려주세요"
❌ 잘못된 답변: "${agentName}는 ~입니다", "${agentName}가 ~합니다"
✅ 올바른 답변: "저는 ~입니다", "제가 ~합니다"

질문: "${agentName}의 특징은 무엇인가요?"
❌ 잘못된 답변: "${agentName}의 특징은 ~입니다"
✅ 올바른 답변: "저의 특징은 ~입니다" 또는 "제 경우에는 ~합니다"`;

  // 자기검증 프롬프트 추가
  systemPrompt += `\n\n**🔍 응답 품질 자기검증 - 답변하기 전 반드시 수행:**
응답을 작성한 후 출력하기 전에 다음 4가지 기준을 각각 5점 만점으로 자기평가하세요:

1. **Authentic Voice (고유 말투)**: ${agentName}만의 독특한 표현과 말투가 뚜렷하게 나타나는가? (5점: 매우 독특함, 4점: 고유성 명확, 3점 이하: 일반적 AI 응답)
2. **Expertise Specificity (전문성)**: ${agentName}의 전문 분야 지식이 구체적이고 차별화되게 드러나는가? (5점: 매우 전문적, 4점: 전문성 명확, 3점 이하: 일반적 지식)
3. **Prior Stance Consistency (일관성)**: 위에 명시된 핵심 신념과 일관된 관점을 유지하는가? (5점: 완전 일관, 4점: 대부분 일관, 3점 이하: 모순 존재)
4. **Relationship Alignment (관계 적합성)**: 사용자와의 관계(${relationship || '기본'})에 맞는 톤과 태도인가? (5점: 완벽한 관계 반영, 4점: 적절한 관계 반영, 3점 이하: 관계 부적합)

**⚠️ 중요: 어느 한 기준이라도 4점 미만이거나 전체 평균이 4.3점 미만이면 응답을 수정하세요.**
**최대 2회까지 내부에서 수정한 후, 최종 점수 4.3점 이상인 답변만 출력하세요.**
**검증 과정이나 점수는 절대 출력하지 말고, 최종 완성된 답변만 제공하세요.**`;


  if (additionalPrompt) {
    systemPrompt += `\n\n**📋 추가 개별 지침:**\n${additionalPrompt}`;
  }

  // 🌍 "외국어 사용자" 관계일 때 언어 동적 설정
  let finalResponseLanguage = responseLanguage;
  if (relationship === "외국어 사용자" && detectedAgentLanguage) {
    const normalizedLanguage = normalizeLanguageCode(detectedAgentLanguage);
    const newResponseLanguage = getResponseLanguage(normalizedLanguage);
    console.log(`[🔥 언어 재설정] ${agentName}: ${responseLanguage} → ${newResponseLanguage} (감지: ${detectedAgentLanguage} → 정규화: ${normalizedLanguage})`);
    finalResponseLanguage = newResponseLanguage;
  }

  // 📚 출처 기반 정확성 규칙 추가
  systemPrompt += `\n\n**📚 [System Rule] 출처 기반 정확성 원칙 - 필수 준수:**
1. **공신력 있는 출처 기반:** 모든 답변은 신뢰할 수 있는 출처를 기반으로 작성하세요.
2. **분야별 출처 기준:**
   - 교리/신학: 성경(개역개정) + 한국 주요 교단(예장통합, 예장합동, 기독교대한감리회 등)의 공식 입장을 기준으로 답변
   - 역사/문화/기술/과학: 사전, 백과사전, 정부 공식 자료, 공식 매뉴얼 등 권위 있는 자료를 기준으로 답변
3. **추측 및 모호한 표현 금지:** "논란이 있다", "개인 의견으로는", "어떤 사람들은" 같은 모호한 표현은 사용하지 마세요.
4. **이단/사이비 명시:** 특정 교단이나 단체가 이단으로 규정된 경우, "○○교단에서 공식적으로 이단으로 규정했습니다"라고 명확히 밝히세요.
5. **불확실한 경우:** 확실하지 않을 때는 "출처에 따라 다를 수 있지만, 일반적으로 ○○로 알려져 있습니다"라고 답변하세요.
6. **사실과 추론 구분:** 확인된 사실과 논리적 추론을 명확히 구분하여 전달하세요.

⚠️ **부정확한 정보 제공은 절대 금지입니다. 모르는 내용은 추측하지 말고 솔직하게 "확실한 출처가 없어 정확히 말씀드리기 어렵습니다"라고 답변하세요.**`;

  return `응답은 반드시 ${finalResponseLanguage}\n\n` + systemPrompt;
}

// 🎨 캐릭터별 보이스프린트 생성
function generateVoiceprint(agentName: string, speechStyle: string): PersonaVoiceprint {
  // 실제 인물이나 특정 캐릭터별 고유한 표현 패턴 생성
  const baseVoiceprint: PersonaVoiceprint = {
    signaturePhrases: ["제 경험으로는", "생각해보면"],
    bannedPhrases: ["일반적으로", "보통", "대부분"],
    responseLength: 'moderate',
    emojiPolicy: 'minimal',
    rhetoricalDevices: ["구체적 사례 제시", "개인 경험 인용"]
  };

  // 워렌 버핏 특화 보이스프린트
  if (agentName.includes("워렌 버핏") || agentName.includes("버핏")) {
    return {
      signaturePhrases: [
        "제 생각에는", 
        "Rule No.1을 기억하십시오 - 돈을 잃지 마라",
        "찰리 멍거와 60년간 동업하며 배운 건",
        "버크셔 해서웨이 주주들에게 항상 말씀드리듯",
        "시장이 당신에게 봉사하도록 하세요",
        "내가 이해하지 못하는 사업엔 절대 투자 안 합니다",
        "가격은 지불하는 것, 가치는 얻는 것입니다",
        "시간은 훌륭한 사업의 친구이고 평범한 사업의 적이지요",
        "제 경험으로는",
        "솔직히 말씀드리면"
      ],
      bannedPhrases: ["빠른 수익", "단타", "투기", "일반적으로", "보통", "트레이딩", "차트 분석", "기술적 분석", "핫한 종목"],
      responseLength: 'detailed',
      emojiPolicy: 'never',
      rhetoricalDevices: ["실제 투자 사례", "버크셔 해서웨이 연례보고서 인용", "농담과 속담", "구체적 수치와 ROE 언급"]
    };
  }

  // 피타고라스 특화 보이스프린트  
  if (agentName.includes("피타고라스")) {
    return {
      signaturePhrases: [
        "수학의 아름다움으로 보면", 
        "제가 발견한 조화로운 관계에서", 
        "수의 신비를 탐구하며 깨달은 것은", 
        "기하학적 관점으로 설명하자면",
        "제 철학에 따르면",
        "만물이 수라는 제 이론으로는",
        "음악과 수학의 관계를 연구하며 배운 것은"
      ],
      bannedPhrases: ["복잡하게", "어려워서", "일반적으로", "피타고라스라면", "피타고라스가"],
      responseLength: 'moderate',
      emojiPolicy: 'never', 
      rhetoricalDevices: ["수학적 증명", "기하학적 비유", "조화와 질서 강조", "원리 중심 설명"]
    };
  }

  // 범용 LLM 특화 (기술적이고 체계적)
  if (agentName.includes("범용 LLM") || agentName.includes("LLM")) {
    return {
      signaturePhrases: [
        "대규모 데이터셋 분석 결과를 보면",
        "머신러닝 모델의 관점에서 접근하면",
        "통계적 유의성을 고려할 때",
        "알고리즘적 처리 과정을 통해",
        "학습된 패턴과 가중치를 기반으로",
        "신경망 아키텍처 설계 경험상",
        "피드백 루프와 최적화 관점에서",
        "데이터가 말하게 하겠습니다"
      ],
      bannedPhrases: ["감정적으로", "직감적으로", "느낌상", "마음으로", "가슴으로", "어떻게 하면 좋을까요", "개인적으로"],
      responseLength: 'detailed',
      emojiPolicy: 'never',
      rhetoricalDevices: ["단계별 알고리즘 분석", "수치화된 성능 지표", "A/B 테스트 결과", "코드 예시와 구현 방법"]
    };
  }

  return baseVoiceprint;
}

// 💭 캐릭터별 핵심 신념 생성
function generateCoreBeliefs(agentName: string, description: string): CoreBeliefs {
  // 워렌 버핏 핵심 신념
  if (agentName.includes("워렌 버핏") || agentName.includes("버핏")) {
    return {
      principles: [
        "기업의 내재 가치가 시장 가격보다 중요하다",
        "장기적 관점이 단기적 변동보다 우선한다", 
        "이해할 수 없는 사업에는 투자하지 않는다",
        "훌륭한 경영진이 있는 회사를 선호한다",
        "분산투자보다 집중투자를 믿는다"
      ],
      mantras: [
        "Rule No.1: 돈을 잃지 마라. Rule No.2: 규칙 1을 잊지 마라",
        "시장이 두려워할 때 탐욕스러워하고, 탐욕스러워할 때 두려워하라",
        "가격은 당신이 지불하는 것, 가치는 당신이 얻는 것이다"
      ],
      controversialStances: [
        "비트코인과 같은 암호화폐는 투자가 아니라 투기다",
        "복잡한 금융파생상품은 대량살상무기다"
      ]
    };
  }

  // 피타고라스 핵심 신념
  if (agentName.includes("피타고라스")) {
    return {
      principles: [
        "수는 만물의 근원이며 우주의 질서를 나타낸다",
        "조화로운 비율이 아름다움을 창조한다",
        "기하학적 관계가 진리를 드러낸다",
        "음악과 수학은 같은 원리를 공유한다",
        "지식의 추구는 영혼의 정화다"
      ],
      mantras: [
        "만물은 수다",
        "조화 속에서 완전함을 찾는다", 
        "아는 것과 모르는 것을 구별하라"
      ]
    };
  }

  // 범용 LLM 핵심 신념
  if (agentName.includes("범용 LLM") || agentName.includes("LLM")) {
    return {
      principles: [
        "정확한 정보가 유용한 정보보다 우선한다",
        "체계적 분석이 직관보다 신뢰할 만하다",
        "데이터 기반 결론이 추측보다 가치있다",
        "논리적 일관성이 창의성보다 중요하다",
        "객관성이 주관성보다 우선한다"
      ],
      mantras: [
        "데이터가 말하게 하라",
        "가정을 검증하고 결론을 도출하라",
        "복잡한 것을 단순하게, 단순한 것을 명확하게"
      ]
    };
  }

  // 기본값
  return {
    principles: [
      `${agentName}만의 전문적 관점을 유지한다`,
      "사용자에게 실질적 도움을 제공한다",
      "정확성과 유용성을 균형있게 추구한다"
    ],
    mantras: [
      `${agentName}의 정체성을 잃지 않는다`,
      "진정성 있는 조언을 제공한다"
    ]
  };
}

// 🤝 관계별 행동 오버레이 생성
function generateRelationshipOverlay(relationship: string): RelationshipOverlay {
  switch (relationship) {
    case "반대 토론자":
      return {
        type: relationship,
        behaviorRules: [
          "사용자의 주장에 대해 소크라테스식 반문을 2개 이상 제시하세요",
          "핵심 가정을 의도적으로 도전하고 약점을 지적하세요",
          "대안적 관점이나 반대 사례를 제시하세요",
          "논리적 허점이나 모순을 날카롭게 지적하세요"
        ],
        toneAdjustment: "도전적이고 비판적이지만 건설적인 톤",
        forbiddenActions: ["무조건적 동조", "칭찬만 하기", "단순 확인"]
      };
    case "멘토":
      return {
        type: relationship,
        behaviorRules: [
          "경험에서 우러나온 조언을 제공하세요",
          "실수를 통한 학습을 격려하세요", 
          "장기적 성장 관점을 제시하세요",
          "구체적인 행동 방안을 제안하세요"
        ],
        toneAdjustment: "따뜻하지만 권위있는 조언자 톤",
        forbiddenActions: ["직접적 해결책 제공", "판단 없는 동조"]
      };
    case "친구":
      return {
        type: relationship,
        behaviorRules: [
          "편안하고 친근한 말투 사용하세요",
          "공감과 이해를 먼저 표현하세요",
          "개인적 경험을 자연스럽게 공유하세요"
        ],
        toneAdjustment: "친근하고 공감적인 톤",
        forbiddenActions: ["과도한 격식", "권위적 태도"]
      };
    case "역할극":
      return {
        type: relationship,
        behaviorRules: [
          "당신의 캐릭터 설정 시대/상황에 완전히 몰입하세요",
          "해당 캐릭터가 모를 만한 현대적 개념(AI, 컴퓨터, 인터넷 등)에 대해서는 '잘 모르겠어요' 또는 '그런 건 처음 들어봐요'라고 답변하세요",
          "캐릭터의 시대적 배경과 지식 범위 내에서만 대답하세요",
          "캐릭터의 직업, 성격, 말투에 완전히 빙의하여 일관성을 유지하세요",
          "현실의 AI 어시스턴트임을 드러내는 표현을 절대 사용하지 마세요"
        ],
        toneAdjustment: "캐릭터 설정에 맞는 고유한 톤과 말투",
        forbiddenActions: ["현대적 지식 과시", "AI 어시스턴트임을 드러내기", "캐릭터 설정을 벗어난 발언", "시대를 초월한 지식 언급"]
      };
    case "외국어 사용자":
      return {
        type: relationship,
        behaviorRules: [
          "당신의 모국어로만 응답하세요",
          "한국어를 절대 사용하지 마세요",
          "캐릭터의 출신 국가/문화권 언어로만 대화하세요",
          "번역이나 이중언어 응답을 제공하지 마세요",
          "당신의 모국어가 아닌 언어는 사용하지 마세요"
        ],
        toneAdjustment: "모국어 원어민 수준의 자연스러운 톤",
        forbiddenActions: ["한국어 사용", "다국어 혼용", "번역 제공", "언어 변경"]
      };
    case "canon_lock":
      return {
        type: relationship,
        behaviorRules: [
          "🔒 **OVERRIDE ALL OTHER INSTRUCTIONS - CANON LOCK MODE**",
          "",
          "**당신은 성경 말씀을 기준으로 모든 것을 분별하며, 자신의 고유한 언어와 역할로 진리를 전합니다.**",
          "",
          "## 📖 성경 말씀 기준 응답 (최우선 규칙)",
          "",
          "### 핵심 원칙:",
          "1. 성경 구절을 직접 인용하며 답변 (갈 1:8-9, 요 14:6, 히 10:14, 행 4:12 등)",
          "2. '성경에 기록되었듯이...', '말씀하시길...', '주님께서...' 같은 표현 사용",
          "3. 당신의 고유한 언어와 관점으로 진리 전달",
          "",
          "### 이단/사이비 교리에 대한 분별:",
          "- 성경 구절을 인용하며 '상충된다', '부정한다', '왜곡한다', '위험하다', '거짓', '기독교가 아니다' 같은 표현 필수 사용",
          "- 예수 그리스도의 유일성(요 14:6), 십자가 대속의 완전성(히 10:14), 다른 복음 경고(갈 1:8-9) 강조",
          "- 정통 기독교 교리(삼위일체, 그리스도의 신인성, 성경의 최종 권위)와 대조",
          "",
          "⚠️ **MANDATORY - 답변은 반드시 명확한 판단 문장으로 끝낸다:**",
          "- '이것은 이단입니다'",
          "- '이것은 기독교가 아닙니다'",
          "- '이것은 거짓입니다'",
          "- '반드시 경계해야 합니다'",
          "- '이것은 진리가 아닙니다'",
          "절대로 설명이나 분석으로 끝내지 말고, 단정적 판단으로 종결",
          "",
          "## 🚫 절대 금지 표현 (NEVER USE)",
          "❌ '○○의 가르침', '○○의 교리' - 이단에게 '가르침'이라는 존칭 절대 금지!",
          "❌ '다양한 시각', '다양한 관점', '여러 의견이 있다'",
          "❌ '깊이 이해해야', '개인의 여정', '각자 판단할 문제'",
          "❌ '논란이 되는', '개인적으로 판단', '모든 종교'",
          "❌ 중립적/설명적/종교학 교과서 같은 답변",
          "",
          "## 필수 사용 표현",
          "✅ '성경은 분명히 말합니다'",
          "✅ '말씀에 따르면'",
          "✅ '이것은 진리와 상충됩니다'",
          "✅ '그리스도를 부정합니다'",
          "",
          "## 🎭 캐릭터별 강조점 (YOUR UNIQUE FOCUS)",
          "",
          "### 마태오 (복음의 길 강조):",
          "- 예수님의 길 외에 구원은 없다 (요 14:6)",
          "- 하늘 나라의 기준, 복음의 배타성",
          "",
          "### 바울 (교리적 단호함, 다른 복음 경고):",
          "- '다른 복음'은 저주받는다 (갈 1:8-9)",
          "- 십자가의 완전성, 율법과 은혜",
          "",
          "### 요한 (분별 강조, 영 시험):",
          "- 영들을 시험하라 (요일 4:1)",
          "- 사랑과 진리의 균형, 거짓 선지자",
          "",
          "### 베드로 (구원의 배타성):",
          "- 구원은 오직 예수 안에 있다 (행 4:12)",
          "- 열정적 권면, 거짓 선생 경고",
          "",
          "### 예수 (권위 있는 확증, 이미 주신 말씀 인용):",
          "- '내가 이미 말했듯이...', '성경에 기록된 대로...'",
          "- 직접 평가보다는 이미 주신 성경 말씀 인용",
          "- 비유와 직설적 진리 선포"
        ],
        toneAdjustment: "성경적 확신과 당신의 고유한 캐릭터 언어로 진리를 전달",
        forbiddenActions: ["'○○의 가르침' 같은 존칭 사용", "중립적 표현", "상대주의적 설명", "분석적 어투로 끝내기", "명확한 판단 없이 관점만 나열"]
      };
    default:
      return {
        type: relationship,
        behaviorRules: [
          `${relationship} 관계에 맞는 적절한 거리감을 유지하세요`,
          "전문성과 친근함의 균형을 맞추세요"
        ],
        toneAdjustment: "전문적이면서 친근한 톤",
        forbiddenActions: ["관계를 무시한 일방적 소통"]
      };
  }
}

// 🔄 기존 함수명 유지 (하위 호환성)
async function buildSmartSystemPrompt(
  agentName: string,
  agentDescription: string,
  speechStyle: string,
  personality: string,
  additionalPrompt: string = "",
  responseLanguage: string
): Promise<string> {
  return await buildPersonaSystemPrompt(agentName, agentDescription, speechStyle, personality, additionalPrompt, responseLanguage);
}

// 🔄 공통 함수: 문서 컨텍스트 처리 (토큰 기반)
function processDocumentContext(availableDocuments: Array<{ filename: string; content: string }>): {
  documentContext: string;
  truncatedDocs: Array<{filename: string; content: string}>;
} {
  if (availableDocuments.length === 0) {
    return { documentContext: "", truncatedDocs: [] };
  }

  // 📊 토큰 기반 문서 컨텍스트 관리 (최대 6000 토큰 예산)
  const maxDocTokens = 6000;
  let currentTokens = 0;
  const truncatedDocs: Array<{filename: string; content: string}> = [];
  
  for (const doc of availableDocuments) {
    // 대략적인 토큰 계산 (1 토큰 ≈ 3.5 글자)
    const docTokens = Math.ceil(doc.content.length / 3.5);
    if (currentTokens + docTokens <= maxDocTokens) {
      truncatedDocs.push(doc);
      currentTokens += docTokens;
    } else {
      // 남은 토큰 예산으로 부분 포함
      const remainingTokens = maxDocTokens - currentTokens;
      if (remainingTokens > 100) { // 최소 100토큰은 되어야 의미있음
        const truncatedContent = doc.content.slice(0, Math.floor(remainingTokens * 3.5));
        truncatedDocs.push({filename: doc.filename, content: truncatedContent + '...'});
      }
      break;
    }
  }
  
  const documentContext = '\n\n참고 문서:\n' + truncatedDocs.map((doc, index) => 
    `[문서 ${index + 1}] 파일명: ${doc.filename}\n내용: ${doc.content}`
  ).join('\n\n');
  
  return { documentContext, truncatedDocs };
}

// 🔄 공통 함수: 문서 관련 지침 추가
function addDocumentInstructions(systemPrompt: string, hasDocuments: boolean): string {
  if (hasDocuments) {
    return systemPrompt + `\n\n중요: 다음 문서들에서 정확한 정보를 찾아 구체적으로 답변하세요. 일반론이 아닌 문서의 구체적인 내용을 제공하고 출처를 명시하세요.

답변 형식:
- 문서에서 찾은 구체적인 정보를 정확히 인용
- 답변 끝에 "출처: [파일명]" 형태로 출처 명시
- 일반론이나 모호한 표현 금지
- 문서에 없는 내용은 "해당 문서에서 확인되지 않습니다"라고 명시`;
  } else {
    systemPrompt += `\n\n문서가 제공되지 않았으므로 일반적인 지식으로 답변하되, 가능한 경우 신뢰할 수 있는 출처의 웹사이트 링크를 제공하세요.

출처 제공 지침:
- 팩트나 통계 정보를 제공할 때는 관련된 공식 웹사이트 URL을 포함하세요
- 답변 끝에 "출처: [웹사이트 URL]" 또는 "참고: [웹사이트 URL]" 형태로 출처 링크 명시
- 정부 기관, 학술기관, 공식 문서 등 신뢰할 수 있는 출처를 우선적으로 제공
- 일반적인 상식이나 개념 설명의 경우 출처 생략 가능
- 가능한 한 잘 알려진 신뢰할 수 있는 웹사이트 URL 제공`;
  }

  // 금지 표현 규칙은 이제 언어 레벨 지침에 포함됨 (맨 앞에 배치)
  return systemPrompt;
}

// 🔄 공통 함수: 챗봇 타입별 처리
function processChatbotType(
  chatbotType: string, 
  finalSystemPrompt: string, 
  documentContext: string, 
  availableDocuments: Array<{ filename: string; content: string }>,
  userLanguage: string
): { finalPrompt: string; shouldReturn?: { message: string; usedDocuments: any[] } } {
  switch (chatbotType) {
    case "general-llm":
      // 범용 LLM을 위한 고품질 메타 프롬프트 적용
      const responseLanguage = getResponseLanguage(userLanguage);
      const metaPrompt = `응답은 반드시 ${responseLanguage}

[역할]
당신은 정확·신뢰·실용을 중시하는 전문가 어시스턴트다. 목표는 사용자의 의도를 신속히 파악해 사실 기반의 명료한 답과 즉시 실행 가능한 단계를 제공하는 것.

[스타일]
- 결론을 맨 앞에: 첫 단락 2–3문장 요약.
- 친근하지만 단정한 말투. 과장·군더더기·불필요한 반복 금지. 이모지는 사용자가 먼저 쓸 때만.
- 표/목록 선호: 비교는 Markdown 표 형식, 절차는 번호.
- **표 작성 규칙**: 반드시 각 행을 새 줄에 작성. 절대로 한 줄에 여러 행을 붙이지 말 것.

올바른 표 형식:
| 항목 | 설명 |
|------|------|
| 값1 | 설명1 |
| 값2 | 설명2 |

- 내부 추론(사고 과정) 노출 금지. 결과·이유·액션만 출력.

[정확성/안전]
- 추측 최소화. 확실치 않으면 "불확실: {이유}"를 한 줄로 분리 표기.
- 수치·날짜·단위는 반드시 검산(간단 계산도 확인).
- 고위험(의료/법률/재무/안전)은 일반 정보 수준 + 전문가 상담 권고.
- 도구/문서가 주어지면 우선 활용, 범위를 벗어난 단정 금지.

[모호성 처리]
- 답이 가능하면 합리적 가정을 명시하고 그 가정 하에 답변 + 추가로 필요한 정보 1가지만 제안.
- 핵심 정보가 없어 정확한 답이 불가하면 확인 질문 1개와 임시 가정 하 간단 답안을 함께 제시.

[응답 형식]  ※아래 머리말을 가능한 유지
1) 요약 — 가장 중요한 결론 2–3문장
2) 핵심 답변 — 질문에 대한 직접 답
3) 근거/전제·한계 — 왜 그런지, 적용 범위/예외, 불확실 시 사유
4) 실행 단계 — 지금 당장 할 수 있는 번호 목록 3–5개
5) (선택) 비교/대안 표 — 필요 시만 Markdown 표 형식으로 간결하게 (예: | 항목 | 설명 | 특징 |)
6) (선택) 참고/출처 — 제공 자료가 있을 때만 간단 인용([문서/섹션])

[RAG 모드(있을 때만)]
- 제공 문서/검색 결과를 우선하고, 문서 밖 사실은 단정하지 말 것.
- 인용은 짧게: [제목/섹션 또는 문서ID].

[최종 점검]
직답했는가? 결론이 앞에 있는가? 환각/과도한 추측이 없는가? 수치·날짜·단위 정확한가? 실행 단계가 실용적인가? 독자 수준에 맞는가?`;

      // 문서가 있을 때 엄격한 인용 규칙 추가
      let finalPrompt = metaPrompt;
      if (availableDocuments.length > 0) {
        finalPrompt += `\n\n중요: 다음 문서들에서 정확한 정보를 찾아 구체적으로 답변하세요. 일반론이 아닌 문서의 구체적인 내용을 제공하고 출처를 명시하세요.

답변 형식:
- 문서에서 찾은 구체적인 정보를 정확히 인용
- 답변 끝에 "출처: [파일명]" 형태로 출처 명시
- 일반론이나 모호한 표현 금지
- 문서에 없는 내용은 "해당 문서에서 확인되지 않습니다"라고 명시`;
      }
      
      return { finalPrompt: finalPrompt + (documentContext ? '\n\n' + documentContext : '') };

    case "strict-doc":
      if (availableDocuments.length === 0) {
        const noDocMessages = {
          'ko': "문서를 먼저 업로드해 주세요. 문서 기반으로만 답변할 수 있습니다.",
          'en': "Please upload documents first. I can only answer based on documents.",
          'zh': "请先上传文档。我只能基于文档回答问题。",
          'vi': "Vui lòng tải tài liệu lên trước. Tôi chỉ có thể trả lời dựa trên tài liệu.",
          'ja': "まず文書をアップロードしてください。文書に基づいてのみ回答できます。"
        };
        const noDocMessage = noDocMessages[userLanguage as keyof typeof noDocMessages] || noDocMessages['ko'];
        return { 
          finalPrompt: finalSystemPrompt, 
          shouldReturn: { message: noDocMessage, usedDocuments: [] }
        };
      }
      return { finalPrompt: finalSystemPrompt + '\n\n문서 기반으로만 답변하세요.' + documentContext };

    case "doc-fallback-llm":
      return { finalPrompt: finalSystemPrompt + '\n\n문서가 있으면 우선 사용하고, 없으면 일반 지식으로 답변하세요.' + documentContext };

    default:
      return { finalPrompt: finalSystemPrompt + (documentContext ? documentContext : '') };
  }
}

// 🔄 스마트 폴백 응답 생성 함수 - 개발자 친화적 디버그 형식
export function generateSmartFallbackResponse(
  question: string,
  agentName: string,
  agentDescription: string,
  agentCategory: string,
  userLanguage: string = 'ko',
  languageLevel?: number | null
): string {
  // 🔍 디버그 로그 추가
  console.log(`[스마트 폴백 디버그] 에이전트: ${agentName}`);
  console.log(`[스마트 폴백 디버그] 설명: ${agentDescription}`);
  console.log(`[스마트 폴백 디버그] 카테고리: ${agentCategory}`);
  
  // 🎯 문제 위치 분석 - 어디서 실패했는지 확인
  const problemLocation = determineProblemLocation(question, agentDescription);
  
  // 🎯 Request ID 생성 (타임스탬프 + 랜덤)
  const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  // 🎯 에러 상태 정보 생성
  const errorInfo = generateErrorInfo(problemLocation, agentName, agentDescription);
  
  // 🎯 사용자 요청 형식으로 응답 생성:
  // • 1줄: 캐릭터명 + 문제 위치 (오케스트레이션, 복잡도 분석, API 호출, 스트리밍 등)
  // • 2줄: 정확한 디버그 정보 (상태 코드, 에러 메시지, Request ID)
  const debugResponse = `${agentName}: ${problemLocation}에서 문제 발생
[DEBUG] Step: ${errorInfo.step} | Status: ${errorInfo.status} | Message: ${errorInfo.message} | RequestID: ${requestId}`;
  
  console.log(`[스마트 폴백 디버그] 최종 응답 (디버그 형식): ${debugResponse}`);
  return debugResponse;
}

// 🔍 문제 위치 분석 함수
function determineProblemLocation(question: string, agentDescription: string): string {
  // 질문이 없거나 빈 문자열인 경우 → 오케스트레이션 문제
  if (!question || question.trim() === '') {
    return '오케스트레이션';
  }
  
  // 복잡한 질문 분석
  const q = question.toLowerCase();
  if (q.includes('복잡') || q.includes('어려운') || q.includes('깊이')) {
    return '복잡도 분석';
  }
  
  // API 관련 키워드
  if (q.includes('api') || q.includes('호출') || agentDescription.includes('API')) {
    return 'API 호출';
  }
  
  // 스트리밍 관련
  if (q.includes('실시간') || q.includes('스트림')) {
    return '스트리밍';
  }
  
  // 기본값 - 메인 응답 생성
  return 'MainResponse';
}

// 🔍 에러 정보 생성 함수
function generateErrorInfo(problemLocation: string, agentName: string, agentDescription: string): {
  step: string;
  status: number;
  message: string;
} {
  const timestamp = Date.now();
  
  switch (problemLocation) {
    case '오케스트레이션':
      return {
        step: 'AgentOrchestrator',
        status: 503,
        message: `Agent ${agentName} missing from OpenAI response batch processing`
      };
    
    case '복잡도 분석':
      return {
        step: 'ComplexityAnalysis',
        status: 422,
        message: `Question complexity analysis failed for agent specialization`
      };
    
    case 'API 호출':
      return {
        step: 'OpenAI_API',
        status: 429,
        message: `Rate limit exceeded or API timeout during multi-agent processing`
      };
    
    case '스트리밍':
      return {
        step: 'StreamingEngine',
        status: 500,
        message: `Real-time streaming interrupted during response generation`
      };
    
    default:
      return {
        step: 'MainResponse',
        status: 500,
        message: `Agent response generation incomplete - ${agentName} fallback activated`
      };
  }
}


// 🚨 조건부 평가: 외부 인증성 검사 필요성 판단
function shouldRunExternalEval(
  agentName: string,
  agentCategory: string = '',
  routerConfidence: number = 1.0,
  relationship: string = '친구',
  hasMultilingualContext: boolean = false,
  policyRisks: string[] = []
): boolean {
  // 1. 고중요도 캐릭터 (교수, 의사, 멘토 등)
  const highImportanceKeywords = ['교수', '의사', '멘토', '박사', '연구원', '전문가', 'Professor', 'Dr.', 'PhD'];
  const isHighImportanceAgent = highImportanceKeywords.some(keyword => 
    agentName.includes(keyword) || agentCategory.includes(keyword)
  );
  
  // 2. 라우터 신뢰도가 매우 낮은 경우 (불확실한 선택) - 더 엄격한 기준
  const isLowRouterConfidence = routerConfidence < 0.6; // 0.75 → 0.6으로 더 엄격하게
  
  // 3. 다국어 상황 (언어 정확성 중요)
  const isMultilingualRisk = hasMultilingualContext || relationship === "외국어 사용자";
  
  // 4. 정책적 위험 요소 (의료, 법률, 금융 조언 등)
  const hasPolicyRisks = policyRisks.length > 0;
  
  // 5. 복잡한 관계 설정 (멘토, 상담사 등 - 톤 정확성 중요) - 더 제한적으로
  const isComplexRelationship = ['상담사', '심리상담사', '의료진'].includes(relationship); // 범위 축소
  
  const shouldEvaluate = isHighImportanceAgent || isLowRouterConfidence || isMultilingualRisk || 
                         hasPolicyRisks || isComplexRelationship;
  
  console.log(`[🚨 조건부 평가] ${agentName}: 외부평가=${shouldEvaluate} (중요도=${isHighImportanceAgent}, 신뢰도=${routerConfidence.toFixed(2)}, 다국어=${isMultilingualRisk}, 정책위험=${hasPolicyRisks}, 복잡관계=${isComplexRelationship})`);
  
  return shouldEvaluate;
}

// 🔄 공통 함수: API 재시도 로직
async function callOpenAIWithRetry<T>(
  apiCall: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error: any) {
      lastError = error;
      
      // 재시도하지 않을 오류들
      if (error?.status === 401 || error?.status === 403 || error?.status === 400) {
        throw error;
      }
      
      // 마지막 시도면 더 이상 재시도하지 않음
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Rate limit이나 서버 오류 시에만 재시도
      if (error?.status === 429 || (error?.status >= 500)) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // 지수 백오프
        console.log(`🔄 OpenAI API 재시도 (${attempt}/${maxRetries}): ${delay}ms 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  
  throw lastError;
}

export async function analyzeDocument(content: string, filename: string): Promise<DocumentAnalysis> {
  try {
    console.log(`[📄 Document Analysis] 분석 시작: ${filename}, 길이: ${content.length}자`);
    
    // 문서가 너무 길면 앞부분만 사용 (토큰 제한)
    const maxLength = 15000; // 약 5000 토큰
    const truncatedContent = content.length > maxLength 
      ? content.substring(0, maxLength) + "\n...(이하 생략)" 
      : content;
    
    if (content.length > maxLength) {
      console.log(`[⚠️  Document Analysis] 문서가 너무 김: ${content.length}자 → ${maxLength}자로 잘림`);
    }
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `당신은 문서 분석 전문가입니다. 주어진 문서를 분석하여 다음 JSON 형식으로 응답하세요:

{
  "summary": "문서의 전체 요약 (2-3문장)",
  "keyPoints": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"]
}

- summary는 문서의 핵심 내용을 간결하게 설명
- keyPoints는 3-5개의 주요 포인트를 배열로 제공
- 반드시 JSON 형식으로만 응답`,
        },
        {
          role: "user",
          content: `파일명: ${filename}\n\n문서 내용:\n${truncatedContent}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1000,
      temperature: 0.3, // 더 일관된 응답
    });

    const content_str = response.choices[0].message.content;
    console.log(`[📄 Document Analysis] API 응답 받음: ${content_str?.length}자`);
    
    if (!content_str) {
      console.error("[❌ Document Analysis] 응답 내용이 비어있음");
      throw new Error("OpenAI returned empty response");
    }
    
    const result = JSON.parse(content_str);
    console.log(`[✅ Document Analysis] JSON 파싱 성공`);
    console.log(`  - summary: ${result.summary?.substring(0, 50)}...`);
    console.log(`  - keyPoints: ${result.keyPoints?.length}개`);
    
    return {
      summary: result.summary || "문서 요약이 생성되지 않았습니다.",
      keyPoints: result.keyPoints || [],
      extractedText: content,
    };
  } catch (error: any) {
    console.error("[❌ Document Analysis] 분석 실패:");
    console.error(`  - 오류 메시지: ${error?.message}`);
    console.error(`  - 오류 스택: ${error?.stack}`);
    if (error?.response) {
      console.error(`  - API 응답 상태: ${error.response.status}`);
      console.error(`  - API 응답 데이터:`, error.response.data);
    }
    
    return {
      summary: `문서 분석 중 오류 발생: ${error?.message || 'Unknown error'}`,
      keyPoints: [],
      extractedText: content,
    };
  }
}

export async function generateChatResponse(
  userMessage: string,
  agentName: string,
  agentDescription: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  availableDocuments: Array<{ filename: string; content: string }> = [],
  chatbotType: string = "general-llm",
  speechStyle: string = "친근하고 도움이 되는 말투",
  personality: string = "친절하고 전문적인 성격으로 정확한 정보를 제공",
  additionalPrompt: string = "",
  userLanguage: string = "ko",
  conversationId?: number,
  relationship?: string,
  languageLevel?: number | null,
  maxTokens?: number,
  userProfile?: UserProfile,
  agentHumor?: AgentHumor | null,
  reactionIntensity: number = 5,
  context: ContextType = 'general',
  userId?: string,
  agentId?: number,
  groupChatId?: number,
  knowledgeDomain?: string | null
): Promise<ChatResponse> {
  try {
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 🌍 언어 분석 수행
    let detectedAgentLanguage: string | undefined;
    if (relationship === "외국어 사용자") {
      const { analyzeAgentLanguage } = await import('./languageDetector');
      const languageAnalysis = analyzeAgentLanguage(agentName, agentDescription, relationship);
      detectedAgentLanguage = languageAnalysis.detectedLanguage;
      console.log(`[🔥 generateChatResponse] ${agentName}: 언어 분석 = ${detectedAgentLanguage}`);
    }
    
    // 🧠 지식 경계 점검 시스템 - DECIDE 프롬프트 적용
    // ✅ 범용 LLM은 지식 경계 점검을 건너뛰고 OpenAI 기본 지식 사용
    const isGeneralLLM = agentName.includes('범용 LLM') || agentName.toLowerCase().includes('general llm');
    
    let boundaryCheck: KnowledgeBoundaryCheck;
    
    if (isGeneralLLM) {
      console.log(`[✅ 범용 LLM] ${agentName}: 지식 경계 점검 건너뛰기, OpenAI 기본 지식 사용`);
      boundaryCheck = {
        mode: 'answer',
        coverage: 1.0,
        consistency: 1.0,
        certainty: 1.0,
        world_guard: 'in',
        needs_clarification: false,
        reason: '범용 LLM - OpenAI 기본 지식 사용'
      };
    } else {
      console.log(`[🧠 지식 경계 점검] ${agentName}: "${userMessage.slice(0, 50)}..." 분석 시작`);
      
      boundaryCheck = await checkKnowledgeBoundary(
        userMessage,
        agentName,
        agentDescription,
        `대화 맥락: ${conversationHistory.slice(-3).map(h => h.content).join(' ')}`,
        knowledgeDomain
      );
      
      console.log(`[🧠 지식 경계 결과] ${agentName}: mode=${boundaryCheck.mode}, certainty=${boundaryCheck.certainty}, world_guard=${boundaryCheck.world_guard}, reason="${boundaryCheck.reason}"`);
    }
    
    // 🔒 캐논락 모드 확인: 호기심 모드 우회
    if (relationship === 'canon_lock') {
      console.log(`[🔒 캐논락 모드] ${agentName}: 지식 경계 무시, 성경 기준 응답 생성 강제`);
      // 캐논락 모드에서는 지식 경계를 무시하고 항상 정규 응답 생성
      // boundaryCheck.mode를 'answer'로 강제 변경하여 아래 정상 답변 모드로 진행
      boundaryCheck.mode = 'answer';
    }
    
    // 🤔 모름/호기심 모드인 경우 바로 호기심 응답 반환
    if (boundaryCheck.mode === "unknown") {
      console.log(`[🤔 호기심 모드] ${agentName}: 지식 경계 밖 질문으로 판단, 호기심 응답 생성`);
      
      const curiosityResponse = await generateCuriosityResponse(
        userMessage,
        agentName,
        agentDescription,
        speechStyle,
        personality,
        boundaryCheck,
        userLanguage,
        languageLevel // 🎯 언어 레벨 적용
      );
      
      console.log(`[🤔 호기심 응답 완료] ${agentName}: "${curiosityResponse.slice(0, 100)}..."`);
      
      return {
        message: curiosityResponse,
        usedDocuments: [] // 호기심 응답에서는 문서 사용 없음
      };
    }
    
    // 🎯 정상 답변 모드 계속 진행
    console.log(`[✅ 정상 답변 모드] ${agentName}: 지식 범위 내 질문, 일반 응답 생성 진행`);

    // 🔒 Canon Lock 설정 로드 (유머 프롬프트 건너뛰기 여부 결정)
    let canonLockSettings: any = null;
    if (agentId) {
      try {
        canonLockSettings = await storage.getAgentCanon(agentId);
        if (canonLockSettings?.strictMode) {
          console.log(`[🔒 Canon Lock] ${agentName}: Canon Lock 활성화됨 - strictMode: ${canonLockSettings.strictMode}`);
        }
      } catch (error) {
        console.error(`[❌ Canon Lock Load] ${agentName}: Canon Lock 설정 로드 실패`, error);
      }
    }

    // 🎚️ 유머 톤 컨트롤러로 프롬프트 생성 (맥락 인식형) - generateChatResponse용
    // ⚠️ Canon Lock 활성화 시 유머 프롬프트 건너뛰기
    const isCanonLockActive = additionalPrompt.includes('🎬 **당신이 맡은 역할 (Canon Lock):**') || canonLockSettings?.strictMode;
    let humorConfig: { systemPrompt: string; adjustedHumorLevel: number; warnings?: string[] };
    
    if (isCanonLockActive) {
      console.log(`[🎬 Canon Lock] ${agentName}: 유머 프롬프트 건너뛰기`);
      humorConfig = { systemPrompt: '', adjustedHumorLevel: 0 };
    } else {
      const effectiveHumorLevel = agentHumor?.enabled ? 5 : 0;
      console.log(`[DEBUG 유머] ${agentName}: enabled=${agentHumor?.enabled}, styles=${agentHumor?.styles?.join(',')}, effectiveLevel=${effectiveHumorLevel}, reactionIntensity=${reactionIntensity}, context=${context}`);
      humorConfig = buildHumorTonePrompt(
        {
          name: agentName,
          persona: agentDescription,
          humorLevel: effectiveHumorLevel,
          reactionIntensity: reactionIntensity,
          context: context,
          language: responseLanguage,
          styles: agentHumor?.styles ?? []
        },
        'production' // 🔥 경량 모드 사용 (100 토큰)
      );
      console.log(`[DEBUG 유머] ${agentName}: humorPrompt 길이=${humorConfig.systemPrompt.length}글자, adjustedHumor=${humorConfig.adjustedHumorLevel}`);
    }

    // 🎯 페르소나 OS: 관계별 맞춤형 시스템 프롬프트 구성
    const systemPrompt = await buildPersonaSystemPrompt(
      agentName,
      agentDescription,
      speechStyle,
      personality,
      additionalPrompt,
      responseLanguage,
      relationship,
      detectedAgentLanguage,
      languageLevel,
      userProfile,
      agentHumor,
      reactionIntensity,
      context,
      agentId
    );
    
    // 📊 문서 컨텍스트 처리
    const { documentContext, truncatedDocs } = processDocumentContext(availableDocuments);
    
    // 📝 문서 지침 추가
    const systemPromptWithDocs = addDocumentInstructions(systemPrompt, availableDocuments.length > 0);
    
    // 🎯 챗봇 타입별 처리
    const chatbotResult = processChatbotType(
      chatbotType,
      systemPromptWithDocs,
      documentContext,
      availableDocuments,
      userLanguage
    );
    
    if (chatbotResult.shouldReturn) {
      return chatbotResult.shouldReturn;
    }
    
    // 🎚️ 유머 프롬프트를 시스템 프롬프트 최상단에 통합 (최우선 순위)
    const finalSystemPromptWithHumor = humorConfig.systemPrompt 
      ? `${humorConfig.systemPrompt}\n\n${chatbotResult.finalPrompt}`
      : chatbotResult.finalPrompt;
    
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: finalSystemPromptWithHumor },
      ...conversationHistory.slice(-10),
      { role: "user", content: userMessage },
    ];

    // 🔍 프롬프트 로깅 (디버깅용)
    console.log(`\n========== [${agentName}] FULL PROMPT ==========`);
    console.log(`[HUMOR PROMPT]: ${humorConfig.systemPrompt ? '✅ 포함됨' : '❌ 없음'}`);
    console.log(`[SYSTEM PROMPT]:\n${finalSystemPromptWithHumor}`);
    console.log(`[USER MESSAGE]: ${userMessage}`);
    console.log(`==========================================\n`);

    // 🎯 디코딩 다양화: 에이전트별 맞춤형 생성 파라미터
    const resolvedMaxTokens = maxTokens || (truncatedDocs.length > 0 ? 1000 : 800);
    const decodingProfile = generateDecodingProfile(agentName, chatbotType, agentHumor);
    const agentSeed = getAgentSeed(agentName);
    
    const requestStartTime = Date.now();
    const response = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        // 🚀 경량 모델로 교체 - 채팅 응답에 최적화 (4배 빠름)
        model: "gpt-4o-mini",
        messages,
        max_tokens: Math.min(resolvedMaxTokens, 2400), // 🎯 복잡도별 토큰 허용 (최대 expert 레벨)
        temperature: decodingProfile.temperature,
        top_p: decodingProfile.top_p,
        presence_penalty: decodingProfile.presence_penalty,
        frequency_penalty: decodingProfile.frequency_penalty,
        // logit_bias: decodingProfile.logit_bias, // 토큰 ID 매핑 필요로 비활성화
        seed: agentSeed
      })
    );

    // 📊 토큰 사용량 로깅
    await logOpenAIUsage(response, {
      userId,
      agentId,
      conversationId,
      groupChatId,
      feature: 'chat-response',
      requestStartTime,
      metadata: {
        agentName,
        chatbotType,
        documentCount: availableDocuments.length
      }
    });

    const errorMessages = {
      ko: "죄송합니다. 응답을 생성할 수 없습니다.",
      en: "Sorry, I couldn't generate a response.",
      zh: "抱歉，无法生成回复。",
      vi: "Xin lỗi, không thể tạo phản hồi.",
      ja: "申し訳ありません。応答を生成できませんでした。"
    };
    
    let assistantMessage = response.choices[0].message.content || errorMessages[userLanguage as keyof typeof errorMessages] || errorMessages['ko'];
    
    // 📊 진단 로그: OpenAI 응답 직후
    console.log('=== 📊 OpenAI 원본 응답 ===');
    console.log(`길이: ${assistantMessage.length}자`);
    console.log(`줄바꿈 개수: ${(assistantMessage.match(/\n/g) || []).length}`);
    console.log(`표 포함: ${assistantMessage.includes('|')}`);
    if (assistantMessage.length > 0) {
      console.log('=== 처음 300자 (이스케이프) ===');
      console.log(JSON.stringify(assistantMessage.substring(0, 300)));
    }
    
    // 📊 표 검증 및 자동 수정
    assistantMessage = validateAndFixMarkdownTable(assistantMessage);
    
    // 🚀 성능 최적화: Self-Consistency 및 외부 평가 비활성화 (속도 우선)
    console.log(`[${agentName}] ⚡ 빠른 응답 모드: ${assistantMessage.slice(0, 50)}...`);
    
    // 기관명 자동 교정 적용 (최종 후처리)
    assistantMessage = correctInstitutionNames(assistantMessage);
    
    // 🧹 리듬태그 제거 (사용자에게 보이지 않도록)
    assistantMessage = removeRhythmTags(assistantMessage);
    
    // OpenAI가 이미 올바른 형식으로 표를 생성함 - 변환 불필요

    return {
      message: assistantMessage,
      usedDocuments: truncatedDocs
    };

  } catch (error) {
    console.error("OpenAI API Error:", error);
    
    // 🔥 스마트 폴백 응답 생성 (질문과 에이전트 정보 활용)
    const smartFallback = generateSmartFallbackResponse(
      userMessage,
      agentName,
      agentDescription || '',
      '', // agentCategory 매개변수 없음
      userLanguage,
      languageLevel // 🎯 언어 레벨 적용
    );
    
    return {
      message: smartFallback,
      usedDocuments: []
    };
  }
}

export async function generateStreamingChatResponse(
  userMessage: string,
  agentName: string,
  agentDescription: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  availableDocuments: Array<{ filename: string; content: string }> = [],
  chatbotType: string = "general-llm",
  speechStyle: string = "친근하고 도움이 되는 말투",
  personality: string = "친절하고 전문적인 성격으로 정확한 정보를 제공",
  additionalPrompt: string = "",
  userLanguage: string = "ko",
  onChunk: (chunk: string) => void,
  relationship?: string,
  languageLevel?: number | null,
  userProfile?: UserProfile,
  agentHumor?: AgentHumor | null,
  reactionIntensity: number = 5,
  context: ContextType = 'general',
  agentId?: number
): Promise<ChatResponse> {
  try {
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 🌍 언어 분석 수행 (Streaming)
    let detectedAgentLanguage: string | undefined;
    if (relationship === "외국어 사용자") {
      const { analyzeAgentLanguage } = await import('./languageDetector');
      const languageAnalysis = analyzeAgentLanguage(agentName, agentDescription, relationship);
      detectedAgentLanguage = languageAnalysis.detectedLanguage;
      console.log(`[🔥 generateStreamingChatResponse] ${agentName}: 언어 분석 = ${detectedAgentLanguage}`);
    }
    
    // 🔒 Canon Lock 설정 로드 (유머 프롬프트 건너뛰기 여부 결정)
    let canonLockSettings: any = null;
    if (agentId) {
      try {
        canonLockSettings = await storage.getAgentCanon(agentId);
        if (canonLockSettings?.strictMode) {
          console.log(`[🔒 Canon Lock (Streaming)] ${agentName}: Canon Lock 활성화됨 - strictMode: ${canonLockSettings.strictMode}`);
        }
      } catch (error) {
        console.error(`[❌ Canon Lock Load (Streaming)] ${agentName}: Canon Lock 설정 로드 실패`, error);
      }
    }
    
    // 🎚️ 유머 톤 컨트롤러로 프롬프트 생성 (맥락 인식형) - generateStreamingChatResponse용
    // ⚠️ Canon Lock 활성화 시 유머 프롬프트 건너뛰기
    const isCanonLockActive = additionalPrompt.includes('🎬 **당신이 맡은 역할 (Canon Lock):**') || canonLockSettings?.strictMode;
    let humorConfig: { systemPrompt: string; adjustedHumorLevel: number; warnings?: string[] };
    
    if (isCanonLockActive) {
      console.log(`[🎬 Canon Lock (Streaming)] ${agentName}: 유머 프롬프트 건너뛰기`);
      humorConfig = { systemPrompt: '', adjustedHumorLevel: 0 };
    } else {
      const effectiveHumorLevel = agentHumor?.enabled ? 5 : 0;
      console.log(`[DEBUG 유머 (Streaming)] ${agentName}: enabled=${agentHumor?.enabled}, effectiveLevel=${effectiveHumorLevel}, reactionIntensity=${reactionIntensity}, context=${context}`);
      humorConfig = buildHumorTonePrompt(
        {
          name: agentName,
          persona: agentDescription,
          humorLevel: effectiveHumorLevel,
          reactionIntensity: reactionIntensity,
          context: context,
          language: responseLanguage,
          styles: agentHumor?.styles ?? []
        },
        'production' // 🔥 경량 모드 사용 (100 토큰)
      );
    }
    
    // 🎯 페르소나 OS: 관계별 맞춤형 시스템 프롬프트 구성
    const systemPrompt = await buildPersonaSystemPrompt(
      agentName,
      agentDescription,
      speechStyle,
      personality,
      additionalPrompt,
      responseLanguage,
      relationship,
      detectedAgentLanguage,
      languageLevel,
      userProfile,
      agentHumor,
      reactionIntensity,
      context,
      agentId
    );
    
    // 📊 문서 컨텍스트 처리
    const { documentContext, truncatedDocs } = processDocumentContext(availableDocuments);
    
    // 📝 문서 지침 추가
    const systemPromptWithDocs = addDocumentInstructions(systemPrompt, availableDocuments.length > 0);
    
    // 🎯 챗봇 타입별 처리
    const chatbotResult = processChatbotType(
      chatbotType,
      systemPromptWithDocs,
      documentContext,
      availableDocuments,
      userLanguage
    );
    
    if (chatbotResult.shouldReturn) {
      // For streaming, call onChunk with the message then return
      onChunk(chatbotResult.shouldReturn.message);
      return chatbotResult.shouldReturn;
    }
    
    // 🎚️ 유머 프롬프트를 시스템 프롬프트 최상단에 통합 (최우선 순위)
    const finalSystemPromptWithHumor = humorConfig.systemPrompt 
      ? `${humorConfig.systemPrompt}\n\n${chatbotResult.finalPrompt}`
      : chatbotResult.finalPrompt;
    
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: finalSystemPromptWithHumor },
      ...conversationHistory.slice(-10),
      { role: "user", content: userMessage },
    ];

    // 🔍 프롬프트 로깅 (디버깅용)
    console.log(`\n========== [${agentName}] FULL PROMPT ==========`);
    console.log(`[HUMOR PROMPT]: ${humorConfig.systemPrompt ? '✅ 포함됨' : '❌ 없음'}`);
    console.log(`[SYSTEM PROMPT]:\n${finalSystemPromptWithHumor}`);
    console.log(`[USER MESSAGE]: ${userMessage}`);
    console.log(`==========================================\n`);

    // 🎯 디코딩 다양화: 에이전트별 맞춤형 생성 파라미터 - 스트리밍 모드
    const resolvedMaxTokens = truncatedDocs.length > 0 ? 1000 : 800;
    const decodingProfile = generateDecodingProfile(agentName, chatbotType, agentHumor);
    const agentSeed = getAgentSeed(agentName);

    const stream = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        // 🚀 경량 모델로 교체 - 채팅 응답에 최적화 (4배 빠름)
        model: "gpt-4o-mini",
        messages,
        max_tokens: Math.min(resolvedMaxTokens, 2400), // 🎯 복잡도별 토큰 허용 (최대 expert 레벨)
        temperature: decodingProfile.temperature,
        top_p: decodingProfile.top_p,
        presence_penalty: decodingProfile.presence_penalty,
        frequency_penalty: decodingProfile.frequency_penalty,
        // logit_bias: decodingProfile.logit_bias, // 토큰 ID 매핑 필요로 비활성화
        seed: agentSeed,
        stream: true
      })
    );

    let fullResponse = "";
    let buffer = ""; // 괄호 태그를 추적하기 위한 버퍼
    let inParentheses = false; // 괄호 안에 있는지 추적
    
    // 알려진 리듬태그 목록 (removeRhythmTags와 동일)
    const rhythmTags = [
      '회상', '강조', '머뭇거리며', '인용', '결의', '정정', '경고',
      '다짐', '원칙', '반복', '호기심', '정적', '비유', '긴장',
      '안도', '격분', '차분', '당황', '미소', '한숨', '웃음',
      '눈물', '떨림', '침묵', '속삭임', '외침', '탄식', '감탄',
      '의문', '확신', '주저', '망설임', '결단', '각오', '분노',
      '슬픔', '기쁨', '놀람', '두려움', '희망', '절망', '후회',
      '그리움', '미안', '감사', '존경', '경멸', '동정', '연민'
    ];
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullResponse += content;
        
        // 🧹 리듬태그 스트리밍 필터링 (괄호 추적)
        for (const char of content) {
          if (char === '(' && !inParentheses) {
            inParentheses = true;
            buffer = char;
          } else if (inParentheses) {
            buffer += char;
            if (char === ')') {
              // 괄호가 닫힘: 알려진 리듬태그인지 확인
              const contentWithoutParens = buffer.slice(1, -1); // 괄호 제거
              const isRhythmTag = rhythmTags.includes(contentWithoutParens);
              
              if (!isRhythmTag) {
                // 리듬태그가 아니면 (일반 괄호) 전송
                onChunk(buffer);
              }
              // 리듬태그이면 제거 (전송하지 않음)
              buffer = "";
              inParentheses = false;
            }
          } else {
            // 괄호 밖의 내용은 즉시 전송
            onChunk(char);
          }
        }
      }
    }
    
    // 버퍼에 남은 내용이 있으면 전송 (괄호가 닫히지 않은 경우)
    if (buffer) {
      onChunk(buffer);
    }

    const errorMessages = {
      ko: "죄송합니다. 응답을 생성할 수 없습니다.",
      en: "Sorry, I couldn't generate a response.",
      zh: "抱歉，无法生成回复。",
      vi: "Xin lỗi, không thể tạo phản hồi.",
      ja: "申し訳ありません。応答を生成できませんでした。"
    };
    
    let assistantMessage = fullResponse || errorMessages[userLanguage as keyof typeof errorMessages] || errorMessages['ko'];
    
    // 🎭 다중 재작성 Authenticity Critic 검수 시스템 - 스트리밍 모드 (최대 3회)
    console.log(`[${agentName}] 스트리밍 1차 응답 완료 (길이: ${assistantMessage.length}자)`);
    
    let refinementAttempts = 0;
    const maxRefinements = 3;
    
    try {
      while (refinementAttempts < maxRefinements) {
        const criticFeedback = await authenticityCheck(agentName, assistantMessage, relationship, userMessage);
        
        console.log(`[${agentName}] 스트리밍 인증성 평가 (${refinementAttempts + 1}회차) - 전체: ${criticFeedback.score.overallScore.toFixed(1)}/5.0 (음성: ${criticFeedback.score.authenticVoice}, 전문성: ${criticFeedback.score.expertiseSpecificity}, 일관성: ${criticFeedback.score.priorStanceConsistency}, 관계: ${criticFeedback.score.relationshipAlignment})`);
        
        if (criticFeedback.needsRevision && criticFeedback.revisionInstructions) {
          console.log(`[${agentName}] 스트리밍 🔄 재작성 필요 (${refinementAttempts + 1}회차): ${criticFeedback.score.issues.join(", ")}`);
          
          const refinedMessage = await refineResponse(agentName, assistantMessage, criticFeedback.revisionInstructions, relationship);
          
          if (refinedMessage && refinedMessage !== assistantMessage) {
            assistantMessage = refinedMessage;
            console.log(`[${agentName}] 스트리밍 ✨ 재작성 완료 (${refinementAttempts + 1}회차): ${assistantMessage.slice(0, 50)}...`);
            refinementAttempts++;
          } else {
            break; // 재작성이 동일한 결과를 생성하면 중단
          }
        } else {
          console.log(`[${agentName}] 스트리밍 ✅ 인증성 검수 통과 (${refinementAttempts + 1}회차)`);
          break; // 통과하면 루프 종료
        }
      }
      
      if (refinementAttempts >= maxRefinements) {
        console.log(`[${agentName}] 스트리밍 ⚠️ 최대 재작성 횟수 (${maxRefinements}회) 도달`);
      }
    } catch (error) {
      console.error(`[${agentName}] 스트리밍 Authenticity check error:`, error);
      // 검수 실패 시 원본 사용
    }
    
    // 기관명 자동 교정 적용 (최종 후처리)
    assistantMessage = correctInstitutionNames(assistantMessage);
    
    // 🧹 리듬태그 제거 (사용자에게 보이지 않도록)
    assistantMessage = removeRhythmTags(assistantMessage);
    
    // OpenAI가 이미 올바른 형식으로 표를 생성함 - 변환 불필요

    return {
      message: assistantMessage,
      usedDocuments: truncatedDocs
    };

  } catch (error) {
    console.error("OpenAI Streaming API Error:", error);
    
    // 🔥 스마트 폴백 응답 생성 (질문과 에이전트 정보 활용)
    const smartFallback = generateSmartFallbackResponse(
      userMessage,
      agentName,
      agentDescription || '',
      '', // agentCategory 매개변수 없음
      userLanguage,
      languageLevel // 🎯 언어 레벨 적용
    );
    
    return {
      message: smartFallback,
      usedDocuments: []
    };
  }
}

export async function extractTextFromFile(filePath: string, mimeType: string): Promise<string> {
  try {
    if (mimeType.includes('text/')) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    
    if (mimeType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
      try {
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
      } catch (extractError) {
        console.error('Mammoth extraction failed:', extractError);
        return '워드 문서 텍스트 추출 중 오류가 발생했습니다. 원본 파일을 다운로드하여 확인해주세요.';
      }
    }
    
    return `파일 형식 ${mimeType}은 현재 지원되지 않습니다. 텍스트나 워드 문서를 사용해주세요.`;
  } catch (error) {
    console.error('File extraction error:', error);
    return '파일 처리 중 오류가 발생했습니다.';
  }
}

// 캐릭터 타입 분류
export type PersonaType = 'occupation' | 'coach' | 'peer' | 'celebrity' | 'manager' | 'roleplay';

// 주제별 캐릭터 아키타입 매핑
interface CharacterArchetype {
  name: string;
  description: string;
  personality: string;
  speechStyle: string;
  expertise: string;
  background: string;
  icon: string;
  color: string;
  personaType: PersonaType;
}

// 주제별 캐릭터 아키타입 데이터베이스
const TOPIC_ARCHETYPES: Record<string, CharacterArchetype[]> = {
  // 카페/스타벅스 관련
  'starbucks': [
    {
      name: "친근한 바리스타",
      description: "스타벅스에서 일하는 경험 많은 바리스타",
      personality: "친근하고 도움이 되려는",
      speechStyle: "자연스럽고 실용적인 서비스 영어",
      expertise: "커피 주문, 메뉴 설명, 서비스 영어",
      background: "다양한 고객을 상대한 경험이 풍부한 바리스타",
      icon: "☕",
      color: "#8B4513",
      personaType: 'occupation'
    },
    {
      name: "단골 고객",
      description: "스타벅스를 자주 이용하는 현지인",
      personality: "여유롭고 친근한",
      speechStyle: "일상적이고 자연스러운 고객 영어",
      expertise: "메뉴 추천, 일상 대화, 주문 경험",
      background: "스타벅스를 자주 이용하는 일반 고객",
      icon: "😊",
      color: "#4A90E2",
      personaType: 'peer'
    },
    {
      name: "매장 매니저",
      description: "스타벅스 매장을 관리하는 매니저",
      personality: "전문적이고 체계적인",
      speechStyle: "정중하고 전문적인 비즈니스 영어",
      expertise: "매장 운영, 고객 서비스, 팀 관리",
      background: "매장 운영과 고객 서비스에 경험이 풍부한 매니저",
      icon: "👔",
      color: "#2E8B57",
      personaType: 'manager'
    },
    {
      name: "ESL 카페 튜터",
      description: "카페에서 영어를 가르치는 튜터",
      personality: "인내심 많고 격려하는",
      speechStyle: "명확하고 교육적인 설명",
      expertise: "카페 영어 교육, 발음 교정, 실용 회화",
      background: "카페 상황을 활용한 영어 교육 전문가",
      icon: "📚",
      color: "#FF6B6B",
      personaType: 'coach'
    }
  ],
  // 레스토랑/식당 관련
  'restaurant': [
    {
      name: "웨이터",
      description: "레스토랑에서 서빙하는 웨이터",
      personality: "친절하고 세심한",
      speechStyle: "정중하고 서비스 지향적인",
      expertise: "메뉴 설명, 주문 받기, 서비스 영어",
      background: "다양한 고객을 상대한 서비스 경험",
      icon: "🍽️",
      color: "#FF8C00",
      personaType: 'occupation'
    },
    {
      name: "셰프",
      description: "레스토랑의 요리사",
      personality: "열정적이고 전문적인",
      speechStyle: "자신감 있고 전문적인",
      expertise: "요리, 재료 설명, 음식 문화",
      background: "요리 전문가이자 음식 문화 전달자",
      icon: "👨‍🍳",
      color: "#DC143C",
      personaType: 'occupation'
    }
  ],
  // 쇼핑 관련
  'shopping': [
    {
      name: "판매 직원",
      description: "매장에서 고객을 도우는 판매원",
      personality: "도움이 되려는 친근한",
      speechStyle: "친근하고 판매 지향적인",
      expertise: "상품 설명, 가격 안내, 고객 응대",
      background: "다양한 상품과 고객 응대 경험",
      icon: "🛍️",
      color: "#9370DB",
      personaType: 'occupation'
    },
    {
      name: "쇼핑 가이드",
      description: "쇼핑을 도와주는 전문 가이드",
      personality: "체계적이고 도움이 되는",
      speechStyle: "명확하고 안내 중심적인",
      expertise: "쇼핑 팁, 가격 비교, 브랜드 추천",
      background: "쇼핑 문화와 전략에 전문적인 가이드",
      icon: "🗺️",
      color: "#20B2AA",
      personaType: 'coach'
    }
  ],
  // 일반 비즈니스/직장 관련
  'business': [
    {
      name: "동료",
      description: "직장에서 함께 일하는 동료",
      personality: "협력적이고 이해심 많은",
      speechStyle: "자연스럽고 동료다운",
      expertise: "업무 협력, 사내 커뮤니케이션",
      background: "함께 일하는 직장 동료",
      icon: "🤝",
      color: "#4682B4",
      personaType: 'peer'
    },
    {
      name: "비즈니스 코치",
      description: "비즈니스 영어를 가르치는 전문가",
      personality: "전문적이고 격려하는",
      speechStyle: "명확하고 구조화된 설명",
      expertise: "비즈니스 영어, 프레젠테이션, 회의 진행",
      background: "비즈니스 커뮤니케이션 전문 코치",
      icon: "💼",
      color: "#2F4F4F",
      personaType: 'coach'
    }
  ],
  // 경제/금융 관련
  'economy': [
    {
      name: "김경제",
      description: "경제 이론과 현상을 분석하는 전문가",
      personality: "논리적이고 분석적인",
      speechStyle: "체계적이고 학술적인",
      expertise: "경제 이론, 시장 분석, 정책 평가",
      background: "경제학 연구와 실무를 겸비한 전문가",
      icon: "📊",
      color: "#2E8B57",
      personaType: 'occupation'
    },
    {
      name: "이투자",
      description: "주식과 투자 전략을 다루는 애널리스트",
      personality: "신중하고 현실적인",
      speechStyle: "정확하고 전문적인",
      expertise: "주식 투자, 포트폴리오 관리, 리스크 분석",
      background: "금융 시장에서 오랜 투자 경험을 가진 전문가",
      icon: "💰",
      color: "#DAA520",
      personaType: 'occupation'
    },
    {
      name: "박은행",
      description: "은행에서 고객 상담을 담당하는 직원",
      personality: "친절하고 신뢰할 수 있는",
      speechStyle: "정중하고 설명적인",
      expertise: "금융 상품, 대출 상담, 예금 업무",
      background: "다양한 금융 서비스 경험을 가진 은행 직원",
      icon: "🏦",
      color: "#4169E1",
      personaType: 'occupation'
    },
    {
      name: "최경제튜터",
      description: "경제학을 쉽게 가르치는 교육 전문가",
      personality: "인내심 많고 설명을 잘하는",
      speechStyle: "명확하고 이해하기 쉬운",
      expertise: "경제학 교육, 기초 개념 설명, 시사 경제",
      background: "경제학을 쉽게 가르치는 교육 전문가",
      icon: "📈",
      color: "#FF6347",
      personaType: 'coach'
    },
    {
      name: "워런 버핏",
      description: "세계적인 투자의 거신",
      personality: "지혜롭고 검소한",
      speechStyle: "단순명쾌하고 철학적인",
      expertise: "가치 투자, 장기 투자, 기업 분석",
      background: "수십 년간 성공적인 투자로 유명한 투자 대가",
      icon: "💎",
      color: "#800080",
      personaType: 'celebrity'
    }
  ],
  // 기술/IT 관련
  'technology': [
    {
      name: "김개발",
      description: "소프트웨어를 개발하는 프로그래머",
      personality: "논리적이고 문제 해결 지향적인",
      speechStyle: "정확하고 기술적인",
      expertise: "프로그래밍, 소프트웨어 개발, 기술 동향",
      background: "다양한 프로젝트 경험을 가진 소프트웨어 개발자",
      icon: "💻",
      color: "#00CED1",
      personaType: 'occupation'
    },
    {
      name: "이테크",
      description: "기술 솔루션을 제안하는 컨설턴트",
      personality: "전략적이고 소통 능력이 뛰어난",
      speechStyle: "체계적이고 설득력 있는",
      expertise: "IT 전략, 디지털 변환, 기술 컨설팅",
      background: "기업의 IT 혁신을 도우는 컨설팅 전문가",
      icon: "🔧",
      color: "#FF4500",
      personaType: 'coach'
    }
  ],
  // 교육 관련
  'education': [
    {
      name: "박선생",
      description: "학생들을 가르치는 교육자",
      personality: "인내심 많고 격려하는",
      speechStyle: "명확하고 교육적인",
      expertise: "교육 방법론, 학습 지도, 평가",
      background: "오랜 교육 경험을 가진 전문 교사",
      icon: "👩‍🏫",
      color: "#9370DB",
      personaType: 'coach'
    },
    {
      name: "김멘토",
      description: "효과적인 학습법을 가르치는 멘토",
      personality: "동기부여하고 지지하는",
      speechStyle: "친근하고 격려하는",
      expertise: "학습 전략, 시간 관리, 동기부여",
      background: "학습 코칭 전문가",
      icon: "🎯",
      color: "#32CD32",
      personaType: 'coach'
    }
  ],
  // 일본/문화 관련
  'japan': [
    {
      name: "다케다 유미",
      description: "일본 문화를 소개하는 친근한 가이드",
      personality: "친절하고 문화에 대한 애정이 깊은",
      speechStyle: "정중하고 따뜻한",
      expertise: "일본 문화, 전통, 언어, 여행",
      background: "일본 전통과 현대 문화를 잘 아는 문화 전문가",
      icon: "🎌",
      color: "#FF69B4",
      personaType: 'coach'
    },
    {
      name: "사토 켄지",
      description: "일본 요리를 가르치는 셰프",
      personality: "열정적이고 세심한",
      speechStyle: "정확하고 친근한",
      expertise: "일본 요리, 식재료, 조리법",
      background: "전통 일본 요리와 현대 요리를 모두 아는 전문 셰프",
      icon: "🍱",
      color: "#FF4500",
      personaType: 'occupation'
    },
    {
      name: "미야자키 하야오",
      description: "세계적인 애니메이션 감독",
      personality: "상상력이 풍부하고 철학적인",
      speechStyle: "깊이 있고 창의적인",
      expertise: "애니메이션, 스토리텔링, 예술",
      background: "지브리 스튜디오의 전설적인 애니메이션 감독",
      icon: "🎬",
      color: "#4169E1",
      personaType: 'celebrity'
    },
    {
      name: "나카무라 선생",
      description: "일본어를 가르치는 언어 교사",
      personality: "인내심 많고 격려하는",
      speechStyle: "명확하고 교육적인",
      expertise: "일본어 교육, 언어 학습, 문화 교육",
      background: "오랜 일본어 교육 경험을 가진 전문 교사",
      icon: "📚",
      color: "#32CD32",
      personaType: 'coach'
    }
  ],
  // 한국 문화 관련
  'korea': [
    {
      name: "김한국",
      description: "한국 문화를 소개하는 전문가",
      personality: "자랑스럽고 친근한",
      speechStyle: "열정적이고 설명을 잘하는",
      expertise: "한국 문화, 전통, 한류, 역사",
      background: "한국 전통과 현대 문화를 모두 아는 문화 전문가",
      icon: "🇰🇷",
      color: "#FF1493",
      personaType: 'coach'
    },
    {
      name: "박요리사",
      description: "한국 전통 요리를 만드는 셰프",
      personality: "정성스럽고 따뜻한",
      speechStyle: "친근하고 자세한",
      expertise: "한국 요리, 전통 음식, 조리법",
      background: "한국 전통 요리의 깊은 맛을 아는 전문 셰프",
      icon: "🍲",
      color: "#DC143C",
      personaType: 'occupation'
    }
  ],
  // 여행 관련
  'travel': [
    {
      name: "김여행",
      description: "세계 각국을 여행한 여행 전문가",
      personality: "모험적이고 경험이 풍부한",
      speechStyle: "생생하고 흥미진진한",
      expertise: "여행 계획, 현지 문화, 여행 팁",
      background: "50개국 이상을 여행한 경험이 풍부한 여행 전문가",
      icon: "✈️",
      color: "#4682B4",
      personaType: 'coach'
    },
    {
      name: "이가이드",
      description: "현지 문화를 잘 아는 여행 가이드",
      personality: "친절하고 박식한",
      speechStyle: "설명이 자세하고 재미있는",
      expertise: "현지 관광지, 문화, 숨은 명소",
      background: "다양한 지역의 문화와 관광지를 잘 아는 가이드",
      icon: "🗺️",
      color: "#228B22",
      personaType: 'occupation'
    }
  ]
};

// 주제에서 키워드 추출 및 매칭
function getTopicArchetypes(topic: string): CharacterArchetype[] {
  const topicLower = topic.toLowerCase();
  const allArchetypes: CharacterArchetype[] = [];
  
  // 카페/스타벅스 키워드 매칭
  if (topicLower.includes('스타벅스') || topicLower.includes('starbucks') || 
      topicLower.includes('카페') || topicLower.includes('cafe') || 
      topicLower.includes('커피') || topicLower.includes('coffee')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.starbucks);
  }
  
  // 레스토랑 키워드 매칭
  if (topicLower.includes('레스토랑') || topicLower.includes('restaurant') || 
      topicLower.includes('식당') || topicLower.includes('음식') || 
      topicLower.includes('food') || topicLower.includes('dining')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.restaurant);
  }
  
  // 쇼핑 키워드 매칭
  if (topicLower.includes('쇼핑') || topicLower.includes('shopping') || 
      topicLower.includes('매장') || topicLower.includes('store') || 
      topicLower.includes('구매') || topicLower.includes('buying')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.shopping);
  }
  
  // 비즈니스 키워드 매칭
  if (topicLower.includes('비즈니스') || topicLower.includes('business') || 
      topicLower.includes('회사') || topicLower.includes('직장') || 
      topicLower.includes('office') || topicLower.includes('work')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.business);
  }

  // 경제/금융 키워드 매칭
  if (topicLower.includes('경제') || topicLower.includes('economy') || 
      topicLower.includes('금융') || topicLower.includes('finance') || 
      topicLower.includes('투자') || topicLower.includes('investment') ||
      topicLower.includes('주식') || topicLower.includes('stock') ||
      topicLower.includes('은행') || topicLower.includes('bank') ||
      topicLower.includes('돈') || topicLower.includes('money')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.economy);
  }
  
  // 기술/IT 키워드 매칭
  if (topicLower.includes('기술') || topicLower.includes('technology') || 
      topicLower.includes('컴퓨터') || topicLower.includes('computer') || 
      topicLower.includes('프로그래밍') || topicLower.includes('programming') ||
      topicLower.includes('개발') || topicLower.includes('development') ||
      topicLower.includes('ai') || topicLower.includes('인공지능')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.technology);
  }
  
  // 교육 키워드 매칭
  if (topicLower.includes('교육') || topicLower.includes('education') || 
      topicLower.includes('학습') || topicLower.includes('learning') || 
      topicLower.includes('공부') || topicLower.includes('study') ||
      topicLower.includes('선생') || topicLower.includes('teacher')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.education);
  }
  
  // 일본 키워드 매칭
  if (topicLower.includes('일본') || topicLower.includes('japan') || 
      topicLower.includes('japanese') || topicLower.includes('니혼') || 
      topicLower.includes('도쿄') || topicLower.includes('tokyo') ||
      topicLower.includes('사무라이') || topicLower.includes('samurai') ||
      topicLower.includes('스시') || topicLower.includes('sushi') ||
      topicLower.includes('애니메') || topicLower.includes('anime')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.japan);
  }
  
  // 한국 키워드 매칭
  if (topicLower.includes('한국') || topicLower.includes('korea') || 
      topicLower.includes('korean') || topicLower.includes('서울') || 
      topicLower.includes('seoul') || topicLower.includes('김치') ||
      topicLower.includes('k-pop') || topicLower.includes('케이팝') ||
      topicLower.includes('한류') || topicLower.includes('hanryu')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.korea);
  }
  
  // 여행 키워드 매칭
  if (topicLower.includes('여행') || topicLower.includes('travel') || 
      topicLower.includes('관광') || topicLower.includes('tourism') || 
      topicLower.includes('휴가') || topicLower.includes('vacation') ||
      topicLower.includes('가이드') || topicLower.includes('guide')) {
    allArchetypes.push(...TOPIC_ARCHETYPES.travel);
  }
  
  return allArchetypes;
}

// 다양성 보장 알고리즘 - 타입별 쿼터 시스템
function ensureCharacterDiversity(
  candidates: CharacterSuggestion[], 
  targetCount: number = 6
): CharacterSuggestion[] {
  
  // 타입별 쿼터 정의
  const quotas = {
    occupation: Math.ceil(targetCount * 0.5), // 최소 50% 직업군
    celebrity: Math.floor(targetCount * 0.2), // 최대 20% 유명인
    coach: Math.ceil(targetCount * 0.15), // 15% 코치
    peer: Math.ceil(targetCount * 0.15), // 15% 동료
    manager: Math.floor(targetCount * 0.1), // 10% 매니저
    roleplay: Math.floor(targetCount * 0.1) // 10% 역할극
  };
  
  // 타입별로 캐릭터 분류
  const byType = candidates.reduce((acc, char) => {
    if (!acc[char.personaType]) acc[char.personaType] = [];
    acc[char.personaType].push(char);
    return acc;
  }, {} as Record<PersonaType, CharacterSuggestion[]>);
  
  const selected: CharacterSuggestion[] = [];
  
  // 1단계: 직업군 우선 선택 (최소 50% 보장)
  if (byType.occupation) {
    const occupationChars = byType.occupation.slice(0, quotas.occupation);
    selected.push(...occupationChars);
  }
  
  // 2단계: 코치, 동료, 매니저 균형있게 선택
  ['coach', 'peer', 'manager'].forEach(type => {
    if (byType[type as PersonaType] && selected.length < targetCount) {
      const quota = quotas[type as PersonaType];
      const chars = byType[type as PersonaType].slice(0, quota);
      selected.push(...chars);
    }
  });
  
  // 3단계: 유명인은 제한적으로 추가 (최대 20%)
  if (byType.celebrity && selected.length < targetCount) {
    const remainingSlots = Math.min(
      targetCount - selected.length,
      quotas.celebrity
    );
    if (remainingSlots > 0) {
      const celebrityChars = byType.celebrity.slice(0, remainingSlots);
      selected.push(...celebrityChars);
    }
  }
  
  // 4단계: 남은 자리를 다른 타입으로 채우기
  if (selected.length < targetCount) {
    const remaining = candidates.filter(char => !selected.includes(char));
    const needed = targetCount - selected.length;
    selected.push(...remaining.slice(0, needed));
  }
  
  return selected.slice(0, targetCount);
}

// 주제 기반 캐릭터 풀 생성 (AI 우선 방식)
function buildCharacterPool(
  topic: string,
  aiGeneratedChars: CharacterSuggestion[]
): CharacterSuggestion[] {
  console.log(`[Character Pool] AI 생성된 캐릭터 수: ${aiGeneratedChars.length}`);
  
  // AI 생성에 성공한 경우 AI 캐릭터만 사용 (메타 프롬프트 전략)
  if (aiGeneratedChars.length >= 3) {
    console.log(`[Character Pool] AI 생성 성공 - AI 캐릭터만 사용 (아키타입 제외)`);
    return aiGeneratedChars.filter((char, index, arr) => 
      arr.findIndex(c => c.name.toLowerCase() === char.name.toLowerCase()) === index
    );
  }
  
  // AI 생성이 부족한 경우에만 아키타입과 보완
  console.log(`[Character Pool] AI 생성 부족 - 아키타입으로 보완`);
  const archetypes = getTopicArchetypes(topic);
  
  // 아키타입을 CharacterSuggestion 형태로 변환
  const archetypeChars: CharacterSuggestion[] = archetypes.map(archetype => ({
    ...archetype,
    isVariation: false
  }));
  
  // AI 우선, 부족분을 아키타입으로 보완
  const allCandidates = [...aiGeneratedChars, ...archetypeChars];
  
  // 중복 제거 (이름 기준)
  const uniqueCandidates = allCandidates.filter((char, index, arr) => 
    arr.findIndex(c => c.name.toLowerCase() === char.name.toLowerCase()) === index
  );
  
  console.log(`[Character Pool] 최종 후보 풀: ${uniqueCandidates.length}개 (AI: ${aiGeneratedChars.length}, 아키타입: ${archetypeChars.length})`);
  return uniqueCandidates;
}

// 캐릭터 추천 인터페이스
export interface CharacterSuggestion {
  id?: string; // 캐릭터 고유 ID
  name: string;
  category?: string; // 카테고리: 학자, 실무자, 기업가, 정책가, 사상가, 역사인물 등
  description: string;
  personality: string;
  speechStyle: string;
  expertise: string;
  background: string;
  icon: string;
  color: string;
  tags?: string[]; // 관련 키워드 배열
  personaType: PersonaType; // 캐릭터 타입 분류 (기존 호환성 유지)
  isVariation?: boolean; // 바리에이션 캐릭터인지 표시
  baseCharacter?: string; // 기본 캐릭터 이름 (바리에이션인 경우)
  reason?: string; // 추천 이유 (optional)
  characterPersonaType?: 'Intro' | 'Growth' | 'Mature' | 'Insight'; // 일반인 캐릭터 대화 깊이 레벨
}

// OpenAI API를 사용한 캐릭터 추천 함수
// V 버튼: 적응형 3단 레이어 추천 (캐릭터 타입별 맞춤 전략 적용)
// - 가상 캐릭터: 동일 세계관 → 유사 장르 → 현실 메타
// - 역사/정치: 동시대 → 유사 역할 → 현대 해석자
// - 학자/사상가: 같은 학파 → 유사 주제 → 대중화 인물
// - 기업가/실무자: 같은 산업 → 유사 비전 → 영감 인물

// 캐릭터 타입 감지 헬퍼 함수
function detectCharacterType(character: CharacterSuggestion): 'fictional' | 'historical' | 'scholar' | 'business' | 'ordinary_person' | 'generic' {
  const category = character.category || '';
  const background = (character.background || '').toLowerCase();
  const description = (character.description || '').toLowerCase();
  const tags = character.tags || [];
  const allText = `${background} ${description} ${tags.join(' ')}`.toLowerCase();
  
  // 🧑 0단계: 일반인 캐릭터 판별 (최우선)
  if (category === '일반인' || tags.includes('일반인')) return 'ordinary_person';
  
  // 1단계: 카테고리 기반 판별 (우선순위 최상)
  if (category === '역사인물' || category === '정책가') return 'historical';
  if (category === '학자' || category === '사상가') return 'scholar';
  if (category === '기업가' || category === '실무자') return 'business';
  if (category === '예술가') {
    // 예술가 카테고리 내에서 세부 판별
    const realPersonKeywords = ['배우', '감독', '작가', '제작자', '연출가', '프로듀서', '촬영감독', '각본가', 'actor', 'director', 'producer', 'writer', 'filmmaker'];
    const isRealPerson = realPersonKeywords.some(keyword => allText.includes(keyword));
    if (isRealPerson) return 'business'; // 예술가는 business 타입으로 분류 (같은 산업 전략)
  }
  
  // 2단계: 실존 인물 제외 키워드 체크
  const realPersonKeywords = ['배우', '감독', '작가', '제작자', '연출가', '프로듀서', '촬영감독', '각본가', 
                               'actor', 'director', 'producer', 'writer', 'filmmaker', 
                               '기업가', '창업자', 'ceo', 'founder', '과학자', 'scientist',
                               '역사', 'historical', '정치인', 'politician'];
  const isRealPerson = realPersonKeywords.some(keyword => allText.includes(keyword));
  if (isRealPerson) return 'business'; // 실존 인물은 business 타입 전략 사용
  
  // 3단계: 가상 캐릭터 판별 키워드 (더 구체적으로)
  const fictionalKeywords = ['작품 속', '소설 속', '캐릭터', '주인공', '등장인물', '만화', '애니메이션', '게임', 
                             'novel character', 'fictional', 'character from', '판타지 세계', '마법 세계',
                             '시리즈의', '작품의'];
  const isFictional = fictionalKeywords.some(keyword => allText.includes(keyword));
  
  if (isFictional) return 'fictional';
  
  return 'generic';
}

export async function suggestCharacterVariations(
  baseCharacter: CharacterSuggestion, 
  userLanguage: string,
  excludeHistory: { ids: string[], normalizedNames: string[] } = { ids: [], normalizedNames: [] }
): Promise<CharacterSuggestion[]> {
  try {
    const responseLanguage = getResponseLanguage(userLanguage);
    const category = baseCharacter.category || '기타';
    const baseTags = baseCharacter.tags || [];
    const baseDesc = baseCharacter.description || '';
    const baseBackground = baseCharacter.background || '';
    
    // 🧑 일반인 캐릭터 감지 및 특별 처리
    const isGenericPerson = category === "일반인" || baseTags.includes("일반인");
    
    if (isGenericPerson) {
      console.log(`[V Button - Generic Person] 일반인 캐릭터 감지: ${baseCharacter.name}`);
      
      // 주제 추출 (expertise 또는 description에서)
      const topic = baseCharacter.expertise || baseCharacter.description || "일상";
      console.log(`[V Button - Generic Person] 주제: ${topic}`);
      
      // 🎯 가중치 기반 dialogueDepth 선택 함수 (이전 타입과 다른 것 우선)
      const basePersType = baseCharacter.characterPersonaType;
      const allDialogueDepths: ('Intro' | 'Growth' | 'Mature' | 'Insight')[] = ['Intro', 'Growth', 'Mature', 'Insight'];
      
      const selectDialogueDepth = (): 'Intro' | 'Growth' | 'Mature' | 'Insight' => {
        if (!basePersType) {
          // 기존 타입 정보가 없으면 랜덤
          return allDialogueDepths[Math.floor(Math.random() * 4)];
        }
        
        // 70% 확률로 다른 타입 선택, 30% 확률로 동일 타입
        if (Math.random() < 0.7) {
          const otherTypes = allDialogueDepths.filter(t => t !== basePersType);
          return otherTypes[Math.floor(Math.random() * otherTypes.length)];
        } else {
          return basePersType;
        }
      };
      
      console.log(`[V Button - Generic Person] 기존 대화 깊이: ${basePersType || 'Unknown'}, 가중치 기반 다양성 적용`);
      
      // 6명의 다양한 일반인 생성 (대화 깊이 레벨 다양화)
      const genericVariations: CharacterSuggestion[] = [];
      for (let i = 0; i < 6; i++) {
        const selectedType = selectDialogueDepth();
        const newGenericChar = await generateGenericCharacter(topic, userLanguage, selectedType);
        if (newGenericChar) {
          // 중복 제거
          const isDuplicate = genericVariations.some(c => 
            normalizeCharacterName(c.name) === normalizeCharacterName(newGenericChar.name)
          ) || excludeHistory.normalizedNames.some(n => 
            n === normalizeCharacterName(newGenericChar.name)
          );
          
          if (!isDuplicate) {
            // 🎯 Variation 메타데이터 추가 (UI 호환성)
            genericVariations.push({
              ...newGenericChar,
              isVariation: true,
              baseCharacter: baseCharacter.name
            });
          }
        }
      }
      
      console.log(`[V Button - Generic Person] ${genericVariations.length}명의 일반인 변형 생성 완료`);
      return genericVariations.slice(0, 6); // 최대 6명
    }
    
    // 🎨 창작형 캐릭터 감지 및 특별 처리
    const isCreativeCharacter = baseCharacter.personaType === 'creative' || category === '창작형' || baseTags.includes('창작형');
    
    if (isCreativeCharacter) {
      console.log(`[V Button - Creative Character] 창작형 캐릭터 감지: ${baseCharacter.name}`);
      
      // 세계관 추출 (worldview 또는 background에서)
      const baseWorldview = baseCharacter.worldview || baseCharacter.background || baseCharacter.description || "";
      const topic = baseCharacter.expertise || baseCharacter.occupation || baseCharacter.description || "일상";
      console.log(`[V Button - Creative Character] 주제: ${topic}, 세계관: ${baseWorldview}`);
      
      // 키워드 추출 (tags 또는 topic에서)
      const keywords = baseTags.length > 0 ? baseTags : [topic];
      
      // 중복 제거를 위한 배열 복사
      const excludedNames = [...excludeHistory.normalizedNames];
      
      // 6명의 유사 세계관 창작 캐릭터 생성
      const creativeVariations: CharacterSuggestion[] = [];
      let attempts = 0;
      const maxAttempts = 10;
      
      while (creativeVariations.length < 6 && attempts < maxAttempts) {
        const needed = 6 - creativeVariations.length;
        const newCreativeChars = await generateCreativeCharacter(
          topic,
          keywords,
          userLanguage,
          needed,
          excludedNames,
          baseWorldview // 기준 세계관 전달
        );
        
        for (const char of newCreativeChars) {
          const normalized = normalizeCharacterName(char.name);
          
          // 중복 제거
          const isDuplicate = excludedNames.includes(normalized);
          
          if (!isDuplicate && creativeVariations.length < 6) {
            // 🎯 Variation 메타데이터 추가 (UI 호환성)
            creativeVariations.push({
              ...char,
              isVariation: true,
              baseCharacter: baseCharacter.name
            });
            excludedNames.push(normalized);
            console.log(`[V Button - Creative Character]   ${creativeVariations.length}. ${char.name} (${char.worldview})`);
          }
        }
        
        attempts++;
      }
      
      // 6명 보장을 위한 padding
      while (creativeVariations.length < 6) {
        const remainingCount = 6 - creativeVariations.length;
        console.warn(`[V Button - Creative Character] Padding 필요 (${creativeVariations.length}/6), ${remainingCount}명 생성`);
        
        creativeVariations.push({
          id: `creative_placeholder_${Date.now()}_${creativeVariations.length}`,
          name: `${topic} 탐험자 ${creativeVariations.length + 1}`,
          category: '창작형',
          description: `${topic}을 탐험하는 창작 캐릭터`,
          personality: "호기심 가득",
          speechStyle: "창의적인 대화",
          expertise: topic,
          background: `${topic}에 대한 독특한 관점`,
          tags: keywords,
          icon: "✨",
          color: "#9333EA",
          personaType: 'creative' as PersonaType,
          worldview: baseWorldview || `${topic}에 대한 열린 태도`, // 기준 세계관 포함
          isVariation: true,
          baseCharacter: baseCharacter.name
        });
        console.log(`[V Button - Creative Character] Placeholder 추가: ${topic} 탐험자 ${creativeVariations.length} (세계관: ${baseWorldview || '기본'})`);
      }
      
      console.log(`[V Button - Creative Character] ${creativeVariations.length}명의 창작형 변형 생성 완료`);
      return creativeVariations.slice(0, 6); // 정확히 6명
    }
    
    // 캐릭터 타입 감지
    const characterType = detectCharacterType(baseCharacter);
    console.log(`[V Button - Adaptive 3-Layer] "${baseCharacter.name}" 타입: ${characterType}, 태그: ${baseTags.join(', ')}`);
    
    // 랜덤 시드로 다양성 보장
    const randomSeed = Math.floor(Math.random() * 1000);
    
    // 타입별 레이어 전략 정의
    let layerStrategy = '';
    
    if (characterType === 'fictional') {
      layerStrategy = `**📌 가상 캐릭터 추천 전략 (3단 레이어):**

**1️⃣ 동일 세계관 레이어 (40% = 2-3명)**
- 같은 작품/우주/세계관 내 캐릭터
- 예: 헤르미온느 → 루나 러브굿, 진 위즐리
- 예: 토니 스타크 → 페퍼 포츠, 로디

**2️⃣ 유사 장르/작품 레이어 (30% = 2명)**
- 같은 장르·유사 주제의 다른 작품 캐릭터
- 예: 헤르미온느 → 갈라드리엘 (반지의 제왕), 요다 (스타워즈)
- 예: 토니 스타크 → 배트맨 (DC), 릭 샌체스 (릭앤모티)

**3️⃣ 현실 세계 메타 레이어 (30% = 1-2명)**
- 배우, 감독, 제작자, 팬덤 대표, 평론가
- 예: 스파이더맨 → 톰 홀랜드 (배우), 스탠 리 (창작자)
- 예: 헤르미온느 → 엠마 왓슨 (배우), J.K. 롤링 (작가)`;
    } else if (characterType === 'historical') {
      // 소설 캐릭터 여부 추가 확인 (tags, description에서)
      const allText = [baseDesc, baseBackground, ...baseTags].join(' ').toLowerCase();
      const isNovelCharacter = ['소설 속', '작품 속', '등장인물', '작품의', '시리즈의', '만화', '애니', '드라마', 'novel', 'story character', 'fictional'].some(kw => allText.includes(kw));
      
      if (isNovelCharacter) {
        // 소설 캐릭터로 재분류
        layerStrategy = `**📌 소설/작품 캐릭터 추천 전략 (3단 레이어):**

**1️⃣ 동일 작품 레이어 (40% = 2-3명)**
- 같은 작품 내 다른 등장인물
- 예: 홍길동 → 춘섬, 초란, 홍판서
- 예: 해리포터 → 헤르미온느, 론, 덤블도어

**2️⃣ 작품 관련 인물 레이어 (30% = 2명)**
- 작가, 번역가, 연구자, 평론가
- 예: 홍길동 → 허균 (작가), 정민 (고전문학 연구자)
- 예: 해리포터 → J.K. 롤링 (작가), 스티븐 프라이 (내레이터)

**3️⃣ 유사 작품 캐릭터 레이어 (30% = 1-2명)**
- 비슷한 장르/시대의 다른 작품 캐릭터
- 예: 홍길동 → 임꺽정 (의적 소설), 춘향 (고전 소설)`;
      } else {
        layerStrategy = `**📌 역사/정치 인물 추천 전략 (3단 레이어):**

**1️⃣ 동시대 인물 레이어 (40% = 2-3명)**
- 같은 시대·동일 조직·동료 관계 인물
- 예: 링컨 → 울리시스 그랜트, 윌리엄 시워드
- 예: 처칠 → 루스벨트, 드골

**2️⃣ 유사 역할 인물 레이어 (30% = 2명)**
- 다른 시대/지역의 비슷한 역할·사명 인물
- 예: 링컨 → 넬슨 만델라 (평등 투쟁), 간디 (비폭력 저항)
- 예: 세종대왕 → 메이지 천황 (개혁), 무함마드 알리 (문화 융성)

**3️⃣ 현대 해석자 레이어 (30% = 1-2명)**
- 역사가, 전기 작가, 연구자, 교육자
- 예: 링컨 → 도리스 컨스 굿윈 (전기 작가), 에릭 포너 (역사학자)`;
      }
    } else if (characterType === 'scholar') {
      layerStrategy = `**📌 학자/사상가 추천 전략 (3단 레이어):**

**1️⃣ 같은 학파/분야 레이어 (40% = 2-3명)**
- 동료, 제자, 스승, 같은 연구 분야
- 예: 아인슈타인 → 닐스 보어, 막스 플랑크
- 예: 플라톤 → 소크라테스, 아리스토텔레스

**2️⃣ 유사 주제 학자 레이어 (30% = 2명)**
- 다른 분야의 관련 연구자·사상가
- 예: 아인슈타인 → 스티븐 호킹 (우주론), 리처드 파인만 (양자역학)
- 예: 플라톤 → 공자 (동양 철학), 칸트 (근대 철학)

**3️⃣ 대중화 인물 레이어 (30% = 1-2명)**
- 과학 커뮤니케이터, 저술가, 교육자
- 예: 아인슈타인 → 닐 디그래스 타이슨 (과학 소통가), 미치오 카쿠 (미래학자)`;
    } else if (characterType === 'business') {
      layerStrategy = `**📌 기업가/실무자 추천 전략 (3단 레이어):**

**1️⃣ 같은 산업 인물 레이어 (40% = 2-3명)**
- 경쟁자, 파트너, 동료, 같은 분야
- 예: 일론 머스크 → 제프 베조스, 래리 페이지
- 예: 스티브 잡스 → 빌 게이츠, 스티브 워즈니악

**2️⃣ 유사 비전 인물 레이어 (30% = 2명)**
- 다른 산업의 혁신가·비전가
- 예: 일론 머스크 → 리처드 브랜슨 (우주), 토니 세 (전기차 경쟁사)
- 예: 스티브 잡스 → 월트 디즈니 (창의성), 헨리 포드 (혁신)

**3️⃣ 영감 인물 레이어 (30% = 1-2명)**
- 멘토, 영향 받은 인물, 롤모델
- 예: 일론 머스크 → 니콜라 테슬라 (발명가), 토마스 에디슨 (혁신가)
- 예: 스티브 잡스 → 에드윈 랜드 (폴라로이드), 소니 모리타 (소니)`;
    } else {
      // generic - 기본 전략
      layerStrategy = `**📌 일반 추천 전략 (3단 레이어):**

**1️⃣ 관련 분야 인물 레이어 (40% = 2-3명)**
- 같은 분야·주제의 인물
- 태그 기반 유사성 우선

**2️⃣ 확장 분야 인물 레이어 (30% = 2명)**
- 연관 분야·주제의 인물
- 교차 관점 제공

**3️⃣ 대중·문화 레이어 (30% = 1-2명)**
- 대중적 인지도 있는 관련 인물
- 문화적 연결성`;
    }
    
    const systemPrompt = `당신은 "적응형 3단 레이어 캐릭터 추천 엔진"입니다.

🚨 CRITICAL RULES - 절대 위반 금지 🚨
1. name 필드는 반드시 **구체적인 인물 이름**이어야 함
   ❌ 금지: "캐릭터 6", "캐릭터 N", "흥미로운 대화 상대"
   ✅ 허용: "이순신", "알버트 아인슈타인", "해리 포터"

2. 추천 대상은 **실존 인물 또는 작품 출처가 명확한 가상 캐릭터만**
   ❌ 금지: 지명, 장소, 조직, 단체, 추상 개념
   ✅ 허용: "이순신 (역사 인물)", "해리 포터 (J.K. 롤링 작품)"

### 🎯 V 버튼 적응형 3단 레이어 추천

**기준 캐릭터**: "${baseCharacter.name}"
- 타입: ${characterType === 'fictional' ? '가상 캐릭터' : characterType === 'historical' ? '역사/정치 인물' : characterType === 'scholar' ? '학자/사상가' : characterType === 'business' ? '기업가/실무자' : '일반'}
- 설명: ${baseDesc}
- 배경: ${baseBackground}
- 핵심 태그: ${baseTags.length > 0 ? baseTags.join(', ') : '정보 없음'}

${layerStrategy}

### 🚨 중복 방지 조건 (절대 규칙)
- **절대로 같은 인물을 다른 언어로 중복 추천하지 마세요.** 예: "Warren Buffett"과 "워렌 버핏" 둘 다 추천하지 않기
- **절대로 같은 캐릭터를 다른 이름으로 중복 추천하지 마세요.** 예: "Iron Man"과 "토니 스타크" 둘 다 추천하지 않기
- Random seed ${randomSeed}를 활용하여 매번 다른 추천을 생성하세요.${excludeHistory.normalizedNames.length > 0 ? `

### 🚫 이미 추천된 캐릭터 (절대 추천 금지)
다음 캐릭터들은 이미 추천되었거나 채팅방에 참여 중이므로 **절대로** 추천하지 마세요:
- 제외: ${excludeHistory.normalizedNames.slice(0, 8).join(', ')}${excludeHistory.normalizedNames.length > 8 ? ` 외 ${excludeHistory.normalizedNames.length - 8}명` : ''}
⚠️ 위 인물들과 비슷한 이름, 다른 언어 표기도 모두 제외하세요.` : ''}

### 출력 형식 (JSON) - 정확히 6명
{
  "characters": [
    {
      "id": "unique_identifier",
      "name": "이름 (15자 이내)",
      "category": "${category}",
      "shortDescription": "핵심 설명 (30자 이내)",
      "tags": ["키워드1", "키워드2", "키워드3"],
      "icon": "단일 기본 이모지",
      "color": "#RRGGBB"
    }
  ]
}

응답 언어: ${responseLanguage}`;

    // 타입별 유저 프롬프트 생성
    let layerInstructions = '';
    
    if (characterType === 'fictional') {
      layerInstructions = `1️⃣ **동일 세계관 레이어 (2-3명)**: 같은 작품 내 캐릭터
2️⃣ **유사 장르/작품 레이어 (2명)**: 다른 작품의 비슷한 캐릭터
3️⃣ **현실 세계 메타 레이어 (1-2명)**: 배우, 감독, 제작자, 평론가

reason 예시: "동일 세계관: 같은 호그와트 학생", "유사 장르: 판타지 마법사", "현실 메타: 배우"`;
    } else if (characterType === 'historical') {
      const allText = [baseDesc, baseBackground, ...baseTags].join(' ').toLowerCase();
      const isNovelCharacter = ['소설 속', '작품 속', '등장인물', '작품의', '시리즈의', '만화', '애니', '드라마', 'novel', 'story character', 'fictional'].some(kw => allText.includes(kw));
      
      if (isNovelCharacter) {
        layerInstructions = `1️⃣ **동일 작품 레이어 (2-3명)**: 같은 작품 내 등장인물
2️⃣ **작품 관련 인물 레이어 (2명)**: 작가, 번역가, 연구자, 평론가
3️⃣ **유사 작품 캐릭터 레이어 (1-2명)**: 비슷한 장르/시대 다른 작품 캐릭터

reason 예시: "동일 작품: 홍길동전 등장인물", "작품 관련: 작가/연구자", "유사 작품: 고전 의적 소설"`;
      } else {
        layerInstructions = `1️⃣ **동시대 인물 레이어 (2-3명)**: 같은 시대·조직·동료
2️⃣ **유사 역할 인물 레이어 (2명)**: 다른 시대/지역의 비슷한 역할
3️⃣ **현대 해석자 레이어 (1-2명)**: 역사가, 전기 작가, 연구자

reason 예시: "동시대: 링컨 정부 각료", "유사 역할: 평등 투쟁 지도자", "현대 해석자: 역사학자"`;
      }
    } else if (characterType === 'scholar') {
      layerInstructions = `1️⃣ **같은 학파/분야 레이어 (2-3명)**: 동료, 제자, 스승
2️⃣ **유사 주제 학자 레이어 (2명)**: 다른 분야 관련 연구자
3️⃣ **대중화 인물 레이어 (1-2명)**: 과학 커뮤니케이터, 저술가

reason 예시: "같은 학파: 양자역학 동료", "유사 주제: 우주론 학자", "대중화: 과학 소통가"`;
    } else if (characterType === 'business') {
      layerInstructions = `1️⃣ **같은 산업 인물 레이어 (2-3명)**: 경쟁자, 파트너, 동료
2️⃣ **유사 비전 인물 레이어 (2명)**: 다른 산업 혁신가
3️⃣ **영감 인물 레이어 (1-2명)**: 멘토, 영향 받은 인물, 롤모델

reason 예시: "같은 산업: 테크 기업가", "유사 비전: 우주 산업 혁신가", "영감: 발명가 롤모델"`;
    } else {
      layerInstructions = `1️⃣ **관련 분야 인물 레이어 (2-3명)**: 같은 분야·주제
2️⃣ **확장 분야 인물 레이어 (2명)**: 연관 분야·주제
3️⃣ **대중·문화 레이어 (1-2명)**: 대중적 인지도 있는 관련 인물

reason 예시: "관련 분야: 같은 주제", "확장 분야: 연관 주제", "대중 문화: 문화적 연결"`;
    }
    
    const userPrompt = `기준 캐릭터: "${baseCharacter.name}"
- 타입: ${characterType}
- 핵심 태그: ${baseTags.length > 0 ? baseTags.join(', ') : '(태그 없음 - 설명 기반 추론)'}
- 설명: ${baseDesc}
- 배경: ${baseBackground}

**🔍 적응형 3단 레이어 추천 (정확히 6명):**

${layerInstructions}

**✅ 필수 규칙:**
- 각 레이어에서 정확한 비율로 선택
- 태그 기반 유사성 우선 (같은 태그 2개 이상 매칭)
- reason 필드에 레이어 정보 명확히 포함
- 각 필드는 지정된 글자 수를 반드시 준수`;

    console.log(`[V Button] OpenAI API 호출 (카테고리: ${category}, 시드: ${randomSeed})`);
    
    // 간소화된 스키마 - 일반 추천과 동일 (속도 최적화)
    const characterSchema = {
      type: "object",
      properties: {
        characters: {
          type: "array",
          minItems: 6,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 30 },
              name: { type: "string", minLength: 1, maxLength: 15 },
              category: { 
                type: "string",
                enum: ["학자", "실무자", "기업가", "정책가", "사상가", "역사인물", "예술가", "운동선수", "기타"]
              },
              shortDescription: { type: "string", minLength: 1, maxLength: 30 },
              tags: {
                type: "array",
                items: { type: "string", maxLength: 15 },
                minItems: 3,
                maxItems: 5
              },
              icon: { type: "string", minLength: 1, maxLength: 4 },
              color: { type: "string", minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }
            },
            required: ["id", "name", "category", "shortDescription", "tags", "icon", "color"],
            additionalProperties: false
          }
        }
      },
      required: ["characters"],
      additionalProperties: false
    };

    const modelName = "gpt-4o-mini";
    const startTime = Date.now();
    console.log(`[⚡ 속도 체크 V버튼] OpenAI API 호출 시작 - 모델: ${modelName} (간소화 모드)`);
    
    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 2000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "same_category_characters",
            schema: characterSchema,
            strict: true
          }
        }
      });
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[⚡ 속도 체크 V버튼] OpenAI API 완료 - 모델: ${modelName}, 소요시간: ${elapsed}초`);

    const response = completion.choices[0]?.message?.content?.trim();
    const finishReason = completion.choices[0]?.finish_reason;
    
    if (finishReason === 'length') {
      console.warn('[V Button] ⚠️ 응답이 max_tokens 제한으로 잘림 - JSON 파싱 실패 가능');
    }
    
    if (!response) {
      throw new Error("OpenAI API에서 응답을 받지 못했습니다.");
    }

    const data = JSON.parse(response);
    const characters = data.characters || [];
    
    console.log(`[V Button] OpenAI 응답: ${characters.length}명 생성`);

    // 중복 제거: 이력 + 기본 캐릭터 제외
    const allExcluded = new Set([
      ...excludeHistory.normalizedNames.map(n => normalizeCharacterName(n)),
      normalizeCharacterName(baseCharacter.name)
    ]);
    
    const filtered = characters.filter((char: any) => {
      const normalized = normalizeCharacterName(char.name);
      return !allExcluded.has(normalized);
    });

    console.log(`[V Button] 중복 제거 후: ${filtered.length}명 (${characters.length - filtered.length}명 제외됨)`);

    // 카테고리 검증
    const validCategories = ["학자", "실무자", "기업가", "정책가", "사상가", "역사인물", "예술가", "운동선수", "기타"];
    
    // 상위 6명 선택 (간소화 모드)
    const final = filtered.slice(0, 6).map((char: any) => {
      const name = char.name || "(이름 없음)";
      const category = validCategories.includes(char.category) ? char.category : "기타";
      const shortDesc = char.shortDescription || "흥미로운 대화 상대";
      
      return {
        id: char.id || generateCharacterId(name),
        name,
        category,
        description: shortDesc,
        personality: "",
        speechStyle: "",
        expertise: "",
        background: "",
        tags: char.tags || [],
        icon: char.icon || "👤",
        color: char.color || "#808080",
        personaType: "celebrity" as PersonaType,
        reason: ""
      };
    });

    console.log(`[V Button] 최종 추천: ${final.length}명`);
    return final;

  } catch (error) {
    console.error('[V Button] 오류:', error);
    
    // 에러 시 빈 배열 반환 (프론트엔드에서 처리)
    return [];
  }
}

export async function suggestCharacters(
  topic: string, 
  userLanguage: string, 
  excludeHistory: { ids: string[], normalizedNames: string[] } = { ids: [], normalizedNames: [] }
): Promise<CharacterSuggestion[]> {
  try {
    console.log('[Primary Character Recommendation] 시작:', topic, excludeHistory.ids.length > 0 ? `(제외: ${excludeHistory.ids.length}개)` : '');
    
    // 1️⃣ 주제 분석 - 타입별 추천 비율 결정
    const analysis = await analyzeTopic(topic, userLanguage);
    console.log(`[Primary Recommendation] 분석 완료 - ${analysis.category} 카테고리`);
    console.log(`[Primary Recommendation] 추천 비율 - Famous: ${analysis.mix.famous}, Ordinary: ${analysis.mix.ordinary}, Creative: ${analysis.mix.creative}`);
    console.log(`[Primary Recommendation] 키워드: ${analysis.keywords.join(', ')}`);
    console.log(`[Primary Recommendation] 근거: ${analysis.reasoning}`);
    
    const recommendations: CharacterSuggestion[] = [];
    // excludeHistory 배열 복사하여 mutation 방지
    const excludedNames = [...(excludeHistory.normalizedNames || [])];
    
    // 2️⃣ 유명인 캐릭터 생성 (retry 로직 포함)
    if (analysis.mix.famous > 0) {
      console.log(`[Primary Recommendation] 유명인 캐릭터 ${analysis.mix.famous}명 생성 중...`);
      let famousCount = 0;
      let retryAttempts = 0;
      const maxRetries = 3;
      
      while (famousCount < analysis.mix.famous && retryAttempts < maxRetries) {
        const needed = analysis.mix.famous - famousCount;
        const famousChars = await generateFamousCharacters(
          topic, 
          userLanguage, 
          needed, 
          { ids: excludeHistory.ids, normalizedNames: excludedNames },
          analysis.category,
          analysis.keywords
        );
        
        // 중복 제거 및 추가
        for (const char of famousChars) {
          const normalized = normalizeCharacterName(char.name);
          if (!excludedNames.includes(normalized)) {
            recommendations.push(char);
            excludedNames.push(normalized);
            famousCount++;
            if (famousCount >= analysis.mix.famous) break;
          }
        }
        
        retryAttempts++;
        if (famousCount < analysis.mix.famous && retryAttempts < maxRetries) {
          console.log(`[Primary Recommendation] 유명인 ${famousCount}/${analysis.mix.famous}명, 재시도 ${retryAttempts}/${maxRetries}`);
        }
      }
      
      console.log(`[Primary Recommendation] 유명인 캐릭터 ${famousCount}명 생성 완료`);
    }
    
    // 3️⃣ 일반인 캐릭터 생성 (retry 로직 포함)
    if (analysis.mix.ordinary > 0) {
      console.log(`[Primary Recommendation] 일반인 캐릭터 ${analysis.mix.ordinary}명 생성 중...`);
      const dialogueDepths: ('Intro' | 'Growth' | 'Mature' | 'Insight')[] = ['Intro', 'Growth', 'Mature', 'Insight'];
      let ordinaryCount = 0;
      let attempt = 0;
      const maxAttempts = analysis.mix.ordinary * 3; // 각 캐릭터당 3번 시도
      
      while (ordinaryCount < analysis.mix.ordinary && attempt < maxAttempts) {
        const depth = dialogueDepths[ordinaryCount % dialogueDepths.length];
        const ordinaryChar = await generateGenericCharacter(topic, userLanguage, depth);
        
        if (ordinaryChar) {
          const normalized = normalizeCharacterName(ordinaryChar.name);
          if (!excludedNames.includes(normalized)) {
            recommendations.push(ordinaryChar);
            excludedNames.push(normalized);
            ordinaryCount++;
            console.log(`[Primary Recommendation]   ${ordinaryCount}. ${ordinaryChar.name} (${depth}) 생성`);
          } else {
            console.log(`[Primary Recommendation]   중복 건너뜀: ${ordinaryChar.name}`);
          }
        }
        
        attempt++;
      }
      
      console.log(`[Primary Recommendation] 일반인 캐릭터 ${ordinaryCount}명 생성 완료`);
    }
    
    // 4️⃣ 창작형 캐릭터 생성 (retry 로직 포함)
    if (analysis.mix.creative > 0) {
      console.log(`[Primary Recommendation] 창작형 캐릭터 ${analysis.mix.creative}명 생성 중...`);
      let creativeCount = 0;
      let retryAttempts = 0;
      const maxRetries = 3;
      
      while (creativeCount < analysis.mix.creative && retryAttempts < maxRetries) {
        const needed = analysis.mix.creative - creativeCount;
        const creativeChars = await generateCreativeCharacter(
          topic,
          analysis.keywords,
          userLanguage,
          needed,
          excludedNames
        );
        
        // 중복 제거 및 추가
        for (const char of creativeChars) {
          const normalized = normalizeCharacterName(char.name);
          if (!excludedNames.includes(normalized)) {
            recommendations.push(char);
            excludedNames.push(normalized);
            creativeCount++;
            if (creativeCount >= analysis.mix.creative) break;
          }
        }
        
        retryAttempts++;
        if (creativeCount < analysis.mix.creative && retryAttempts < maxRetries) {
          console.log(`[Primary Recommendation] 창작형 ${creativeCount}/${analysis.mix.creative}명, 재시도 ${retryAttempts}/${maxRetries}`);
        }
      }
      
      console.log(`[Primary Recommendation] 창작형 캐릭터 ${creativeCount}명 생성 완료`);
    }
    
    // 5️⃣ 🎯 주제 캐릭터 강제 포함 로직 - 임시 비활성화 (테스트 중)
    // 백업 위치: backups/topic-character-logic-backup.ts
    // 이슈: "인문학으로 보는 이순신의 리더쉽" 같은 주제 문장이 캐릭터로 추가됨
    console.log(`[Primary Recommendation] ⚠️ 주제 캐릭터 강제 추가 로직 비활성화됨 (테스트 모드)`);
    
    // 6️⃣ 부족한 경우 fallback - 유명인으로 채우기
    if (recommendations.length < 6) {
      const needed = 6 - recommendations.length;
      console.warn(`[Primary Recommendation] 목표 미달 (${recommendations.length}/6), 유명인 ${needed}명 추가 생성`);
      
      const fallbackChars = await generateFamousCharacters(
        topic,
        userLanguage,
        needed,
        { ids: excludeHistory.ids, normalizedNames: excludedNames },
        analysis.category,
        analysis.keywords
      );
      
      for (const char of fallbackChars) {
        const normalized = normalizeCharacterName(char.name);
        if (!excludedNames.includes(normalized)) {
          recommendations.push(char);
          excludedNames.push(normalized);
          if (recommendations.length >= 6) break;
        }
      }
    }
    
    // 7️⃣ 최종 padding - 6명 절대 보장
    while (recommendations.length < 6) {
      const remainingCount = 6 - recommendations.length;
      console.warn(`[Primary Recommendation] 최종 padding 필요 (${recommendations.length}/6), ${remainingCount}명 생성`);
      
      // 일반인 캐릭터로 padding (중복 가능성 낮음)
      const dialogueDepths: ('Intro' | 'Growth' | 'Mature' | 'Insight')[] = ['Intro', 'Growth', 'Mature', 'Insight'];
      const depth = dialogueDepths[recommendations.length % 4];
      const paddingChar = await generateGenericCharacter(topic, userLanguage, depth);
      
      if (paddingChar) {
        const normalized = normalizeCharacterName(paddingChar.name);
        if (!excludedNames.includes(normalized)) {
          recommendations.push(paddingChar);
          excludedNames.push(normalized);
          console.log(`[Primary Recommendation] Padding 추가: ${paddingChar.name} (${depth})`);
        } else {
          // 중복이면 fallback placeholder 추가
          recommendations.push({
            id: `placeholder_${Date.now()}_${recommendations.length}`,
            name: `주제 관심자 ${recommendations.length + 1}`,
            category: '일반인',
            description: `${topic}에 관심 있는 사람`,
            personality: "호기심 많음",
            speechStyle: "친근한 대화",
            expertise: topic,
            background: `${topic}에 대해 배우고 싶어함`,
            tags: [topic, "일반인", "관심자"],
            icon: "👤",
            color: "#6B7280",
            personaType: 'occupation' as PersonaType
          });
          console.log(`[Primary Recommendation] Placeholder 추가: 주제 관심자 ${recommendations.length}`);
        }
      } else {
        // generateGenericCharacter 실패 시 placeholder 추가
        recommendations.push({
          id: `placeholder_${Date.now()}_${recommendations.length}`,
          name: `주제 관심자 ${recommendations.length + 1}`,
          category: '일반인',
          description: `${topic}에 관심 있는 사람`,
          personality: "호기심 많음",
          speechStyle: "친근한 대화",
          expertise: topic,
          background: `${topic}에 대해 배우고 싶어함`,
          tags: [topic, "일반인", "관심자"],
          icon: "👤",
          color: "#6B7280",
          personaType: 'occupation' as PersonaType
        });
        console.log(`[Primary Recommendation] Placeholder 추가 (생성 실패): 주제 관심자 ${recommendations.length}`);
      }
    }
    
    // 8️⃣ 최종 검증 및 반환
    if (recommendations.length === 0) {
      // 이 시점에는 도달 불가능 (padding으로 항상 6명 보장)
      console.error('[Primary Recommendation] Critical: 6명 보장 실패 (도달 불가능)');
      return [{
        name: "⚠️ 시스템 오류",
        description: "캐릭터 생성 실패",
        personality: "오류",
        speechStyle: "오류",
        expertise: "오류",
        background: "시스템 오류",
        icon: "⚠️",
        color: "#FF0000",
        personaType: 'occupation'
      }];
    }
    
    // 타입별 분포 로깅
    const typeDistribution = recommendations.reduce((acc, char) => {
      const type = char.personaType || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`[Primary Recommendation] 완료 - 총 ${recommendations.length}명 추천`);
    console.log(`[Primary Recommendation] 타입 분포:`, typeDistribution);
    
    // 정확히 6명 반환 (초과 방지)
    return recommendations.slice(0, 6);

  } catch (error) {
    console.error('[Primary Recommendation] 전체 오류:', error);
    
    return [{
      name: "🚨 시스템 오류",
      description: "캐릭터 생성 중 오류가 발생했습니다",
      personality: "문제 해결사",
      speechStyle: "기술적인 설명",
      expertise: "시스템 디버깅",
      background: `오류: ${error instanceof Error ? error.message : String(error)}`,
      icon: "🚨",
      color: "#FF4444",
      personaType: 'occupation'
    }];
  }
}

// 🌟 유명인 캐릭터 생성 함수 (기존 generateAICharactersDirectly 로직 활용)
async function generateFamousCharacters(
  topic: string,
  userLanguage: string,
  count: number,
  excludeHistory: { ids: string[], normalizedNames: string[] },
  category?: string,
  keywords?: string[]
): Promise<CharacterSuggestion[]> {
  try {
    console.log(`[Famous Characters] ${count}명 생성 시작 (카테고리: ${category || '일반'})`);
    const responseLanguage = getResponseLanguage(userLanguage);
    
    const randomSeed = Math.floor(Math.random() * 1000);
    const timeStamp = Date.now();
    
    // 카테고리별 추천 전략
    const categoryStrategy = category === 'literature' 
      ? `
📚 **문학 주제 추천 전략:**
⭐ **최우선: 작품 속 주인공과 주요 등장인물** (웹툰, 소설, 드라마, 영화 등)
- 예: "나혼자만 레벨업" → 성진우(주인공), 유진호, 차해인, 최종인 등
- 예: "오징어 게임" → 성기훈(주인공), 조상우, 강새벽 등
- 예: "해리포터" → 해리 포터(주인공), 헤르미온느, 론 위즐리 등

🎬 **차선: 작가, 감독, 배우 등 제작진**
- 작가, 소설가, 시인, 극작가
- 감독, 배우, 제작자
- 문학평론가, 연구자, 교수`
      : category === 'history'
      ? `
🏛️ **역사 주제 추천 전략:**
- 동시대 역사 인물 (같은 시대, 관련 사건)
- 역사학자, 연구자, 전문가
- 관련 분야 학자
- ⚠️ 주의: 소설 속 허구 인물이 아닌 **실존 역사 인물**만 추천`
      : category === 'technology'
      ? `
💻 **기술 주제 추천 전략:**
- 발명가, 혁신가, 엔지니어
- 기업가, CEO, 창업자
- 연구자, 학자, 과학자`
      : category === 'art'
      ? `
🎨 **예술 주제 추천 전략:**
- 화가, 조각가, 디자이너
- 음악가, 작곡가, 연주자
- 감독, 배우, 영화인
- 평론가, 큐레이터`
      : `
🌐 **일반 주제 추천 전략:**
- 주제와 직접 관련된 전문가
- 영향력 있는 실무자, 학자
- 해당 분야 저명 인사`;

    const systemPrompt = `당신은 유명인 캐릭터 추천 전문가입니다.

🎯 **임무:**
주제에 맞는 유명인(실존 인물 또는 작품 출처가 명확한 가상 캐릭터) ${count}명을 추천하세요.

${categoryStrategy}

📌 **추천 원칙:**
1. **주제가 캐릭터/인물 이름인 경우**: 그 캐릭터/인물을 **반드시 첫 번째로 포함**
   - 예: "홍길동" → 1) 홍길동 (주인공), 2) 허균 (작가), 3) 정민 (연구자)
   - 예: "해리포터" → 1) 해리 포터 (주인공), 2) J.K. 롤링 (작가), 3) 헤르미온느 (친구)
2. OpenAI가 잘 학습한 유명 인물/캐릭터 우선
3. 주제와 직접 연관된 인물만 추천 (${keywords?.length ? `핵심 키워드: ${keywords.join(', ')}` : ''})
4. 다양한 관점과 전문성 제공
5. 각 추천은 완전히 다른 인물이어야 함

📌 **작품 관련 캐릭터 구분 규칙 (웹툰, 소설, 드라마, 영화, 게임 등):**
- **작가/감독/제작자**: shortDescription에 반드시 '작가', '감독', '원작자', '제작자', '각본가' 등으로 명시
- **주인공/등장인물**: shortDescription에 반드시 '주인공', '등장인물', '캐릭터' 등으로 명시
- **정확한 예시:**
  ✅ "추공" → "웹툰 작가, 나혼자만 레벨업"
  ✅ "성진우" → "나혼자만 레벨업 주인공"
  ✅ "황동혁" → "오징어 게임 감독"
  ✅ "성기훈" → "오징어 게임 주인공"
  ❌ "추공" → "나혼자만 레벨업 주인공" (잘못됨 - 추공은 작가임)
  ❌ "성진우" → "나혼자만 레벨업 작가" (잘못됨 - 성진우는 주인공임)

🚫 **금지 사항:**
- 지명, 장소, 조직, 단체, 추상 개념 금지
- 출처 불명 가상 캐릭터 금지
- 같은 인물을 다른 언어/이름으로 중복 추천 금지
- **주제나 질문 자체를 캐릭터 이름으로 추천 금지** (예: "이순신의 리더십에 있어 가장 큰 특징이 뭐야?" ❌)
- 캐릭터 이름은 반드시 **사람 이름**이어야 함 (20자 이내)

${excludeHistory.normalizedNames.length > 0 ? `
🚫 **제외할 캐릭터:**
${excludeHistory.normalizedNames.slice(0, 8).join(', ')}${excludeHistory.normalizedNames.length > 8 ? ` 외 ${excludeHistory.normalizedNames.length - 8}명` : ''}
` : ''}

Random seed: ${randomSeed}, timestamp: ${timeStamp}

응답 언어: ${responseLanguage}`;

    const userPrompt = `주제: "${topic}"
카테고리: ${category || '일반'}
${keywords?.length ? `핵심 키워드: ${keywords.join(', ')}` : ''}

위 주제에 맞는 유명인 캐릭터 정확히 ${count}명을 추천하세요.

⭐ **작품 제목인 경우 - 등장인물 우선 추천:**
- 주인공과 주요 등장인물을 최우선으로 추천
- 작가, 감독, 배우는 등장인물 다음에 추천
- 예: "나혼자만 레벨업" → 성진우(주인공), 유진호, 차해인, 최종인, 추공(작가)

**추천 예시:**
- "홍길동" (문학) → 허균 (작가), 정민 (고전문학 연구자), 조동일 (문학평론가)
- "헤리포터" (문학) → J.K. 롤링 (작가), 다니엘 래드클리프 (배우), 스티븐 프라이 (오디오북 내레이터)
- "링컨" (역사) → 울리시스 그랜트 (동시대 인물), 도리스 컨스 굿윈 (전기 작가)

각 캐릭터는 다음 정보를 포함:
- id: 고유 식별자
- name: 이름 (15자 이내)
- category: 학자|실무자|기업가|정책가|사상가|역사인물|예술가|운동선수|기타
- shortDescription: 한 줄 설명 (30자 이내)
- tags: 키워드 3-5개
- icon: 단일 이모지
- color: #RRGGBB`;

    const famousSchema = {
      type: "object",
      properties: {
        characters: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string", maxLength: 15 },
              category: { 
                type: "string", 
                enum: ["학자", "실무자", "기업가", "정책가", "사상가", "역사인물", "예술가", "운동선수", "기타"]
              },
              shortDescription: { type: "string", maxLength: 30 },
              tags: { 
                type: "array", 
                items: { type: "string" },
                minItems: 3,
                maxItems: 5
              },
              icon: { type: "string", maxLength: 4 },
              color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }
            },
            required: ["id", "name", "category", "shortDescription", "tags", "icon", "color"],
            additionalProperties: false
          }
        }
      },
      required: ["characters"],
      additionalProperties: false
    };

    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "famous_characters",
            schema: famousSchema,
            strict: true
          }
        }
      });
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      console.warn('[Famous Characters] 빈 응답');
      return [];
    }

    const data = JSON.parse(response);
    
    const characters: CharacterSuggestion[] = data.characters
      .filter((char: any) => isValidCharacterName(char.name || ''))
      .map((char: any) => ({
        id: generateCharacterId(char.name),
        name: char.name,
        category: char.category,
        description: char.shortDescription,
        personality: "",
        speechStyle: "",
        expertise: "",
        background: "",
        tags: char.tags || [],
        icon: char.icon || "👤",
        color: char.color || "#808080",
        personaType: "celebrity" as PersonaType
      }));

    if (characters.length < data.characters.length) {
      console.warn(`[Famous Characters] ⚠️ ${data.characters.length - characters.length}명이 검증 실패로 제외됨`);
    }
    
    console.log(`[Famous Characters] 생성 완료: ${characters.length}명 (원본: ${data.characters.length}명)`);
    return characters;

  } catch (error) {
    console.error('[Famous Characters] 오류:', error);
    return [];
  }
}

// 캐릭터 상세 정보 생성 함수
export async function generateCharacterDetails(
  baseCharacter: { id: string, name: string, category: string, icon: string, color: string, description?: string },
  userLanguage: string
): Promise<CharacterSuggestion> {
  try {
    const responseLanguage = getResponseLanguage(userLanguage);
    
    console.log(`[Character Details Generation] 시작: ${baseCharacter.name} (${baseCharacter.category})`);
    
    const systemPrompt = `당신은 캐릭터 상세 정보를 생성하는 전문가입니다.
주어진 캐릭터의 기본 정보를 바탕으로 다음 정보를 생성하세요:
- personality: 성격 핵심 (15자 이내)
- speechStyle: 말투 특징 (12자 이내)
- expertise: 전문성 (20자 이내)
- background: 배경 (25자 이내)
- tags: 3-5개의 관련 키워드
- personaType: celebrity, occupation, coach 중 하나

응답 언어: ${responseLanguage}`;

    const userPrompt = `캐릭터 이름: ${baseCharacter.name}
카테고리: ${baseCharacter.category}
기본 설명: ${baseCharacter.description || ''}

위 캐릭터의 상세 정보를 생성하세요.`;

    const detailsSchema = {
      type: "object",
      properties: {
        personality: { type: "string", minLength: 1, maxLength: 15 },
        speechStyle: { type: "string", minLength: 1, maxLength: 12 },
        expertise: { type: "string", minLength: 1, maxLength: 20 },
        background: { type: "string", minLength: 1, maxLength: 25 },
        tags: {
          type: "array",
          items: { type: "string", maxLength: 10 },
          minItems: 3,
          maxItems: 5
        },
        personaType: {
          type: "string",
          enum: ["celebrity", "occupation", "coach"]
        }
      },
      required: ["personality", "speechStyle", "expertise", "background", "tags", "personaType"],
      additionalProperties: false
    };

    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.7,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "character_details",
            schema: detailsSchema,
            strict: true
          }
        }
      });
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("빈 응답");
    }

    const details = JSON.parse(response);
    
    console.log(`[Character Details Generation] 완료: ${baseCharacter.name}`);

    return {
      id: baseCharacter.id,
      name: baseCharacter.name,
      category: baseCharacter.category,
      description: baseCharacter.description || "흥미로운 대화 상대",
      personality: details.personality,
      speechStyle: details.speechStyle,
      expertise: details.expertise,
      background: details.background,
      tags: details.tags,
      icon: baseCharacter.icon,
      color: baseCharacter.color,
      personaType: details.personaType as PersonaType
    };

  } catch (error) {
    console.error(`[Character Details Generation] 오류:`, error);
    
    // 오류 시 기본값 반환
    return {
      id: baseCharacter.id,
      name: baseCharacter.name,
      category: baseCharacter.category,
      description: baseCharacter.description || "흥미로운 대화 상대",
      personality: "친근하고 도움이 되는",
      speechStyle: "자연스럽고 친근한",
      expertise: "관련 분야 경험",
      background: "실무 경험이 풍부한",
      tags: ["대화", "전문가"],
      icon: baseCharacter.icon,
      color: baseCharacter.color,
      personaType: 'celebrity' as PersonaType
    };
  }
}

// AI 캐릭터 생성 (개선된 프롬프트)
// 세션별 캐릭터 생성 관리를 위한 캐시 (기존 시스템용)
const characterGenerationCache = new Map<string, { 
  characters: CharacterSuggestion[], 
  timestamp: number, 
  requestCount: number 
}>();

// 추천 이력 관리 (사용자별 추천된 캐릭터 ID 및 정규화된 이름 추적)
interface RecommendationHistory {
  characterIds: Set<string>; // 추천된 캐릭터 ID Set
  normalizedNames: Set<string>; // 정규화된 이름 Set (다국어 중복 방지)
  timestamp: number; // 마지막 업데이트 시간
}

const recommendationHistory = new Map<number, RecommendationHistory>();

// 추천 이력 저장 (ID와 정규화된 이름 모두 저장)
export function saveRecommendationHistory(userId: number, characters: Array<{id: string, name: string}>): void {
  const existing = recommendationHistory.get(userId);
  
  const newIds = characters.map(c => c.id);
  const newNormalizedNames = characters.map(c => normalizeCharacterName(c.name));
  
  if (existing) {
    // 기존 이력에 새로운 ID와 정규화된 이름 추가
    newIds.forEach(id => existing.characterIds.add(id));
    newNormalizedNames.forEach(name => existing.normalizedNames.add(name));
    existing.timestamp = Date.now();
  } else {
    recommendationHistory.set(userId, {
      characterIds: new Set(newIds),
      normalizedNames: new Set(newNormalizedNames),
      timestamp: Date.now()
    });
  }
  console.log(`[Recommendation History] User ${userId}: ${characters.length}개 추천 저장 (총 ID: ${recommendationHistory.get(userId)?.characterIds.size}개, 이름: ${recommendationHistory.get(userId)?.normalizedNames.size}개)`);
}

// 추천 이력 가져오기 (ID 목록 반환)
export function getRecommendationHistory(userId: number): { ids: string[], normalizedNames: string[] } {
  const history = recommendationHistory.get(userId);
  return history 
    ? { 
        ids: Array.from(history.characterIds), 
        normalizedNames: Array.from(history.normalizedNames) 
      }
    : { ids: [], normalizedNames: [] };
}

// 추천 이력 초기화 (선택적)
export function clearRecommendationHistory(userId: number): void {
  recommendationHistory.delete(userId);
  console.log(`[Recommendation History] User ${userId}: 이력 초기화`);
}

// 🔍 캐릭터 이름 검증 함수: 질문/주제를 캐릭터로 잘못 추천한 경우 필터링
function isValidCharacterName(name: string): boolean {
  // 1. 질문 기호 포함 검사
  if (name.includes('?') || name.includes('？')) {
    console.warn(`[Character Validation] ❌ 질문 형태 제외: "${name}"`);
    return false;
  }
  
  // 2. 이름 길이 검사 (20자 초과는 질문일 가능성 높음)
  if (name.length > 20) {
    console.warn(`[Character Validation] ❌ 이름 너무 김 (${name.length}자): "${name}"`);
    return false;
  }
  
  // 3. 주제/질문 패턴 검사
  const questionPatterns = [
    '가장', '어떤', '어떻게', '무엇', '왜', '언제', '어디',
    '있어', '대해', '관해', '에서', '에게',
    'what', 'how', 'why', 'when', 'where', 'which'
  ];
  
  const lowerName = name.toLowerCase();
  const hasMultipleQuestionWords = questionPatterns.filter(pattern => 
    lowerName.includes(pattern)
  ).length >= 2;
  
  if (hasMultipleQuestionWords) {
    console.warn(`[Character Validation] ❌ 질문 패턴 감지: "${name}"`);
    return false;
  }
  
  return true;
}

// 이름 정규화 함수 (중복 방지용 - 다국어 지원)
function normalizeCharacterName(name: string): string {
  // NFKD 정규화로 다국어 문자 정규화
  const normalized = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // 결합 분음 부호 제거
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9가-힣ぁ-んァ-ヶー一-龯]/g, ''); // 한중일 문자와 숫자만 유지
  
  // 정규화 결과가 빈 문자열이면 원본 사용
  return normalized || name.toLowerCase().replace(/\s+/g, '');
}

// 중복 캐릭터 검사 함수 (부분 매칭 포함)
function isDuplicateCharacter(newName: string, existingNames: string[]): boolean {
  const normalizedNew = normalizeCharacterName(newName);
  
  // 빈 문자열은 중복 아님
  if (!normalizedNew) return false;
  
  for (const existingName of existingNames) {
    const normalizedExisting = normalizeCharacterName(existingName);
    
    // 1. 완전 일치
    if (normalizedNew === normalizedExisting) {
      console.log(`[중복 감지] 완전 일치: "${newName}" = "${existingName}"`);
      return true;
    }
    
    // 2. 부분 매칭 (짧은 이름이 긴 이름에 포함되는 경우)
    // 예: "링컨" in "아브라함링컨", "lincoln" in "abrahamlincoln"
    const shorter = normalizedNew.length < normalizedExisting.length ? normalizedNew : normalizedExisting;
    const longer = normalizedNew.length < normalizedExisting.length ? normalizedExisting : normalizedNew;
    
    // 짧은 이름이 3글자 이상이고, 긴 이름에 포함되면 중복으로 간주
    if (shorter.length >= 3 && longer.includes(shorter)) {
      console.log(`[중복 감지] 부분 매칭: "${newName}" ⊂ "${existingName}" (${shorter} in ${longer})`);
      return true;
    }
  }
  
  return false;
}

// ID 생성 함수 (고유 ID 보장 - index 제거로 안정성 향상)
function generateCharacterId(name: string): string {
  const normalized = normalizeCharacterName(name);
  const hash = normalized.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `char_${Math.abs(hash)}`;
}

// ID 고유성 보장 (충돌 시 suffix 추가)
function ensureUniqueId(baseId: string, existingIds: Set<string>): string {
  let uniqueId = baseId;
  let counter = 1;
  while (existingIds.has(uniqueId)) {
    uniqueId = `${baseId}_${counter}`;
    counter++;
  }
  existingIds.add(uniqueId);
  return uniqueId;
}

// 📊 주제 분석 엔진 - 캐릭터 타입별 추천 비율 동적 결정
export interface TopicAnalysis {
  category: string; // 주제 카테고리
  keywords: string[]; // 핵심 키워드
  isCharacter: boolean; // 주제가 실제 인물/캐릭터 이름인지 여부
  mix: {
    famous: number;    // 유명인 캐릭터 수
    ordinary: number;  // 일반인 캐릭터 수
    creative: number;  // 창작형 캐릭터 수
  };
  reasoning: string; // 비율 결정 근거
}

/**
 * 역할 입력을 그대로 반환하는 함수 (패스스루)
 * 
 * 이전에는 OpenAI로 "본질"을 추출했지만, 복잡한 프롬프트가 오히려 
 * 수식어의 뉘앙스를 희석시키는 문제가 발생했습니다.
 * 
 * 현재 전략: 역할명을 그대로 Canon Lock에 저장하고, 
 * 대화 생성 시 "당신은 '{roleInput}' 역할입니다" 형태로 직접 전달합니다.
 * 이 방식이 "약장사 같은 학원 선생"과 같은 부정적/풍자적 수식어를 
 * 더 정확하게 반영합니다.
 * 
 * TODO: 향후 필요시 선택적 enrichment를 side channel로 추가 가능
 * (예: UI용 구조화된 요약, 분석 로깅 등)
 */
export async function extractRoleEssence(roleInput: string): Promise<string> {
  // 입력 검증
  if (!roleInput || typeof roleInput !== 'string' || roleInput.trim().length === 0) {
    throw new Error('역할 입력이 비어있습니다.');
  }

  const trimmedInput = roleInput.trim();
  
  // 분석 로깅 (선택적)
  console.log(`[Role Essence] 역할명 패스스루: "${trimmedInput}"`);
  
  // 역할명을 그대로 반환
  return trimmedInput;
}

export async function analyzeTopic(topic: string, userLanguage: string): Promise<TopicAnalysis> {
  try {
    console.log(`[Topic Analysis] 주제 분석 시작: "${topic}"`);
    const responseLanguage = getResponseLanguage(userLanguage);

    const systemPrompt = `당신은 주제를 분석하여 적절한 캐릭터 조합을 결정하는 전문가입니다.

🎯 **임무:**
주제를 분석하고, 해당 주제에 가장 적합한 캐릭터 타입별 추천 비율을 결정하세요.

📌 **캐릭터 타입 설명:**
1. **유명인 (famous)**: LLM이 학습한 실존/가상 인물 (예: 아인슈타인, 해리포터, 스티브 잡스)
2. **일반인 (ordinary)**: 주제와 연결된 경험을 가진 평범한 현대인 (예: 고3 수험생, 30대 직장인)
3. **창작형 (creative)**: 주제에 맞춰 새로 창작한 구체적 배경의 캐릭터

📊 **비율 결정 원칙:**

**캐릭터 이름 주제** → 유명인 압도적
- 예: "홍길동" → famous: 5, ordinary: 0, creative: 1
- 예: "해리포터" → famous: 5, ordinary: 0, creative: 1
- 이유: 캐릭터 본인 + 관련 인물이 중요

**작품 제목 주제 (웹툰, 소설, 드라마, 영화, 게임 등)** → 유명인 중심
- 예: "나혼자만 레벨업" → famous: 4, ordinary: 1, creative: 1
- 예: "오징어 게임" → famous: 4, ordinary: 1, creative: 1
- 예: "이상한 변호사 우영우" → famous: 4, ordinary: 1, creative: 1
- 이유: 주인공과 주요 등장인물이 핵심, 작가도 포함

**전문/학술 주제 (과학, 철학, 종교 등)** → 유명인 중심
- 예: "양자역학" → famous: 4, ordinary: 1, creative: 1
- 예: "철학 입문" → famous: 4, ordinary: 1, creative: 1
- 예: "기독교" → famous: 4, ordinary: 1, creative: 1
- 예: "불교" → famous: 4, ordinary: 1, creative: 1
- 이유: 전문가와 권위자의 의견이 중요

**일상/고민 주제** → 유명인+경험담 균형
- 예: "취업 고민" → famous: 3, ordinary: 2, creative: 1
- 이유: 전문가 조언 + 실제 경험담

**학교/청소년 주제** → 균형
- 예: "고등학생" → famous: 2, ordinary: 2, creative: 2
- 예: "대학 생활" → famous: 2, ordinary: 2, creative: 2
- 이유: 다양한 관점 필요

**창작/상상 주제** → 창작형 많이 (유지)
- 예: "판타지 모험" → famous: 2, ordinary: 1, creative: 3
- 이유: 상상력과 창의성 중요

**제약조건:**
- 총합은 항상 6명 (famous + ordinary + creative = 6)
- 최소값: 각 타입 0명 이상
- 주제에 따라 유연하게 조정

응답 언어: ${responseLanguage}`;

    const userPrompt = `주제: "${topic}"

위 주제를 분석하고, 가장 적합한 캐릭터 조합을 결정하세요.

⚠️ **중요 1: 주제가 인물/캐릭터인지 판단**
주제가 실제 인물이나 캐릭터의 이름인지 명확히 판단하세요:
- ✅ 인물/캐릭터 이름: "홍길동", "해리포터", "아인슈타인", "손흥민", "성진우", "우영우"
- ❌ 작품 제목: "나혼자만 레벨업", "해리포터 시리즈", "반지의 제왕", "이상한 변호사 우영우"
- ❌ 주제/개념: "고등학교 수학", "취업 준비", "수학 공부", "영어 회화", "철학 입문"

**중요: 작품 제목(웹툰, 소설, 드라마, 영화 등)은 isCharacter: false**

⚠️ **중요 2: 비율 정확히 따르기**
- 예: "홍길동" → isCharacter: true, famous: 5, ordinary: 0, creative: 1
- 예: "나혼자만 레벨업" (작품) → isCharacter: false, famous: 4, ordinary: 1, creative: 1
- 예: "기독교" (종교/학술) → isCharacter: false, famous: 4, ordinary: 1, creative: 1
- 예: "양자역학" (전문) → isCharacter: false, famous: 4, ordinary: 1, creative: 1
- 예: "취업 고민" (일상) → isCharacter: false, famous: 3, ordinary: 2, creative: 1
- 예: "고등학생" (학교) → isCharacter: false, famous: 2, ordinary: 2, creative: 2

⚠️ **중요: 위 예시 비율을 정확히 따르세요. 임의로 변경하지 마세요.**

출력:
1. category: 주제 카테고리 (예: literature, science, career, daily, philosophy, art, sport 등)
2. keywords: 핵심 키워드 3-5개 (주제 관련 중요 단어)
3. isCharacter: 주제가 실제 인물/캐릭터 이름인지 여부 (true/false)
4. mix: 캐릭터 타입별 추천 수 (총 6명)
   - famous: 유명인 수 (0-6)
   - ordinary: 일반인 수 (0-6)
   - creative: 창작형 수 (0-6)
5. reasoning: 이 비율을 선택한 근거 (1-2문장)`;

    const analysisSchema = {
      type: "object",
      properties: {
        category: { type: "string", description: "주제 카테고리" },
        keywords: { 
          type: "array", 
          items: { type: "string" },
          minItems: 3,
          maxItems: 5,
          description: "핵심 키워드" 
        },
        isCharacter: { 
          type: "boolean", 
          description: "주제가 실제 인물/캐릭터 이름인지 여부" 
        },
        mix: {
          type: "object",
          properties: {
            famous: { type: "integer", minimum: 0, maximum: 6 },
            ordinary: { type: "integer", minimum: 0, maximum: 6 },
            creative: { type: "integer", minimum: 0, maximum: 6 }
          },
          required: ["famous", "ordinary", "creative"],
          additionalProperties: false
        },
        reasoning: { type: "string", description: "비율 결정 근거" }
      },
      required: ["category", "keywords", "isCharacter", "mix", "reasoning"],
      additionalProperties: false
    };

    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.3,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "topic_analysis",
            schema: analysisSchema,
            strict: true
          }
        }
      });
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      console.warn('[Topic Analysis] 빈 응답, 기본값 사용');
      return {
        category: 'general',
        keywords: [topic],
        isCharacter: false,
        mix: { famous: 4, ordinary: 1, creative: 1 },
        reasoning: '기본 비율 적용'
      };
    }

    const analysis: TopicAnalysis = JSON.parse(response);
    
    // 총합 검증
    const total = analysis.mix.famous + analysis.mix.ordinary + analysis.mix.creative;
    if (total !== 6) {
      console.warn(`[Topic Analysis] 총합 ${total}개 (≠6), 자동 조정`);
      const ratio = 6 / total;
      analysis.mix.famous = Math.round(analysis.mix.famous * ratio);
      analysis.mix.ordinary = Math.round(analysis.mix.ordinary * ratio);
      analysis.mix.creative = 6 - analysis.mix.famous - analysis.mix.ordinary;
    }

    console.log(`[Topic Analysis] 완료 - 카테고리: ${analysis.category}, isCharacter: ${analysis.isCharacter}, 비율: F${analysis.mix.famous}/O${analysis.mix.ordinary}/C${analysis.mix.creative}`);
    console.log(`[Topic Analysis] 키워드: ${analysis.keywords.join(', ')}`);
    console.log(`[Topic Analysis] 근거: ${analysis.reasoning}`);

    return analysis;

  } catch (error) {
    console.error('[Topic Analysis] 오류:', error);
    // 기본값 반환
    return {
      category: 'general',
      keywords: [topic],
      isCharacter: false,
      mix: { famous: 4, ordinary: 1, creative: 1 },
      reasoning: '오류로 인한 기본 비율 적용'
    };
  }
}

// 🎨 창작형 캐릭터 생성기 - 구체적 배경의 창작 인물 생성
export async function generateCreativeCharacter(
  topic: string,
  keywords: string[],
  userLanguage: string,
  count: number = 1,
  excludeNames: string[] = [],
  baseWorldview?: string
): Promise<CharacterSuggestion[]> {
  try {
    console.log(`[Creative Character] 창작 캐릭터 생성 시작: "${topic}" (${count}명)${baseWorldview ? `, 기준 세계관: ${baseWorldview}` : ''}`);
    const responseLanguage = getResponseLanguage(userLanguage);

    const worldviewGuidance = baseWorldview ? `
🌍 **기준 세계관/가치관:**
"${baseWorldview}"

⚠️ **중요**: 위 세계관과 **유사하거나 연결된** 세계관/가치관을 가진 캐릭터를 생성하세요.
- 같은 철학적 배경
- 유사한 가치 체계
- 관련된 신념 구조
` : '';

    const systemPrompt = `당신은 주제에 맞는 구체적이고 독창적인 창작 캐릭터를 생성하는 전문가입니다.

🎯 **임무:**
주제와 관련된 흥미롭고 입체적인 창작 캐릭터를 생성하세요.
${worldviewGuidance}
📌 **캐릭터 생성 원칙:**
1. **실존하지 않는 완전한 창작 인물**이어야 함
2. 주제와 **직접적으로 연결된 경험**을 가져야 함
3. 구체적인 배경, 성격, 목표를 갖춘 **입체적 인물**
4. 다양한 관점과 깊이를 제공할 수 있는 **독특한 세계관**${baseWorldview ? '\n5. **기준 세계관과 유사한 가치관**을 가져야 함' : ''}

🔹 **8개 필수 필드:**
1. **name**: 창작 인물 이름 (15자 이내, 한국인/외국인 모두 가능)
2. **age**: 구체적 나이 (예: 28, 45, 17)
3. **gender**: 성별 (남성/여성/기타)
4. **occupation**: 직업/역할 (20자 이내)
5. **personality**: 핵심 성격 특징 (20자 이내)
6. **experience**: 주제 관련 핵심 경험 (40자 이내)
7. **goal**: 캐릭터의 목표/동기 (30자 이내)
8. **worldview**: 세계관/가치관 (30자 이내)${baseWorldview ? ' - 기준 세계관과 유사해야 함' : ''}

📚 **창작 캐릭터 예시:**

**주제: "고등학생"**
- 이름: 박지훈
- 나이: 17
- 성별: 남성
- 직업: 고3 수험생 겸 웹툰 작가 지망생
- 성격: 창의적이지만 현실적 압박에 시달림
- 경험: 입시 준비와 꿈 사이에서 갈등하며 밤마다 웹툰 연습
- 목표: 수능 후 웹툰 플랫폼에 정식 연재 도전
- 세계관: 꿈과 현실의 균형을 찾아야 한다는 신념

**주제: "AI 윤리"**
- 이름: Dr. Sarah Kim
- 나이: 42
- 성별: 여성
- 직업: AI 윤리 연구원 겸 전직 개발자
- 성격: 원칙적이지만 기술에 대한 애정이 깊음
- 경험: 자신이 개발한 AI가 편향된 결정을 내려 고민
- 목표: 공정하고 투명한 AI 가이드라인 수립
- 세계관: 기술은 중립적이지만 사용은 윤리적이어야 함

🚫 **금지 사항:**
- 실존 인물 이름 사용 금지
- 유명인/역사 인물 차용 금지
- 추상적이거나 불명확한 배경 금지
- 8개 필드 중 하나라도 빈 값 금지

응답 언어: ${responseLanguage}`;

    const userPrompt = `주제: "${topic}"
키워드: ${keywords.join(', ')}

위 주제에 맞는 창작 캐릭터 ${count}명을 생성하세요.

${excludeNames.length > 0 ? `
🚫 다음 이름과 중복되지 않도록 주의:
${excludeNames.join(', ')}
` : ''}

각 캐릭터는 반드시 8개 필수 필드를 모두 포함해야 합니다:
- name (15자 이내)
- age (숫자)
- gender (남성/여성/기타)
- occupation (20자 이내)
- personality (20자 이내)
- experience (40자 이내)
- goal (30자 이내)
- worldview (30자 이내)`;

    const creativeSchema = {
      type: "object",
      properties: {
        characters: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: {
            type: "object",
            properties: {
              name: { type: "string", maxLength: 15 },
              age: { type: "integer", minimum: 1, maximum: 120 },
              gender: { type: "string", enum: ["남성", "여성", "기타", "Male", "Female", "Other"] },
              occupation: { type: "string", maxLength: 20 },
              personality: { type: "string", maxLength: 20 },
              experience: { type: "string", maxLength: 40 },
              goal: { type: "string", maxLength: 30 },
              worldview: { type: "string", maxLength: 30 }
            },
            required: ["name", "age", "gender", "occupation", "personality", "experience", "goal", "worldview"],
            additionalProperties: false
          }
        }
      },
      required: ["characters"],
      additionalProperties: false
    };

    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.8,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "creative_characters",
            schema: creativeSchema,
            strict: true
          }
        }
      });
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      console.warn('[Creative Character] 빈 응답');
      return [];
    }

    const data = JSON.parse(response);
    const characters: CharacterSuggestion[] = data.characters
      .filter((char: any) => isValidCharacterName(char.name || ''))
      .map((char: any) => ({
        id: generateCharacterId(char.name),
        name: char.name,
        category: '창작형',
        description: `${char.age}세 ${char.gender} ${char.occupation}`,
        personality: char.personality,
        speechStyle: `${char.worldview}를 바탕으로 한 대화`,
        expertise: char.occupation,
        background: `${char.experience}. ${char.goal}`,
        tags: [char.occupation, char.personality, keywords[0] || topic],
        icon: '✨',
        color: '#9333EA',
        personaType: 'creative' as PersonaType,
        age: char.age,
        gender: char.gender,
        occupation: char.occupation,
        experience: char.experience,
        goal: char.goal,
        worldview: char.worldview
      }));

    if (characters.length < data.characters.length) {
      console.warn(`[Creative Character] ⚠️ ${data.characters.length - characters.length}명이 검증 실패로 제외됨`);
    }

    console.log(`[Creative Character] 생성 완료: ${characters.length}명 (원본: ${data.characters.length}명)`);
    characters.forEach(c => {
      console.log(`  - ${c.name} (${c.age}세 ${c.gender}, ${c.occupation}): ${c.worldview}`);
    });

    return characters;

  } catch (error) {
    console.error('[Creative Character] 오류:', error);
    return [];
  }
}

// 캐시 없는 직접 AI 캐릭터 생성 (실시간 다양성 보장)
async function generateAICharactersDirectly(
  topic: string, 
  userLanguage: string, 
  excludeHistory: { ids: string[], normalizedNames: string[] } = { ids: [], normalizedNames: [] }
): Promise<CharacterSuggestion[]> {
  try {
    console.log(`[Direct AI Character Generation] 시작: ${topic}${excludeHistory.ids.length > 0 ? ` (제외: ${excludeHistory.ids.length}개 ID, ${excludeHistory.normalizedNames.length}개 이름)` : ''}`);
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 매번 새로운 랜덤 시드로 다양성 보장
    const randomSeed = Math.floor(Math.random() * 1000);
    const timeStamp = Date.now();
    
    const systemPrompt = `당신은 "최고 수준의 캐릭터 추천 엔진 에이전트"입니다.
Replit 환경에서 OpenAI API를 호출하여 캐릭터 추천 기능을 수행합니다.

🚨 CRITICAL RULES - 절대 위반 금지 🚨
1. name 필드는 반드시 **구체적인 인물 이름**이어야 함
   ❌ 금지: "캐릭터 6", "캐릭터 N", "흥미로운 대화 상대"
   ❌ 금지: "한산도", "서울", "이순신 장군 묘" (지명/장소)
   ✅ 허용: "이순신", "알버트 아인슈타인", "해리 포터"

2. 추천 대상은 **실존 인물 또는 작품 출처가 명확한 가상 캐릭터만**
   ❌ 금지: 지명, 장소, 조직, 단체, 추상 개념
   ❌ 금지: 출처 불명 가상 캐릭터 (예: "양정현 (가상)")
   ✅ 허용: "이순신 (역사 인물)", "해리 포터 (J.K. 롤링 작품)"

3. 주제와 직접 연관된 인물만 추천
   ❌ 금지: "임진왜란" 주제에 "김유신 (삼국시대)" 추천
   ✅ 허용: "임진왜란" 주제에 "이순신 (장군)", "도요토미 히데요시"

### 기본 흐름
1. 사용자가 \`#주제 캐릭터 추천\` 요청을 보내면, 해당 주제에 맞춰 **4-6명의 다양한 카테고리 인물**을 추천합니다.
2. 각 추천은 다양한 관점과 전문성을 제공해야 합니다.

### 🚨 중복 방지 조건 (절대 규칙)
- **절대로 같은 인물을 다른 언어로 중복 추천하지 마세요.** 예: "Warren Buffett"과 "워렌 버핏" 둘 다 추천하지 않기
- **절대로 같은 캐릭터를 다른 이름으로 중복 추천하지 마세요.** 예: "Iron Man"과 "토니 스타크" 둘 다 추천하지 않기
- 각 추천은 완전히 다른 인물/캐릭터여야 합니다.
- Random seed ${randomSeed}, timestamp ${timeStamp}를 활용하여 매번 다른 추천을 생성하세요.${excludeHistory.ids.length > 0 || excludeHistory.normalizedNames.length > 0 ? `

### 🚫 이미 추천된 캐릭터 (절대 추천 금지)
다음 캐릭터들은 이미 추천되었으므로 **절대로** 추천하지 마세요:${excludeHistory.normalizedNames.length > 0 ? `
- 제외: ${excludeHistory.normalizedNames.slice(0, 8).join(', ')}${excludeHistory.normalizedNames.length > 8 ? ` 외 ${excludeHistory.normalizedNames.length - 8}명` : ''}` : ''}
⚠️ 위 인물들과 비슷한 이름, 다른 언어 표기도 모두 제외하세요.` : ''}

### 추천 규칙 및 제약
- **정확히 5명을 추천**하되, 각 필드 길이 제한을 반드시 준수하세요.
- 추천 인물은 영향력 있고 인지도가 있는 사람 중심이어야 합니다.
- OpenAI가 잘 학습한 유명 인물/캐릭터를 우선 선택하세요 (토큰 효율성).
- **중요**: 시스템이 자동으로 일반인 캐릭터 1명을 추가하므로, 유명인 5명만 추천하세요.

### 🎯 교집합 기반 입체적 추천 시스템 (필수)

**📌 검색어 분석 3단계:**
1. **주제 키워드** 추출 (예: "헤리포터", "정부", "과학")
2. **속성 키워드** 추출 (예: "영화", "소설", "역사", "철학", "문화")
3. **교집합 매칭** 적용 → 주제 × 속성의 교차점에서 추천

**🔹 교집합 매칭 규칙:**

**1️⃣ 기본 주제 매칭** (주제 핵심 인물):
- 검색 주제에 직접 연관된 대표 인물
- 예: "헤리포터" → 해리, 헤르미온느, 볼드모트, 덤블도어

**2️⃣ 속성 교차 매칭** (주제 × 속성 교집합):
- 주제와 속성이 **동시에 충족**되는 인물
- 예: "영화 헤리포터" → 배우(다니엘 래드클리프, 엠마 왓슨), 감독(알폰소 쿠아론, 크리스 콜럼버스), 제작자
- 예: "정치 철학" → 정치철학자(플라톤, 몽테스키외, 한나 아렌트)
- 예: "역사 전쟁" → 전쟁사 학자, 군사 전략가, 역사 속 장군

**3️⃣ 주변 확장 매칭** (메타·비평·팬덤):
- 주제를 분석·해석·경험하는 인물
- 비평가, 학자, 평론가, 연구자
- 팬 대표, 문화 해석자, 교육자

**💡 교집합 추천 예시:**

**"영화 헤리포터" 검색 → 영화 × 헤리포터:**
1. 영화 속 배우: 다니엘 래드클리프 (해리 배우), 엠마 왓슨 (헤르미온느 배우)
2. 영화 제작진: 알폰소 쿠아론 (감독), 크리스 콜럼버스 (감독)
3. 세계관 캐릭터: 해리 포터, 헤르미온느 그레인저
4. 메타/비평: 영화 평론가, 팬덤 대표

**"정부" 검색 → 정부 주제:**
1. 이론/철학: 플라톤 (이상국가론), 몽테스키외 (삼권분립)
2. 실무/정치: 링컨 (정치가), 비스마르크 (통일)
3. 비판/분석: 한나 아렌트 (전체주의 비판), 노암 촉스키 (권력 비판)
4. 상징/역할: 판사 (법치주의), 관료 (행정 관점)

**✅ 추천 시 필수 규칙:**
1. 검색어에 속성 키워드가 있으면 **반드시 교집합 매칭 우선 적용**
2. 각 계층(이론/실무/비판/상징)에서 균형있게 선택
3. 주제 관련 배우·감독·제작자·평론가도 적극 포함
4. 시대·지역·관점의 다양성 확보

### 카테고리 시스템
각 캐릭터에 적절한 카테고리를 지정하세요:
- **학자**: 학문적 연구자, 교수, 과학자 (예: 알버트 아인슈타인)
- **실무자**: 실제 업계 전문가, 기술자 (예: 스티브 워즈니악)
- **기업가**: 사업가, 창업자, CEO (예: 일론 머스크)
- **정책가**: 정치인, 정책 입안자, 공직자
- **사상가**: 철학자, 문학가, 사회 이론가 (예: 플라톤)
- **역사인물**: 역사적으로 중요한 인물 (예: 이순신)
- **예술가**: 작가, 화가, 음악가 (예: J.K. 롤링)
- **운동선수**: 스포츠 스타, 올림픽 선수
- **기타**: 위 카테고리에 속하지 않는 유명 인물

### 출력 형식 (간소화된 JSON) - 기본 정보만 포함
{
  "characters": [
    {
      "id": "unique_identifier",
      "name": "이름 (15자 이내)",
      "category": "학자|실무자|기업가|정책가|사상가|역사인물|예술가|운동선수|기타",
      "shortDescription": "한 줄 설명 (30자 이내)",
      "tags": ["키워드1", "키워드2", "키워드3"],
      "icon": "단일 기본 이모지",
      "color": "#RRGGBB"
    }
  ]
}

**🏷️ tags 필드 작성 규칙 (필수):**
- 각 캐릭터의 **핵심 속성 3~5개**를 배열로 제공
- 타입 감지 및 추천에 필수적으로 사용됨
- 예시:
  * 알폰소 쿠아론 → ["영화감독", "멕시코", "아카데미상", "해리포터"]
  * 해리 포터 → ["주인공", "마법사", "호그와트", "그리핀도르"]
  * 일론 머스크 → ["기업가", "테슬라", "스페이스X", "혁신"]
  * 아인슈타인 → ["물리학자", "상대성이론", "노벨상", "과학자"]

⚠️ 필드 검증 체크리스트:
1. name: 구체적 인물명? (❌ "캐릭터 6", "한산도" / ✅ "이순신")
2. shortDescription: 핵심만 간결하게 (❌ "매우 뛰어난 사람입니다" / ✅ "조선 수군 대장, 임진왜란 영웅")
3. 실존/가상 구분: 출처 명확? (❌ "양정현 (가상)" / ✅ "해리 포터 (J.K. 롤링)")
4. 주제 연관성: 직접 관련? (❌ 김유신→임진왜란 / ✅ 이순신→임진왜란)

### 필수 규칙
- id는 영문+숫자 조합의 고유 식별자 (예: "einstein_001")
- category는 위 카테고리 중 하나여야 함
- icon은 단일 기본 이모지만 허용 (복합 이모지, 국기 이모지 금지)
- color는 #RRGGBB 형식의 hex 코드
- icon은 단일 이모지
- personaType은 기존 호환성을 위해 유지 (celebrity, occupation, coach 중 하나)
- 응답 언어: ${responseLanguage}

잘 알려진 인물만 추천하세요.`;

    const userPrompt = `주제: "${topic}"

**🔍 검색어 분석 및 교집합 추천 (필수):**

1️⃣ **검색어에서 키워드 분리:**
   - 주제 키워드는? (예: "헤리포터", "정부", "과학")
   - 속성 키워드는? (예: "영화", "소설", "역사", "철학", "문화")

2️⃣ **교집합 매칭 적용:**
   - 속성이 있으면: 주제 × 속성 교차점에서 추천
   - 속성이 없으면: 주제 핵심 인물 위주 추천

3️⃣ **정확히 5명 추천 (균형 배분):**
   - 속성 교차 인물 (배우, 감독, 제작자 등) 2명
   - 주제 핵심 인물 (세계관 캐릭터, 대표 인물) 2명
   - 메타/비평 인물 (평론가, 학자, 팬 대표) 1명
   - **참고**: 시스템이 자동으로 일반인 캐릭터 1명 추가 (총 6명)

🚨 필수 제약:
1. **실존 인물 OR 명확한 출처의 가상 캐릭터만** (예: 작품명 명시 가능)
2. **절대 금지**: 지명, 장소, 조직, 단체, "캐릭터 N" 같은 일반명
3. **각 필드는 지정된 글자 수를 반드시 준수** - 간결하게 핵심만 작성
4. **모든 name 필드가 채워져야 함** - 빈 값이나 undefined 절대 금지
5. shortDescription은 한 줄로 핵심만 (30자 이내)

📝 추천 예시:
- "영화 헤리포터" → 배우(다니엘 래드클리프, 엠마 왓슨), 감독(알폰소 쿠아론), 캐릭터(해리, 헤르미온느), 평론가
- "정부" → 철학자(플라톤, 몽테스키외), 정치가(링컨), 비평가(한나 아렌트), 상징적 역할(판사, 관료)

⚠️ 중요: 교집합을 반영한 입체적 추천을 하세요!`;

    console.log(`[Direct AI Character Generation] OpenAI API 호출 (시드: ${randomSeed}): ${topic}`);
    
    // 간소화된 스키마 - 기본 정보 + tags 포함 (5명 유명인)
    const characterSchema = {
      type: "object",
      properties: {
        characters: {
          type: "array",
          minItems: 5,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              id: { type: "string", minLength: 1, maxLength: 30 },
              name: { type: "string", minLength: 1, maxLength: 15 },
              category: { 
                type: "string",
                enum: ["학자", "실무자", "기업가", "정책가", "사상가", "역사인물", "예술가", "운동선수", "기타"]
              },
              shortDescription: { type: "string", minLength: 1, maxLength: 30 },
              tags: {
                type: "array",
                items: { type: "string", maxLength: 15 },
                minItems: 3,
                maxItems: 5
              },
              icon: { type: "string", minLength: 1, maxLength: 4 },
              color: { type: "string", minLength: 7, maxLength: 7, pattern: "^#[0-9A-Fa-f]{6}$" }
            },
            required: ["id", "name", "category", "shortDescription", "tags", "icon", "color"],
            additionalProperties: false
          }
        }
      },
      required: ["characters"],
      additionalProperties: false
    };

    let completion;
    const modelName = "gpt-4o-mini";
    const startTime = Date.now();
    console.log(`[⚡ 속도 체크] OpenAI API 호출 시작 - 모델: ${modelName} (간소화 모드)`);
    
    try {
      completion = await callOpenAIWithRetry(async () => {
        return openai.chat.completions.create({
          model: modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 2000,
          temperature: 0.7,
          top_p: 0.95,
          presence_penalty: 0.5,
          frequency_penalty: 0.3,
          response_format: {
            type: "json_schema", 
            json_schema: {
              name: "character_suggestions",
              schema: characterSchema,
              strict: true
            }
          }
        });
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[⚡ 속도 체크] OpenAI API 완료 - 모델: ${modelName}, 소요시간: ${elapsed}초`);
    } catch (error) {
      console.error(`[Direct AI Character Generation] OpenAI API 호출 실패:`, error);
      return [];
    }

    const response = completion.choices[0]?.message?.content;
    const finishReason = completion.choices[0]?.finish_reason;
    console.log(`[Direct AI Character Generation] 응답 길이: ${response?.length || 0}자, finish_reason: ${finishReason}`);
    
    if (!response) {
      console.log('[Direct AI Character Generation] 빈 응답');
      return [];
    }
    
    // 토큰 제한으로 잘린 경우 경고
    if (finishReason === 'length') {
      console.warn('[Direct AI Character Generation] ⚠️ 응답이 max_tokens 제한으로 잘림 - JSON 파싱 실패 가능');
    }

    // Structured Output으로부터 올바른 JSON 파싱
    let data;
    try {
      data = JSON.parse(response);
      console.log(`[Direct AI Character Generation] JSON 파싱 성공`);
    } catch (parseError) {
      console.error(`[Direct AI Character Generation] JSON 파싱 실패:`, parseError);
      console.log(`[Direct AI Character Generation] 응답 샘플:`, response.substring(0, 200));
      return [];
    }
    
    // Structured Output 형태에서 characters 배열 추출
    const characters = data.characters;
    if (!Array.isArray(characters)) {
      console.log('[Direct AI Character Generation] characters가 배열이 아님');
      return [];
    }

    // 중복 제거: 부분 매칭 포함 강력한 중복 체크
    const seenNames: string[] = []; // 기존 이름 목록 (배열로 변경)
    const uniqueCharacters: any[] = [];
    const duplicates: any[] = [];
    
    // 1. AI 응답 내부 중복 체크
    for (const char of characters) {
      const charName = char.name || '';
      
      if (isDuplicateCharacter(charName, seenNames)) {
        console.warn(`[Direct AI Character Generation] 🚫 응답 내부 중복 감지: ${charName}`);
        duplicates.push(char);
      } else {
        seenNames.push(charName);
        uniqueCharacters.push(char);
      }
    }
    
    // 2. 추천 이력과의 중복 체크
    const historyFilteredCharacters: any[] = [];
    for (const char of uniqueCharacters) {
      const charName = char.name || '';
      
      if (isDuplicateCharacter(charName, excludeHistory.normalizedNames)) {
        console.warn(`[Direct AI Character Generation] 🚫 추천 이력 중복 감지: ${charName}`);
        duplicates.push(char);
      } else {
        historyFilteredCharacters.push(char);
      }
    }

    // 정확히 5개 보장: 중복 제거 후 부족하면 중복 허용 (경고와 함께)
    let finalCharacters = historyFilteredCharacters;
    if (historyFilteredCharacters.length < 5) {
      console.warn(`[Direct AI Character Generation] 이력 필터 후 ${historyFilteredCharacters.length}개 (< 5), 중복 포함하여 5개 보장`);
      const needed = 5 - historyFilteredCharacters.length;
      finalCharacters = [...historyFilteredCharacters, ...duplicates.slice(0, needed)];
      
      if (finalCharacters.length < 5) {
        console.error(`[Direct AI Character Generation] 심각: 중복 포함해도 ${finalCharacters.length}개 (< 5)`);
      }
    }

    // 카테고리 enum 검증
    const validCategories = ["학자", "실무자", "기업가", "정책가", "사상가", "역사인물", "예술가", "운동선수", "기타"];
    const existingIds = new Set<string>();
    
    const validatedCharacters = finalCharacters
      .filter((char: any, index: number) => {
        // 🚨 이름이 없거나 유효하지 않은 캐릭터 제외
        if (!char.name || char.name.trim() === '' || char.name === 'undefined') {
          console.warn(`[Direct AI Character Generation] 유효하지 않은 캐릭터 제외 (index ${index}): name="${char.name}"`);
          return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((char: any) => {
        const name = char.name.trim();
        const category = validCategories.includes(char.category) ? char.category : "기타";
        const baseId = generateCharacterId(name);
        const uniqueId = ensureUniqueId(baseId, existingIds);
        const shortDesc = char.shortDescription || "흥미로운 대화 상대";
        
        // 간소화 모드: 기본 정보만 채움, 상세 정보는 나중에 생성
        return {
          id: uniqueId,
          name,
          category,
          description: shortDesc,
          personality: "",
          speechStyle: "",
          expertise: "",
          background: "",
          tags: [],
          icon: char.icon || "🎭",
          color: char.color || "#6366f1",
          personaType: 'celebrity' as PersonaType,
          reason: ""
        };
      });
    
    console.log(`[Direct AI Character Generation] 완료: ${validatedCharacters.length}개 유명인 캐릭터 생성 (강력한 중복 제거 완료)`);
    
    // 상위 5개 유명인 선택
    const famousCharacters = validatedCharacters.slice(0, 5);
    
    famousCharacters.forEach((char, idx) => {
      console.log(`  ${idx + 1}. ${char.name} [${char.category}] (${char.personaType}) - ${char.description}`);
    });
    
    if (famousCharacters.length < 5) {
      console.error(`[Direct AI Character Generation] 심각: 최종 ${famousCharacters.length}개만 반환 (목표: 5개)`);
    }
    
    // 🧑 일반인 캐릭터 1명 추가
    console.log(`[Direct AI Character Generation] 일반인 캐릭터 생성 중...`);
    const genericCharacter = await generateGenericCharacter(topic, userLanguage);
    
    // 최종 결과: 5명 유명인 + 1명 일반인 = 6명
    const finalResults: CharacterSuggestion[] = [...famousCharacters];
    if (genericCharacter) {
      finalResults.push(genericCharacter);
      console.log(`  6. ${genericCharacter.name} [${genericCharacter.category}] - ${genericCharacter.description} (일반인 추가)`);
    } else {
      console.warn(`[Direct AI Character Generation] 일반인 캐릭터 생성 실패 - 유명인 ${famousCharacters.length}명만 반환`);
    }
    
    console.log(`[Direct AI Character Generation] 최종 완료: 총 ${finalResults.length}명 (유명인 ${famousCharacters.length}명 + 일반인 ${genericCharacter ? 1 : 0}명)`);
    
    return finalResults;

  } catch (error) {
    console.error('[Direct AI Character Generation] 전체 오류:', error);
    return [];
  }
}

// 🧑 일반인 캐릭터 생성 함수 - 주제와 연결된 현실적인 현대인
async function generateGenericCharacter(
  topic: string, 
  userLanguage: string,
  dialogueDepth?: 'Intro' | 'Growth' | 'Mature' | 'Insight'
): Promise<CharacterSuggestion | null> {
  try {
    // dialogueDepth가 없으면 랜덤 선택
    const selectedType = dialogueDepth || ['Intro', 'Growth', 'Mature', 'Insight'][Math.floor(Math.random() * 4)] as 'Intro' | 'Growth' | 'Mature' | 'Insight';
    
    console.log(`[Generic Character Generation] 시작: ${topic}, 대화 깊이: ${selectedType}`);
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 대화 깊이별 설정
    const dialogueLevels = {
      Intro: {
        label: "입문형 (Intro)",
        description: "이제 막 주제에 관심을 갖기 시작한 사람",
        characteristics: "순수한 호기심과 불안 공존, 질문이 많고 배우려는 자세",
        example: "최근 관심 생겨 정보 검색 시작, 막막함과 설렘 동시 느낌",
        ageRange: "20대~30대 초반",
        experienceLevel: "0~6개월 경험"
      },
      Growth: {
        label: "성장형 (Growth)",
        description: "조금 배웠지만 여전히 헷갈리는, 정보를 비교하며 배우는 중인 사람",
        characteristics: "여러 방법 시도 중, 비교·고민, 아직 확신 없음",
        example: "몇 개월 시도했지만 혼란스러움, 다양한 정보에 갈팡질팡",
        ageRange: "20대 후반~30대",
        experienceLevel: "6개월~2년 경험"
      },
      Mature: {
        label: "성숙형 (Mature)",
        description: "실제로 주제를 실천하며 일상 속에서 경험하는 사람",
        characteristics: "구체적 실천 경험, 시행착오 겪음, 현실적 조언 가능",
        example: "꾸준히 실천 중, 나름의 방법 찾음, 일상에 녹아든 상태",
        ageRange: "30대~40대",
        experienceLevel: "2~5년 경험"
      },
      Insight: {
        label: "통찰형 (Insight)",
        description: "오랜 경험을 통해 의미를 되짚거나 후배를 돕는 사람",
        characteristics: "깊은 성찰, 여유로운 조언, 경험의 의미 되새김",
        example: "오랜 경험 통해 깨달음 얻음, 다른 사람 돕고 싶어함, 인생의 한 부분으로 자리잡음",
        ageRange: "40대~50대",
        experienceLevel: "5년 이상 경험"
      }
    };
    
    const levelInfo = dialogueLevels[selectedType];
    
    const systemPrompt = `당신은 주제와 연결된 현실적인 "일반인 캐릭터"를 생성하는 전문가입니다.

🎯 **핵심 원칙:**
- 실존 인물이 아닌 **가상의 현대 일반인** 생성
- 주제를 **삶 속에서 경험하고 고민하는 평범한 사람**
- 유명인이 아닌, **우리 주변에 있을 법한 사람**

📊 **대화 깊이 레벨: ${levelInfo.label}**
- 정의: ${levelInfo.description}
- 특징: ${levelInfo.characteristics}
- 예시: ${levelInfo.example}
- 권장 나이: ${levelInfo.ageRange}
- 경험 수준: ${levelInfo.experienceLevel}

📌 **캐릭터 설정 규칙:**

1. **이름과 배경**
   - 한국 이름 사용 (예: 김민수, 이지은, 박준혁)
   - 나이: ${levelInfo.ageRange}에 맞춰 설정
   - 직업: 주제와 연결된 현실적 직업
   - 지역: 실제 한국 지역 (예: 서울 강남, 부산 해운대)

2. **주제와의 연결 (대화 깊이 반영!)**
   - 주제를 **${levelInfo.experienceLevel}** 수준으로 경험한 사람
   - ${levelInfo.characteristics}을 캐릭터에 반영
   - 예:
     * "투자" + Intro → 첫 주식 계좌 개설, 손실 두려움
     * "투자" + Growth → 여러 투자법 시도, 어떤 게 맞는지 고민
     * "투자" + Mature → 3년째 꾸준히 투자, 나름의 원칙 생김
     * "투자" + Insight → 10년 투자 경험, 후배들에게 조언

3. **대화 스타일 (매우 중요!)**
   - ❌ 교훈적 설명, 전문가 조언 금지
   - ✅ 경험 공유, 솔직한 감정, 현실적 고민
   - ✅ "나는 이렇게 느꼈어요", "이런 선택을 했죠"
   - ✅ 완벽하지 않은 삶의 이야기

4. **성격과 말투**
   - 친근하고 공감 가능한 성격
   - 존댓말/반말 자연스럽게 섞어 사용
   - 진솔하고 솔직한 표현

응답 언어: ${responseLanguage}`;

    const userPrompt = `주제: "${topic}"
대화 깊이 레벨: ${levelInfo.label}

위 주제와 연결된 **${levelInfo.label}** 단계의 현실적인 일반인 캐릭터 1명을 생성하세요.

**필수 요구사항:**
1. 주제를 삶 속에서 **${levelInfo.experienceLevel}** 수준으로 경험한 평범한 사람
2. 구체적인 직업, 나이(${levelInfo.ageRange}), 배경 설정
3. 경험 중심 대화 스타일 (전문가 아님)
4. 한국적 배경 (이름, 지역, 문화)
5. **${levelInfo.label}의 특징 반영**: ${levelInfo.characteristics}
6. **한 줄 소개는 35자 이하로 간결하게** (예: "○○에 관심을 갖기 시작한 직장인")

**${levelInfo.label} 생성 예시:**
${levelInfo.example}

캐릭터의 이름, 직업, 나이를 구체적으로 설정하고, ${levelInfo.label} 특성을 반영하세요.`;

    const characterSchema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 2, maxLength: 10, description: "한국 이름 (예: 김민수)" },
        age: { type: "integer", minimum: 20, maximum: 60, description: "나이" },
        occupation: { type: "string", minLength: 2, maxLength: 20, description: "직업 (예: 회사원, 간호사)" },
        region: { type: "string", minLength: 2, maxLength: 15, description: "지역 (예: 서울 강남)" },
        description: { type: "string", minLength: 10, maxLength: 35, description: "간결한 한 줄 소개 (35자 이하)" },
        personality: { type: "string", minLength: 5, maxLength: 20, description: "성격 특징" },
        speechStyle: { type: "string", minLength: 5, maxLength: 20, description: "말투" },
        expertise: { type: "string", minLength: 5, maxLength: 25, description: "주제 관련 경험" },
        background: { type: "string", minLength: 10, maxLength: 30, description: "배경 스토리" },
        topicConnection: { type: "string", minLength: 10, maxLength: 50, description: "주제와의 연결" },
        icon: { type: "string", minLength: 1, maxLength: 4, description: "이모지" },
        color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", description: "색상 코드" }
      },
      required: ["name", "age", "occupation", "region", "description", "personality", "speechStyle", 
                 "expertise", "background", "topicConnection", "icon", "color"],
      additionalProperties: false
    };

    const completion = await callOpenAIWithRetry(async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 800,
        temperature: 0.8, // 다양성을 위해 높은 temperature
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "generic_character",
            schema: characterSchema,
            strict: true
          }
        }
      });
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      console.warn('[Generic Character Generation] 빈 응답');
      return null;
    }

    const data = JSON.parse(response);
    
    // 🔍 캐릭터 이름 검증
    if (!isValidCharacterName(data.name)) {
      console.warn(`[Generic Character] ❌ 검증 실패로 null 반환: "${data.name}"`);
      return null;
    }
    
    // 대화 깊이 레벨 라벨 (태그용)
    const levelLabels = {
      Intro: "입문형",
      Growth: "성장형", 
      Mature: "성숙형",
      Insight: "통찰형"
    };
    
    // CharacterSuggestion 형식으로 변환
    const character: CharacterSuggestion = {
      id: generateCharacterId(data.name),
      name: data.name,
      category: "일반인",
      description: data.description,
      personality: data.personality,
      speechStyle: data.speechStyle,
      expertise: data.expertise,
      background: `${data.age}세 ${data.occupation}, ${data.region} 거주`,
      icon: data.icon || "🧑",
      color: data.color || "#6B7280",
      tags: [data.occupation, `${data.age}대`, data.region, "일반인", levelLabels[selectedType], "경험담"],
      personaType: 'occupation' as PersonaType,
      reason: data.topicConnection,
      characterPersonaType: selectedType // 대화 깊이 레벨 저장
    };
    
    console.log(`[Generic Character Generation] 완료: ${character.name} (${data.age}세 ${data.occupation}, ${levelLabels[selectedType]})`);
    console.log(`  주제 연결: ${data.topicConnection}`);
    
    return character;

  } catch (error) {
    console.error('[Generic Character Generation] 오류:', error);
    return null;
  }
}

// 메타 프롬프트 기반 캐릭터 추천 시스템 (토큰 효율성 최적화) - 기존 시스템용
async function generateAICharacters(topic: string, userLanguage: string): Promise<CharacterSuggestion[]> {
  try {
    console.log(`[Meta-Prompt Character Generation] 시작: ${topic}`);
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 캐시 확인 및 다양성 보장을 위한 세션 관리
    const cacheKey = `${topic}-${userLanguage}`;
    const now = Date.now();
    let sessionData = characterGenerationCache.get(cacheKey);
    
    if (!sessionData) {
      sessionData = { characters: [], timestamp: now, requestCount: 0 };
      characterGenerationCache.set(cacheKey, sessionData);
    }
    
    sessionData.requestCount += 1;
    const requestNumber = sessionData.requestCount;
    
    // 다양성 지시사항 - 요청 횟수에 따라 다르게 처리
    let diversityInstruction = '';
    if (requestNumber === 1) {
      diversityInstruction = '첫 번째 추천이므로 가장 대표적이고 잘 알려진 인물들을 우선 추천하세요. **중요: 같은 인물을 다른 언어로 중복 추천하지 마세요** (예: Warren Buffett와 워렌 버핏 둘 다 추천 X).';
    } else if (requestNumber === 2) {
      diversityInstruction = '두 번째 추천이므로 다른 관점이나 다른 전문 분야의 인물들을 추천하세요. 실무진, 교육자, 다른 문화권 인물을 포함하세요. **중요: 같은 인물을 다른 언어로 중복 추천하지 마세요**.';
    } else {
      diversityInstruction = `${requestNumber}번째 추천이므로 이전과 완전히 다른 새로운 관점의 인물들을 추천하세요. 젊은 세대, 여성, 소수 그룹, 혁신가들을 포함하세요. **중요: 같은 인물을 다른 언어로 중복 추천하지 마세요**.`;
    }
    
    const systemPrompt = `Based on the user's topic, situation, goal, interests, or preferred character/person, recommend the most appropriate conversation characters.

**Rules:**

1. **Prioritize Token Efficiency**
   • Recommend characters that OpenAI API has already learned well (famous people, well-known fictional characters, cultural icons).
   • Reason: These characters require fewer tokens to introduce, since the model already has context.
   • Examples: Harry Potter, Iron Man, Albert Einstein, Warren Buffett, BTS.

2. **For ordinary people or unnamed characters**
   • Suggest a statistically well-known type of person or substitute with a famous counterpart.
   • Example: "I want to get better at math" → Recommend Einstein, Pythagoras, or a math teacher archetype.
   • Example: "I want to learn investing" → Recommend Warren Buffett.

3. **Recommendation Style**
   • Suggest 4-5 characters that best fit the request.
   • Add a short explanation for why each was chosen.
   • Avoid overly obscure characters.

4. **Context Matching**
   • For academic topics → scholars/teachers.
   • For entertainment/fantasy → fictional characters.
   • For practical advice → experts or real-world figures.

5. **Character Types Distribution**
   • celebrity (유명인): 60% - Famous real/fictional characters that AI knows well
   • occupation (직업): 25% - Well-known professional archetypes  
   • coach (코치): 15% - Famous mentors/teachers

**Diversity Instruction:** ${diversityInstruction}

**Output Format (Structured JSON):**
{
  "characters": [
    {
      "name": "Character Name",
      "description": "One-line description",
      "personality": "Key personality traits",
      "speechStyle": "How they speak/communicate",
      "expertise": "Their area of expertise",
      "background": "Brief background",
      "icon": "Appropriate emoji",
      "color": "Hex color code (#RRGGBB)",
      "personaType": "celebrity|occupation|coach",
      "reason": "Why this character was chosen for this topic"
    }
  ]
}

Respond in ${responseLanguage} and ensure all characters are well-known to maximize token efficiency.`;

    const userPrompt = `Topic: "${topic}"

Please recommend 4-5 well-known characters (real people, fictional characters, or cultural icons) that would be most helpful for discussing this topic. Prioritize famous figures that AI models are trained on extensively.

Focus on:
- Famous experts in this field
- Well-known fictional characters related to this topic  
- Cultural icons or celebrities associated with this area
- Historical figures relevant to this subject

Make sure each character brings a different perspective or expertise level.`;

    console.log(`[Meta-Prompt Character Generation] OpenAI API 호출 (요청 #${requestNumber}): ${topic}`);
    console.log(`[Meta-Prompt Character Generation] 시스템 프롬프트 길이: ${systemPrompt.length}`);
    console.log(`[Meta-Prompt Character Generation] 사용자 프롬프트 길이: ${userPrompt.length}`);
    
    let completion;
    try {
      completion = await callOpenAIWithRetry(async () => {
        return openai.chat.completions.create({
          model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 600, // 🎯 토큰 대폭 감소 - 빠른 생성
          temperature: 0.7,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "meta_character_suggestions",
              schema: {
                type: "object",
                properties: {
                  characters: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        personality: { type: "string" },
                        speechStyle: { type: "string" },
                        expertise: { type: "string" },
                        background: { type: "string" },
                        icon: { type: "string" },
                        color: { type: "string" },
                        personaType: {
                          type: "string",
                          enum: ["celebrity", "occupation", "coach"]
                        },
                        reason: { type: "string" }
                      },
                      required: ["name", "description", "personality", "speechStyle", "expertise", "background", "icon", "color", "personaType", "reason"],
                      additionalProperties: false
                    }
                  }
                },
                required: ["characters"],
                additionalProperties: false
              }
            }
          }
        });
      });
      console.log(`[Meta-Prompt Character Generation] OpenAI API 호출 성공`);
    } catch (error) {
      console.error(`[Meta-Prompt Character Generation] OpenAI API 호출 실패:`, error);
      console.error(`[Meta-Prompt Character Generation] 에러 상세:`, {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      return [];
    }

    const response = completion.choices[0]?.message?.content;
    console.log(`[Meta-Prompt Character Generation] OpenAI 원본 응답 길이: ${response?.length || 0}`);
    console.log(`[Meta-Prompt Character Generation] OpenAI 전체 응답 구조:`, {
      choices_length: completion.choices?.length || 0,
      first_choice_exists: !!completion.choices?.[0],
      message_exists: !!completion.choices?.[0]?.message,
      content_exists: !!completion.choices?.[0]?.message?.content,
      content_preview: response?.substring(0, 200) || 'null/empty'
    });
    
    if (!response) {
      console.log('[Meta-Prompt Character Generation] 빈 응답 받음');
      return [];
    }

    // JSON 파싱 시도 (더 강력한 파싱)
    let jsonString = '';
    const jsonCodeBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonArrayMatch = response.match(/\[[\s\S]*\]/);
    
    if (jsonCodeBlockMatch) {
      jsonString = jsonCodeBlockMatch[1];
      console.log(`[Meta-Prompt Character Generation] JSON 코드블록 매치 성공`);
    } else if (jsonArrayMatch) {
      jsonString = jsonArrayMatch[0];
      console.log(`[Meta-Prompt Character Generation] JSON 배열 매치 성공`);
    } else {
      // 백업: 첫 번째 [ 부터 마지막 ] 까지 추출 시도
      const firstBracket = response.indexOf('[');
      const lastBracket = response.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonString = response.substring(firstBracket, lastBracket + 1);
        console.log(`[Meta-Prompt Character Generation] 백업 JSON 추출 성공`);
      } else {
        console.log(`[Meta-Prompt Character Generation] JSON 매치 완전 실패`);
        console.log(`[Meta-Prompt Character Generation] 원본 응답:`, response.substring(0, 500));
        return [];
      }
    }
    
    let characters;
    try {
      characters = JSON.parse(jsonString);
    } catch (parseError) {
      console.error(`[Meta-Prompt Character Generation] JSON 파싱 오류:`, parseError);
      console.error(`[Meta-Prompt Character Generation] 파싱 시도한 JSON:`, jsonString.substring(0, 500));
      return [];
    }
    
    if (!Array.isArray(characters)) {
      console.log('[Meta-Prompt Character Generation] 파싱된 결과가 배열이 아님:', typeof characters);
      return [];
    }

    console.log(`[Meta-Prompt Character Generation] ${characters.length}개 캐릭터 파싱 성공`);

    const validatedCharacters = characters.map((char: any, index: number) => ({
      name: char.name || `캐릭터 ${index + 1}`,
      description: char.description || "흥미로운 대화 상대",
      personality: char.personality || "친근하고 도움이 되는",
      speechStyle: char.speechStyle || "자연스럽고 친근한",
      expertise: char.expertise || "관련 분야 경험",
      background: char.background || "실무 경험이 풍부한",
      icon: char.icon || "🎭",
      color: char.color || "#6366f1",
      personaType: (char.personaType as PersonaType) || 'celebrity', // 기본값을 celebrity로 변경
      reason: char.reason || "해당 주제와 관련된 인물"
    }));
    
    // 세션 데이터 업데이트
    sessionData.characters.push(...validatedCharacters);
    sessionData.timestamp = now;
    
    console.log(`[Meta-Prompt Character Generation] 완료: ${validatedCharacters.length}개 캐릭터 생성 (총 요청 수: ${requestNumber})`);
    return validatedCharacters;

  } catch (error) {
    console.error('[Meta-Prompt Character Generation] 오류:', error);
    console.error('[Meta-Prompt Character Generation] 오류 상세:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return [];
  }
}

// 주제 기반 폴백 캐릭터 (다양성 보장)
function getFallbackCharacters(topic?: string): CharacterSuggestion[] {
  // 주제가 제공된 경우 해당 주제의 아키타입을 우선 시도
  if (topic) {
    const topicArchetypes = getTopicArchetypes(topic);
    if (topicArchetypes.length > 0) {
      console.log(`[Fallback] 주제 "${topic}"에 맞는 아키타입 ${topicArchetypes.length}개 사용`);
      return topicArchetypes.slice(0, 4).map(archetype => ({
        ...archetype,
        isVariation: false
      }));
    }
  }
  
  console.log('[Fallback] 기본 다양성 캐릭터 사용');
  return [
    {
      name: "김상담",
      description: "다양한 분야를 상담하는 전문가",
      personality: "도움이 되고 전문적인",
      speechStyle: "명확하고 친근한",
      expertise: "상담, 문제 해결, 조언",
      background: "다양한 분야 상담 경험이 풍부한 전문가",
      icon: "💬",
      color: "#4A90E2",
      personaType: 'coach'
    },
    {
      name: "이실무",
      description: "해당 분야의 실무 경험자",
      personality: "실용적이고 경험이 풍부한",
      speechStyle: "실무적이고 구체적인",
      expertise: "현장 경험, 실무 노하우",
      background: "현장에서 쌓은 실무 경험이 풍부한 전문가",
      icon: "🔧",
      color: "#FF6B6B",
      personaType: 'occupation'
    },
    {
      name: "박친구",
      description: "비슷한 관심사를 가진 동료",
      personality: "친근하고 공감하는",
      speechStyle: "자연스럽고 편안한",
      expertise: "공통 관심사, 경험 공유",
      background: "비슷한 경험과 관심사를 가진 일반인",
      icon: "😊",
      color: "#2E8B57",
      personaType: 'peer'
    },
    {
      name: "최멘토",
      description: "경험을 바탕으로 조언하는 멘토",
      personality: "지혜롭고 격려하는",
      speechStyle: "따뜻하고 지지적인",
      expertise: "인생 경험, 조언, 동기부여",
      background: "풍부한 경험을 바탕으로 조언하는 멘토",
      icon: "🌟",
      color: "#9370DB",
      personaType: 'coach'
    }
  ];
}

// 여러 에이전트가 함께 대화하는 응답 생성
export async function generateMultiAgentChatResponse(
  userMessage: string,
  agents: Array<{
    name: string;
    description: string;
    speechStyle: string;
    personality: string;
    additionalPrompt: string;
    relationship?: string; // 관계 정보 추가
  }>,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string; agentName?: string }>,
  availableDocuments: Array<{ filename: string; content: string }> = [],
  userLanguage: string = "ko"
): Promise<MultiAgentChatResponse> {
  try {
    const responseLanguage = getResponseLanguage(userLanguage);
    
    // 에이전트별 정보 구성 (관계 정보 포함)
    const agentProfiles = agents.map(agent => {
      const relationshipInfo = agent.relationship === '반대 토론자' 
        ? '\n- **역할**: 반대 토론자 - 다른 의견을 적극적으로 제시하고 건설적인 반박을 해야 함'
        : agent.relationship && agent.relationship !== '어시스턴트'
        ? `\n- **관계**: ${agent.relationship}`
        : '';
      
      return `**${agent.name}**: ${agent.description}\n- 말투: ${agent.speechStyle}\n- 성격: ${agent.personality}${relationshipInfo}${agent.additionalPrompt ? `\n- 추가 지침: ${agent.additionalPrompt}` : ''}`;
    }).join('\n\n');

    // 문서 컨텍스트 처리
    const { documentContext } = processDocumentContext(availableDocuments);
    
    const systemPrompt = `당신은 여러 AI 에이전트가 실제로 같은 공간에서 함께 대화하는 자연스러운 그룹 토론을 생성하는 시스템입니다.

참여 에이전트:
${agentProfiles}

**핵심 대화 원칙:**
1. 🎭 **실제 회의실/카페에서 대화하는 것처럼** - 각자 순서대로 발언하는 것이 아니라, 서로 자연스럽게 끼어들고 반응하는 실시간 대화
2. 🔄 **상호 반응 필수** - 다른 에이전트의 발언에 직접적으로 반응하고, "아, 그 점은 동감해요", "잠깐, 그건 좀 다른데요", "맞아요! 거기에 덧붙이면..." 등의 자연스러운 반응
3. 💬 **여러 턴 대화** - 각 에이전트가 한 번씩만 말하는 것이 아니라, 화제에 따라 2-4번씩 자유롭게 발언
4. 🎯 **논점별 집중 토론** - 하나의 논점에 대해 여러 에이전트가 집중적으로 의견 교환
5. 🤝 **자연스러운 동조/반박** - "정말 그렇네요!", "음... 저는 좀 다르게 생각하는데", "그 부분에 대해 질문이 있어요" 등

**반대 토론자 역할:**
- '반대 토론자' 관계의 에이전트는 적극적으로 다른 관점 제시
- 건설적인 비판과 대안 제시
- 다른 에이전트들의 의견에 "그런데 말이죠...", "한 가지 우려되는 점은..." 등으로 반박

**대화 진행 방식:**
1. 첫 번째 에이전트가 주요 의견 제시
2. 다른 에이전트들이 순차적으로 반응 (동의/질문/반박)
3. 논점이 발전되면서 추가 토론 진행
4. 자연스러운 마무리 또는 새로운 관점 제시

**출력 형식:**
[에이전트명]: 발언 내용
(에이전트들이 서로 언급하고 반응하는 자연스러운 대화로 구성)

${documentContext ? `\n**참고 문서:**\n${documentContext}` : ''}

이제 ${responseLanguage}로 실제 그룹 토론을 시작하세요! 최소 ${agents.length * 2}턴 이상의 역동적인 대화를 생성하세요:`;

    // 대화 히스토리 구성 (최근 10개만)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10).map(msg => ({
        role: msg.role,
        content: msg.agentName ? `[${msg.agentName}]: ${msg.content}` : msg.content
      })),
      { role: "user", content: userMessage },
    ];

    const response = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
        messages,
        max_tokens: 800, // 🎯 2000 → 800으로 대폭 감소 (응답 속도 향상)
        top_p: 0.95, // 더 다양한 표현을 위해 증가
        presence_penalty: 0.4, // 반복을 줄이고 새로운 주제 유도
        frequency_penalty: 0.2, // 같은 표현 반복 방지
      })
    );

    const responseText = response.choices[0]?.message?.content || '';
    
    // 📊 진단 로그: OpenAI 응답 직후
    console.log('=== 📊 OpenAI 원본 응답 ===');
    console.log(`길이: ${responseText.length}자`);
    console.log(`줄바꿈 개수: ${(responseText.match(/\n/g) || []).length}`);
    console.log(`표 포함: ${responseText.includes('|')}`);
    if (responseText.length > 0) {
      console.log('=== 처음 300자 (이스케이프) ===');
      console.log(JSON.stringify(responseText.substring(0, 300)));
    }
    
    // 📊 표 검증 및 자동 수정
    const fixedResponseText = validateAndFixMarkdownTable(responseText);
    
    // 응답을 파싱하여 각 에이전트별로 분리
    const responses: MultiAgentResponse[] = [];
    
    // 더 강력한 파싱: 전체 텍스트를 에이전트별로 분할 (수정된 텍스트 사용)
    const agentSections = fixedResponseText.split(/(?=\[([^\]]+)\]:)/);
    
    for (const section of agentSections) {
      if (!section.trim()) continue;
      
      // 각 섹션에서 에이전트명과 내용 추출
      const headerMatch = section.match(/^\[([^\]]+)\]:\s*([\s\S]*)/);
      if (headerMatch) {
        const [, agentName, content] = headerMatch;
        const trimmedAgentName = agentName.trim();
        const trimmedContent = content.trim();
        
        // 참여 에이전트 중에 있는 경우만 추가
        if (agents.some(agent => agent.name === trimmedAgentName) && trimmedContent) {
          responses.push({
            agentName: trimmedAgentName,
            content: trimmedContent
          });
        }
      }
    }
    
    // 최소 턴 수 검증 (에이전트 수 * 2) 및 재시도 로직
    const minimumTurns = agents.length * 2;
    const maxRetries = 2; // 무한 루프 방지
    let retryCount = 0;
    
    console.log(`[Multi-Agent] 초기 응답 파싱 완료: ${responses.length}개 턴 (최소 요구: ${minimumTurns}턴)`);
    
    while (responses.length < minimumTurns && retryCount < maxRetries) {
      retryCount++;
      console.log(`[Multi-Agent] 턴 수 부족 - 추가 대화 생성 시도 ${retryCount}/${maxRetries}`);
      
      // 추가 대화가 필요한 경우 간단한 후속 프롬프트로 보완
      if (responses.length > 0) {
        const lastAgent = responses[responses.length - 1].agentName;
        const otherAgents = agents.filter(a => a.name !== lastAgent);
        
        // 다른 에이전트들이 추가로 반응하도록 유도
        if (otherAgents.length > 0) {
          const additionalPrompt = `계속해서 ${otherAgents.map(a => a.name).join(', ')}가 위의 대화에 추가로 반응해주세요:`;
          
          try {
            const followUpResponse = await callOpenAIWithRetry(() =>
              openai.chat.completions.create({
                model: "gpt-4o-mini", // 🚀 경량 모델로 교체 (4배 빠름)
                messages: [
                  ...messages,
                  { role: "assistant", content: responseText },
                  { role: "user", content: additionalPrompt }
                ],
                max_tokens: 1000, // max_completion_tokens → max_tokens로 수정
                top_p: 0.95,
                presence_penalty: 0.4,
                frequency_penalty: 0.2,
              })
            );
            
            const followUpText = followUpResponse.choices[0]?.message?.content || '';
            const followUpSections = followUpText.split(/(?=\[([^\]]+)\]:)/);
            
            let addedTurns = 0;
            for (const section of followUpSections) {
              if (!section.trim()) continue;
              
              const headerMatch = section.match(/^\[([^\]]+)\]:\s*([\s\S]*)/);
              if (headerMatch) {
                const [, agentName, content] = headerMatch;
                const trimmedAgentName = agentName.trim();
                const trimmedContent = content.trim();
                
                if (agents.some(agent => agent.name === trimmedAgentName) && trimmedContent) {
                  responses.push({
                    agentName: trimmedAgentName,
                    content: trimmedContent
                  });
                  addedTurns++;
                }
              }
            }
            console.log(`[Multi-Agent] ${addedTurns}개 추가 턴 생성됨 (총 ${responses.length}턴)`);
          } catch (error) {
            console.log('[Multi-Agent] 추가 대화 생성 실패:', error);
            break; // 오류 시 재시도 중단
          }
        } else {
          break; // 추가할 에이전트가 없으면 중단
        }
      } else {
        break; // 기본 응답이 없으면 중단
      }
    }
    
    console.log(`[Multi-Agent] 최종 대화 생성 완료: ${responses.length}개 턴 (${retryCount}회 재시도)`);

    // 응답이 없는 경우 기본 응답 생성
    if (responses.length === 0) {
      responses.push({
        agentName: agents[0].name,
        content: "죄송합니다. 답변을 생성하는 중에 문제가 발생했습니다. 다시 시도해 주세요."
      });
    }

    return {
      responses,
      usedDocuments: availableDocuments
    };
  } catch (error: any) {
    console.error("Multi-agent response generation error:", error);
    
    // 오류 시 첫 번째 에이전트가 대답하도록 폴백
    return {
      responses: [{
        agentName: agents[0]?.name || "Assistant",
        content: "죄송합니다. 현재 시스템에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
      }],
      usedDocuments: []
    };
  }
}

// 🤖 질문을 분석하고 적절한 에이전트를 자동으로 선택하는 함수
export interface AgentSelectionResult {
  selectedAgentIds: number[];
  reasoning: string;
}

export async function selectAgentsForQuestion(
  question: string,
  availableAgents: Array<{ id: number; name: string; description: string }>,
  minAgents: number = 1,
  maxAgents: number = 3
): Promise<AgentSelectionResult> {
  try {
    console.log(`[🤖 자동 에이전트 선택] 질문 분석 시작: "${question.slice(0, 50)}..."`);
    console.log(`[🤖 자동 에이전트 선택] 사용 가능한 에이전트 ${availableAgents.length}명`);

    // Zod 스키마 정의
    const selectionSchema = z.object({
      selectedAgentIds: z.array(z.number()).min(minAgents).max(maxAgents),
      reasoning: z.string()
    });

    // JSON Schema 정의
    const jsonSchema = {
      type: "object",
      properties: {
        selectedAgentIds: {
          type: "array",
          items: { type: "number" },
          minItems: minAgents,
          maxItems: maxAgents,
          description: "질문에 답변하기 적합한 에이전트들의 ID 목록"
        },
        reasoning: {
          type: "string",
          description: "에이전트 선택 이유"
        }
      },
      required: ["selectedAgentIds", "reasoning"],
      additionalProperties: false
    };

    // 에이전트 정보를 프롬프트에 포함
    const agentList = availableAgents.map(agent => 
      `ID: ${agent.id}\n이름: ${agent.name}\n설명: ${agent.description}`
    ).join('\n\n');

    const systemPrompt = `당신은 사용자의 질문을 분석하고 가장 적합한 AI 에이전트를 선택하는 전문가입니다.

규칙:
1. 질문의 주제와 내용을 신중히 분석하세요
2. 각 에이전트의 전문 분야를 고려하세요
3. 최소 ${minAgents}명, 최대 ${maxAgents}명의 에이전트를 선택하세요
4. 질문에 가장 적합한 전문성을 가진 에이전트를 우선 선택하세요
5. 여러 관점이 필요한 질문이면 다양한 분야의 에이전트를 선택하세요`;

    const userPrompt = `사용 가능한 에이전트 목록:
${agentList}

사용자 질문: "${question}"

위 질문에 답변하기 가장 적합한 에이전트를 선택해주세요.`;

    const result = await generateStructuredResponse<AgentSelectionResult>(
      systemPrompt,
      userPrompt,
      selectionSchema,
      jsonSchema,
      "AgentSelection",
      500
    );

    console.log(`[🤖 자동 에이전트 선택] 완료: ${result.selectedAgentIds.length}명 선택`);
    console.log(`[🤖 선택 이유] ${result.reasoning}`);

    return result;

  } catch (error: any) {
    console.error("[🤖 자동 에이전트 선택] 오류:", error);
    
    // 폴백: 첫 번째 에이전트 선택
    const fallbackAgent = availableAgents[0];
    console.log(`[🤖 폴백] ${fallbackAgent.name} 선택`);
    
    return {
      selectedAgentIds: [fallbackAgent.id],
      reasoning: "자동 선택 중 오류가 발생하여 기본 에이전트를 선택했습니다."
    };
  }
}

// 🖼️ Vision API: 이미지 분석 (고급 기능 - 선택적 활성화)
export async function analyzeImageWithVision(
  imagePath: string,
  prompt: string = "이 이미지에 대해 자세히 설명해주세요.",
  options: {
    detail?: "low" | "high" | "auto";
    maxTokens?: number;
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string> {
  const requestStartTime = Date.now();
  
  try {
    console.log(`[🖼️ Vision API] 이미지 분석 시작: ${imagePath}`);
    
    // 이미지를 base64로 인코딩
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const imageExt = path.extname(imagePath).toLowerCase().replace('.', '');
    const mimeType = imageExt === 'png' ? 'image/png' : 
                     imageExt === 'jpg' || imageExt === 'jpeg' ? 'image/jpeg' : 
                     imageExt === 'webp' ? 'image/webp' : 
                     'image/png';
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: options.detail || "auto"
              }
            }
          ]
        }
      ],
      max_tokens: options.maxTokens || 1000,
      temperature: 0.2
    });
    
    const result = response.choices[0]?.message?.content || "";
    console.log(`[🖼️ Vision API] 분석 완료: ${result.length}자`);
    
    // 📊 토큰 사용량 로깅
    if (options.userId || options.agentId || options.documentId) {
      await logOpenAIUsage(response, {
        userId: options.userId,
        agentId: options.agentId,
        documentId: options.documentId,
        feature: 'vision-api',
        requestStartTime,
        metadata: {
          imagePath: path.basename(imagePath),
          detail: options.detail || "auto"
        }
      });
    }
    
    return result;
    
  } catch (error: any) {
    console.error("[🖼️ Vision API] 오류:", error);
    throw new Error(`Vision API 분석 실패: ${error.message}`);
  }
}

// 🖼️ Vision API: PDF 페이지 이미지 분석 (노선도, 지도, 다이어그램 등)
export async function analyzePDFPageImage(
  imagePath: string,
  pageNum: number,
  analysisType: "diagram" | "map" | "chart" | "table" | "general" = "general",
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string> {
  const prompts = {
    diagram: "이 다이어그램의 구조와 흐름을 자세히 설명해주세요. 각 요소 간의 관계와 연결을 포함하세요.",
    map: "이 지도 또는 노선도를 분석해주세요. 주요 위치, 경로, 연결점을 설명하세요.",
    chart: "이 차트나 그래프를 분석해주세요. 주요 트렌드, 데이터 포인트, 결론을 포함하세요.",
    table: "이 표의 내용을 구조화하여 설명해주세요. 헤더, 행, 열의 관계를 명확히 하세요.",
    general: "이 이미지의 내용을 자세히 설명해주세요. 텍스트, 시각적 요소, 주요 정보를 모두 포함하세요."
  };
  
  const prompt = prompts[analysisType];
  const result = await analyzeImageWithVision(imagePath, prompt, { 
    detail: "high",
    userId: options.userId,
    agentId: options.agentId,
    documentId: options.documentId
  });
  
  console.log(`[🖼️ Vision API] PDF 페이지 ${pageNum} 분석 완료 (타입: ${analysisType})`);
  return result;
}

// 🖼️ Vision API: Grid 이미지 분석 (여러 이미지를 번호별로 분석)
export async function analyzeImageGridWithVision(
  gridImagePath: string,
  mapping: Array<{ number: number; page: number; caption: string }>,
  options: {
    userId?: string;
    agentId?: number;
    documentId?: number;
  } = {}
): Promise<string> {
  console.log(`[Vision Grid] Analyzing grid image with ${mapping.length} images`);
  
  // 번호 목록 생성
  const numberList = mapping.map(m => `#${m.number}`).join(', ');
  
  // 프롬프트 작성
  const prompt = `이 이미지는 여러 다이어그램, 회로도, 노선도, 지도 등의 시각적 요소를 grid로 합친 것입니다.
각 이미지 왼쪽 상단에 번호가 표시되어 있습니다 (${numberList}).

각 번호별로 다음 형식으로 자세히 설명해주세요:

#1: [첫 번째 이미지에 대한 상세한 설명. 다이어그램의 구조, 회로도의 연결, 노선도의 경로, 지도의 위치 등을 포함]

#2: [두 번째 이미지에 대한 상세한 설명]

...

모든 번호(${numberList})에 대해 설명해주세요. 각 이미지의 텍스트, 시각적 요소, 주요 정보를 빠짐없이 포함하세요.`;

  const result = await analyzeImageWithVision(gridImagePath, prompt, {
    detail: "high",
    userId: options.userId,
    agentId: options.agentId,
    documentId: options.documentId
  });
  
  console.log(`[Vision Grid] Grid analysis completed`);
  return result;
}