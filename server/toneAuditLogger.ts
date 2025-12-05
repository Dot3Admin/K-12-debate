// toneAuditLogger.ts
// 🔍 Tone Application Audit Logger
// 프롬프트 변화 추적 및 분석 시스템

import type { Agent, InsertToneApplicationLog } from '@shared/schema';
import { db } from './db';
import { toneApplicationLogs } from '@shared/schema';

/**
 * Tone 적용 로그 저장
 * @param data 로그 데이터
 */
export async function logToneApplication(data: {
  agent: Agent;
  relationshipType: string;
  characterArchetype?: string;
  debateIntensity?: number;
  beforePrompt: string;
  afterPrompt: string;
  userId?: string;
  groupChatId?: number;
  messageId?: number;
}): Promise<void> {
  try {
    const logEntry: InsertToneApplicationLog = {
      agentId: data.agent.id,
      agentName: data.agent.name,
      relationshipType: data.relationshipType,
      characterArchetype: data.characterArchetype || data.agent.characterArchetype || undefined,
      debateIntensity: data.debateIntensity,
      beforePrompt: data.beforePrompt,
      afterPrompt: data.afterPrompt,
      userId: data.userId,
      groupChatId: data.groupChatId,
      messageId: data.messageId,
    };

    await db.insert(toneApplicationLogs).values(logEntry);

    console.log(`[Tone Audit] Logged tone application for agent: ${data.agent.name}, relationship: ${data.relationshipType}`);
  } catch (error) {
    console.error('[Tone Audit] Failed to log tone application:', error);
  }
}

/**
 * 프롬프트 변화 비교 분석
 * @param beforePrompt 적용 전 프롬프트
 * @param afterPrompt 적용 후 프롬프트
 * @returns 변화 분석 결과
 */
export function analyzePromptChange(beforePrompt: string, afterPrompt: string): {
  addedLength: number;
  addedSections: string[];
  hasToneInstructions: boolean;
  hasProhibitedPhrases: boolean;
  hasCharacterPersona: boolean;
} {
  const beforeLines = beforePrompt.split('\n').filter(l => l.trim());
  const afterLines = afterPrompt.split('\n').filter(l => l.trim());
  
  const addedLength = afterPrompt.length - beforePrompt.length;
  
  const addedSections: string[] = [];
  if (afterPrompt.includes('🎭 **캐릭터 본질:**')) addedSections.push('Character Persona');
  if (afterPrompt.includes('🧠 **사고 흐름')) addedSections.push('Thinking Pattern');
  if (afterPrompt.includes('🤝 **현재 관계 맥락:**')) addedSections.push('Relationship Context');
  if (afterPrompt.includes('🔊 **톤 강도:')) addedSections.push('Tone Intensity');
  if (afterPrompt.includes('🚫 **절대 사용 금지 표현')) addedSections.push('Prohibited Phrases');
  
  return {
    addedLength,
    addedSections,
    hasToneInstructions: afterPrompt.includes('톤') || afterPrompt.includes('tone'),
    hasProhibitedPhrases: afterPrompt.includes('금지') || afterPrompt.includes('prohibited'),
    hasCharacterPersona: afterPrompt.includes('캐릭터 본질') || afterPrompt.includes('Character'),
  };
}

/**
 * 특정 에이전트의 최근 Tone 적용 로그 조회
 * @param agentId 에이전트 ID
 * @param limit 조회 개수 (기본 10개)
 */
export async function getRecentToneLogs(agentId: number, limit: number = 10) {
  try {
    const logs = await db
      .select()
      .from(toneApplicationLogs)
      .where(eq(toneApplicationLogs.agentId, agentId))
      .orderBy(desc(toneApplicationLogs.createdAt))
      .limit(limit);

    return logs;
  } catch (error) {
    console.error('[Tone Audit] Failed to get recent logs:', error);
    return [];
  }
}

/**
 * 관계 타입별 Tone 적용 로그 통계
 * @param relationshipType 관계 타입
 */
export async function getToneLogStats(relationshipType: string) {
  try {
    const logs = await db
      .select()
      .from(toneApplicationLogs)
      .where(eq(toneApplicationLogs.relationshipType, relationshipType))
      .orderBy(desc(toneApplicationLogs.createdAt))
      .limit(100);

    const totalLogs = logs.length;
    const avgBeforeLength = logs.reduce((sum, log) => sum + log.beforePrompt.length, 0) / totalLogs;
    const avgAfterLength = logs.reduce((sum, log) => sum + log.afterPrompt.length, 0) / totalLogs;
    const avgIncrease = avgAfterLength - avgBeforeLength;

    return {
      totalLogs,
      avgBeforeLength: Math.round(avgBeforeLength),
      avgAfterLength: Math.round(avgAfterLength),
      avgIncrease: Math.round(avgIncrease),
      avgIncreasePercent: Math.round((avgIncrease / avgBeforeLength) * 100),
    };
  } catch (error) {
    console.error('[Tone Audit] Failed to get stats:', error);
    return null;
  }
}

/**
 * 프롬프트 비교 출력 (디버깅용)
 * @param beforePrompt 적용 전
 * @param afterPrompt 적용 후
 */
export function printPromptComparison(beforePrompt: string, afterPrompt: string): void {
  console.log('\n========== PROMPT COMPARISON ==========');
  console.log('\n📝 BEFORE (길이: %d자):', beforePrompt.length);
  console.log(beforePrompt.substring(0, 300) + '...\n');
  
  console.log('📝 AFTER (길이: %d자):', afterPrompt.length);
  console.log(afterPrompt.substring(0, 300) + '...\n');
  
  const analysis = analyzePromptChange(beforePrompt, afterPrompt);
  console.log('📊 변화 분석:');
  console.log('  - 추가된 길이: +%d자', analysis.addedLength);
  console.log('  - 추가된 섹션:', analysis.addedSections.join(', '));
  console.log('  - Character Persona: %s', analysis.hasCharacterPersona ? '✅' : '❌');
  console.log('  - Prohibited Phrases: %s', analysis.hasProhibitedPhrases ? '✅' : '❌');
  console.log('=======================================\n');
}

import { eq, desc } from 'drizzle-orm';

export default {
  logToneApplication,
  analyzePromptChange,
  getRecentToneLogs,
  getToneLogStats,
  printPromptComparison,
};
