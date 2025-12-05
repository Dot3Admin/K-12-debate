/**
 * 프롬프트 캐싱 시스템
 * 채팅방 입장 시 사용자별 에이전트 프롬프트를 사전 생성하여 캐싱
 * 질문 시 캐시에서 즉시 가져와 응답 속도 최적화
 */

import { buildLoBoPrompt, getPromptCacheKey } from "./promptBuilder";
import type { IStorage } from "./storage";
import type { User, Agent, RelationshipTone } from "@shared/schema";

// 메모리 캐시 (Map 기반)
const promptCache = new Map<string, string>();

// 캐시 통계 (디버깅용)
let cacheHits = 0;
let cacheMisses = 0;

/**
 * 채팅방 입장 시 모든 에이전트에 대한 프롬프트 사전 생성
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 * @param storage - 스토리지 인스턴스
 */
export async function preloadGroupChatPrompts(
  groupChatId: number,
  userId: string,
  storage: IStorage
): Promise<void> {
  console.log(`[📝 프롬프트 사전 생성] 채팅방 ${groupChatId}, 사용자 ${userId}`);
  
  try {
    // 1. 사용자 정보 조회
    const user = await storage.getUser(userId);
    if (!user) {
      console.warn(`[⚠️ 프롬프트 사전 생성] 사용자 ${userId} 조회 실패`);
      return;
    }
    
    // 2. 채팅방에 참여한 에이전트 목록 조회
    const agents = await storage.getGroupChatAgents(groupChatId);
    
    // 3. 각 에이전트별 프롬프트 생성 및 캐싱
    const startTime = Date.now();
    let successCount = 0;
    
    for (const agent of agents) {
      try {
        // 사용자-에이전트 관계 설정 조회
        const settings = await storage.getUserAgentSetting(groupChatId, userId, agent.id);
        const relationshipType = settings?.relationshipType || "companion";
        
        // 톤 패턴 조회
        const tonePattern = await storage.getRelationshipTone(relationshipType, "default");
        
        // 🔒 Canon Lock 설정 조회 (relationship과 독립적)
        let canonEnabled = false;
        let strictMode: string | null = null;
        let customRule: string | null = null;
        try {
          const canonSettings = await storage.getAgentCanon(agent.id);
          strictMode = canonSettings?.strictMode || null;
          customRule = canonSettings?.customRule || null;
          
          // 🎯 Canonical modes: biblical/teacher만 Canon Lock으로 인정
          const canonicalModes = ['biblical', 'teacher'];
          canonEnabled = !!strictMode && canonicalModes.includes(strictMode);
        } catch (error) {
          // Canon Lock 설정이 없으면 기본값 false 사용
        }
        
        // 프롬프트 빌드
        const prompt = await buildLoBoPrompt(user, agent, relationshipType, tonePattern, canonEnabled, strictMode, customRule);
        
        // 캐시에 저장
        const cacheKey = getPromptCacheKey(groupChatId, userId, agent.id);
        promptCache.set(cacheKey, prompt);
        
        successCount++;
      } catch (error) {
        console.error(`[❌ 프롬프트 사전 생성 실패] 에이전트 ${agent.id}:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[✅ 프롬프트 사전 생성 완료] ${successCount}/${agents.length}개 에이전트, ${duration}ms`);
  } catch (error) {
    console.error(`[❌ 프롬프트 사전 생성 실패] 채팅방 ${groupChatId}:`, error);
  }
}

/**
 * 캐시에서 프롬프트 가져오기
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 * @param agentId - 에이전트 ID
 * @returns 캐시된 프롬프트 또는 null
 */
export function getCachedPrompt(
  groupChatId: number,
  userId: string,
  agentId: number
): string | null {
  const cacheKey = getPromptCacheKey(groupChatId, userId, agentId);
  const prompt = promptCache.get(cacheKey);
  
  if (prompt) {
    cacheHits++;
    console.log(`[🎯 캐시 히트] ${cacheKey} (히트율: ${getCacheHitRate()}%)`);
    return prompt;
  } else {
    cacheMisses++;
    console.log(`[❌ 캐시 미스] ${cacheKey}`);
    return null;
  }
}

/**
 * 특정 에이전트의 프롬프트만 재생성
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 * @param agentId - 에이전트 ID
 * @param storage - 스토리지 인스턴스
 */
export async function regeneratePrompt(
  groupChatId: number,
  userId: string,
  agentId: number,
  storage: IStorage
): Promise<void> {
  console.log(`[🔄 프롬프트 재생성] 채팅방 ${groupChatId}, 사용자 ${userId}, 에이전트 ${agentId}`);
  
  try {
    const user = await storage.getUser(userId);
    const agent = await storage.getAgent(agentId);
    
    if (!user || !agent) {
      console.warn(`[⚠️ 프롬프트 재생성] 사용자 또는 에이전트 조회 실패`);
      return;
    }
    
    const settings = await storage.getUserAgentSetting(groupChatId, userId, agentId);
    const relationshipType = settings?.relationshipType || "companion";
    
    const tonePattern = await storage.getRelationshipTone(relationshipType, "default");
    
    // 🔒 Canon Lock 설정 조회 (relationship과 독립적)
    let canonEnabled = false;
    let strictMode: string | null = null;
    let customRule: string | null = null;
    try {
      const canonSettings = await storage.getAgentCanon(agentId);
      strictMode = canonSettings?.strictMode || null;
      customRule = canonSettings?.customRule || null;
      
      // 🎯 Canonical modes: biblical/teacher만 Canon Lock으로 인정
      const canonicalModes = ['biblical', 'teacher'];
      canonEnabled = !!strictMode && canonicalModes.includes(strictMode);
    } catch (error) {
      // Canon Lock 설정이 없으면 기본값 false 사용
    }
    
    const prompt = await buildLoBoPrompt(user, agent, relationshipType, tonePattern, canonEnabled, strictMode, customRule);
    
    const cacheKey = getPromptCacheKey(groupChatId, userId, agentId);
    promptCache.set(cacheKey, prompt);
    
    console.log(`[✅ 프롬프트 재생성 완료] ${cacheKey}`);
  } catch (error) {
    console.error(`[❌ 프롬프트 재생성 실패]:`, error);
  }
}

/**
 * 관계 타입 변경 시 캐시 무효화 및 재생성
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 * @param agentId - 에이전트 ID
 * @param storage - 스토리지 인스턴스
 */
export async function invalidateAndRegenerate(
  groupChatId: number,
  userId: string,
  agentId: number,
  storage: IStorage
): Promise<void> {
  const cacheKey = getPromptCacheKey(groupChatId, userId, agentId);
  
  // 캐시 무효화
  promptCache.delete(cacheKey);
  console.log(`[🗑️ 캐시 무효화] ${cacheKey}`);
  
  // 재생성
  await regeneratePrompt(groupChatId, userId, agentId, storage);
}

/**
 * 특정 사용자의 모든 캐시 삭제 (채팅방 나가기 시)
 * @param groupChatId - 그룹 채팅 ID
 * @param userId - 사용자 ID
 */
export function clearUserCache(groupChatId: number, userId: string): void {
  let deletedCount = 0;
  
  for (const key of promptCache.keys()) {
    if (key.startsWith(`prompt:${groupChatId}:${userId}:`)) {
      promptCache.delete(key);
      deletedCount++;
    }
  }
  
  console.log(`[🗑️ 사용자 캐시 삭제] ${deletedCount}개 항목 삭제`);
}

/**
 * 전체 캐시 삭제 (디버깅용)
 */
export function clearAllCache(): void {
  const size = promptCache.size;
  promptCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  console.log(`[🗑️ 전체 캐시 삭제] ${size}개 항목 삭제`);
}

/**
 * 캐시 히트율 계산
 * @returns 히트율 (퍼센트)
 */
export function getCacheHitRate(): number {
  const total = cacheHits + cacheMisses;
  return total > 0 ? Math.round((cacheHits / total) * 100) : 0;
}

/**
 * 캐시 통계 조회
 * @returns 캐시 통계 객체
 */
export function getCacheStats() {
  return {
    size: promptCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: getCacheHitRate()
  };
}
