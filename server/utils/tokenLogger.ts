import { storage } from '../storage';
import type { InsertTokenUsage } from '@shared/schema';

// GPT 모델별 비용 (USD per 1K tokens)
const MODEL_COSTS = {
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },
  'o1-preview': { prompt: 0.015, completion: 0.06 },
  'o1-mini': { prompt: 0.003, completion: 0.012 },
} as const;

// 비용 계산
export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model as keyof typeof MODEL_COSTS] || MODEL_COSTS['gpt-4o-mini'];
  const promptCost = (promptTokens / 1000) * costs.prompt;
  const completionCost = (completionTokens / 1000) * costs.completion;
  return promptCost + completionCost;
}

// 토큰 사용량 로깅
export async function logTokenUsage(params: {
  userId?: string;
  agentId?: number;
  conversationId?: number;
  groupChatId?: number;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  requestDuration?: number;
  metadata?: any;
}): Promise<void> {
  try {
    const totalTokens = params.promptTokens + params.completionTokens;
    const estimatedCost = calculateCost(params.model, params.promptTokens, params.completionTokens);

    const tokenUsageData: InsertTokenUsage = {
      userId: params.userId || null,
      agentId: params.agentId || null,
      conversationId: params.conversationId || null,
      groupChatId: params.groupChatId || null,
      feature: params.feature,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens,
      estimatedCost: estimatedCost.toString(),
      requestDuration: params.requestDuration || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    };

    await storage.logTokenUsage(tokenUsageData);
  } catch (error) {
    console.error('[🔥 토큰 로깅 실패]:', error);
  }
}

// OpenAI API 응답에서 토큰 정보 추출 및 로깅
export async function logOpenAIUsage(
  response: any,
  params: {
    userId?: string;
    agentId?: number;
    conversationId?: number;
    groupChatId?: number;
    feature: string;
    requestStartTime?: number;
    metadata?: any;
  }
): Promise<void> {
  try {
    if (!response?.usage) {
      console.warn('[⚠️ 토큰 정보 없음] OpenAI 응답에 usage 정보가 없습니다');
      return;
    }

    const { prompt_tokens, completion_tokens } = response.usage;
    const model = response.model || 'gpt-4o-mini';
    const requestDuration = params.requestStartTime ? Date.now() - params.requestStartTime : undefined;

    await logTokenUsage({
      ...params,
      model,
      promptTokens: prompt_tokens,
      completionTokens: completion_tokens,
      requestDuration,
    });
  } catch (error) {
    console.error('[🔥 OpenAI 토큰 로깅 실패]:', error);
  }
}
