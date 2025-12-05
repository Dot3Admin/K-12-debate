// 테스트용 토큰 데이터 시드 함수
import { storage } from '../storage';
import type { InsertTokenUsage } from '@shared/schema';

export async function seedTokenData(): Promise<void> {
  console.log('[🔥 토큰 시드] 테스트 데이터 생성 시작...');

  const features = ['chat', 'document_analysis', 'summarization', 'image_generation', 'translation'];
  const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // 지난 24시간 동안의 데이터 생성
  for (let i = 0; i < 100; i++) {
    const timestamp = new Date(now - Math.random() * 24 * oneHour);
    const feature = features[Math.floor(Math.random() * features.length)];
    const model = models[Math.floor(Math.random() * models.length)];

    const promptTokens = Math.floor(Math.random() * 2000) + 100;
    const completionTokens = Math.floor(Math.random() * 1500) + 50;
    const totalTokens = promptTokens + completionTokens;

    // 모델별 비용 계산
    let promptCost = 0;
    let completionCost = 0;
    if (model === 'gpt-4o') {
      promptCost = (promptTokens / 1000) * 0.0025;
      completionCost = (completionTokens / 1000) * 0.01;
    } else if (model === 'gpt-4o-mini') {
      promptCost = (promptTokens / 1000) * 0.00015;
      completionCost = (completionTokens / 1000) * 0.0006;
    } else if (model === 'gpt-4-turbo') {
      promptCost = (promptTokens / 1000) * 0.01;
      completionCost = (completionTokens / 1000) * 0.03;
    }

    const estimatedCost = promptCost + completionCost;
    const requestDuration = Math.floor(Math.random() * 5000) + 500;

    const tokenUsageData: InsertTokenUsage = {
      userId: null,
      agentId: Math.random() > 0.5 ? Math.floor(Math.random() * 10) + 1 : null,
      conversationId: null,
      groupChatId: null,
      feature,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost: estimatedCost.toString(),
      requestDuration,
      metadata: JSON.stringify({ test: true }),
      timestamp,
    };

    await storage.logTokenUsage(tokenUsageData);
  }

  console.log('[🔥 토큰 시드] 100개의 테스트 데이터 생성 완료!');
}
