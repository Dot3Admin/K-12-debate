/**
 * 🎯 토큰 최적화 엔진
 * 
 * 목표: 응답당 300-500 토큰 절감
 * 전략:
 * 1. 대화 히스토리 압축 (100-150 토큰 절감)
 * 2. 문서 검색 결과 압축 (100-200 토큰 절감)
 * 3. 프롬프트 구조 최적화 (50-100 토큰 절감)
 */

import OpenAI from "openai";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || ""
});

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Helper type for compatibility with generateChatResponse
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 시스템 메시지를 필터링하여 ChatMessage[] 타입으로 변환
 */
export function filterSystemMessages(messages: Message[]): ChatMessage[] {
  return messages.filter(msg => msg.role !== "system") as ChatMessage[];
}

export interface DocumentChunk {
  filename: string;
  content: string;
  relevanceScore?: number;
}

/**
 * 🎯 토큰 예산 관리
 * 
 * 각 요청에 대한 최대 토큰 예산을 설정하고 동적으로 조정
 */
export interface TokenBudget {
  total: number;           // 전체 토큰 예산
  history: number;         // 대화 히스토리용 예산
  documents: number;       // 문서 검색용 예산
  systemPrompt: number;    // 시스템 프롬프트용 예산
}

/**
 * 기본 토큰 예산 (GPT-4o 컨텍스트 윈도우 128k 기준)
 */
export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  total: 4000,       // 입력 전체 예산
  history: 1500,     // 대화 히스토리 (압축된 3-5개 메시지)
  documents: 1500,   // 문서 검색 결과 (압축된 3개 청크)
  systemPrompt: 1000 // 시스템 프롬프트
};

/**
 * 토큰 예산에 맞게 컨텍스트 조정
 */
export function adjustContextToBudget(
  messages: Message[],
  documentChunks: DocumentChunk[],
  budget: TokenBudget = DEFAULT_TOKEN_BUDGET
): {
  adjustedMessages: Message[];
  adjustedChunks: DocumentChunk[];
  budgetUsed: { history: number; documents: number; total: number };
} {
  // 현재 토큰 사용량 추정
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  
  let adjustedMessages = [...messages];
  let adjustedChunks = [...documentChunks];
  
  // 1. 대화 히스토리 조정
  let historyTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
  
  while (historyTokens > budget.history && adjustedMessages.length > 1) {
    // 가장 오래된 메시지 제거 (요약 메시지는 유지)
    const toRemove = adjustedMessages.findIndex(msg => 
      !msg.content.includes('[이전 대화 요약]')
    );
    if (toRemove !== -1) {
      adjustedMessages.splice(toRemove, 1);
      historyTokens = adjustedMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    } else {
      break;
    }
  }
  
  // 2. 문서 청크 조정
  let documentTokens = documentChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0);
  
  while (documentTokens > budget.documents && adjustedChunks.length > 0) {
    // 관련성이 가장 낮은 청크 제거
    const sortedChunks = adjustedChunks.sort((a, b) => 
      (b.relevanceScore || 0) - (a.relevanceScore || 0)
    );
    sortedChunks.pop(); // 마지막 (가장 낮은 점수) 제거
    adjustedChunks = sortedChunks;
    documentTokens = adjustedChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0);
  }
  
  const totalUsed = historyTokens + documentTokens;
  
  console.log(`
[토큰 예산 관리]
- 예산: 히스토리 ${budget.history}, 문서 ${budget.documents}, 총 ${budget.total}
- 사용: 히스토리 ${historyTokens}, 문서 ${documentTokens}, 총 ${totalUsed}
- 메시지: ${messages.length} → ${adjustedMessages.length}
- 청크: ${documentChunks.length} → ${adjustedChunks.length}
  `);
  
  return {
    adjustedMessages,
    adjustedChunks,
    budgetUsed: {
      history: historyTokens,
      documents: documentTokens,
      total: totalUsed
    }
  };
}

/**
 * 🔥 대화 히스토리 압축 (100-150 토큰 절감)
 * 
 * 전략:
 * - 최근 3개 메시지: 원본 유지 (컨텍스트 보존)
 * - 4-10번째 메시지: AI 요약 (핵심만 추출)
 * - 10개 이상: 제거
 * 
 * 예상 절감: 10개 메시지 * 평균 50토큰 = 500토큰 → 150토큰 (350토큰 절감의 30%)
 */
export async function compressConversationHistory(
  messages: Message[],
  maxRecentMessages: number = 3
): Promise<Message[]> {
  if (messages.length <= maxRecentMessages) {
    return messages;
  }

  // 최근 3개는 원본 유지
  const recentMessages = messages.slice(-maxRecentMessages);
  
  // 이전 메시지들 (4-10번째)
  const oldMessages = messages.slice(0, -maxRecentMessages);
  
  if (oldMessages.length === 0) {
    return recentMessages;
  }

  try {
    // 이전 대화 요약
    const conversationText = oldMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const summaryPrompt = `Summarize this conversation in 2-3 concise sentences. Focus on key topics, decisions, and context needed for the current conversation:

${conversationText}

Summary:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 저렴한 모델 사용
      messages: [{ role: "user", content: summaryPrompt }],
      max_tokens: 100, // 요약은 짧게
      temperature: 0.3, // 일관성 유지
    });

    const summary = response.choices[0]?.message?.content || "";
    
    if (!summary) {
      return recentMessages;
    }

    console.log(`[토큰 최적화] 대화 히스토리 압축: ${messages.length}개 → 요약 + ${maxRecentMessages}개`);
    console.log(`[토큰 최적화] 압축된 요약: ${summary.substring(0, 100)}...`);

    // 요약 + 최근 메시지 (system 역할 대신 assistant 역할로 요약 추가)
    return [
      { role: "assistant" as const, content: `[이전 대화 요약] ${summary}` },
      ...recentMessages
    ];
  } catch (error) {
    console.error('[토큰 최적화] 대화 요약 실패:', error);
    // 실패 시 최근 메시지만 반환
    return recentMessages;
  }
}

/**
 * 🔥 문서 검색 결과 압축 (100-200 토큰 절감)
 * 
 * 전략:
 * - 관련성 점수로 정렬 및 필터링
 * - 중복 내용 제거
 * - 청크당 최대 토큰 제한
 * - 상위 N개만 유지
 * 
 * 예상 절감: 10개 청크 * 평균 200토큰 = 2000토큰 → 500토큰 (1500토큰 절감의 10%)
 */
export function compressDocumentChunks(
  chunks: DocumentChunk[],
  maxChunks: number = 3,
  maxChunkTokens: number = 150
): DocumentChunk[] {
  if (chunks.length === 0) {
    return [];
  }

  // 🚨 중요: relevanceScore가 없으면 압축하지 않음 (전체 문서 유지)
  const hasRelevanceScores = chunks.some(chunk => chunk.relevanceScore !== undefined);
  
  if (!hasRelevanceScores) {
    console.log(`[토큰 최적화] relevanceScore 없음 - 문서 압축 건너뛰기 (${chunks.length}개 문서 유지)`);
    return chunks;
  }

  console.log(`[토큰 최적화] 문서 청크 압축 시작: ${chunks.length}개 청크`);

  // 1. 관련성 점수로 정렬 (높은 순)
  const sortedChunks = [...chunks].sort((a, b) => 
    (b.relevanceScore || 0) - (a.relevanceScore || 0)
  );

  // 2. 상위 N개만 선택
  const topChunks = sortedChunks.slice(0, maxChunks);

  // 3. 각 청크의 토큰 제한 (대략 4 characters = 1 token)
  const maxChars = maxChunkTokens * 4;
  const compressedChunks = topChunks.map(chunk => ({
    ...chunk,
    content: chunk.content.length > maxChars 
      ? chunk.content.substring(0, maxChars) + '...'
      : chunk.content
  }));

  // 4. 중복 파일명 제거 (같은 파일의 여러 청크가 있을 경우)
  const uniqueChunks = compressedChunks.reduce((acc, chunk) => {
    const existingChunk = acc.find(c => c.filename === chunk.filename);
    if (!existingChunk) {
      acc.push(chunk);
    } else if ((chunk.relevanceScore || 0) > (existingChunk.relevanceScore || 0)) {
      // 관련성이 더 높으면 교체
      const index = acc.indexOf(existingChunk);
      acc[index] = chunk;
    }
    return acc;
  }, [] as DocumentChunk[]);

  console.log(`[토큰 최적화] 문서 청크 압축 완료: ${chunks.length}개 → ${uniqueChunks.length}개`);
  
  return uniqueChunks;
}

/**
 * 🔥 프롬프트 구조 최적화 (50-100 토큰 절감)
 * 
 * 전략:
 * - 조건부 섹션 제거 (불필요한 경우)
 * - 짧은 지시문 사용
 * - 반복 제거
 */
export function optimizeSystemPrompt(
  systemPrompt: string,
  options: {
    includeLanguageLevel?: boolean;
    includeCanonLock?: boolean;
    includeHumorSettings?: boolean;
  } = {}
): string {
  let optimized = systemPrompt;

  // 불필요한 헤더 제거
  optimized = optimized.replace(/\[LoBo System Prompt\]\s*/g, '');
  
  // 반복되는 공백 정리
  optimized = optimized.replace(/\n{3,}/g, '\n\n');
  optimized = optimized.trim();

  // 조건부 섹션 제거
  if (!options.includeLanguageLevel) {
    optimized = optimized.replace(/📌 \*\*언어 레벨.*?\*\*/s, '');
  }
  if (!options.includeCanonLock) {
    optimized = optimized.replace(/🔒 \*\*Canon Lock.*?\*\*/s, '');
  }
  if (!options.includeHumorSettings) {
    optimized = optimized.replace(/Response Length Control.*?$/s, '');
  }

  console.log(`[토큰 최적화] 프롬프트 최적화: ${systemPrompt.length}자 → ${optimized.length}자`);
  
  return optimized;
}

/**
 * 🎯 통합 토큰 최적화 함수
 * 
 * 모든 최적화 전략을 적용하여 최대 토큰 절감
 */
export async function optimizeTokenUsage(
  messages: Message[],
  documentChunks: DocumentChunk[],
  systemPrompt: string,
  options: {
    maxRecentMessages?: number;
    maxDocumentChunks?: number;
    maxChunkTokens?: number;
    optimizePrompt?: boolean;
    budget?: TokenBudget;
  } = {}
): Promise<{
  messages: Message[];
  documentChunks: DocumentChunk[];
  systemPrompt: string;
  savedTokens: number;
}> {
  const {
    maxRecentMessages = 3,
    maxDocumentChunks = 3,
    maxChunkTokens = 150,
    optimizePrompt = true,
    budget = DEFAULT_TOKEN_BUDGET
  } = options;

  // 원본 토큰 수 추정 (대략 4 characters = 1 token)
  const originalMessageTokens = messages.reduce((sum, msg) => 
    sum + Math.ceil(msg.content.length / 4), 0
  );
  const originalDocTokens = documentChunks.reduce((sum, chunk) => 
    sum + Math.ceil(chunk.content.length / 4), 0
  );
  const originalPromptTokens = Math.ceil(systemPrompt.length / 4);

  // 최적화 적용
  const compressedMessages = await compressConversationHistory(messages, maxRecentMessages);
  const compressedChunks = compressDocumentChunks(documentChunks, maxDocumentChunks, maxChunkTokens);
  const optimizedPrompt = optimizePrompt 
    ? optimizeSystemPrompt(systemPrompt)
    : systemPrompt;

  // 🎯 토큰 예산에 맞게 추가 조정
  // relevanceScore가 없으면 문서 압축을 건너뜀 (에이전트 전체 문서 보존)
  const hasRelevanceScores = compressedChunks.some(chunk => chunk.relevanceScore !== undefined);
  
  let adjustedMessages = compressedMessages;
  let adjustedChunks = compressedChunks;
  
  if (hasRelevanceScores) {
    // RAG 검색 결과만 예산 관리 적용
    const adjusted = adjustContextToBudget(compressedMessages, compressedChunks, budget);
    adjustedMessages = adjusted.adjustedMessages;
    adjustedChunks = adjusted.adjustedChunks;
  } else {
    console.log(`[토큰 예산 관리] relevanceScore 없음 - 예산 관리 건너뛰기 (전체 문서 보존)`);
  }

  // 압축된 토큰 수 추정
  const compressedMessageTokens = adjustedMessages.reduce((sum, msg) => 
    sum + Math.ceil(msg.content.length / 4), 0
  );
  const compressedDocTokens = adjustedChunks.reduce((sum, chunk) => 
    sum + Math.ceil(chunk.content.length / 4), 0
  );
  const compressedPromptTokens = Math.ceil(optimizedPrompt.length / 4);

  const savedTokens = (originalMessageTokens - compressedMessageTokens) +
                     (originalDocTokens - compressedDocTokens) +
                     (originalPromptTokens - compressedPromptTokens);

  console.log(`
╔══════════════════════════════════════════════╗
║          토큰 최적화 결과                    ║
╠══════════════════════════════════════════════╣
║ 대화 히스토리: ${originalMessageTokens} → ${compressedMessageTokens} (-${originalMessageTokens - compressedMessageTokens} 토큰)
║ 문서 검색: ${originalDocTokens} → ${compressedDocTokens} (-${originalDocTokens - compressedDocTokens} 토큰)
║ 시스템 프롬프트: ${originalPromptTokens} → ${compressedPromptTokens} (-${originalPromptTokens - compressedPromptTokens} 토큰)
║ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
║ 총 절감: ${savedTokens} 토큰
╚══════════════════════════════════════════════╝
  `);

  return {
    messages: adjustedMessages,
    documentChunks: adjustedChunks,
    systemPrompt: optimizedPrompt,
    savedTokens
  };
}
