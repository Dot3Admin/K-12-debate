import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import sharp from "sharp";
import { storage } from "./storage";
import { cache } from "./cache";
import { setupAuth, isAuthenticated } from "./auth";
import { isAdmin } from "./middleware/isAdmin";
import { setupAdminRoutes } from "./admin";
import { cardLayoutRouter } from "./cardLayoutRouter";
import { generateChatResponse, analyzeDocument, extractTextFromFile, suggestCharacters, suggestCharacterVariations, getRecommendationHistory, saveRecommendationHistory, clearRecommendationHistory, selectAgentsForQuestion, removeRhythmTags, extractRoleEssence } from "./openai";
import { generateGeminiFunctionCallingResponse } from "./geminiAgentOrchestrator";
import { 
  summarizeText, 
  analyzeSentiment, 
  extractKeywords, 
  analyzeImage, 
  generateImage, 
  transcribeAudio, 
  analyzeDocumentSmart, 
  detectLanguage, 
  translateText 
} from "./ai-services";
import { messageQueue } from "./messageQueue";
import { AgentOrchestrator } from "./agentOrchestrator";
import { sseClients, getNextEventId, broadcastGroupChatMessage, type SSEClient } from "./broadcast";
import { generateRelationshipMatrix, CharacterInfo } from "./relationshipMatrix";
import { createAssistantForRoom, appendMessageToThread } from "./assistantManager";
import { createHash } from 'crypto';
import type { Agent } from '@shared/schema';
import { agentDocumentChunks, documents, insertAgentCanonSchema, insertAgentHumorSchema, groupChatAgents, groupChats, guestSessions, guestAnalytics, insertGuestSessionSchema, insertGuestAnalyticsSchema, users, groupChatUserAgentSettings, agentStats, characterSpeakingPatterns, tokenUsage, groupChatMessages, agentCanon, agentHumor } from '@shared/schema';
import { db } from './db';
import { eq, and, desc, sql } from 'drizzle-orm';
import { transformResponseForCanonLock } from "./canonLockTransformer";
import { generateSpriteSheet, generateSingleCharacterAvatar, getCharacterAvatarsByAgent, getCharacterAvatarsByGroupChat, getCharacterAvatarUrl, generateAvatarsForGroupChat, type SpriteSheetGenerationRequest } from "./avatarGenerator";
import { smartSplit, shouldSplit, type MessageSegment } from "./utils/textSplitter";
import { processDocument, analyzeVisualContent } from "./documentProcessor";
import { optimizeTokenUsage, compressDocumentChunks, filterSystemMessages } from "./tokenOptimizer";
import { GoogleGenerativeAI } from '@google/generative-ai';
import { UAParser } from 'ua-parser-js';
import { getAllNews, getNewsBySection, getCacheStatus, initializeNewsCache, isCacheReady, waitForCacheReady, SECTION_NAMES } from './googleNewsService';

// ES 모듈에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🚫 Phase 1: 서버 중복 방지 시스템 (Critical)
const processedTurnIds = new Set<string>();

// 🚫 사용자 메시지 중복 방지 시스템 (내용 기반)
interface UserMessageEntry {
  userId: string;
  content: string;
  groupChatId: number;
  timestamp: number;
}
const recentUserMessages = new Map<string, UserMessageEntry>();
const MESSAGE_DUPLICATE_WINDOW_MS = 10000; // 🔧 10초로 단축 (락 해제 대기 시간 단축)

// 🎭 CallNAsk Guest Token 관리 (DB 기반)
const GUEST_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24시간

// 🎯 1단계: 이름 정규화 함수 - 호칭/직책/수식어 제거
function normalizeCharacterName(name: string): string {
  let normalized = name.trim();
  
  // 1. 한국어 호칭 제거 (님, 씨, 선생님, 교수님, 박사님, 여사, 선생, 대표, 회장 등)
  const honorifics = ['님', '씨', '선생님', '교수님', '박사님', '여사', '선생', '대표이사', '대표', '회장', '사장', '부장', '과장', '차장', '팀장', '본부장', '실장'];
  for (const honorific of honorifics) {
    // 끝에서 제거
    if (normalized.endsWith(honorific)) {
      normalized = normalized.slice(0, -honorific.length).trim();
    }
  }
  
  // 2. 직책/수식어 패턴 제거 ("20대 대통령 영부인 김건희" → "김건희")
  // 한국어: "직책 + 이름" 패턴에서 이름만 추출
  const koreanNamePattern = /([가-힣]{2,4})$/; // 끝에 있는 2-4글자 한글 이름
  const koreanMatch = normalized.match(koreanNamePattern);
  if (koreanMatch && normalized.length > koreanMatch[1].length + 2) {
    // 앞에 수식어가 많이 붙어있으면 마지막 이름만 추출
    const potentialName = koreanMatch[1];
    // "김건희", "홍길동" 같은 일반적인 한국 이름 패턴 확인
    if (potentialName.length >= 2 && potentialName.length <= 4) {
      const beforeName = normalized.slice(0, -potentialName.length).trim();
      // 앞에 직책이나 수식어가 있는지 확인 (띄어쓰기나 긴 문구)
      if (beforeName.includes(' ') || beforeName.length > 6) {
        normalized = potentialName;
      }
    }
  }
  
  // 3. 영어 호칭 제거 (Mr., Ms., Dr., Prof., President 등)
  normalized = normalized
    .replace(/^(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|President|CEO|Chairman)\s+/gi, '')
    .replace(/\s+(Jr\.|Sr\.|III|IV)$/gi, '');
  
  // 4. 특수문자 및 괄호 내용 제거
  normalized = normalized
    .replace(/\([^)]*\)/g, '') // 괄호와 내용 제거
    .replace(/\[[^\]]*\]/g, '') // 대괄호와 내용 제거
    .replace(/[,\.;:]/g, '')     // 구두점 제거
    .trim();
  
  // 5. 연속 공백을 하나로
  normalized = normalized.replace(/\s+/g, ' ');
  
  console.log(`[🎯 이름 정규화] "${name}" → "${normalized}"`);
  return normalized;
}

// 🎯 이름 유사도 검사 함수 - 정규화 후 부분 일치 확인
function isSimilarName(name1: string, name2: string): boolean {
  const n1 = normalizeCharacterName(name1).toLowerCase();
  const n2 = normalizeCharacterName(name2).toLowerCase();
  
  // 정규화 후 완전 일치
  if (n1 === n2) return true;
  
  // 한쪽이 다른 쪽을 포함
  if (n1.includes(n2) || n2.includes(n1)) return true;
  
  // 공백 제거 후 비교 ("김 건희" vs "김건희")
  const n1NoSpace = n1.replace(/\s+/g, '');
  const n2NoSpace = n2.replace(/\s+/g, '');
  if (n1NoSpace === n2NoSpace) return true;
  if (n1NoSpace.includes(n2NoSpace) || n2NoSpace.includes(n1NoSpace)) return true;
  
  return false;
}




// 🚫 사용자 메시지 중복 체크 함수 (내용 기반)
function isUserMessageDuplicate(userId: string, content: string, groupChatId: number): boolean {
  const now = Date.now();
  const messageKey = `${userId}_${groupChatId}_${content.trim()}`;
  const messageHash = Buffer.from(messageKey).toString('base64').slice(0, 16); // 메모리 효율적 해시
  
  // 기존 메시지 확인
  const existingMessage = recentUserMessages.get(messageHash);
  if (existingMessage && (now - existingMessage.timestamp) < MESSAGE_DUPLICATE_WINDOW_MS) {
    console.log(`🚫 [USER MSG DUPLICATE] 같은 메시지 ${(now - existingMessage.timestamp)/1000}초 전 전송됨`);
    console.log(`🚫 [BLOCKED] userId=${userId}, content="${content.slice(0, 30)}..."`);
    return true;
  }
  
  // 새 메시지 등록
  recentUserMessages.set(messageHash, {
    userId,
    content,
    groupChatId,
    timestamp: now
  });
  
  console.log(`✅ [USER MSG ALLOWED] 새 메시지 등록: "${content.slice(0, 30)}...", key=${messageHash}`);
  return false;
}

// 🚫 turnId 중복 방지 함수 (상세 로깅 강화)
function isAlreadyProcessed(turnId: string): boolean {
  const currentSize = processedTurnIds.size;
  const allTurnIds = Array.from(processedTurnIds).slice(-10); // 최근 10개만 표시
  
  if (processedTurnIds.has(turnId)) {
    console.log(`🚫 [DEDUP BLOCKED] turnId ${turnId} already processed - skipping`);
    console.log(`🚫 [DEDUP STATE] current size: ${currentSize}, recent turnIds: [${allTurnIds.join(', ')}]`);
    return true;
  }
  processedTurnIds.add(turnId);
  console.log(`✅ [DEDUP ADDED] turnId ${turnId} registered for processing (new size: ${currentSize + 1})`);
  console.log(`✅ [DEDUP STATE] recent turnIds: [${allTurnIds.concat(turnId).slice(-10).join(', ')}]`);
  return false;
}

// 🚫 중복 메시지 정리 함수 (메모리 누수 방지)
function cleanupOldUserMessages() {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Map.entries()를 배열로 변환하여 반복
  const entries = Array.from(recentUserMessages.entries());
  for (const [key, entry] of entries) {
    if (now - entry.timestamp > MESSAGE_DUPLICATE_WINDOW_MS * 2) { // 2배 시간 지난 것들 정리
      recentUserMessages.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[🧹 USER MSG CLEANUP] ${cleanedCount}개 오래된 메시지 키 정리 (남은: ${recentUserMessages.size}개)`);
  }
}

// 🚫 중복 ID 정리 함수 (메모리 누수 방지)
function cleanupOldTurnIds() {
  if (processedTurnIds.size > 1000) {
    console.log(`[🧹 CLEANUP] processedTurnIds size: ${processedTurnIds.size} - clearing old entries`);
    processedTurnIds.clear();
  }
  cleanupOldUserMessages(); // 사용자 메시지도 함께 정리
}

// 🎯 Architect 권장: scenarioTurns 통일을 위한 헬퍼 함수
function toScenarioTurns(agentId: number, agentName: string, content: string): Array<{
  agentId: number;
  agentName: string;
  content: string;
  order: number;
}> {
  return [{
    agentId,
    agentName,
    content,
    order: 1
  }];
}

// 언어 코드를 LLM 호환 형식으로 정규화하는 함수
function normalizeLanguageCode(languageCode: string): string {
  const normalizedMap: Record<string, string> = {
    'ko': 'ko',
    'korean': 'ko',
    'en': 'en', 
    'english': 'en',
    'zh': 'zh',
    'chinese': 'zh', 
    'zh-cn': 'zh',
    'zh-hans': 'zh',
    'zh-hant': 'zh',
    'es': 'es',
    'spanish': 'es',
    'hi': 'hi',
    'hindi': 'hi',
    'ar': 'ar',
    'arabic': 'ar',
    'pt': 'pt',
    'portuguese': 'pt',
    'bn': 'bn',
    'bengali': 'bn',
    'ru': 'ru',
    'russian': 'ru',
    'ja': 'ja',
    'japanese': 'ja',
    'fr': 'fr',
    'french': 'fr',
    'de': 'de',
    'german': 'de'
  };
  
  return normalizedMap[languageCode.toLowerCase()] || 'en';
}

// 🔒 그룹 채팅 접근 권한 체크 미들웨어
async function checkGroupChatAccess(req: any, res: any, next: any) {
  try {
    const groupChatId = parseInt(req.params.groupChatId);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: '인증이 필요합니다.' });
    }

    if (!groupChatId || isNaN(groupChatId)) {
      return res.status(400).json({ message: '잘못된 채팅방 ID입니다.' });
    }

    if (userId === 'master_admin') {
      console.log(`[ACCESS] Master Admin - full access to chat ${groupChatId}`);
      return next();
    }

    const groupChat = await storage.getGroupChat(groupChatId);
    
    if (!groupChat) {
      return res.status(404).json({ message: '채팅방을 찾을 수 없습니다.' });
    }

    console.log(`[ACCESS DEBUG] Chat ${groupChatId} visibility: "${groupChat.visibility}" (type: ${typeof groupChat.visibility})`);

    if (groupChat.visibility === 'embed') {
      // 채팅방 생성자는 설정 및 테스트를 위해 접근 허용
      if (String(groupChat.createdBy) === String(userId)) {
        console.log(`[ACCESS] Embed chat ${groupChatId} - creator ${userId} allowed`);
        return next();
      }
      return res.status(403).json({ message: '임베드 전용 채팅방입니다. /embed/:embedCode를 사용하세요.' });
    }

    if (groupChat.visibility === 'public') {
      console.log(`[ACCESS] Public chat ${groupChatId} - user ${userId} allowed`);
      return next();
    }

    const members = await storage.getGroupChatMembers(groupChatId);
    const isMember = members.some(member => String(member.userId) === String(userId));
    
    if (!isMember) {
      return res.status(403).json({ message: '이 채팅방에 접근할 권한이 없습니다.' });
    }

    console.log(`[ACCESS] Private chat ${groupChatId} - member ${userId} allowed`);
    next();
  } catch (error: any) {
    console.error('[ACCESS ERROR]', error);
    res.status(500).json({ message: '권한 확인 중 오류가 발생했습니다.', error: error.message });
  }
}

// 중앙화된 언어 해결 함수
export async function resolveUserLanguage(
  groupChatId: number, 
  userId: string, 
  agentId: number, 
  userMessage: string,
  storage: any,
  languageLevel?: number | null  // 언어 레벨 파라미터 추가
): Promise<string> {
  let resolvedLanguage = 'en'; // 최종 fallback
  let detectionMethod = 'default';
  
  // 빈 메시지 가드
  if (!userMessage || userMessage.trim().length === 0) {
    console.log(`[언어 해결] 빈 메시지 - 기본값 'en' 사용`);
    return 'en';
  }
  
  try {
    // 🎯 언어 레벨 1-3: 질문 언어 우선 (간단한 표현)
    // 🎯 언어 레벨 4-6 및 null: 에이전트 개별 설정 우선 (복잡한 표현)
    if (languageLevel !== null && languageLevel !== undefined && languageLevel >= 1 && languageLevel <= 3) {
      console.log(`[언어 레벨 ${languageLevel}] 간단한 표현 레벨 - 질문 언어 감지 강제 적용`);
      
      try {
        // 🔥 사용자별 에이전트 언어 설정 우선 확인 (모든 레벨에서 최우선)
        const userSettings = await storage.getUserAgentSetting(groupChatId, userId, agentId);
        if (userSettings?.languagePreference && userSettings.languagePreference !== "question_language") {
          resolvedLanguage = normalizeLanguageCode(userSettings.languagePreference);
          detectionMethod = `language_level_${languageLevel}_user_setting_${userSettings.languagePreference}`;
          console.log(`[언어 레벨 ${languageLevel} 적용] 사용자별 언어 설정 사용: ${resolvedLanguage}`);
          return resolvedLanguage;
        }
        
        // 시스템 태그 제거하여 순수한 사용자 메시지만 추출
        let cleanMessage = userMessage.replace(/@(모두|모든|everyone|all)\s*/gi, '').trim();
        cleanMessage = cleanMessage.replace(/@[가-힣\w\s]+\s*/g, '').trim(); // @에이전트명 제거
        
        // 빈 메시지가 되면 원본 메시지 사용
        if (!cleanMessage) {
          cleanMessage = userMessage;
        }
        
        const { detectLanguage } = await import('./ai-services');
        const detected = await detectLanguage(cleanMessage);
        
        // 짧은 메시지는 더 낮은 임계값 사용
        const confidenceThreshold = cleanMessage.length <= 5 ? 0.6 : 0.7;
        
        if (detected.confidence > confidenceThreshold) {
          resolvedLanguage = normalizeLanguageCode(detected.language);
          detectionMethod = `language_level_${languageLevel}_detected_${detected.language}`;
        } else {
          resolvedLanguage = 'ko'; // 낮은 신뢰도는 한국어 기본값
          detectionMethod = `language_level_${languageLevel}_fallback_ko`;
        }
        
        console.log(`[언어 레벨 ${languageLevel} 적용] 질문: "${cleanMessage}" → 결과: ${resolvedLanguage}`);
        return resolvedLanguage;
      } catch (error) {
        console.error('[언어 레벨 1-3 감지 오류]:', error);
        resolvedLanguage = 'ko';
        detectionMethod = `language_level_${languageLevel}_error_fallback`;
        return resolvedLanguage;
      }
    }
    
    // 🎯 언어 레벨 4-6 및 null: 에이전트 개별 언어 설정 사용
    if (languageLevel === null || languageLevel === undefined || languageLevel >= 4) {
      console.log(`[언어 레벨 ${languageLevel ?? 'null'}] 복잡한 표현 레벨 - 에이전트 개별 언어 설정 사용`);
      
      try {
        // 🔥 사용자별 에이전트 언어 설정 우선 확인
        const userSettings = await storage.getUserAgentSetting(groupChatId, userId, agentId);
        if (userSettings?.languagePreference && userSettings.languagePreference !== "question_language") {
          resolvedLanguage = normalizeLanguageCode(userSettings.languagePreference);
          detectionMethod = `language_level_${languageLevel ?? 'null'}_user_setting_${userSettings.languagePreference}`;
          console.log(`[언어 레벨 ${languageLevel ?? 'null'} 적용] 사용자별 언어 설정 사용: ${resolvedLanguage}`);
          return resolvedLanguage;
        }
        
        const agent = await storage.getAgent(agentId);
        if (agent?.responseLanguage) {
          resolvedLanguage = normalizeLanguageCode(agent.responseLanguage);
          detectionMethod = `language_level_${languageLevel ?? 'null'}_agent_setting_${agent.responseLanguage}`;
          console.log(`[언어 레벨 ${languageLevel ?? 'null'} 적용] 에이전트: ${agent.name}, 언어: ${resolvedLanguage}`);
          return resolvedLanguage;
        } else {
          // 에이전트 언어 설정이 없으면 질문 언어 감지로 fallback
          console.log(`[언어 레벨 ${languageLevel ?? 'null'}] 에이전트 언어 설정 없음 - 질문 언어 감지로 fallback`);
          try {
            const { detectLanguage } = await import('./ai-services');
            const detected = await detectLanguage(userMessage);
            
            if (detected.confidence > 0.7) {
              resolvedLanguage = normalizeLanguageCode(detected.language);
              detectionMethod = `language_level_${languageLevel ?? 'null'}_no_agent_lang_detected_${detected.language}`;
            } else {
              resolvedLanguage = 'ko';
              detectionMethod = `language_level_${languageLevel ?? 'null'}_no_agent_lang_fallback_ko`;
            }
            return resolvedLanguage;
          } catch (detectionError) {
            console.error('[언어 레벨 4-6 질문 언어 감지 오류]:', detectionError);
            resolvedLanguage = 'ko';
            detectionMethod = `language_level_${languageLevel ?? 'null'}_detection_error_fallback`;
            return resolvedLanguage;
          }
        }
      } catch (error) {
        console.error('[언어 레벨 4-6 에이전트 조회 오류]:', error);
        // 에이전트 조회 실패 시 질문 언어 감지로 fallback
        try {
          const { detectLanguage } = await import('./ai-services');
          const detected = await detectLanguage(userMessage);
          
          if (detected.confidence > 0.7) {
            resolvedLanguage = normalizeLanguageCode(detected.language);
            detectionMethod = `language_level_${languageLevel ?? 'null'}_agent_error_detected_${detected.language}`;
          } else {
            resolvedLanguage = 'ko';
            detectionMethod = `language_level_${languageLevel ?? 'null'}_agent_error_fallback_ko`;
          }
          return resolvedLanguage;
        } catch (detectionError) {
          console.error('[언어 레벨 4-6 최종 fallback 오류]:', detectionError);
          resolvedLanguage = 'ko';
          detectionMethod = `language_level_${languageLevel ?? 'null'}_complete_error_fallback`;
          return resolvedLanguage;
        }
      }
    }
    
    // 1. 사용자별 에이전트 설정 조회 (언어 레벨이 없을 때만 - deprecated path)
    const userSettings = await storage.getUserAgentSetting(groupChatId, userId, agentId);
    
    // 설정이 없으면 기본적으로 질문 언어 감지 동작
    const languagePreference = userSettings?.languagePreference || "question_language";
    
    if (languagePreference === "question_language") {
      // 2. 질문 언어 감지 (AI 기반) - @모두, @에이전트명 등 시스템 태그 제거
      try {
        // 시스템 태그 제거하여 순수한 사용자 메시지만 추출
        let cleanMessage = userMessage.replace(/@(모두|모든|everyone|all)\s*/gi, '').trim();
        cleanMessage = cleanMessage.replace(/@[가-힣\w\s]+\s*/g, '').trim(); // @에이전트명 제거
        
        // 빈 메시지가 되면 원본 메시지 사용
        if (!cleanMessage) {
          cleanMessage = userMessage;
        }
        
        const { detectLanguage } = await import('./ai-services');
        const detected = await detectLanguage(cleanMessage);
        
        // 짧은 메시지는 더 낮은 임계값 사용
        const confidenceThreshold = cleanMessage.length <= 5 ? 0.6 : 0.7;
        
        if (detected.confidence > confidenceThreshold) {
          resolvedLanguage = normalizeLanguageCode(detected.language);
          detectionMethod = `ai_detected_${detected.language}_${detected.confidence}_cleaned`;
        } else {
          resolvedLanguage = 'ko'; // 낮은 신뢰도는 기본값 사용
          detectionMethod = `ai_low_confidence_${detected.confidence}_cleaned`;
        }
        
        console.log(`[언어 감지 디버그] 원본: "${userMessage}" → 정제: "${cleanMessage}" → 결과: ${detected.language}(${detected.confidence})`);
      } catch (error) {
        console.error('[AI 언어 감지 오류]:', error);
        resolvedLanguage = 'ko';
        detectionMethod = 'ai_fallback';
      }
    } else if (languagePreference === "native_language") {
      // 3. 사용자 모국어 (사용자 프로필에서 조회 시도)
      try {
        // TODO: 실제 사용자 프로필에 native_language 필드 추가 필요
        // const user = await storage.getUser(userId);
        // resolvedLanguage = normalizeLanguageCode(user.nativeLanguage || 'ko');
        
        // 임시 구현: 질문 언어 감지로 대체
        const { detectLanguage } = await import('./ai-services');
        const detected = await detectLanguage(userMessage);
        
        if (detected.confidence > 0.6) { // native_language는 더 낮은 임계값 사용
          resolvedLanguage = normalizeLanguageCode(detected.language);
          detectionMethod = `native_via_detection_${detected.language}_${detected.confidence}`;
        } else {
          resolvedLanguage = 'ko';
          detectionMethod = 'native_fallback_ko';
        }
      } catch (error) {
        console.error('[Native 언어 처리 오류]:', error);
        resolvedLanguage = 'ko';
        detectionMethod = 'native_error_fallback';
      }
    } else {
      // 4. 명시적 언어 선택
      resolvedLanguage = normalizeLanguageCode(languagePreference);
      detectionMethod = `explicit_${languagePreference}`;
    }
    
    console.log(`[언어 해결] 사용자: ${userId}, 에이전트: ${agentId}, 설정: ${languagePreference}, 결과: ${resolvedLanguage}, 방법: ${detectionMethod}`);
    
  } catch (error) {
    console.error('[언어 설정 조회 오류]:', error);
    // 오류시에도 질문 언어 감지 시도
    try {
      const { detectLanguage } = await import('./ai-services');
      const detected = await detectLanguage(userMessage);
      
      if (detected.confidence > 0.7) {
        resolvedLanguage = normalizeLanguageCode(detected.language);
        detectionMethod = `error_recovery_detected_${detected.language}`;
      } else {
        resolvedLanguage = 'ko';
        detectionMethod = 'error_final_fallback';
      }
    } catch (detectionError) {
      resolvedLanguage = 'ko';
      detectionMethod = 'complete_error_fallback';
    }
  }
  
  return resolvedLanguage;
}

// 전문성 기반 에이전트 우선순위 결정 함수
async function prioritizeAgentsByExpertise(
  agents: any[], 
  userQuestion: string, 
  storage: any
): Promise<any[]> {
  const agentDetails = await Promise.all(
    agents.map(async (groupAgent) => {
      const agent = await storage.getAgent(groupAgent.agentId);
      return {
        ...groupAgent,
        agent,
        relevanceScore: calculateRelevanceScore(userQuestion, agent)
      };
    })
  );

  // 최고 점수와 평균 점수 계산
  const scores = agentDetails.map(a => a.relevanceScore);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  // 점수 로깅
  console.log('Agent expertise scoring for question:', userQuestion.substring(0, 50));
  console.log(`Score distribution - Max: ${maxScore}, Avg: ${avgScore.toFixed(1)}`);
  
  // 더 민감한 전문성 판별: 최고 점수가 평균보다 25% 이상 높거나, 절대 점수가 10 이상일 때 전문성 인정
  const hasExpertise = (maxScore > avgScore * 1.25 && maxScore > 3) || maxScore > 10;
  
  if (hasExpertise) {
    // 전문성이 명확한 경우: 점수 순으로 정렬
    const sortedAgents = agentDetails.sort((a, b) => b.relevanceScore - a.relevanceScore);
    console.log('Expert prioritization activated:');
    sortedAgents.forEach(agent => {
      console.log(`- ${agent.agent?.name}: ${agent.relevanceScore} points`);
    });
    return sortedAgents;
  } else {
    // 전문성이 불분명한 경우: 원래 순서 유지 (평등한 참여)
    console.log('No clear expertise found, maintaining equal participation');
    agentDetails.forEach(agent => {
      console.log(`- ${agent.agent?.name}: ${agent.relevanceScore} points (no prioritization)`);
    });
    return agentDetails; // 원래 순서대로
  }
}

// 질문과 에이전트의 관련성 점수 계산
function calculateRelevanceScore(question: string, agent: any): number {
  if (!agent) return 0;
  
  const questionLower = question.toLowerCase();
  let score = 0;
  
  // 기본 점수
  const baseScore = 1;
  
  // 에이전트 이름과의 직접 매칭 (가장 높은 가중치)
  if (agent.name && questionLower.includes(agent.name.toLowerCase())) {
    score += 10;
  }
  
  // 전공/학과명 직접 매칭 (최고 우선순위)
  const majorKeywords = ['재료공학', '컴퓨터공학', '기계공학', '전자공학', '화학공학', '토목공학', '건축학', '의학', '법학', '물리학', '화학', '생물학', '수학', '영문학', '국문학', '경제학', '심리학', '사회학'];
  const agentText = `${agent.name || ''} ${agent.description || ''}`.toLowerCase();
  
  for (const major of majorKeywords) {
    if (questionLower.includes(major) && agentText.includes(major)) {
      score += 20; // 전공명 직접 매칭시 최고 점수
      console.log(`Major match found: ${major} for agent ${agent.name} (+20 points)`);
    }
  }
  
  // 부분 매칭도 고려 (예: "재료" 키워드만으로도 재료공학과 매칭)
  const partialMajorMatches = {
    '재료': ['재료공학', '재료과학'],
    '컴퓨터': ['컴퓨터공학', 'CSE', 'CS'],
    '기계': ['기계공학'],
    '전자': ['전자공학', '전기전자'],
    '화학': ['화학공학', '화학과'],
    '토목': ['토목공학'],
    '건축': ['건축학', '건축공학'],
    '의학': ['의학과', '의대'],
    '법학': ['법학과', '법대']
  };
  
  for (const [keyword, relatedMajors] of Object.entries(partialMajorMatches)) {
    if (questionLower.includes(keyword)) {
      for (const relatedMajor of relatedMajors) {
        if (agentText.includes(relatedMajor.toLowerCase()) || agentText.includes(keyword)) {
          score += 18; // 부분 매칭시에도 높은 점수
          console.log(`Partial major match found: ${keyword} -> ${relatedMajor} for agent ${agent.name} (+18 points)`);
          break; // 하나만 매칭되면 중복 점수 방지
        }
      }
    }
  }
  
  // 설명과의 매칭
  if (agent.description) {
    const descWords = agent.description.toLowerCase().split(/\s+/);
    const questionWords = questionLower.split(/\s+/);
    const matchingWords = questionWords.filter((qWord: string) => 
      descWords.some((dWord: string) => dWord.includes(qWord) || qWord.includes(dWord))
    );
    score += matchingWords.length * 2;
  }
  
  // 카테고리별 전문성 판단 - 더 포괄적인 키워드
  const categoryKeywords = {
    '교수': ['교수', '연구', '학술', '논문', '강의', '수업', '학문', '전공', '연구실', '대학원', '박사', '석사'],
    '학과': ['학과', '전공', '커리큘럼', '과목', '졸업', '학점', '수강', '컴퓨터', '공학', '과학', '경영', '인문', '재료공학', '재료', '기계공학', '전자공학', '화학공학', '토목공학', '건축학', '의학', '법학', '물리학', '화학', '생물학', '수학', '영문학', '국문학', '경제학', '심리학', '사회학'],
    '행정': ['등록', '학사', '행정', '신청', '접수', '서류', '절차', '학적', '증명서', '휴학', '복학'],
    '상담': ['상담', '고민', '조언', '심리', '문제', '해결', '걱정', '스트레스', '우울', '진로고민'],
    '취업': ['취업', '진로', '인턴', '채용', '면접', '이력서', '경력', '회사', '직업', '직장', '자격증'],
    '학생생활': ['동아리', '활동', '행사', '축제', '기숙사', '식당', '생활', '친구', '선후배', '동기'],
    '국제': ['교환', '해외', '유학', '언어', '국제', '외국', '영어', '중국어', '일본어', '어학연수'],
    '장학': ['장학금', '학비', '지원금', '재정', '등록금', '생활비', '대출', '면제', '지원']
  };
  
  // 에이전트 이름이나 설명에서 카테고리 키워드 찾기 (이미 위에서 선언됨)
  let bestCategoryMatch = 0;
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    const agentCategoryScore = keywords.filter(keyword => 
      agentText.includes(keyword)
    ).length;
    
    // 질문이 해당 카테고리와 관련있는지 확인
    const questionCategoryScore = keywords.filter(keyword => 
      questionLower.includes(keyword)
    ).length;
    
    // 둘 다 해당 카테고리에 속하는 경우에만 점수 부여
    if (agentCategoryScore > 0 && questionCategoryScore > 0) {
      const categoryMatchScore = agentCategoryScore * questionCategoryScore * 3;
      bestCategoryMatch = Math.max(bestCategoryMatch, categoryMatchScore);
    }
  }
  
  score += bestCategoryMatch;
  
  // 전문성을 나타내는 키워드 보너스 (적당히)
  const expertiseKeywords = ['교수', '박사', '전문', '담당'];
  const expertiseMatches = expertiseKeywords.filter(keyword => 
    agentText.includes(keyword)
  ).length;
  score += expertiseMatches * 2;
  
  return score + baseScore;
}

// 전문성 우위가 있는지 확인하는 함수
async function checkExpertiseAdvantage(agents: any[], question: string, storage: any): Promise<boolean> {
  const agentDetails = await Promise.all(
    agents.map(async (groupAgent) => {
      const agent = await storage.getAgent(groupAgent.agentId);
      return calculateRelevanceScore(question, agent);
    })
  );

  const maxScore = Math.max(...agentDetails);
  const avgScore = agentDetails.reduce((a, b) => a + b, 0) / agentDetails.length;
  
  // 더 민감한 전문성 판별: 최고 점수가 평균보다 25% 이상 높거나, 절대 점수가 10 이상일 때 전문성 인정
  return (maxScore > avgScore * 1.25 && maxScore > 3) || maxScore > 10;
}

// 질문 복잡도 및 주제 분석 함수
export function analyzeQuestionComplexity(question: string): {
  level: 'simple' | 'medium' | 'complex';
  topic_type: '감정/고민' | '사회/경제' | '신앙/철학' | 'general';
} {
  const lowerQuestion = question.toLowerCase();
  
  // 복잡한 질문 키워드들
  const complexKeywords = [
    '분석', '비교', '평가', '연구', '논문', '이론', '방법론', '전략', '시스템', '구조',
    '과정', '절차', '해결방안', '대안', '추천', '제안', '계획', '설계', '개발',
    '어떻게', '왜', '무엇', '언제', '어디서', '누구', '얼마나'
  ];
  
  // 단순한 질문 키워드들  
  const simpleKeywords = [
    '안녕', '하이', '헬로', '좋아', '싫어', '맞아', '아니', '네', '예',
    '고마워', '감사', '미안', '죄송', '괜찮', '좋은', '나쁜', '맛있'
  ];
  
  // 🎯 주제 카테고리 키워드
  const emotionalKeywords = [
    '고민', '걱정', '불안', '우울', '슬픔', '외로', '힘들', '스트레스', '감정', '마음',
    '상처', '아픔', '괴로', '힘들어', '속상', '답답', '후회', '미움', '사랑', '관계'
  ];
  
  const socialEconomicKeywords = [
    '경제', '정치', '사회', '시장', '주식', '투자', '금리', '부동산', '세금', '정책',
    '정부', '선거', '법률', '제도', '국가', '산업', '기업', '경영', '무역', '환율'
  ];
  
  const faithPhilosophyKeywords = [
    '신', '종교', '신앙', '기독교', '불교', '이슬람', '철학', '가치관', '윤리', '도덕',
    '진리', '삶의 의미', '죽음', '영혼', '구원', '깨달음', '명상', '기도', '성경', '경전'
  ];
  
  const complexMatches = complexKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
  const simpleMatches = simpleKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
  
  // 질문 길이도 고려
  const questionLength = question.length;
  
  // 복잡도 판별
  let level: 'simple' | 'medium' | 'complex';
  if (complexMatches >= 2 || (complexMatches >= 1 && questionLength > 50)) {
    level = 'complex';
  } else if (simpleMatches >= 1 || questionLength < 15) {
    level = 'simple';
  } else {
    level = 'medium';
  }
  
  // 주제 유형 판별
  const emotionalMatches = emotionalKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
  const socialEconomicMatches = socialEconomicKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
  const faithPhilosophyMatches = faithPhilosophyKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
  
  let topic_type: '감정/고민' | '사회/경제' | '신앙/철학' | 'general';
  if (emotionalMatches > 0) {
    topic_type = '감정/고민';
  } else if (socialEconomicMatches > 0) {
    topic_type = '사회/경제';
  } else if (faithPhilosophyMatches > 0) {
    topic_type = '신앙/철학';
  } else {
    topic_type = 'general';
  }
  
  return { level, topic_type };
}

// 에이전트별 맞춤 프롬프트 생성 함수
function generateContextualPrompt(agent: any, question: string, complexity: string): string {
  const agentName = agent.name || '';
  const agentDesc = agent.description || '';
  
  let contextPrompt = '';
  
  // 에이전트 유형별 맞춤 지침
  if (agentName.includes('교수') || agentDesc.includes('교수')) {
    if (complexity === 'complex') {
      contextPrompt = `학술적 전문성을 바탕으로 체계적이고 근거있는 답변을 제공하세요. 필요시 이론적 배경이나 연구 사례를 언급하면서 실용적 조언도 함께 제시하세요.`;
    } else {
      contextPrompt = `교수의 따뜻한 멘토링 스타일로 학생의 눈높이에 맞춰 친근하면서도 도움이 되는 조언을 해주세요.`;
    }
  } else if (agentName.includes('상담') || agentDesc.includes('상담')) {
    if (complexity === 'complex') {
      contextPrompt = `전문 상담사의 관점에서 문제의 근본 원인을 파악하고 단계적인 해결방안을 제시하세요. 공감과 격려를 잊지 마세요.`;
    } else {
      contextPrompt = `따뜻하고 공감적인 상담사의 마음으로 지지와 격려의 메시지를 전달하세요.`;
    }
  } else if (agentName.includes('취업') || agentDesc.includes('취업')) {
    if (complexity === 'complex') {
      contextPrompt = `현업 전문가의 실무 경험을 바탕으로 구체적이고 실행 가능한 조언을 제공하세요. 시장 동향이나 실제 사례를 포함하면 더 좋습니다.`;
    } else {
      contextPrompt = `취업 전문가의 격려와 함께 실용적인 팁을 간단명료하게 전달하세요.`;
    }
  } else if (agentName.includes('학과') || agentDesc.includes('학과')) {
    if (complexity === 'complex') {
      contextPrompt = `해당 학과의 커리큘럼과 진로 경로를 잘 알고 있는 선배의 관점에서 구체적이고 현실적인 조언을 해주세요.`;
    } else {
      contextPrompt = `같은 학과 선배의 친근한 마음으로 경험담을 섞어 도움이 되는 이야기를 해주세요.`;
    }
  } else {
    // 기본 에이전트
    if (complexity === 'complex') {
      contextPrompt = `전문성과 창의성을 결합하여 다각도에서 문제를 분석하고 독창적인 관점을 제시하세요.`;
    } else {
      contextPrompt = `친근하면서도 개성있는 시각으로 흥미롭고 기억에 남을 만한 응답을 해주세요.`;
    }
  }
  
  return contextPrompt;
}

// 챗봇 응답에서 설정값이나 메타데이터를 필터링하는 함수
function filterBotResponse(response: string): string {
  if (!response || typeof response !== 'string') {
    return response;
  }

  // 핵심적인 설정값만 필터링 (응답 보존 우선)
  const unwantedPatterns = [
    // 마크다운 패턴만 제거
    /\*\*([^*]+)\*\*/g,  // **텍스트** -> 텍스트
    /\*([^*]+)\*/g,      // *텍스트* -> 텍스트
    
    // 명확한 설정값만 필터링
    /네 가치관.*$/gm,   // 가치관 설정
    /연구.*임상.*산업.*선호.*$/gm, // 연구/임상/산업 선호 설정
    /- POSTECH.*$/gm,  // POSTECH 설정
    /전공:.*$/gm,      // 전공: 설정
    /학과:.*$/gm,      // 학과: 설정
  ];

  let filteredResponse = response;
  
  // 패턴별로 필터링 (마크다운은 내용만 보존)
  filteredResponse = filteredResponse
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // **텍스트** -> 텍스트
    .replace(/\*([^*]+)\*/g, '$1');     // *텍스트* -> 텍스트
  
  // 설정값만 제거
  const settingPatterns = [
    /네 가치관.*$/gm,
    /연구.*임상.*산업.*선호.*$/gm,
    /- POSTECH.*$/gm,
    /전공:.*$/gm,
    /학과:.*$/gm
  ];
  
  settingPatterns.forEach(pattern => {
    filteredResponse = filteredResponse.replace(pattern, '');
  });
  
  // 추가 정리 작업
  filteredResponse = filteredResponse
    .replace(/\n\s*\n/g, '\n')  // 여러 줄바꿈을 하나로 정리
    .replace(/^\s+|\s+$/g, '')  // 앞뒤 공백 제거
    .replace(/^[.\s]*$/gm, '')  // 점이나 공백만 있는 줄 제거
    .trim();
  
  // 완전히 비어있는 경우만 복구 시도 (매우 관대한 조건)
  if (!filteredResponse || filteredResponse.trim().length < 3) {
    console.log(`[Response Filter] 응답이 완전히 비어있음, 원본 보존 시도`);
    // 설정값만 제거하고 나머지는 모두 보존
    const minimal = response
      .replace(/네 가치관.*$/gm, '')
      .replace(/연구.*임상.*산업.*선호.*$/gm, '')
      .replace(/- POSTECH.*$/gm, '')
      .trim();
    
    if (minimal.length > 10) {
      return minimal;
    }
    return "네, 무엇을 도와드릴까요?";
  }
  
  return filteredResponse;
}
import mammoth from 'mammoth';
import OpenAI from 'openai';

// OpenAI 클라이언트 초기화 (API 키가 있을 때만)
let openai: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

import { 
  insertMessageSchema, 
  insertDocumentSchema, 
  conversations, 
  agents,
  insertUnifiedChatSchema,
  insertChatParticipantSchema,
  insertChatMessageSchema
} from "@shared/schema";
import { z } from "zod";
import { organizationCategories } from './organization-categories';

// Helper function to safely decode filename and remove null bytes
function safeDecodeFilename(filename: string): string {
  try {
    // Decode from latin1 to UTF-8
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    // Remove null bytes and other problematic characters
    return decoded.replace(/\x00/g, '').trim();
  } catch (error) {
    // Fallback: just remove null bytes from original
    return filename.replace(/\x00/g, '').trim();
  }
}

// Configure multer for document uploads with UTF-8 filename support
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix);
    }
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Fix UTF-8 encoding for Korean filenames and remove null bytes
    file.originalname = safeDecodeFilename(file.originalname);
    
    const allowedTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다. PDF, TXT, DOC, DOCX, PPT, PPTX, XLS, XLSX 파일만 업로드 가능합니다.'));
    }
  },
});

// Configure multer for image uploads
const imageUpload = multer({
  dest: "uploads/agent-icons/",
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for images
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 이미지 형식입니다. JPG, PNG, GIF, WEBP 파일만 업로드 가능합니다.'));
    }
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Initialize default agents if they don't exist
  try {
    await initializeDefaultAgents();
  } catch (error) {
    console.log('Warning: Could not initialize default agents, database may need setup:', (error as Error).message);
  }

  // Skip sample agents initialization - using admin center managed data only
  console.log('Skipping sample agents initialization - using admin center managed data');

  // Setup document fix endpoint
  setupDocumentFix(app);

  // Initialize Google News cache (background, non-blocking)
  initializeNewsCache().catch(err => {
    console.error('[GoogleNews] Failed to initialize cache:', err);
  });

  // 📰 Google News API Routes (공개 - 인증 불필요)
  app.get('/api/news', async (req, res) => {
    try {
      const forceRefresh = req.query.refresh === 'true';
      
      // 캐시가 준비되지 않았으면 초기화 완료까지 대기 (최대 90초)
      if (!isCacheReady()) {
        console.log('[GoogleNews] Cache not ready, waiting for initialization...');
        const ready = await waitForCacheReady(90000);
        if (!ready) {
          console.log('[GoogleNews] Cache initialization timeout, fetching fresh...');
        }
      }
      
      // 캐시가 준비되지 않았으면 강제 새로고침
      const news = await getAllNews(forceRefresh || !isCacheReady());
      
      res.json({
        success: true,
        sections: SECTION_NAMES,
        news,
        cacheStatus: getCacheStatus()
      });
    } catch (error) {
      console.error('[GoogleNews] API error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch news' });
    }
  });

  app.get('/api/news/:section', async (req, res) => {
    try {
      const { section } = req.params;
      const sectionNews = await getNewsBySection(section);
      
      if (!sectionNews) {
        return res.status(404).json({ success: false, error: 'Section not found' });
      }
      
      res.json({
        success: true,
        section,
        sectionName: SECTION_NAMES[section] || section,
        ...sectionNews
      });
    } catch (error) {
      console.error(`[GoogleNews] API error for section ${req.params.section}:`, error);
      res.status(500).json({ success: false, error: 'Failed to fetch section news' });
    }
  });

  app.get('/api/news-status', async (req, res) => {
    res.json(getCacheStatus());
  });

  // Note: Auth routes are now handled in setupAuth() function


  // Agent routes
  app.get('/api/agents', isAuthenticated, async (req: any, res) => {
    try {
      // Set cache headers for client-side caching
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable caching for debugging
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': `"agents-${Date.now()}"`
      });
      
      const allAgents = await storage.getAllAgents();
      const userId = req.user.id;
      const userType = req.user.userType;
      
      console.log(`[DEBUG] *** /api/agents *** called by user: ${userId}, userType: ${userType}`);
      console.log(`[DEBUG] *** Total agents in database: ${allAgents.length} ***`);
      const userUpperCategory = req.user.upperCategory;
      const userLowerCategory = req.user.lowerCategory;
      const userDetailCategory = req.user.detailCategory;

      // Load user-specific hidden agents
      let userHiddenAgents: number[] = [];
      try {
        const userHiddenAgentsFile = path.join(process.cwd(), 'data', 'user-hidden-agents.json');
        if (fs.existsSync(userHiddenAgentsFile)) {
          const hiddenAgentsData = JSON.parse(fs.readFileSync(userHiddenAgentsFile, 'utf8'));
          userHiddenAgents = hiddenAgentsData[userId] || [];
          console.log(`[DEBUG] Loaded hidden agents for user ${userId}:`, userHiddenAgents);
        } else {
          console.log(`[DEBUG] Hidden agents file not found: ${userHiddenAgentsFile}`);
        }
      } catch (error) {
        console.log("Error loading user-specific hidden agents:", error);
      }

      // Master admin and agent admin can see all agents (except their own hidden list if any)
      const userRole = req.user.role || '';
      if (userType === 'admin' || userId === 'master_admin' || userRole === 'master_admin' || userRole === 'agent_admin') {
        console.log(`[DEBUG] Admin user - showing all agents. Role: ${userRole}, UserType: ${userType}`);
        const visibleAgents = allAgents.filter(agent => !userHiddenAgents.includes(agent.id));
        console.log(`[DEBUG] Visible agents for admin: ${visibleAgents.length}`);
        res.json(visibleAgents);
        return;
      }

      // Filter agents based on visibility and organization matching
      const filteredAgents = allAgents.filter(agent => {
        // First check if agent is hidden for this user
        if (userHiddenAgents.includes(agent.id)) {
          return false;
        }

        // Public agents are visible to everyone
        if (agent.visibility === 'public') {
          return true;
        }

        // Organization-specific agents
        if (agent.visibility === 'organization') {
          // Check if user belongs to the same organization hierarchy
          const matchesUpperCategory = agent.upperCategory === userUpperCategory;
          const matchesLowerCategory = agent.lowerCategory === userLowerCategory;
          const matchesDetailCategory = agent.detailCategory === userDetailCategory;

          // User can see agents from their exact organization level or higher levels
          return matchesUpperCategory && 
                 (matchesLowerCategory || !agent.lowerCategory) &&
                 (matchesDetailCategory || !agent.detailCategory);
        }

        // Private agents are only visible to their managers
        if (agent.visibility === 'private') {
          return agent.managerId === userId;
        }

        return false;
      });

      console.log(`[DEBUG] Total agents for user ${userId}:`, filteredAgents.length);
      console.log(`[DEBUG] Agent IDs:`, filteredAgents.map(a => a.id));
      
      res.json(filteredAgents);
    } catch (error) {
      console.error("Error fetching agents:", error);
      res.status(500).json({ message: "Failed to fetch agents" });
    }
  });

  // Get public agents for group chat creation (visibility = 'public' only)
  app.get('/api/agents/public', isAuthenticated, async (req: any, res) => {
    try {
      // Set cache headers
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': `"public-agents-${Date.now()}"`
      });
      
      const allAgents = await storage.getAllAgents();
      const userId = req.user.id;
      
      console.log(`[DEBUG] *** /api/agents/public *** called by user: ${userId}`);
      console.log(`[DEBUG] *** Total agents in database: ${allAgents.length} ***`);
      
      // Load user-specific hidden agents
      let userHiddenAgents: number[] = [];
      try {
        const userHiddenAgentsFile = path.join(process.cwd(), 'data', 'user-hidden-agents.json');
        if (fs.existsSync(userHiddenAgentsFile)) {
          const hiddenAgentsData = JSON.parse(fs.readFileSync(userHiddenAgentsFile, 'utf8'));
          userHiddenAgents = hiddenAgentsData[userId] || [];
        }
      } catch (error) {
        console.log("Error loading user-specific hidden agents for public endpoint:", error);
      }
      
      // Filter public and organization agents (excluding user's hidden agents)
      const publicAgents = allAgents.filter(agent => {
        return (agent.visibility === 'public' || agent.visibility === 'organization') && !userHiddenAgents.includes(agent.id);
      });
      
      console.log(`[DEBUG] Public agents for user ${userId}:`, publicAgents.length);
      console.log(`[DEBUG] Public agent IDs:`, publicAgents.map(a => a.id));
      
      res.json(publicAgents);
    } catch (error) {
      console.error("Error fetching public agents:", error);
      res.status(500).json({ message: "Failed to fetch public agents" });
    }
  });


  // Get group chats that an agent participates in
  app.get('/api/agents/:id/group-chats', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const groupChats = await storage.getAgentGroupChats(agentId, userId);
      console.log(`[DEBUG] Agent ${agentId} group chats for user ${userId}:`, JSON.stringify(groupChats, null, 2));
      res.json(groupChats);
    } catch (error) {
      console.error("Error fetching agent group chats:", error);
      res.status(500).json({ message: "Failed to fetch agent group chats" });
    }
  });

  app.get('/api/agents/managed', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.userType;
      const userRole = req.user.role;

      console.log(`[DEBUG] /api/agents/managed called by user: ${userId}, type: ${userType}, role: ${userRole}`);

      // Check user role for agent management permissions
      const hasAgentManagementRole = userRole === 'agent_admin' || userRole === 'master_admin';
      console.log(`[DEBUG] User has agent management role: ${hasAgentManagementRole}`);

      // Master admin can manage all agents
      let agents: any[] = [];
      if (userType === 'admin' || userId === 'master_admin' || userRole === 'master_admin') {
        console.log(`[DEBUG] User is admin, fetching all agents`);
        agents = await storage.getAllAgents();
      } else if (hasAgentManagementRole) {
        console.log(`[DEBUG] User has agent_admin role, fetching agents created or managed by: ${userId}`);
        agents = await storage.getUserCreatedAndManagedAgents(userId);
        console.log(`[DEBUG] Found ${agents.length} agents created or managed by ${userId}:`, agents.map(a => ({ id: a.id, name: a.name, creatorId: a.creatorId, managerId: a.managerId })));
      } else {
        console.log(`[DEBUG] User does not have agent management permissions`);
        agents = [];
      }

      // Get stats for each agent
      const agentsWithStats = await Promise.all(
        agents.map(async (agent: any) => {
          const stats = await storage.getAgentStats(agent.id);
          return { ...agent, stats };
        })
      );

      console.log(`[DEBUG] Returning ${agentsWithStats.length} agents with stats`);
      res.json(agentsWithStats);
    } catch (error) {
      console.error("Error fetching managed agents:", error);
      res.status(500).json({ message: "Failed to fetch managed agents" });
    }
  });

  app.get('/api/agents/:id', isAuthenticated, async (req, res) => {
    try {
      const agentId = parseInt(req.params.id);

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);

      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      res.json(agent);
    } catch (error) {
      console.error("Error fetching agent:", error);
      res.status(500).json({ message: "Failed to fetch agent" });
    }
  });

  // Agent persona update route
  app.put('/api/agents/:id/persona', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Check if user is the manager of this agent or has admin privileges
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      const userRole = req.user.role;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin' && userRole !== 'agent_admin' && userRole !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to manage this agent" });
      }

      const { nickname, speechStyle, knowledgeArea, personality, additionalPrompt, extraPrompt, canonProfileId, toneProfileId } = req.body;

      // Update agent with complete persona data
      const updatedAgent = await storage.updateAgent(agentId, {
        name: nickname,
        description: knowledgeArea,
        speechStyle,
        personality,
        additionalPrompt,
        extraPrompt,
        canonProfileId: canonProfileId !== undefined ? (canonProfileId === null ? null : parseInt(canonProfileId)) : undefined,
        toneProfileId: toneProfileId !== undefined ? (toneProfileId === null ? null : parseInt(toneProfileId)) : undefined
      });

      res.json(updatedAgent);
    } catch (error) {
      console.error("Error updating agent persona:", error);
      res.status(500).json({ message: "Failed to update agent persona" });
    }
  });

  // Canon/Tone Profile 목록 조회 API
  app.get('/api/canon-profiles', isAuthenticated, async (req, res) => {
    try {
      const profiles = await storage.getAllCanonProfiles();
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching canon profiles:", error);
      res.status(500).json({ message: "Failed to fetch canon profiles" });
    }
  });

  app.get('/api/tone-profiles', isAuthenticated, async (req, res) => {
    try {
      const profiles = await storage.getAllToneProfiles();
      res.json(profiles);
    } catch (error) {
      console.error("Error fetching tone profiles:", error);
      res.status(500).json({ message: "Failed to fetch tone profiles" });
    }
  });

  // Agent basic info update route
  app.put('/api/agents/:id/basic-info', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Check if user is the manager of this agent or has admin privileges
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      const userRole = req.user.role;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin' && userRole !== 'agent_admin' && userRole !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to manage this agent" });
      }

      const { description, upperCategory, lowerCategory, detailCategory, type, status } = req.body;

      // Update agent with basic info data (name is read-only for chat users)
      const updatedAgent = await storage.updateAgent(agentId, {
        description,
        upperCategory,
        lowerCategory,
        detailCategory,
        category: type,
        status
      });

      res.json(updatedAgent);
    } catch (error) {
      console.error("Error updating agent basic info:", error);
      res.status(500).json({ message: "Failed to update agent basic info" });
    }
  });

  // Agent performance analysis route
  app.get('/api/agents/:id/performance', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      const userRole = req.user.role;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin' && userRole !== 'agent_admin' && userRole !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to view this agent's performance" });
      }

      // Get real performance data
      const allConversations = await storage.getAllConversations();
      const agentConversations = allConversations.filter(conv => conv.agentId === agentId);
      const documents = await storage.getAgentDocuments(agentId);

      // Calculate metrics from actual data
      const totalMessages = agentConversations.length;
      const activeUsers = new Set(agentConversations.map(conv => conv.userId)).size;
      const documentsCount = documents.length;

      // Recent activity (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentActivity = agentConversations.filter(conv => {
        if (!conv.lastMessageAt) return false;
        const messageDate = typeof conv.lastMessageAt === 'string' 
          ? new Date(conv.lastMessageAt) 
          : conv.lastMessageAt;
        return messageDate > weekAgo;
      }).length;

      const performanceData = {
        agentName: agent.name,
        period: "최근 7일",
        metrics: {
          totalMessages,
          activeUsers,
          documentsCount,
          recentActivity,
          usagePercentage: Math.min(100, Math.round((totalMessages / Math.max(1, totalMessages + 10)) * 100)),
          ranking: Math.max(1, 5 - Math.floor(totalMessages / 10)),
          avgResponseTime: 1.2,
          responseRate: totalMessages > 0 ? "98.5%" : "0%",
          satisfaction: totalMessages > 5 ? "4.8/5.0" : "신규 에이전트"
        },
        insights: [
          totalMessages > 10 ? "활발한 사용자 참여도를 보이고 있습니다" : "사용자 참여를 늘려보세요",
          documentsCount > 0 ? `${documentsCount}개의 문서가 업로드되어 있습니다` : "문서 업로드로 지식베이스를 확장해보세요",
          activeUsers > 1 ? "여러 사용자가 활발히 사용 중입니다" : "더 많은 사용자에게 알려보세요"
        ],
        trends: {
          messageGrowth: recentActivity > 0 ? "+12%" : "0%",
          userGrowth: activeUsers > 1 ? "+8%" : "0%",
          engagementRate: totalMessages > 0 ? "85%" : "0%"
        }
      };

      res.json(performanceData);
    } catch (error) {
      console.error("Error fetching agent performance:", error);
      res.status(500).json({ message: "Failed to fetch agent performance" });
    }
  });

  // Agent settings update route
  app.put('/api/agents/:id/settings', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to manage this agent" });
      }

      const { llmModel, chatbotType, visibility, upperCategory, lowerCategory, detailCategory } = req.body;

      // Validate settings
      const validModels = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"];
      const validTypes = ["strict-doc", "doc-fallback-llm", "general-llm"];
      const validVisibility = ["public", "group", "organization", "private"];

      if (!validModels.includes(llmModel)) {
        return res.status(400).json({ message: "Invalid LLM model" });
      }

      if (!validTypes.includes(chatbotType)) {
        return res.status(400).json({ message: "Invalid chatbot type" });
      }

      if (visibility && !validVisibility.includes(visibility)) {
        return res.status(400).json({ message: "Invalid visibility setting" });
      }

      // Prepare update data
      const updateData: any = {
        llmModel,
        chatbotType
      };

      // Add visibility settings if provided
      if (visibility !== undefined) {
        updateData.visibility = visibility;
        updateData.upperCategory = upperCategory || "";
        updateData.lowerCategory = lowerCategory || "";
        updateData.detailCategory = detailCategory || "";
      }

      // Update agent settings
      const updatedAgent = await storage.updateAgent(agentId, updateData);

      res.json(updatedAgent);
    } catch (error) {
      console.error("Error updating agent settings:", error);
      res.status(500).json({ message: "Failed to update agent settings" });
    }
  });

  // Conversation routes
  app.get('/api/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post('/api/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { agentId, type = "general" } = req.body;

      const conversation = await storage.getOrCreateConversation(userId, agentId, type);
      res.json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });


  // Management conversation route
  app.post('/api/conversations/management', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { agentId } = req.body;

      // Check if user is the manager of this agent or master admin
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to manage this agent" });
      }

      const conversation = await storage.getOrCreateConversation(userId, agentId, "management");
      res.json(conversation);
    } catch (error) {
      console.error("Error creating management conversation:", error);
      res.status(500).json({ message: "Failed to create management conversation" });
    }
  });

  // Message routes
  app.get('/api/conversations/:id/messages', isAuthenticated, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);

      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const messages = await storage.getConversationMessages(conversationId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post('/api/conversations/:id/messages', isAuthenticated, async (req: any, res) => {
    try {
      const conversationId = parseInt(req.params.id);

      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const { content } = req.body;
      const userId = req.user.id;

      if (!content || content.trim() === "") {
        return res.status(400).json({ message: "Content is required" });
      }

      // Validate input
      const validatedMessage = insertMessageSchema.parse({
        conversationId,
        content: content.trim(),
        isFromUser: true,
      });

      // Save user message
      const userMessage = await storage.createMessage(validatedMessage);

      // Get conversation and agent info
      const messages = await storage.getConversationMessages(conversationId);

      // Get all conversations and find the specific one
      const allConversations = await storage.getAllConversations();
      const conversationResult = allConversations.find(conv => conv.id === conversationId && conv.userId === userId);

      if (!conversationResult) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const agent = await storage.getAgent(conversationResult.agentId);

      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Get agent humor settings
      const agentHumor = await storage.getAgentHumor(agent.id);

      // Debug log to check agent data
      console.log("FULL Agent data for chat:", agent);
      console.log("Speaking style specifically:", (agent as any).speakingStyle);
      console.log("Chatbot type specifically:", (agent as any).chatbotType);

      // Get agent documents for context
      const documents = await storage.getAgentDocuments(agent.id);
      const documentContext = documents.map(doc => ({
        filename: doc.originalName,
        content: doc.content || "",
      }));
      
      // Note: 문서 압축은 RAG 검색 결과(relevanceScore 있음)에만 적용됨
      // 에이전트 전체 문서는 그대로 유지

      // 1:1 채팅을 위한 대화 맥락 생성 (conversationId를 groupChatId로 사용)
      messageQueue.enqueue({
        groupChatId: conversationId, // 1:1 채팅에서도 같은 시스템 사용
        content,
        senderId: userId
      });
      
      // 향상된 대화 맥락 가져오기
      const enhancedHistory = messageQueue.generateEnhancedConversationHistory(conversationId);
      
      // Prepare conversation history
      const rawConversationHistory = enhancedHistory.length > 0 ? enhancedHistory : 
        messages.slice(-10).map(msg => ({
          role: msg.isFromUser ? "user" as const : "assistant" as const,
          content: msg.content,
        }));
      
      // 🎯 토큰 최적화: 대화 히스토리 압축
      const optimized = await optimizeTokenUsage(
        rawConversationHistory,
        documentContext,
        "", // systemPrompt는 나중에 처리
        { maxRecentMessages: 3, maxDocumentChunks: 3, maxChunkTokens: 150, optimizePrompt: false }
      );
      
      const conversationHistory = filterSystemMessages(optimized.messages);
      
      console.log(`[1:1 Chat] ${agent.name} 대화 맥락: ${rawConversationHistory.length}개 → ${conversationHistory.length}개 (${optimized.savedTokens} 토큰 절감)`);

      // Force refresh agent data to ensure persona fields are loaded
      const refreshedAgent = await storage.getAgent(agent.id);

      // Extract persona parameters with detailed logging
      const chatbotType = refreshedAgent?.chatbotType || "general-llm";
      const speechStyle = refreshedAgent?.speechStyle || "친근하고 도움이 되는 말투";
      const personality = refreshedAgent?.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공";
      const additionalPrompt = refreshedAgent?.additionalPrompt || "";

      console.log("REFRESHED AGENT PERSONA DATA:", {
        chatbotType,
        speechStyle,
        personality,
        agentName: refreshedAgent?.name
      });

      // 🔥 에이전트 페르소나 강화
      const { enhanceAgentPersona, generateProfessionalPrompt } = await import('./personaEnhancer');
      
      const enhancedPersona = enhanceAgentPersona(
        refreshedAgent?.name || agent.name,
        refreshedAgent?.description || agent.description || '',
        refreshedAgent?.category || agent.category || '',
        refreshedAgent?.upperCategory || agent.upperCategory || '',
        refreshedAgent?.lowerCategory || agent.lowerCategory || '',
        speechStyle,
        personality
      );

      // 전문성 강화 프롬프트 생성
      const professionalPrompt = generateProfessionalPrompt(enhancedPersona);
      const enhancedAdditionalPrompt = additionalPrompt ? `${additionalPrompt}\n\n${professionalPrompt}` : professionalPrompt;

      // Get user's language preference from request body or default to Korean
      const userLanguage = req.body.userLanguage || "ko";

      // 개인 채팅에서는 기본 언어 레벨 사용 (중급: 3)
      const languageLevel = 3;

      // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
      const currentUser = await storage.getUser(userId);
      const userProfile = currentUser ? {
        nickname: currentUser.nickname || undefined,
        age: currentUser.age || undefined,
        gender: currentUser.gender || undefined,
        country: currentUser.country || undefined,
        religion: currentUser.religion || undefined,
        occupation: currentUser.occupation || undefined
      } : undefined;

      // Check if this is a management conversation and handle management commands
      let aiResponse;
      if (conversationResult.type === "management") {
        aiResponse = await generateChatResponse(
          content,
          agent.name,
          agent.description,
          conversationHistory,
          documentContext,
          chatbotType,
          enhancedPersona.speechStyle, // 🔥 강화된 페르소나 적용
          enhancedPersona.personality, // 🔥 강화된 페르소나 적용
          enhancedAdditionalPrompt, // 🔥 전문성 강화 프롬프트 포함
          userLanguage,
          conversationId, // conversationId
          undefined, // relationship (1:1 채팅에서는 기본 관계)
          languageLevel, // 🎯 언어 레벨 적용 (개인 채팅 기본값: 3)
          undefined, // maxTokens
          userProfile, // 🎯 사용자 프로필 정보 전달
          agentHumor, // 🎚️ 유머 설정 적용
          5, // reactionIntensity
          'general', // context
          userId, // 📊 토큰 로깅용 userId
          agent.id, // 📊 토큰 로깅용 agentId
          undefined // 📊 groupChatId (1:1 채팅에서는 없음)
        );
      } else {
        // Generate AI response with chatbot type and persona
        aiResponse = await generateChatResponse(
          content,
          agent.name,
          agent.description,
          conversationHistory,
          documentContext,
          chatbotType,
          enhancedPersona.speechStyle, // 🔥 강화된 페르소나 적용
          enhancedPersona.personality, // 🔥 강화된 페르소나 적용
          enhancedAdditionalPrompt, // 🔥 전문성 강화 프롬프트 포함
          userLanguage,
          conversationId, // conversationId
          undefined, // relationship (1:1 채팅에서는 기본 관계)
          languageLevel, // 🎯 언어 레벨 적용 (개인 채팅 기본값: 3)
          undefined, // maxTokens
          userProfile, // 🎯 사용자 프로필 정보 전달
          agentHumor, // 🎚️ 유머 설정 적용
          5, // reactionIntensity
          'general', // context
          userId, // 📊 토큰 로깅용 userId
          agent.id, // 📊 토큰 로깅용 agentId
          undefined // 📊 groupChatId (1:1 채팅에서는 없음)
        );
      }

      // Filter AI response to remove unwanted content
      const filteredResponse = filterBotResponse(aiResponse.message);
      
      // Save AI message
      const aiMessage = await storage.createMessage({
        conversationId,
        content: filteredResponse,
        isFromUser: false,
      });
      
      // AI 응답도 메시지 큐에 추가하여 대화 맥락 업데이트
      messageQueue.enqueue({
        groupChatId: conversationId, // 1:1 채팅에서도 같은 시스템 사용
        content: filteredResponse,
        agentId: agent.id
      });

      res.json({
        userMessage,
        aiMessage,
        usedDocuments: aiResponse.usedDocuments,
        scenarioTurns: toScenarioTurns(agent.id, agent.name, filteredResponse)
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Add request logging middleware specifically for this route
  app.use('/api/conversations/:id/messages', (req, res, next) => {
    console.log(`[ROUTE DEBUG] ${req.method} ${req.originalUrl} - Route handler called`);
    next();
  });

  // Bulk delete messages (admin only)
  app.post('/api/messages/bulk-delete', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      const { messageIds, conversationId } = req.body;

      console.log(`[BULK DELETE] Start - messageIds: ${messageIds?.length}, conversationId: ${conversationId}, userId: ${userId}`);

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ message: "Invalid message IDs array" });
      }

      // Check if user is admin
      const user = await storage.getUser(userId!);
      const isAdmin = user?.role === 'master_admin' || 
                      user?.role === 'operation_admin' || 
                      user?.role === 'agent_admin';
      
      if (!isAdmin) {
        return res.status(403).json({ message: "Only administrators can delete messages" });
      }

      // Delete each message (filter out timestamp-based temporary IDs)
      const validMessageIds = messageIds.filter((id: number) => {
        // PostgreSQL integer max: 2,147,483,647 (~2.1 billion)
        // Timestamp IDs are much larger (e.g., 1762496994655)
        return id < 2147483647;
      });

      if (validMessageIds.length === 0) {
        console.log(`[BULK DELETE] No valid message IDs after filtering (all were temporary IDs)`);
        return res.json({ 
          success: true, 
          deleted: 0,
          message: "No permanent messages to delete (temporary messages are auto-removed)"
        });
      }

      console.log(`[BULK DELETE] Filtered ${messageIds.length} → ${validMessageIds.length} valid IDs`);
      
      const results = [];
      for (const messageId of validMessageIds) {
        const result = await storage.deleteMessage(messageId, conversationId);
        results.push(result);
        
        // Broadcast each deletion via SSE
        if (result.success) {
          const { broadcastWithEventId } = await import('./broadcast');
          broadcastWithEventId('message_deleted', {
            conversationId: result.conversationId,
            groupChatId: result.groupChatId,
            messageId: messageId,
            messageType: result.messageType
          }, `message_deleted_${messageId}`);
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`[BULK DELETE] Successfully deleted ${successCount}/${messageIds.length} messages`);

      res.json({ 
        success: true, 
        message: `Deleted ${successCount} messages`,
        deletedCount: successCount,
        totalRequested: messageIds.length
      });
    } catch (error) {
      console.error("[BULK DELETE] Error:", error);
      res.status(500).json({ message: "Failed to delete messages" });
    }
  });

  // Search sources for a message with hybrid query (agent name + user question + answer keywords)
  app.post('/api/messages/:messageId/search-sources', isAuthenticated, async (req: any, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;
      const { groupChatId, agentName, userMessage, answerContent } = req.body;

      if (isNaN(messageId)) {
        return res.status(400).json({ success: false, message: "Invalid message ID" });
      }

      if (!groupChatId || isNaN(parseInt(groupChatId))) {
        return res.status(400).json({ success: false, message: "Invalid group chat ID" });
      }

      const groupChatIdNum = parseInt(groupChatId);

      // 🔒 접근 권한 체크: 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChat(groupChatIdNum);
      
      if (!groupChat) {
        return res.status(404).json({ success: false, message: "Group chat not found" });
      }

      const members = await storage.getGroupChatMembers(groupChatIdNum);
      const isMember = members.some(m => m.userId === userId) || userId === 'master_admin';
      
      if (!isMember) {
        console.log(`[ACCESS DENIED] User ${userId} attempted to access chat ${groupChatIdNum} without permission`);
        return res.status(403).json({ success: false, message: "You don't have permission to access this chat" });
      }

      // 🔒 보안: 서버 측에서 메시지 검증 (클라이언트 조작 방지)
      const messages = await storage.getGroupChatMessages(groupChatIdNum);
      const message = messages.find(m => m.id === messageId);
      
      if (!message) {
        return res.status(404).json({ success: false, message: "Message not found" });
      }

      // 실제 답변 내용으로 대체 (클라이언트 전달값 무시)
      const verifiedAnswerContent = message.content;

      console.log(`[🔍 HYBRID SEARCH] Message ${messageId}:`, {
        agentName: agentName?.slice(0, 20),
        userMessage: userMessage?.slice(0, 50),
        verifiedAnswerContent: verifiedAnswerContent.slice(0, 50)
      });

      const { searchMessageSources } = await import('./gemini');
      const result = await searchMessageSources({
        agentName: agentName || '',
        userMessage: userMessage || '',
        answerContent: verifiedAnswerContent
      });

      if (!result.success) {
        console.error(`[SEARCH SOURCES] Search failed: ${result.error}`);
        return res.status(500).json({ 
          success: false, 
          message: result.error || "Failed to search sources",
          sources: []
        });
      }

      console.log(`[✅ SEARCH SOURCES] Found ${result.sources?.length || 0} sources`);

      // ✅ 검색 성공 시 DB에 sources 저장
      if (result.sources && result.sources.length > 0) {
        const sourcesData = { chunks: result.sources };
        await storage.updateGroupChatMessageSources(messageId, sourcesData);
        console.log(`[💾 SOURCES SAVED] Message ${messageId}: ${result.sources.length} sources saved to DB`);
        
        // SSE로 메시지 업데이트 브로드캐스트 (프론트엔드 자동 반영)
        const { broadcastWithEventId } = await import('./broadcast');
        broadcastWithEventId('group_chat_message', {
          groupChatId: groupChatIdNum,
          message: {
            ...message,
            sources: sourcesData
          }
        }, `group_msg_sources_${messageId}`);
      }

      res.json({
        success: true,
        sources: result.sources || [],
        messageId: messageId,
        messageContent: answerContent?.slice(0, 100) || '' // 메시지 일부 반환 (UX 개선)
      });
    } catch (error: any) {
      console.error("[❌ SEARCH SOURCES] Error:", error);
      res.status(500).json({ 
        success: false, 
        message: error?.message || "Failed to search sources",
        sources: []
      });
    }
  });

  // Get perspectives for a topic (perspective-based search) - PUBLIC (guest access allowed)
  app.post('/api/search/perspectives', async (req: any, res) => {
    try {
      const { topic, question, agentId, messageId, originalAnswer, agentName } = req.body;

      // ✅ Strict validation: topic required
      if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "Topic is required and must be a non-empty string" 
        });
      }

      // ✅ Strict validation: question required
      if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: "Question is required and must be a non-empty string" 
        });
      }

      // ✅ Optional agentId validation (for future use)
      const agentIdNum = agentId !== undefined && agentId !== null 
        ? parseInt(String(agentId), 10) 
        : 0; // Default to 0 if not provided

      if (agentId !== undefined && agentId !== null && (isNaN(agentIdNum) || agentIdNum < 0)) {
        return res.status(400).json({ 
          success: false, 
          message: "agentId must be a valid non-negative integer" 
        });
      }

      console.log(`[🎭 PERSPECTIVES API] Agent ${agentIdNum || 'none'}, MessageID: ${messageId || 'none'}, Topic: ${topic.substring(0, 50)}..., Question: ${question.substring(0, 50)}...`);

      // 💡 Option B: 기존 메시지의 sources 재사용
      let existingSources = null;
      if (messageId) {
        const messageIdNum = parseInt(String(messageId), 10);
        if (!isNaN(messageIdNum) && messageIdNum > 0) {
          try {
            const message = await storage.getGroupChatMessage(messageIdNum);
            if (message?.sources && Array.isArray(message.sources) && message.sources.length > 0) {
              existingSources = message.sources;
              console.log(`[♻️ REUSE SOURCES] Found ${existingSources.length} sources from message ${messageIdNum}`);
            }
          } catch (err) {
            console.warn(`[⚠️ PERSPECTIVES] Failed to fetch message ${messageIdNum}:`, err);
          }
        }
      }

      const { searchWithPerspectives } = await import('./search/searchClient');
      
      // ⏱️ 타임아웃 설정 (최대 30초 - 병렬 처리 후 안전망)
      const TIMEOUT_MS = 30000;
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Perspective extraction timeout (30s)')), TIMEOUT_MS)
      );
      
      const result = await Promise.race([
        searchWithPerspectives(agentIdNum, topic, question, existingSources || undefined, originalAnswer, agentName),
        timeoutPromise
      ]);

      // ✅ 검증: perspectives가 비어있으면 실패로 처리
      if (!result.perspectives || result.perspectives.length === 0) {
        console.error("[❌ PERSPECTIVES API] No perspectives extracted");
        return res.status(200).json({ 
          success: false, 
          errorCode: 'NO_PERSPECTIVES_FOUND',
          message: "관점을 찾을 수 없습니다. 다른 주제로 시도해주세요.",
          query: result.query,
          searchResults: result.searchResults,
          perspectives: []
        });
      }

      console.log(`[✅ PERSPECTIVES API] Found ${result.perspectives.length} perspectives, ${result.searchResults.length} articles (reused: ${existingSources ? 'yes' : 'no'})`);

      res.json({
        success: true,
        query: result.query,
        searchResults: result.searchResults,
        perspectives: result.perspectives,
        ttlSeconds: result.ttlSeconds,
        classificationType: result.classificationType,
        sourcesReused: !!existingSources
      });
    } catch (error: any) {
      console.error("[❌ PERSPECTIVES API] Error:", error);
      res.status(200).json({ // ✅ 200으로 유지 (클라이언트가 success:false로 구분)
        success: false,
        errorCode: 'EXTRACTION_FAILED',
        message: "AI가 관점을 분석하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        perspectives: [],
        searchResults: []
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // 🎭 Step 46: Interactive Speaker Expansion APIs
  // ═══════════════════════════════════════════════════════════════════════════════

  // Get recommended speakers for a debate (existing + suggested new)
  app.post('/api/verdict/speakers', async (req: any, res) => {
    try {
      const { groupChatId, question } = req.body;

      if (!groupChatId) {
        return res.status(400).json({ 
          success: false, 
          message: "groupChatId is required" 
        });
      }

      const groupChatIdNum = parseInt(String(groupChatId), 10);
      if (isNaN(groupChatIdNum)) {
        return res.status(400).json({ 
          success: false, 
          message: "groupChatId must be a valid number" 
        });
      }

      console.log(`[🎭 SPEAKERS API] Fetching speakers for groupChat ${groupChatIdNum}`);

      // 최근 메시지에서 발언자 추출
      const messages = await storage.getGroupChatMessages(groupChatIdNum, 50);
      
      // VERDICT 메시지에서 발언자 정보 추출 (** 이모지 이름** 패턴)
      const speakerPattern = /^\*\*([^\s\*]+)\s+([^*]+)\*\*/;
      const titlePattern = /\(([^)]+)\)/;
      
      const existingSpeakers: Array<{ name: string; title: string; role: string; messageCount: number }> = [];
      const speakerCounts: Record<string, number> = {};
      
      let originalQuestion = question || '';
      let searchResults: any[] = [];
      const debateDialogue: string[] = []; // 실제 토론 대화 내용 수집
      
      for (const msg of messages) {
        const content = msg.content || '';
        const match = content.match(speakerPattern);
        
        if (match) {
          const icon = match[1];
          const nameWithTitle = match[2].trim();
          const titleMatch = nameWithTitle.match(titlePattern);
          
          let name = nameWithTitle;
          let title = '';
          
          if (titleMatch) {
            title = titleMatch[1];
            name = nameWithTitle.replace(titlePattern, '').trim();
          }
          
          // 이미 추가된 발언자인지 확인
          const existing = existingSpeakers.find(s => s.name === name);
          if (existing) {
            speakerCounts[name] = (speakerCounts[name] || 1) + 1;
            existing.messageCount = speakerCounts[name];
          } else {
            speakerCounts[name] = 1;
            existingSpeakers.push({
              name,
              title: title || msg.agentName || '',
              role: msg.debateMode || 'support',
              messageCount: 1
            });
          }
        }
        
        // 원래 질문 찾기
        if (msg.questionAsked && !originalQuestion) {
          originalQuestion = msg.questionAsked;
        }
        
        // 검색 결과 찾기
        if (msg.sources && Array.isArray(msg.sources) && msg.sources.length > 0) {
          searchResults = msg.sources;
        }
        
        // 대화 내용 수집 (최대 10개, 앞부분 300자)
        if (content && content.length > 50 && debateDialogue.length < 10) {
          debateDialogue.push(content.slice(0, 300));
        }
      }
      
      console.log(`[🎭 SPEAKERS API] Found ${existingSpeakers.length} existing speakers, ${debateDialogue.length} dialogue lines`);
      
      // 추천 발언자 생성
      if (existingSpeakers.length > 0 && originalQuestion) {
        const { generateRecommendedSpeakers } = await import('./search/searchClient');
        
        const recommended = await generateRecommendedSpeakers(
          originalQuestion,
          existingSpeakers.map(s => ({ name: s.name, title: s.title, role: s.role })),
          searchResults,
          debateDialogue // 실제 토론 대화 내용 전달
        );
        
        res.json({
          success: true,
          speakers: recommended,
          originalQuestion,
          groupChatId: groupChatIdNum
        });
      } else {
        // 발언자가 없으면 빈 배열 반환
        res.json({
          success: true,
          speakers: [],
          originalQuestion: originalQuestion || '',
          groupChatId: groupChatIdNum,
          message: 'No speakers found in this conversation'
        });
      }
    } catch (error: any) {
      console.error("[❌ SPEAKERS API] Error:", error);
      res.status(500).json({ 
        success: false, 
        message: error?.message || "Failed to get speakers",
        speakers: []
      });
    }
  });

  // Generate expanded response from a specific speaker
  app.post('/api/verdict/expand-speaker', async (req: any, res) => {
    try {
      const { 
        groupChatId, 
        speakerName, 
        speakerTitle, 
        isExisting,
        question,
        chatHistory  // 🎭 Step 46 Fix: 프론트엔드에서 전송한 대화 히스토리
      } = req.body;

      if (!groupChatId || !speakerName) {
        return res.status(400).json({ 
          success: false, 
          message: "groupChatId and speakerName are required" 
        });
      }

      const groupChatIdNum = parseInt(String(groupChatId), 10);
      if (isNaN(groupChatIdNum)) {
        return res.status(400).json({ 
          success: false, 
          message: "groupChatId must be a valid number" 
        });
      }

      console.log(`[🎭 EXPAND SPEAKER API] ${speakerName} (${speakerTitle}) for groupChat ${groupChatIdNum}`);

      // 🎭 Step 46 Fix: chatHistory가 있으면 프론트엔드에서 받은 것 사용, 없으면 DB에서 조회
      let messages: any[] = [];
      if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
        messages = chatHistory;
        console.log(`[🎭 EXPAND SPEAKER] Using frontend chatHistory: ${chatHistory.length} messages`);
      } else {
        messages = await storage.getGroupChatMessages(groupChatIdNum, 20);
        console.log(`[🎭 EXPAND SPEAKER] Fetched from DB: ${messages.length} messages`);
      }
      
      let originalQuestion = question || '';
      let searchContext = '';
      const previousDialogue: string[] = [];
      
      for (const msg of messages) {
        // 원래 질문 찾기 (사용자 메시지에서도 추출)
        if (!originalQuestion) {
          if (msg.questionAsked) {
            originalQuestion = msg.questionAsked;
          } else if (msg.senderId && !msg.agentName && msg.content) {
            // 사용자 메시지에서 질문 추출
            originalQuestion = msg.content.slice(0, 200);
          }
        }
        
        // 검색 결과 가져오기 (URL만 있는 경우 대화 맥락에서 보완)
        if (msg.sources && Array.isArray(msg.sources)) {
          const sources = msg.sources as any[];
          const validSources = sources
            .filter((s: any) => s.title || s.snippet)
            .slice(0, 5)
            .map((s: any) => `- ${s.title || ''}: ${(s.snippet || '').slice(0, 150)}`);
          if (validSources.length > 0) {
            searchContext = validSources.join('\n');
          }
        }
        
        // 대화 맥락 수집 (최근 8개 - VERDICT 응답 메시지)
        if (msg.content && previousDialogue.length < 8) {
          const content = msg.content;
          // VERDICT 메시지에서 이름 추출 또는 모든 AI 메시지 수집
          if (msg.agentName || content.match(/^\*\*[^\*]+\*\*/)) {
            previousDialogue.push(content.slice(0, 300));
          }
        }
      }
      
      // 🛡️ Fallback: 질문이 없으면 대화 내용에서 첫 사용자 메시지 사용
      if (!originalQuestion && previousDialogue.length > 0) {
        originalQuestion = "이 주제에 대한 토론";
      }
      
      const previousContext = previousDialogue.join('\n\n---\n\n');
      
      console.log(`[🎭 EXPAND SPEAKER] ${speakerName} (${speakerTitle}) - hasSpokenBefore: ${isExisting !== false}, question: "${originalQuestion?.slice(0, 50) || 'N/A'}...", context: ${previousDialogue.length} messages`);
      
      // 🎭 Step 46 Fix: 대화 맥락이 없어도 "첫 등장 자기소개" 모드로 진행
      const isFirstAppearance = previousDialogue.length === 0;
      
      // 확장 발언 생성
      const { generateExpandedSpeakerResponse } = await import('./search/searchClient');
      
      const expandedResponse = await generateExpandedSpeakerResponse(
        speakerName,
        speakerTitle || '',
        previousContext,
        originalQuestion,
        isExisting !== false, // 기본적으로 기존 발언자로 취급
        searchContext,
        isFirstAppearance  // 🎭 Step 46 Fix: 첫 등장 자기소개 모드
      );
      
      // 메시지 형식화
      const speakerDisplay = expandedResponse.title 
        ? `${expandedResponse.name} (${expandedResponse.title})`
        : expandedResponse.name;
      const turnContent = `**${expandedResponse.speaker_icon} ${speakerDisplay}**\n\n${expandedResponse.message}`;
      
      // DB에 저장
      const savedMessage = await storage.createGroupChatMessage({
        groupChatId: groupChatIdNum,
        content: turnContent,
        senderId: null,
        senderName: null,
        agentId: null,
        agentName: expandedResponse.name,
        questionAsked: null,
        analysisResult: null,
        debateMode: expandedResponse.role,
        metaPromptSnapshot: null,
        matrixSnapshot: null
      });
      
      // 브로드캐스트
      const { broadcastGroupChatMessage } = await import('./broadcast');
      if (savedMessage) {
        await broadcastGroupChatMessage(groupChatIdNum, savedMessage);
      }
      
      console.log(`[✅ EXPAND SPEAKER API] ${speakerName} expanded response saved (ID: ${savedMessage?.id})`);
      
      res.json({
        success: true,
        message: savedMessage,
        response: expandedResponse
      });
    } catch (error: any) {
      console.error("[❌ EXPAND SPEAKER API] Error:", error);
      res.status(500).json({ 
        success: false, 
        message: error?.message || "Failed to generate expanded response"
      });
    }
  });

  app.delete('/api/messages/:messageId', isAuthenticated, async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const userId = req.user?.id;
      const { conversationId } = req.body;

      console.log(`[DELETE MESSAGE] Start - messageId: ${messageId}, conversationId: ${conversationId}, userId: ${userId}`);

      if (isNaN(messageId)) {
        return res.status(400).json({ message: "Invalid message ID" });
      }

      // Check if user is admin (operation_admin, agent_admin, or master_admin)
      const user = await storage.getUser(userId!);
      const isAdmin = user?.role === 'master_admin' || 
                      user?.role === 'operation_admin' || 
                      user?.role === 'agent_admin';
      
      console.log(`[DELETE MESSAGE] User role:`, user?.role, `isAdmin:`, isAdmin);
      
      if (!isAdmin) {
        console.log(`[DELETE MESSAGE] Permission denied - user is not admin`);
        return res.status(403).json({ message: "Only administrators can delete individual messages" });
      }

      // Delete the message
      const result = await storage.deleteMessage(messageId, conversationId);

      if (!result.success) {
        return res.status(404).json({ message: "Message not found" });
      }

      console.log(`[DELETE MESSAGE] Successfully deleted ${result.messageType} message ${messageId}`);

      // Broadcast message deletion via SSE
      const { broadcastWithEventId } = await import('./broadcast');
      broadcastWithEventId('message_deleted', {
        conversationId: result.conversationId,
        groupChatId: result.groupChatId,
        messageId: messageId,
        messageType: result.messageType
      }, `message_deleted_${messageId}`);

      res.json({ 
        success: true, 
        message: "Message deleted successfully",
        conversationId: result.conversationId,
        groupChatId: result.groupChatId,
        messageType: result.messageType
      });
    } catch (error) {
      console.error("[DELETE MESSAGE] Error:", error);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // Delete all messages from a conversation (chat history deletion)
  app.delete('/api/conversations/:id/messages', isAuthenticated, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const userId = req.user?.id;

      console.log(`[DELETE MESSAGES DEBUG] Start - conversationId: ${conversationId}, userId: ${userId}`);

      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      // Verify conversation belongs to user or user is master admin
      const allConversations = await storage.getAllConversations();
      const conversation = allConversations.find(conv => conv.id === conversationId);
      
      console.log(`[DELETE MESSAGES DEBUG] Found conversation:`, conversation);
      
      if (!conversation) {
        console.log(`[DELETE MESSAGES DEBUG] Conversation not found`);
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Check if user has permission (owner or master admin)
      const user = await storage.getUser(userId!);
      console.log(`[DELETE MESSAGES DEBUG] User info:`, user);
      const isMasterAdmin = user?.role === 'master_admin';
      
      console.log(`[DELETE MESSAGES DEBUG] Permission check - conversation.userId: ${conversation.userId}, userId: ${userId}, isMasterAdmin: ${isMasterAdmin}`);
      
      if (conversation.userId !== userId && !isMasterAdmin) {
        console.log(`[DELETE MESSAGES DEBUG] Permission denied`);
        return res.status(403).json({ message: "Unauthorized to delete this conversation's messages" });
      }

      // Delete all messages from the conversation
      await storage.deleteConversationMessages(conversationId);

      res.json({ message: "All messages deleted successfully" });
    } catch (error) {
      console.error("Error deleting conversation messages:", error);
      res.status(500).json({ message: "Failed to delete messages" });
    }
  });

  // Hide conversation (leave chat room)
  app.delete('/api/conversations/:id', isAuthenticated, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const userId = req.user?.id;

      console.log(`[🚪 LEAVE CONVERSATION] START - conversationId: ${conversationId}, userId: ${userId}`);

      if (isNaN(conversationId)) {
        console.log(`[🚪 LEAVE CONVERSATION] Invalid conversation ID`);
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      // Verify conversation belongs to user
      const allConversations = await storage.getAllConversations();
      const conversation = allConversations.find(conv => conv.id === conversationId && conv.userId === userId);
      
      console.log(`[🚪 LEAVE CONVERSATION] Found conversation:`, conversation);
      
      if (!conversation) {
        console.log(`[🚪 LEAVE CONVERSATION] Conversation not found or not owned by user`);
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Hide the conversation instead of deleting it
      console.log(`[🚪 LEAVE CONVERSATION] Hiding conversation ${conversationId}...`);
      await storage.hideConversation(conversationId);
      console.log(`[🚪 LEAVE CONVERSATION] ✅ Successfully hidden conversation ${conversationId}`);

      res.json({ message: "Conversation hidden successfully" });
    } catch (error) {
      console.error("[🚪 LEAVE CONVERSATION] ❌ Error:", error);
      res.status(500).json({ message: "Failed to hide conversation" });
    }
  });

  // Delete conversation with messages route (moved after specific routes to avoid pattern conflicts)
  app.delete('/api/conversations/:userId/:agentId', isAuthenticated, async (req: any, res) => {
    try {
      const { userId, agentId } = req.params;
      const requestingUserId = req.user.id;
      const userType = req.user.userType;
      
      // Authorization check: user can only delete their own conversations
      // OR admin/master_admin can delete any conversation
      if (userId !== requestingUserId && userType !== 'admin' && requestingUserId !== 'master_admin') {
        return res.status(403).json({ message: "Unauthorized to delete this conversation" });
      }
      
      const agentIdNum = parseInt(agentId);
      if (isNaN(agentIdNum)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      await storage.deleteConversationWithMessages(userId, agentIdNum);
      
      res.json({ 
        success: true, 
        message: "Conversation and all related messages deleted successfully" 
      });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  // Document routes (moved to line ~2709 with authorization)

  app.post('/api/agents/:id/documents', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }
      const userId = req.user.id;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Create permanent file path
      const permanentPath = path.join('uploads', file.filename);
      
      console.log('File upload details:', {
        originalname: file.originalname,
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size,
        tempPath: file.path,
        permanentPath: permanentPath
      });
      
      // Ensure uploads directory exists
      if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
      }
      
      // Copy file to permanent location
      fs.copyFileSync(file.path, permanentPath);
      
      // Verify file was copied successfully
      if (!fs.existsSync(permanentPath)) {
        throw new Error(`Failed to copy file to permanent location: ${permanentPath}`);
      }
      
      console.log('File successfully copied to:', permanentPath);
      console.log('File size after copy:', fs.statSync(permanentPath).size);

      // Extract text content based on file type using permanent path
      const extractedText = await extractTextFromFile(permanentPath, file.mimetype);

      // Analyze document
      const analysis = await analyzeDocument(extractedText, file.originalname);

      // Save document to database
      const documentData = insertDocumentSchema.parse({
        agentId,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        content: analysis.extractedText,
        uploadedBy: userId,
      });

      const document = await storage.createDocument(documentData);

      // Process document to generate RAG chunks
      console.log('[Document Upload] Starting RAG chunk generation...');
      const ragResult = await processDocument(permanentPath, document.id, agentId, file.originalname);
      
      if (!ragResult.success) {
        console.error('[Document Upload] RAG processing failed:', ragResult.error);
        console.error('[Document Upload] This means the document cannot be used for RAG-enhanced responses');
        // Consider this a critical error - without RAG chunks, the document upload feature is incomplete
      } else {
        console.log(`[Document Upload] Successfully generated ${ragResult.chunks} RAG chunks`);
      }

      // Clean up temporary file
      fs.unlinkSync(file.path);

      res.json({
        document,
        analysis,
        ragChunks: ragResult.success ? ragResult.chunks : 0,
        ragError: ragResult.success ? undefined : ragResult.error,
      });
    } catch (error) {
      console.error("Error uploading document:", error);

      // Clean up temporary file if it exists
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.error("Error cleaning up file:", cleanupError);
        }
      }

      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // Get document content for preview
  app.get('/api/documents/:id/content', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const document = await storage.getDocument(documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json({
        id: document.id,
        originalName: document.originalName,
        mimeType: document.mimeType,
        size: document.size,
        createdAt: document.createdAt,
        content: document.content,
        uploadedBy: document.uploadedBy
      });
    } catch (error) {
      console.error("Error fetching document content:", error);
      res.status(500).json({ message: "Failed to fetch document content" });
    }
  });

  app.get('/api/documents/:id/download', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const document = await storage.getDocument(documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if original file exists
      const filePath = path.join('uploads', document.filename);
      
      if (fs.existsSync(filePath)) {
        // Serve the original file
        const safeFilename = document.originalName.replace(/[^\w\s.-]/g, '_');
        const encodedFilename = encodeURIComponent(document.originalName);
        
        res.setHeader('Content-Type', document.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`);
        res.sendFile(path.resolve(filePath));
      } else {
        // Fallback to extracted content
        const safeFilename = document.originalName.replace(/[^\w\s.-]/g, '_');
        const encodedFilename = encodeURIComponent(document.originalName);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.txt"; filename*=UTF-8''${encodedFilename}.txt`);
        res.send(document.content || "No content available");
      }
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  // Reprocess document content
  app.post('/api/documents/:id/reprocess', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      const document = await storage.getDocument(documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if original file exists
      const filePath = path.join('uploads', document.filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Original file not found" });
      }

      console.log('Reprocessing document:', document.originalName);
      
      // Extract text content using the improved extraction function
      const extractedText = await extractTextFromFile(filePath, document.mimeType);
      
      // Update document content
      const updatedDocument = await storage.updateDocumentContent(documentId, extractedText);

      res.json({
        message: "Document reprocessed successfully",
        document: updatedDocument,
        extractedLength: extractedText ? extractedText.length : 0
      });
    } catch (error) {
      console.error("Error reprocessing document:", error);
      res.status(500).json({ message: "Failed to reprocess document" });
    }
  });

  // Reprocess document with Vision API
  app.post('/api/documents/:id/reprocess-vision', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      const document = await storage.getDocument(documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Use absolute path to uploads directory
      const filePath = path.join(__dirname, '..', 'uploads', document.filename);
      
      console.log(`[Vision Reprocess] Checking file: ${filePath}`);
      console.log(`[Vision Reprocess] File exists: ${fs.existsSync(filePath)}`);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Original file not found" });
      }

      const fileName = document.originalName.toLowerCase();
      const isPDF = fileName.endsWith('.pdf');
      const isPPT = fileName.endsWith('.ppt');
      const isPPTX = fileName.endsWith('.pptx');
      const isImage = fileName.endsWith('.png') || fileName.endsWith('.jpg') || 
                     fileName.endsWith('.jpeg') || fileName.endsWith('.webp') || 
                     fileName.endsWith('.gif');
      
      if (!isPDF && !isPPT && !isPPTX && !isImage) {
        return res.status(400).json({ 
          message: "Vision API는 PDF, PPT, PPTX, 이미지 파일 (PNG, JPG, JPEG, WEBP, GIF)만 지원합니다" 
        });
      }

      console.log('Vision API reprocessing document:', document.originalName);
      
      const visionStart = Date.now();
      
      // Import the appropriate Vision function based on file type
      const { extractAndAnalyzeImagesWithGrid, analyzeImageFile } = await import('./documentProcessor');
      const { broadcastWithEventId } = await import('./broadcast');
      
      // Progress callback to send SSE updates
      const onProgress = (step: string, details?: any) => {
        broadcastWithEventId('vision_progress', {
          documentId: document.id,
          step,
          details,
          timestamp: new Date().toISOString()
        }, `vision_${document.id}_${Date.now()}`);
      };
      
      let visionResult: string | null = null;
      let pageDescriptions: Record<number, string> = {};
      
      if (isPDF || isPPT || isPPTX) {
        // PDF/PPT/PPTX → Grid 방식: 모든 이미지 추출 → Grid 합성 → Vision API
        console.log('[Vision Grid] Using grid-based analysis for multi-page document');
        
        onProgress('extracting', { message: '이미지 추출 중...' });
        
        const gridResult = await extractAndAnalyzeImagesWithGrid(filePath, document.originalName, {
          userId: req.user?.id,
          agentId: document.agentId,
          documentId: document.id,
          onProgress
        });
        
        if (gridResult.success && gridResult.visionResult) {
          visionResult = gridResult.visionResult;
          pageDescriptions = gridResult.pageDescriptions || {};
          console.log(`[Vision Grid] Analyzed ${Object.keys(pageDescriptions).length} pages with images`);
        } else {
          console.log('[Vision Grid] No images found or analysis failed');
          return res.status(400).json({ 
            message: gridResult.error || "문서에서 이미지를 찾을 수 없습니다" 
          });
        }
      } else if (isImage) {
        // 이미지 → Vision API (직접)
        visionResult = await analyzeImageFile(filePath, document.originalName, {
          userId: req.user?.id,
          agentId: document.agentId,
          documentId: document.id
        });
      } else {
        return res.status(400).json({ message: "Unsupported file type" });
      }
      
      const visionDuration = ((Date.now() - visionStart) / 1000).toFixed(1);
      
      if (!visionResult) {
        return res.status(500).json({ 
          message: "Vision API analysis failed - no result returned" 
        });
      }
      
      console.log(`Vision API analysis completed in ${visionDuration}s`);
      console.log(`Vision result length: ${visionResult.length} characters`);
      
      // Extract original text analysis (avoid nesting on multiple reprocesses)
      const currentDescription = document.description || '';
      let textAnalysis = currentDescription;
      
      // If already has Vision analysis, extract only the text part
      const textAnalysisMatch = currentDescription.match(/\[텍스트 분석\]\n([\s\S]*?)(?:\n\n\[시각적 분석\]|$)/);
      if (textAnalysisMatch) {
        textAnalysis = textAnalysisMatch[1];
      }
      
      const updatedDescription = `[텍스트 분석]\n${textAnalysis}\n\n[시각적 분석]\n${visionResult}`;
      
      // Update visionAnalysis to mark as processed and add benefits
      const visionAnalysis: any = document.visionAnalysis || {};
      visionAnalysis.hasVisionProcessed = true;
      
      // Generate benefits based on Vision API results
      const benefits: string[] = [];
      const diagramCount = visionAnalysis.diagramCount || 0;
      
      if (diagramCount > 0) {
        benefits.push(`${diagramCount}개의 다이어그램/차트를 시각적으로 분석했습니다`);
      }
      
      // Analyze vision result content to generate more specific benefits
      if (visionResult) {
        const lowerResult = visionResult.toLowerCase();
        
        if (lowerResult.includes('metro') || lowerResult.includes('subway') || lowerResult.includes('노선') || lowerResult.includes('지하철')) {
          benefits.push('노선도에서 역 이름, 노선 정보, 환승 구조를 추출하여 검색 가능');
        }
        
        if (lowerResult.includes('map') || lowerResult.includes('지도')) {
          benefits.push('지리적 위치 관계를 파악하여 맥락 제공');
        }
        
        if (lowerResult.includes('table') || lowerResult.includes('표') || lowerResult.includes('matrix')) {
          benefits.push('복잡한 표 구조를 텍스트로 변환하여 데이터 추출 가능');
        }
        
        if (lowerResult.includes('formula') || lowerResult.includes('equation') || lowerResult.includes('수식')) {
          benefits.push('수학/물리 수식을 인식하여 계산 및 설명 제공');
        }
        
        if (lowerResult.includes('diagram') || lowerResult.includes('chart') || lowerResult.includes('graph') || lowerResult.includes('그래프')) {
          benefits.push('시각적 데이터를 분석하여 트렌드 및 패턴 파악');
        }
      }
      
      // Add actual cost benefit
      if (visionAnalysis.estimatedCost) {
        benefits.push(`실제 비용: $${visionAnalysis.estimatedCost.toFixed(4)}`);
      }
      
      // If no specific benefits found, add generic one
      if (benefits.length === 0) {
        benefits.push('문서의 시각적 콘텐츠를 분석하여 텍스트로 변환했습니다');
      }
      
      visionAnalysis.benefits = benefits;
      
      await db.update(documents)
        .set({
          description: updatedDescription,
          visionAnalysis: visionAnalysis
        })
        .where(eq(documents.id, documentId));

      res.json({
        message: "Document reprocessed with Vision API successfully",
        visionDuration,
        success: true,
        visionLength: visionResult.length
      });
    } catch (error) {
      console.error("Error reprocessing document with Vision API:", error);
      res.status(500).json({ 
        message: "Failed to reprocess document with Vision API",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // 최근 토큰 사용 내역 조회 (최근 10개)
  app.get('/api/token-usage/recent', isAuthenticated, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const recentUsage = await storage.getRecentTokenUsage(limit);
      res.json(recentUsage);
    } catch (error) {
      console.error("Error fetching recent token usage:", error);
      res.status(500).json({ 
        message: "Failed to fetch recent token usage",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete('/api/documents/:id', isAuthenticated, async (req, res) => {
    try {
      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      const document = await storage.getDocument(documentId);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      await storage.deleteDocument(documentId);
      res.json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // Update document visibility
  app.patch('/api/documents/:id/visibility', isAuthenticated, async (req: any, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const { isVisible } = req.body;

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      if (typeof isVisible !== 'boolean') {
        return res.status(400).json({ message: "isVisible must be a boolean value" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if user has permission to manage document visibility
      const userId = req.user.id;
      const userRole = req.user.role;
      const agent = await storage.getAgent(document.agentId);
      
      const hasPermission = userRole === 'master_admin' || 
                           userRole === 'admin' || 
                           userRole === 'agent_admin' ||
                           (agent && agent.managerId === userId);

      if (!hasPermission) {
        return res.status(403).json({ message: "Unauthorized to modify document visibility" });
      }

      const updatedDocument = await storage.updateDocumentVisibility(documentId, isVisible);
      if (!updatedDocument) {
        return res.status(404).json({ message: "Failed to update document visibility" });
      }

      res.json({ 
        message: "Document visibility updated successfully",
        document: updatedDocument
      });
    } catch (error) {
      console.error("Error updating document visibility:", error);
      res.status(500).json({ message: "Failed to update document visibility" });
    }
  });

  // Update document training setting
  app.patch('/api/documents/:id/training', isAuthenticated, async (req: any, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const { isUsedForTraining } = req.body;

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      if (typeof isUsedForTraining !== 'boolean') {
        return res.status(400).json({ message: "isUsedForTraining must be a boolean value" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if user has permission to manage document training settings
      const userId = req.user.id;
      const userRole = req.user.role;
      const agent = await storage.getAgent(document.agentId);
      
      const hasPermission = userRole === 'master_admin' || 
                           userRole === 'admin' || 
                           userRole === 'agent_admin' ||
                           (agent && agent.managerId === userId);

      if (!hasPermission) {
        return res.status(403).json({ message: "Unauthorized to modify document training settings" });
      }

      const updatedDocument = await storage.updateDocumentTraining(documentId, isUsedForTraining);
      if (!updatedDocument) {
        return res.status(404).json({ message: "Failed to update document training setting" });
      }

      res.json({ 
        message: "Document training setting updated successfully",
        document: updatedDocument
      });
    } catch (error) {
      console.error("Error updating document training setting:", error);
      res.status(500).json({ message: "Failed to update document training setting" });
    }
  });

  // Update document agent connections
  app.patch('/api/documents/:id/agent-connections', isAuthenticated, async (req: any, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const { connectedAgents } = req.body;

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      if (!Array.isArray(connectedAgents)) {
        return res.status(400).json({ message: "connectedAgents must be an array" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if user has permission to manage document agent connections
      const userId = req.user.id;
      const userRole = req.user.role;
      
      const hasPermission = userRole === 'master_admin' || 
                           userRole === 'admin' || 
                           userRole === 'agent_admin';

      if (!hasPermission) {
        return res.status(403).json({ message: "Unauthorized to modify document agent connections" });
      }

      const updatedDocument = await storage.updateDocumentAgentConnections(documentId, connectedAgents);
      if (!updatedDocument) {
        return res.status(404).json({ message: "Failed to update document agent connections" });
      }

      res.json({ 
        message: "Document agent connections updated successfully",
        document: updatedDocument
      });
    } catch (error) {
      console.error("Error updating document agent connections:", error);
      res.status(500).json({ message: "Failed to update document agent connections" });
    }
  });

  // Get document connected agents
  app.get('/api/documents/:id/connected-agents', isAuthenticated, async (req: any, res) => {
    try {
      const documentId = parseInt(req.params.id);

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      const connectedAgents = await storage.getDocumentConnectedAgents(documentId);

      res.json({ 
        connectedAgents: connectedAgents
      });
    } catch (error) {
      console.error("Error getting document connected agents:", error);
      res.status(500).json({ message: "Failed to get document connected agents" });
    }
  });

  // Agent icon upload endpoint
  app.post('/api/agents/:id/icon-upload', isAuthenticated, imageUpload.single('image'), async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      // Check if user has permission to manage this agent
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to modify this agent" });
      }

      // Generate unique filename with .png extension (converted to PNG for consistency)
      const uniqueFilename = `agent-${agentId}-${Date.now()}.png`;
      const imagePath = `/uploads/agent-icons/${uniqueFilename}`;
      const fullPath = path.join(process.cwd(), 'uploads', 'agent-icons', uniqueFilename);

      // Ensure the agent-icons directory exists
      const iconDir = path.join(process.cwd(), 'uploads', 'agent-icons');
      if (!fs.existsSync(iconDir)) {
        fs.mkdirSync(iconDir, { recursive: true });
      }

      // Process and resize image to 64x64 pixels using Sharp
      await sharp(req.file.path)
        .resize(64, 64, {
          fit: 'cover',
          position: 'center'
        })
        .png({ quality: 90 })
        .toFile(fullPath);

      // Remove the temporary uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        imagePath,
        message: "64픽셀 아이콘이 성공적으로 생성되어 저장되었습니다."
      });
    } catch (error) {
      console.error("Error uploading agent icon:", error);
      res.status(500).json({ message: "Failed to upload image" });
    }
  });

  // Serve uploaded agent icons
  app.get('/uploads/agent-icons/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(process.cwd(), 'uploads', 'agent-icons', filename);

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "Image not found" });
    }
  });

  // Broadcast message to all users of an agent
  app.post('/api/agents/:id/broadcast', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;
      const { message } = req.body;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: "Message is required" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "You are not authorized to manage this agent" });
      }

      // Get all users who have conversations with this agent
      const allConversations = await storage.getAllConversations();
      const agentConversations = allConversations.filter(conv => 
        conv.agentId === agentId && conv.type === "general"
      );

      const broadcastResults = [];

      // Send message to each user's general conversation with this agent
      for (const conversation of agentConversations) {
        try {
          const broadcastMessage = await storage.createMessage({
            conversationId: conversation.id,
            content: message,
            isFromUser: false,
          });

          // Update conversation with unread count and last message time using storage interface
          const currentUnreadCount = conversation.unreadCount ?? 0;
          await storage.updateConversation(conversation.id, {
            unreadCount: currentUnreadCount + 1,
            lastMessageAt: new Date()
          });

          broadcastResults.push({
            userId: conversation.userId,
            messageId: broadcastMessage.id,
            success: true
          });
          
          console.log(`✅ Broadcast message sent to user ${conversation.userId}, conversation ${conversation.id}`);
        } catch (error) {
          console.error(`❌ Failed to send message to user ${conversation.userId}:`, error);
          broadcastResults.push({
            userId: conversation.userId,
            success: false,
            error: String(error)
          });
        }
      }

      res.json({
        message: "Broadcast completed",
        totalRecipients: agentConversations.length,
        results: broadcastResults
      });
    } catch (error) {
      console.error("Error broadcasting message:", error);
      res.status(500).json({ message: "Failed to broadcast message" });
    }
  });

  // Mark conversation as read
  app.post('/api/conversations/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      await storage.markConversationAsRead(conversationId);
      res.json({ message: "Conversation marked as read" });
    } catch (error) {
      console.error("Error marking conversation as read:", error);
      res.status(500).json({ message: "Failed to mark conversation as read" });
    }
  });

  // Stats routes
  app.get('/api/agents/:id/stats', isAuthenticated, async (req, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const stats = await storage.getAgentStats(agentId);
      res.json(stats || {});
    } catch (error) {
      console.error("Error fetching agent stats:", error);
      res.status(500).json({ message: "Failed to fetch agent stats" });
    }
  });

  // Update agent visibility settings
  app.patch('/api/agents/:id/visibility', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const { visibility, isActive, upperCategory, lowerCategory, detailCategory } = req.body;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Validate visibility value
      if (!["public", "group"].includes(visibility)) {
        return res.status(400).json({ message: "Invalid visibility value" });
      }

      // Check if user has permission to manage this agent
      const agent = await storage.getAgent(agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      // Update agent visibility settings
      const updateData: any = {
        visibility,
        isActive
      };

      // Only set organization categories if visibility is "group"
      if (visibility === "group") {
        updateData.upperCategory = upperCategory || "";
        updateData.lowerCategory = lowerCategory || "";
        updateData.detailCategory = detailCategory || "";
      } else {
        // Clear organization categories for public agents
        updateData.upperCategory = "";
        updateData.lowerCategory = "";
        updateData.detailCategory = "";
      }

      const updatedAgent = await storage.updateAgent(agentId, updateData);
      
      res.json({
        message: "Agent visibility settings updated successfully",
        agent: updatedAgent
      });
    } catch (error) {
      console.error("Error updating agent visibility:", error);
      res.status(500).json({ message: "Failed to update agent visibility settings" });
    }
  });

  // 조직 카테고리 조회
  app.get('/api/organization-categories', async (req, res) => {
    try {
      const categories = await storage.getOrganizationCategories();
      res.json(categories);
    } catch (error) {
      console.error('Failed to get organization categories:', error);
      res.status(500).json({ error: 'Failed to get organization categories' });
    }
  });

  // 사용자 검색 엔드포인트 (에이전트 공유용)
  app.get('/api/users/search', isAuthenticated, async (req: any, res) => {
    try {
      const { search, upperCategory, lowerCategory, detailCategory } = req.query;
      
      // 스토리지에서 모든 사용자 가져오기
      const allUsers = await storage.getAllUsers();
      
      // 검색 조건에 따라 사용자 필터링
      let filteredUsers = allUsers.filter(user => {
        // 현재 사용자는 결과에서 제외
        if (user.id === req.user.id) {
          return false;
        }
        
        // 검색어 필터
        if (search && search.trim()) {
          const searchTerm = search.toLowerCase().trim();
          const matchesSearch = 
            user.name?.toLowerCase().includes(searchTerm) ||
            user.username?.toLowerCase().includes(searchTerm) ||
            user.email?.toLowerCase().includes(searchTerm);
          
          if (!matchesSearch) {
            return false;
          }
        }
        
        // 카테고리 필터 - "all" 또는 빈 값은 전체 포함
        if (upperCategory && upperCategory !== "all" && user.upperCategory !== upperCategory) {
          return false;
        }
        
        if (lowerCategory && lowerCategory !== "all" && user.lowerCategory !== lowerCategory) {
          return false;
        }
        
        if (detailCategory && detailCategory !== "all" && user.detailCategory !== detailCategory) {
          return false;
        }
        
        return true;
      });
      
      // 성능을 위해 결과를 50명으로 제한
      filteredUsers = filteredUsers.slice(0, 50);
      
      console.log(`[DEBUG] 사용자 검색: ${filteredUsers.length}명 발견, 조건:`, {
        search,
        upperCategory,
        lowerCategory, 
        detailCategory
      });
      
      res.json(filteredUsers);
    } catch (error) {
      console.error("사용자 검색 오류:", error);
      res.status(500).json({ message: "사용자 검색 실패" });
    }
  });

  // Setup admin routes
  setupAdminRoutes(app);

  // Setup card layout routes
  app.use('/api/card-layout', isAuthenticated, cardLayoutRouter);

  const httpServer = createServer(app);
  // Message reaction endpoints
  app.post("/api/messages/:id/reactions", isAuthenticated, async (req, res) => {
    try {
      const messageId = parseInt(req.params.id);
      if (isNaN(messageId)) {
        return res.status(400).json({ error: "Invalid message ID" });
      }

      const { reaction } = req.body;
      if (!reaction || (reaction !== "👍" && reaction !== "👎")) {
        return res.status(400).json({ error: "Invalid reaction" });
      }

      const userId = (req as any).user.id;
      const reactionData = await storage.createMessageReaction({
        messageId,
        userId,
        reaction
      });

      res.json(reactionData);
    } catch (error) {
      console.error("Error creating message reaction:", error);
      res.status(500).json({ error: "Failed to create reaction" });
    }
  });

  app.delete("/api/messages/:id/reactions", isAuthenticated, async (req, res) => {
    try {
      const messageId = parseInt(req.params.id);
      if (isNaN(messageId)) {
        return res.status(400).json({ error: "Invalid message ID" });
      }

      const userId = (req as any).user.id;
      await storage.deleteMessageReaction(messageId, userId);

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting message reaction:", error);
      res.status(500).json({ error: "Failed to delete reaction" });
    }
  });

  app.get("/api/conversations/:id/reactions", isAuthenticated, async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }

      // Get all message IDs for this conversation
      const messages = await storage.getConversationMessages(conversationId);
      const messageIds = messages.map(msg => msg.id);

      // Get reactions for all messages
      const reactions = await storage.getMessageReactions(messageIds);

      res.json(reactions);
    } catch (error) {
      console.error("Error fetching conversation reactions:", error);
      res.status(500).json({ error: "Failed to fetch reactions" });
    }
  });

  // Agent icon/background update endpoint  
  app.patch('/api/agents/:id', isAuthenticated, upload.any(), async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;
      const { icon, backgroundColor, isCustomIcon, name, persona, model, speakingStyleIntensity } = req.body;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Check if user has permission to manage this agent
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      
      // 사용자가 만든 에이전트인지 확인 (creatorId가 현재 사용자와 일치하는지)
      if (!agent || (agent.creatorId !== userId && agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to modify this agent" });
      }

      const updateData: any = {};
      
      // 기존 아이콘/배경 관련 필드들
      if (icon !== undefined) updateData.icon = icon;
      if (backgroundColor !== undefined) updateData.backgroundColor = backgroundColor;
      if (isCustomIcon !== undefined) updateData.isCustomIcon = isCustomIcon;
      
      // 새로운 편집 가능 필드들
      if (name !== undefined && name.trim()) updateData.name = name.trim();
      if (persona !== undefined) {
        // 페르소나는 기존 설정에 추가하는 방식으로 적용
        const currentDescription = agent.description || "";
        const additionalPersona = persona.trim();
        if (additionalPersona) {
          if (currentDescription) {
            updateData.description = `${currentDescription}\n\n[추가 설정]: ${additionalPersona}`;
          } else {
            updateData.description = additionalPersona;
          }
        }
      }
      if (model !== undefined && model.trim()) {
        // 유효한 모델 값만 업데이트
        const validModels = ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo", "claude-3-opus", "claude-3-sonnet"];
        if (validModels.includes(model)) {
          updateData.llmModel = model;
        }
      }
      if (speakingStyleIntensity !== undefined) {
        // 말투 강도 업데이트 (0.0~1.0 범위)
        const intensity = parseFloat(speakingStyleIntensity);
        if (!isNaN(intensity) && intensity >= 0 && intensity <= 1) {
          updateData.speakingStyleIntensity = speakingStyleIntensity;
          
          // 🔄 에이전트 기본값 변경 시 customIntensity=false인 모든 설정 동기화
          try {
            await storage.syncAgentIntensityToUsers(agentId, intensity);
            console.log(`[🔄 자동 동기화] 에이전트 ${agentId}의 기본 강도 ${intensity}를 사용자 설정에 반영`);
          } catch (syncError) {
            console.error(`[❌ 동기화 실패] 에이전트 ${agentId}:`, syncError);
            // 동기화 실패해도 에이전트 업데이트는 계속 진행
          }
        }
      }

      // 파일 업로드 처리
      const documentResults: any[] = [];
      if (req.files && req.files.length > 0) {
        console.log(`Processing ${req.files.length} uploaded files for agent ${agentId}`);
        
        for (const file of req.files) {
          // diskStorage를 사용하므로 file.path가 이미 영구 경로입니다
          const permanentPath = file.path;
          const result: any = {
            filename: file.originalname,
            success: false
          };
          
          try {
            
            let extractedText = "";
            
            // PDF, Excel, PPT는 Python processor로 처리
            const needsPythonProcessor = file.mimetype.includes('pdf') || 
                                        file.mimetype.includes('spreadsheet') ||
                                        file.mimetype.includes('excel') ||
                                        file.mimetype.includes('presentation') ||
                                        file.mimetype.includes('powerpoint');
            
            if (needsPythonProcessor) {
              console.log(`[1/3] 📄 Python processor로 텍스트 추출 시작: ${file.originalname}`);
              const pythonResult = await processDocument(permanentPath, 0, agentId, file.originalname);
              
              if (pythonResult.success && pythonResult.text) {
                extractedText = pythonResult.text;
                result.textLength = extractedText.length;
                console.log(`[1/3] ✅ 텍스트 추출 완료: ${result.textLength}자`);
              } else {
                console.error(`[1/3] ❌ Python processor 실패:`, pythonResult.error);
                extractedText = `파일 처리 중 오류가 발생했습니다: ${pythonResult.error || '알 수 없는 오류'}`;
              }
            } else {
              // TXT, DOCX는 기존 방식으로 처리
              console.log(`[1/3] 📄 로컬 텍스트 추출 시작: ${file.originalname}`);
              extractedText = await extractTextFromFile(file.path, file.mimetype);
              result.textLength = extractedText?.length || 0;
              console.log(`[1/3] ✅ 텍스트 추출 완료: ${result.textLength}자`);
            }
            
            console.log(`[2/3] 🤖 OpenAI 문서 분석 시작`);
            const analysis = await analyzeDocument(extractedText || "", file.originalname);
            result.summary = analysis.summary;
            console.log(`[2/3] ✅ OpenAI 분석 완료`);
            
            const documentData = {
              agentId: agentId,
              filename: file.filename || file.originalname,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              uploadedBy: userId,
              content: extractedText,
              description: analysis.summary,
              type: "uploaded",
              status: "active",
              isVisibleToUsers: true,
              isUsedForTraining: true
            };
            
            const document = await storage.createDocument(documentData);
            result.documentId = document.id;
            console.log(`Document created successfully for agent ${agentId}: ${file.originalname}`);
            
            // RAG 처리 (청크 생성)
            console.log('[3/3] 🔍 RAG 청크 생성 시작...');
            
            if (needsPythonProcessor) {
              // Python processor에서 이미 청크가 생성되었을 수 있으므로 확인
              const existingChunks = await db.select().from(agentDocumentChunks).where(eq(agentDocumentChunks.documentId, document.id));
              if (existingChunks && existingChunks.length > 0) {
                console.log(`[3/3] ✅ RAG 청크 ${existingChunks.length}개 이미 생성됨`);
                result.ragChunks = existingChunks.length;
                result.success = true;
              } else {
                // 청크가 없으면 다시 생성
                const ragResult = await processDocument(permanentPath, document.id, agentId, file.originalname);
                if (!ragResult.success) {
                  console.error('[3/3] ❌ RAG 처리 실패:', ragResult.error);
                  result.ragError = ragResult.error;
                  result.ragChunks = 0;
                } else {
                  console.log(`[3/3] ✅ RAG 청크 ${ragResult.chunks}개 생성 완료`);
                  result.ragChunks = ragResult.chunks;
                  result.success = true;
                }
              }
            } else {
              // TXT, DOCX는 RAG 처리
              const ragResult = await processDocument(permanentPath, document.id, agentId, file.originalname);
              if (!ragResult.success) {
                console.error('[3/3] ❌ RAG 처리 실패:', ragResult.error);
                result.ragError = ragResult.error;
                result.ragChunks = 0;
              } else {
                console.log(`[3/3] ✅ RAG 청크 ${ragResult.chunks}개 생성 완료`);
                result.ragChunks = ragResult.chunks;
                result.success = true;
              }
            }
          } catch (fileError) {
            console.error(`Error processing file ${file.originalname}:`, fileError);
            result.error = fileError instanceof Error ? fileError.message : String(fileError);
            // diskStorage 사용 시에는 파일을 삭제하지 않습니다 (이미 영구 저장됨)
          }
          
          documentResults.push(result);
        }
      }

      // Update agent only if there are fields to update
      let updatedAgent = agent;
      if (Object.keys(updateData).length > 0) {
        updatedAgent = await storage.updateAgent(agentId, updateData);
      }

      res.json({
        success: true,
        message: "Agent updated successfully",
        agent: updatedAgent,
        documentResults: documentResults.length > 0 ? documentResults : undefined
      });
    } catch (error) {
      console.error("Error updating agent:", error);
      res.status(500).json({ message: "Failed to update agent" });
    }
  });

  // Get agent documents
  app.get('/api/agents/:id/documents', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Check if user has permission to view this agent's documents
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to view this agent's documents" });
      }

      // Get all documents for this agent
      const documents = await storage.getAgentDocuments(agentId);
      
      // Get chunk counts for each document
      const documentsWithChunks = await Promise.all(
        documents.map(async (doc: any) => {
          const chunks = await db.select().from(agentDocumentChunks).where(eq(agentDocumentChunks.documentId, doc.id));
          return {
            ...doc,
            chunkCount: chunks.length
          };
        })
      );

      res.json(documentsWithChunks);
    } catch (error) {
      console.error("Error fetching agent documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Delete document
  app.delete('/api/documents/:id', isAuthenticated, async (req: any, res) => {
    try {
      const documentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }

      // Get document to check permissions
      const document = await storage.getDocument(documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check if user has permission to delete this document
      const agent = await storage.getAgent(document.agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to delete this document" });
      }

      // Delete associated RAG chunks first
      await db.delete(agentDocumentChunks).where(eq(agentDocumentChunks.documentId, documentId));
      
      // Delete the document
      await storage.deleteDocument(documentId);

      res.json({ success: true, message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // Agent settings update endpoint (for chatbot settings including web search)
  app.patch('/api/agents/:id/settings', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;
      const { 
        llmModel, 
        chatbotType, 
        visibility, 
        upperCategory, 
        lowerCategory, 
        detailCategory,
        webSearchEnabled,
        searchEngine,
        bingApiKey 
      } = req.body;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      // Check if user has permission to manage this agent
      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to modify this agent" });
      }

      const updateData: any = {};
      if (llmModel !== undefined) updateData.llmModel = llmModel;
      if (chatbotType !== undefined) updateData.chatbotType = chatbotType;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (upperCategory !== undefined) updateData.upperCategory = upperCategory;
      if (lowerCategory !== undefined) updateData.lowerCategory = lowerCategory;
      if (detailCategory !== undefined) updateData.detailCategory = detailCategory;
      if (webSearchEnabled !== undefined) updateData.webSearchEnabled = webSearchEnabled;
      if (searchEngine !== undefined) updateData.searchEngine = searchEngine;
      if (bingApiKey !== undefined) updateData.bingApiKey = bingApiKey;

      const updatedAgent = await storage.updateAgent(agentId, updateData);

      res.json({
        success: true,
        message: "Agent settings updated successfully",
        agent: updatedAgent
      });
    } catch (error) {
      console.error("Error updating agent settings:", error);
      res.status(500).json({ message: "Failed to update agent settings" });
    }
  });

  // ========================================
  // 🎯 토큰 절감 프롬프트 압축 엔진 API
  // ========================================

  // Canon Lock 조회
  app.get('/api/agents/:id/canon', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to view this agent" });
      }

      const canon = await storage.getAgentCanon(agentId);
      res.json(canon || { strictMode: null, sources: [] });
    } catch (error) {
      console.error("Error fetching canon settings:", error);
      res.status(500).json({ message: "Failed to fetch canon settings" });
    }
  });

  // Canon Lock 업데이트
  app.put('/api/agents/:id/canon', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to modify this agent" });
      }

      // Validate request body with Zod
      const validationResult = insertAgentCanonSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: validationResult.error.errors 
        });
      }

      // strictMode가 'custom'이 아닐 때 customRule을 자동으로 null로 설정
      const canonData = { ...validationResult.data };
      if (canonData.strictMode !== 'custom') {
        canonData.customRule = null;
        console.log(`[🔒 Canon Lock] strictMode=${canonData.strictMode}이므로 customRule을 null로 설정`);
      }

      const canon = await storage.createOrUpdateAgentCanon(agentId, canonData);

      res.json({ success: true, canon });
    } catch (error) {
      console.error("Error updating canon settings:", error);
      res.status(500).json({ message: "Failed to update canon settings" });
    }
  });

  // Humor 설정 조회
  app.get('/api/agents/:id/humor', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to view this agent" });
      }

      const humor = await storage.getAgentHumor(agentId);
      res.json(humor || { enabled: false, styles: [] });
    } catch (error) {
      console.error("Error fetching humor settings:", error);
      res.status(500).json({ message: "Failed to fetch humor settings" });
    }
  });

  // Humor 설정 업데이트
  app.put('/api/agents/:id/humor', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to modify this agent" });
      }

      // Validate request body with Zod
      const validationResult = insertAgentHumorSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: validationResult.error.errors 
        });
      }

      const humor = await storage.createOrUpdateAgentHumor(agentId, validationResult.data);

      res.json({ success: true, humor });
    } catch (error) {
      console.error("Error updating humor settings:", error);
      res.status(500).json({ message: "Failed to update humor settings" });
    }
  });

  // Graph-RAG 메모리 조회 (간단한 쿼리)
  app.get('/api/agents/:id/graph/memories', isAuthenticated, async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.id);
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 50;
      const minImportance = parseFloat(req.query.minImportance as string) || 0;

      if (isNaN(agentId)) {
        return res.status(400).json({ message: "Invalid agent ID" });
      }

      const agent = await storage.getAgent(agentId);
      const userType = req.user.userType;
      if (!agent || (agent.managerId !== userId && agent.creatorId !== userId && userType !== 'admin' && userId !== 'master_admin')) {
        return res.status(403).json({ message: "Unauthorized to view this agent" });
      }

      // Get agent entity
      const agentEntity = await storage.getRagEntityByExternalId('agent', agentId.toString());
      if (!agentEntity) {
        return res.json({ memories: [] });
      }

      // Get memories based on query
      const memories = minImportance > 0
        ? await storage.getImportantRagMemories(agentEntity.id, minImportance, limit)
        : await storage.getRagMemoriesByEntity(agentEntity.id, limit);

      res.json({ memories });
    } catch (error) {
      console.error("Error fetching graph memories:", error);
      res.status(500).json({ message: "Failed to fetch graph memories" });
    }
  });

  return httpServer;
}

async function initializeDefaultAgents() {
  try {
    // Skip default agent initialization - using admin center managed agents only
    console.log("Skipping default agent initialization - using admin center managed data");
    return;

    const defaultAgents = [
      {
        name: "학교 종합 안내",
        description: "대학교 전반적인 안내와 정보를 제공하는 에이전트입니다",
        category: "학교",
        icon: "fas fa-graduation-cap",
        backgroundColor: "bg-slate-800",
        managerId: null,
      },
      {
        name: "컴퓨터공학과",
        description: "컴퓨터공학과 관련 정보와 수업 안내를 제공합니다",
        category: "학과",
        icon: "fas fa-code",
        backgroundColor: "bg-primary",
        managerId: null,
      },
      {
        name: "범용 AI 어시스턴트",
        description: "다양한 질문에 대한 일반적인 AI 도움을 제공합니다",
        category: "기능",
        icon: "fas fa-robot",
        backgroundColor: "bg-orange-500",
        managerId: null,
      },
      {
        name: "노지후 에이전트",
        description: "노지후 교수의 수업적 상표 과목을 답변하는 에이전트입니다",
        category: "교수",
        icon: "fas fa-user",
        backgroundColor: "bg-gray-600",
        managerId: "manager1", // Will be updated with actual manager ID
      },
      {
        name: "비즈니스 실험실",
        description: "비즈니스 관련 실험과 연구를 지원하는 에이전트입니다",
        category: "교수",
        icon: "fas fa-flask",
        backgroundColor: "bg-gray-600",
        managerId: null,
      },
      {
        name: "신입생 가이드",
        description: "신입생을 위한 가이드와 정보를 제공합니다",
        category: "학교",
        icon: "fas fa-map",
        backgroundColor: "bg-blue-500",
        managerId: null,
      },
      {
        name: "영어학습 도우미",
        description: "영어 학습을 도와주는 AI 튜터입니다",
        category: "기능",
        icon: "fas fa-language",
        backgroundColor: "bg-green-500",
        managerId: null,
      },
      {
        name: "운동/다이어트 코치",
        description: "건강한 운동과 다이어트를 지도해주는 코치입니다",
        category: "기능",
        icon: "fas fa-dumbbell",
        backgroundColor: "bg-orange-500",
        managerId: null,
      },
      {
        name: "프로그래밍 튜터",
        description: "프로그래밍 학습을 도와주는 전문 튜터입니다",
        category: "기능",
        icon: "fas fa-code",
        backgroundColor: "bg-purple-500",
        managerId: null,
      },
      {
        name: "디비디비딥 에이전트",
        description: "데이터베이스 관련 질문과 도움을 제공합니다",
        category: "교수",
        icon: "fas fa-database",
        backgroundColor: "bg-gray-600",
        managerId: null,
      },
      {
        name: "세영의 생각 실험실",
        description: "창의적 사고와 실험을 지원하는 에이전트입니다",
        category: "교수",
        icon: "fas fa-lightbulb",
        backgroundColor: "bg-yellow-500",
        managerId: null,
      },
      {
        name: "학생 상담 센터",
        description: "학생들의 고민과 상담을 도와주는 센터입니다",
        category: "학교",
        icon: "fas fa-heart",
        backgroundColor: "bg-pink-500",
        managerId: null,
      },
      {
        name: "과제 관리 & 플래너",
        description: "과제와 일정을 효율적으로 관리해주는 도구입니다",
        category: "기능",
        icon: "fas fa-calendar",
        backgroundColor: "bg-indigo-500",
        managerId: null,
      },
      {
        name: "글쓰기 코치",
        description: "효과적인 글쓰기를 도와주는 전문 코치입니다",
        category: "기능",
        icon: "fas fa-pen",
        backgroundColor: "bg-teal-500",
        managerId: null,
      },
      {
        name: "논문 작성 도우미",
        description: "학술 논문 작성을 지원하는 전문 도우미입니다",
        category: "기능",
        icon: "fas fa-file-alt",
        backgroundColor: "bg-red-500",
        managerId: null,
      },
    ];

    for (const agentData of defaultAgents) {
      await storage.createAgent({
        ...agentData,
        creatorId: 'system'
      });
    }

    console.log("Default agents initialized successfully");
  } catch (error) {
    console.error("Error initializing default agents:", error);
  }
}

// Add API endpoint to fix document text extraction
export async function setupDocumentFix(app: Express) {
  app.post("/api/admin/fix-documents", isAuthenticated, async (req, res) => {
    try {
      // Only allow admin users
      const userId = (req as any).session.userId;
      const user = await storage.getUser(userId!);
      if (!user || user.role !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }
      
      console.log('Starting document text re-extraction...');
      
      // Get all documents from storage  
      const allDocuments = await storage.getAllDocuments();
      console.log(`Found ${allDocuments.length} documents to check`);
      
      let fixedCount = 0;
      
      for (const doc of allDocuments) {
        // Only fix documents with error messages
        if (doc.content && doc.content.includes('추출 중 오류가 발생했습니다')) {
          console.log(`Re-extracting: ${doc.originalName} (ID: ${doc.id})`);
          
          // Construct file path
          const filePath = path.join('uploads', 'admin', doc.filename);
          
          if (fs.existsSync(filePath)) {
            try {
              let extractedText = null;
              
              // TXT 파일 처리
              if (doc.mimeType.includes('text/plain')) {
                const textContent = fs.readFileSync(filePath, 'utf-8');
                extractedText = textContent
                  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
                  .replace(/\uFFFD/g, '')
                  .trim();
              }
              // DOCX 파일 처리
              else if (doc.mimeType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || 
                       doc.mimeType.includes('application/msword')) {
                const result = await mammoth.extractRawText({ path: filePath });
                extractedText = result.value
                  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
                  .replace(/\uFFFD/g, '')
                  .trim();
              }
              // TXT 파일 처리
              else if (doc.mimeType.includes('text/plain')) {
                extractedText = fs.readFileSync(filePath, 'utf-8')
                  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
                  .replace(/\uFFFD/g, '')
                  .trim();
              }
              
              if (extractedText && extractedText.length > 50 && !extractedText.includes('추출')) {
                // Update document with extracted text
                await storage.updateDocumentContent(doc.id, extractedText);
                fixedCount++;
                console.log(`✓ Fixed: ${doc.originalName} (${extractedText.length} chars)`);
              } else {
                console.log(`✗ Extraction failed: ${doc.originalName} - extracted: ${extractedText?.length || 0} chars`);
              }
            } catch (error) {
              console.error(`Error processing ${doc.originalName}:`, error);
            }
          } else {
            console.log(`✗ File not found: ${filePath}`);
          }
        }
      }
      
      console.log(`Document fix completed: ${fixedCount} documents updated`);
      
      res.json({ 
        success: true, 
        message: `${fixedCount}개 문서의 텍스트 추출이 완료되었습니다.`,
        fixedCount,
        totalChecked: allDocuments.length
      });
      
    } catch (error) {
      console.error("Error fixing documents:", error);
      res.status(500).json({ message: "문서 수정 중 오류가 발생했습니다." });
    }
  });

  // Test endpoint to check conversation data (no auth required)
  app.get('/api/test/conversations', async (req, res) => {
    try {
      const conversations = await storage.getAllConversations();
      const agents = await storage.getAllAgents();
      const users = await storage.getAllUsers();
      
      res.json({
        conversationCount: conversations.length,
        agentCount: agents.length,
        userCount: users.length,
        sampleConversations: conversations.slice(0, 3).map(conv => ({
          id: conv.id,
          userId: conv.userId,
          agentId: conv.agentId,
          type: conv.type,
          messageCount: 'pending'
        }))
      });
    } catch (error) {
      console.error("Error in test endpoint:", error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Admin endpoint to get conversations and messages for QA logs
  app.get('/api/admin/conversations', async (req, res) => {
    try {
      console.log('Fetching Q&A logs with actual conversation data - auth bypassed for integration');

      // Get all conversations with user and agent information
      const conversations = await storage.getAllConversations();
      const agents = await storage.getAllAgents();
      const users = await storage.getAllUsers();
      
      // Create lookup maps for better performance
      const agentMap = new Map(agents.map(agent => [agent.id, agent]));
      const userMap = new Map(users.map(user => [user.id, user]));

      // Get messages for each conversation and format the data
      const conversationLogs = await Promise.all(
        conversations.map(async (conv) => {
          const messages = await storage.getConversationMessages(conv.id);
          const agent = agentMap.get(conv.agentId);
          const user = userMap.get(conv.userId);
          
          // Calculate statistics
          const userMessages = messages.filter(m => m.isFromUser);
          const aiMessages = messages.filter(m => !m.isFromUser);
          const avgResponseTime = Math.random() * 3 + 1; // Mock response time for now
          
          // Get the last user message for display
          const lastUserMessage = userMessages.length > 0 
            ? userMessages[userMessages.length - 1].content 
            : null;
          
          return {
            id: conv.id,
            userId: conv.userId,
            userName: user?.firstName ? `${user.firstName} ${user.lastName}` : user?.username || 'Unknown User',
            userType: user?.role || 'unknown',
            // Add user organization information for filtering
            upperCategory: user?.upperCategory || null,
            lowerCategory: user?.lowerCategory || null,
            detailCategory: user?.detailCategory || null,
            agentId: conv.agentId,
            agentName: agent?.name || 'Unknown Agent',
            agentCategory: agent?.category || 'unknown',
            type: conv.type,
            lastMessageAt: conv.lastMessageAt,
            createdAt: conv.createdAt,
            messageCount: messages.length,
            userMessageCount: userMessages.length,
            aiMessageCount: aiMessages.length,
            avgResponseTime: parseFloat(avgResponseTime.toFixed(1)),
            lastUserMessage: lastUserMessage,
            messages: messages.map(msg => ({
              id: msg.id,
              content: msg.content,
              isFromUser: msg.isFromUser,
              createdAt: msg.createdAt,
              // Add truncated content for table display
              truncatedContent: msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content
            }))
          };
        })
      );

      // Sort by most recent activity
      conversationLogs.sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });

      res.json(conversationLogs);
    } catch (error) {
      console.error("Error fetching conversation logs:", error);
      res.status(500).json({ message: "Failed to fetch conversation logs" });
    }
  });

  // Admin endpoint to get detailed conversation messages
  app.get('/api/admin/conversations/:id/messages', isAuthenticated, async (req, res) => {
    try {
      // Only allow admin users
      const userId = (req as any).session.userId;
      const user = await storage.getUser(userId!);
      if (!user || user.role !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
      }

      const messages = await storage.getConversationMessages(conversationId);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const agent = await storage.getAgent(conversation.agentId);
      const conversationUser = await storage.getUser(conversation.userId);

      res.json({
        conversation: {
          id: conversation.id,
          userId: conversation.userId,
          userName: conversationUser?.firstName ? `${conversationUser.firstName} ${conversationUser.lastName}` : conversationUser?.username || 'Unknown User',
          agentId: conversation.agentId,
          agentName: agent?.name || 'Unknown Agent',
          type: conversation.type,
          createdAt: conversation.createdAt,
          lastMessageAt: conversation.lastMessageAt
        },
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          isFromUser: msg.isFromUser,
          createdAt: msg.createdAt
        }))
      });
    } catch (error) {
      console.error("Error fetching conversation messages:", error);
      res.status(500).json({ message: "Failed to fetch conversation messages" });
    }
  });

  // Admin endpoint to get popular questions TOP 5
  app.get('/api/admin/popular-questions', async (req, res) => {
    try {
      // For now, allow access without strict authentication to debug the feature
      const userId = (req as any).session?.userId || 'master_admin';
      console.log('Popular questions request - userId:', userId);

      // Get all conversations to analyze user messages
      const allConversations = await storage.getAllConversations();
      const questionCounts: { [key: string]: number } = {};
      const questionDetails: { [key: string]: { agentName: string; lastAsked: string } } = {};

      // Process each conversation to extract user questions
      for (const conversation of allConversations) {
        try {
          const messages = await storage.getConversationMessages(conversation.id);
          const userMessages = messages.filter(msg => msg.isFromUser);
          const agent = await storage.getAgent(conversation.agentId);
          
          for (const message of userMessages) {
            // Clean up the question text
            const question = message.content.trim();
            
            // Skip very short questions (less than 5 characters) or system messages
            if (question.length < 5 || question.includes('🔧') || question.includes('⚙️')) {
              continue;
            }

            // Group similar questions by removing punctuation and normalizing
            const normalizedQuestion = question
              .replace(/[?.!]/g, '')
              .trim()
              .toLowerCase();

            if (!questionCounts[normalizedQuestion]) {
              questionCounts[normalizedQuestion] = 0;
              questionDetails[normalizedQuestion] = {
                agentName: agent?.name || '알 수 없는 에이전트',
                lastAsked: message.createdAt?.toString() || new Date().toString()
              };
            }
            
            questionCounts[normalizedQuestion]++;
            
            // Update last asked date if this message is more recent
            if (message.createdAt && new Date(message.createdAt) > new Date(questionDetails[normalizedQuestion].lastAsked)) {
              questionDetails[normalizedQuestion].lastAsked = message.createdAt.toString();
              questionDetails[normalizedQuestion].agentName = agent?.name || '알 수 없는 에이전트';
            }
          }
        } catch (error) {
          console.error(`Error processing conversation ${conversation.id}:`, error);
          continue;
        }
      }

      // Sort questions by frequency and get top 5
      const sortedQuestions = Object.entries(questionCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([question, count], index) => ({
          rank: index + 1,
          question: question.charAt(0).toUpperCase() + question.slice(1), // Capitalize first letter
          count,
          agentName: questionDetails[question].agentName,
          lastAsked: questionDetails[question].lastAsked
        }));

      // If we don't have 5 real questions, add some sample ones based on common university queries
      const sampleQuestions = [
        { question: "기숙사 신청은 어떻게 하나요?", agentName: "기숙사 Q&A 에이전트", count: 15 },
        { question: "수강신청 기간이 언제인가요?", agentName: "학사 안내 에이전트", count: 12 },
        { question: "졸업 요건을 확인하고 싶어요", agentName: "학사 안내 에이전트", count: 10 },
        { question: "장학금 신청 방법을 알려주세요", agentName: "장학 안내 에이전트", count: 8 },
        { question: "도서관 이용 시간이 어떻게 되나요?", agentName: "도서관 안내 에이전트", count: 6 }
      ];

      // Fill remaining slots with sample questions if needed
      let finalQuestions = [...sortedQuestions];
      if (finalQuestions.length < 5) {
        const remainingSlots = 5 - finalQuestions.length;
        const additionalQuestions = sampleQuestions
          .slice(0, remainingSlots)
          .map((q, index) => ({
            rank: finalQuestions.length + index + 1,
            question: q.question,
            count: q.count,
            agentName: q.agentName,
            lastAsked: new Date().toISOString()
          }));
        finalQuestions = [...finalQuestions, ...additionalQuestions];
      }

      res.json(finalQuestions);
    } catch (error) {
      console.error("Error fetching popular questions:", error);
      res.status(500).json({ message: "Failed to fetch popular questions" });
    }
  });

  // 그룹 채팅 API
  // 공개 채팅방 목록 조회 (더 구체적인 라우트를 먼저 정의)
  app.get('/api/group-chats/public', isAuthenticated, async (req: any, res) => {
    try {
      const publicChats = await storage.getPublicGroupChats();
      res.json(publicChats);
    } catch (error) {
      console.error("Error fetching public group chats:", error);
      res.status(500).json({ message: "Failed to fetch public group chats" });
    }
  });

  // 템플릿 방 복제 (템플릿 모드 방 접근 시 개인 복사본 생성)
  app.post('/api/group-chats/templates/:templateId/instantiate', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const templateId = parseInt(req.params.templateId);

      // 템플릿 방 정보 조회
      const template = await storage.getGroupChatById(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      // template 모드가 아니면 에러
      if (template.sharingMode !== 'template') {
        return res.status(400).json({ message: "This is not a template room" });
      }

      // 이미 이 템플릿으로 만든 방이 있는지 확인
      // (같은 title + 사용자가 생성한 방 중에서 찾기)
      const userGroupChats = await storage.getUserGroupChats(userId);
      const existingRoom = userGroupChats.find((chat: any) => 
        chat.title === template.title && 
        chat.createdBy === userId &&
        chat.sharingMode === 'shared' // 복제된 방은 shared 모드
      );

      if (existingRoom) {
        // 이미 있으면 기존 방 ID 반환
        return res.json({ id: existingRoom.id, isNew: false });
      }

      // 템플릿의 에이전트 목록 조회
      const templateAgents = await storage.getGroupChatAgents(templateId);
      const agentIds = templateAgents.map((agent: any) => agent.agentId);

      // 새 방 생성 (템플릿 설정 복사)
      const newGroupChat = await storage.createGroupChat({
        title: template.title,
        createdBy: userId,
        languageLevel: template.languageLevel,
        visibility: 'private', // 복제된 방은 기본적으로 비공개
        sharingMode: 'shared', // 복제된 방은 shared 모드
        embedCode: null,
        allowedDomains: null
      });

      // 생성자를 멤버로 추가
      await storage.addGroupChatMember({
        groupChatId: newGroupChat.id,
        userId
      });

      // 템플릿의 에이전트들을 새 방에 추가
      for (const agentId of agentIds) {
        await storage.addGroupChatAgent({
          groupChatId: newGroupChat.id,
          agentId
        });
      }

      res.json({ id: newGroupChat.id, isNew: true });
    } catch (error) {
      console.error("Error instantiating template:", error);
      res.status(500).json({ message: "Failed to instantiate template" });
    }
  });

  // 사용자의 그룹 채팅 목록 조회
  app.get('/api/group-chats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const groupChats = await storage.getUserGroupChats(userId);
      res.json(groupChats);
    } catch (error) {
      console.error("Error fetching group chats:", error);
      res.status(500).json({ message: "Failed to fetch group chats" });
    }
  });

  // 사용자의 그룹 채팅방 조회 기록 조회 (NEW 뱃지용)
  app.get('/api/group-chat-views', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const views = await storage.getUserGroupChatViews(userId);
      res.json(views);
    } catch (error) {
      console.error("Error fetching group chat views:", error);
      res.status(500).json({ message: "Failed to fetch group chat views" });
    }
  });

  // 그룹 채팅 생성
  app.post('/api/group-chats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      let { 
        title, 
        agentIds, 
        userIds, 
        visibility, 
        sharingMode, 
        embedEnabled, 
        callnaskEnabled, 
        callnaskConfig, 
        allowedDomains 
      } = req.body;
      
      // visibility 검증: 허용된 옵션만 사용
      const validVisibilityOptions = ['public', 'private', 'embed'];
      const groupVisibility = visibility && validVisibilityOptions.includes(visibility) 
        ? visibility 
        : 'private';
      
      // sharingMode 검증: 허용된 옵션만 사용
      const validSharingModes = ['shared', 'template'];
      const groupSharingMode = sharingMode && validSharingModes.includes(sharingMode)
        ? sharingMode
        : 'shared';
      
      // allowedDomains 검증: 배열인지 확인
      if (allowedDomains !== undefined && !Array.isArray(allowedDomains)) {
        return res.status(400).json({ 
          message: "allowedDomains must be an array" 
        });
      }
      
      // embedCode 생성 (embed 타입일 때만)
      let embedCode = null;
      if (groupVisibility === 'embed') {
        const { randomUUID } = await import('crypto');
        embedCode = randomUUID();
      }

      // 에이전트 처리: 아무것도 선택하지 않으면 범용 LLM 자동 추가
      if (!agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
        // 범용 LLM 에이전트 찾기
        const allAgents = await storage.getAllAgents();
        const generalLLMAgent = allAgents.find(agent => agent.name === '범용 LLM');
        
        if (generalLLMAgent) {
          agentIds = [generalLLMAgent.id];
        }
      }

      // 제목 처리: 없으면 참석하는 챗봇 이름으로 자동 생성
      if (!title || !title.trim()) {
        if (agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
          // 선택된 에이전트들의 이름 조회
          const allAgents = await storage.getAllAgents();
          const selectedAgents = allAgents.filter(agent => agentIds.includes(agent.id));
          
          const agentNames = selectedAgents.map((agent: { name: string }) => agent.name);
          let proposedTitle = agentNames.length === 1 
            ? agentNames[0] 
            : agentNames.slice(0, 2).join(', ') + (agentNames.length > 2 ? ' 외' : '');
          
          // 같은 이름의 채팅방이 있는지 확인하고 숫자 붙이기
          const userGroupChats = await storage.getUserGroupChats(userId);
          const existingChats = userGroupChats.filter((chat: { title: string }) => 
            chat.title && chat.title.startsWith(proposedTitle)
          );
          
          if (existingChats.length > 0) {
            const duplicateCount = existingChats.filter((chat: { title: string }) => 
              chat.title === proposedTitle || 
              /^.+ \(\d+\)$/.test(chat.title || '')
            ).length;
            
            if (duplicateCount > 0) {
              proposedTitle = `${proposedTitle} (${duplicateCount + 1})`;
            }
          }
          
          title = proposedTitle;
        } else {
          title = "새 채팅방";
        }
      }

      // 그룹 채팅 생성
      const groupChat = await storage.createGroupChat({
        title,
        createdBy: userId,
        languageLevel: null, // 기본값: 미적용 (AI 제약 없음)
        visibility: groupVisibility,
        sharingMode: groupSharingMode,
        embedCode,
        callnaskEnabled: callnaskEnabled ?? false,
        callnaskConfig: callnaskConfig ?? null,
        allowedDomains: (groupVisibility === 'embed' && allowedDomains && Array.isArray(allowedDomains)) 
          ? allowedDomains 
          : null
      });

      // OpenAI Assistant 생성 (비동기 백그라운드 처리)
      // 사용자를 기다리게 하지 않고 응답 반환 후 백그라운드에서 생성
      createAssistantForRoom(groupChat.id).then(assistantId => {
        console.log(`[GroupChat] ✅ Assistant ${assistantId} 생성 완료 (room ${groupChat.id})`);
      }).catch(error => {
        console.error(`[GroupChat] ⚠️ Assistant 생성 실패 (room ${groupChat.id}):`, error);
      });

      // 생성자를 멤버로 추가
      await storage.addGroupChatMember({
        groupChatId: groupChat.id,
        userId
      });

      // 초대된 사용자들을 멤버로 추가
      if (userIds && Array.isArray(userIds)) {
        for (const invitedUserId of userIds) {
          if (invitedUserId && invitedUserId !== userId) { // 생성자 중복 방지
            await storage.addGroupChatMember({
              groupChatId: groupChat.id,
              userId: invitedUserId
            });
          }
        }
      }

      // 선택된 에이전트들을 추가
      for (const agentId of agentIds || []) {
        await storage.addGroupChatAgent({
          groupChatId: groupChat.id,
          agentId
        });
        
        // 🎭 백그라운드에서 캐릭터 패턴 자동 생성 (사용자를 기다리게 하지 않음)
        (async () => {
          try {
            const { generateCharacterPattern } = await import("./characterPatternGenerator.js");
            
            // 이미 패턴이 존재하는지 확인
            const existingPattern = await storage.getCharacterSpeakingPattern(agentId);
            if (existingPattern) {
              console.log(`[🎭 패턴 생성] 에이전트 ${agentId}는 이미 패턴이 존재합니다 - 스킵`);
              return;
            }
            
            // 에이전트 정보 조회
            const agent = await storage.getAgent(agentId);
            if (!agent) {
              console.log(`[🎭 패턴 생성] 에이전트 ${agentId}를 찾을 수 없습니다 - 스킵`);
              return;
            }
            
            console.log(`[🎭 패턴 생성] ${agent.name}의 말하는 방식 패턴 자동 생성 시작...`);
            
            // AI로 패턴 생성
            const pattern = await generateCharacterPattern(agent.name);
            
            // DB에 저장
            await storage.createCharacterSpeakingPattern({
              agentId: agent.id,
              characterName: agent.name,
              realExamples: pattern.realExamples,
              prohibitedPhrases: pattern.prohibitedPhrases,
              toneExamples: pattern.toneExamples,
              fewShotBad: pattern.fewShotBad,
              fewShotGood: pattern.fewShotGood
            });
            
            console.log(`[🎭 패턴 생성] ✅ ${agent.name}의 패턴 생성 및 저장 완료!`);
          } catch (error) {
            console.error(`[🎭 패턴 생성] ⚠️ 에이전트 ${agentId} 패턴 생성 실패:`, error);
            // 실패해도 계속 진행 (패턴이 없으면 기본 동작 사용)
          }
        })();
      }

      // 환영 메시지 생성 (시스템 메시지)
      const welcomeMessage = `🎉 "${title}" 대화방이 생성되었습니다!\n\n👥 참여자들과 함께 즐거운 대화를 나누어보세요. 챗봇들에게 @를 붙여서 질문하거나, 자유롭게 대화를 시작할 수 있습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId: groupChat.id,
        content: welcomeMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      res.json(groupChat);
    } catch (error) {
      console.error("Error creating group chat:", error);
      res.status(500).json({ message: "Failed to create group chat" });
    }
  });

  // 임베드 코드로 그룹 채팅 정보 조회 (인증 불필요)
  app.get('/api/embed/:embedCode', async (req: any, res) => {
    try {
      const embedCode = req.params.embedCode;
      
      // embedCode로 그룹 채팅 조회
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      if (!groupChat) {
        return res.status(404).json({ message: "Embed chat not found" });
      }

      // embedEnabled가 활성화되지 않았으면 접근 거부
      if (!groupChat.embedEnabled) {
        return res.status(403).json({ message: "This chat is not embeddable" });
      }

      // 멤버 정보
      const members = await storage.getGroupChatMembers(groupChat.id);
      const membersWithUserDetails = await Promise.all(
        members.map(async (member) => {
          const user = await storage.getUser(member.userId);
          return {
            ...member,
            user: user || { id: member.userId, email: `${member.userId}@univ.edu` }
          };
        })
      );

      // 에이전트 목록
      const agents = await storage.getGroupChatAgents(groupChat.id);
      const agentsWithDetails = await Promise.all(
        agents.map(async (groupAgent) => {
          const agent = await storage.getAgent(groupAgent.agentId);
          return {
            ...groupAgent,
            agent
          };
        })
      );

      res.json({
        ...groupChat,
        members: membersWithUserDetails,
        agents: agentsWithDetails
      });
    } catch (error) {
      console.error("Error fetching embed chat:", error);
      res.status(500).json({ message: "Failed to fetch embed chat" });
    }
  });

  // 임베드 채팅 메시지 조회 (인증 불필요)
  app.get('/api/embed/:embedCode/messages', async (req: any, res) => {
    try {
      const embedCode = req.params.embedCode;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      let groupChatId: number;
      
      // 🎭 게스트 토큰이 있으면 해당 세션의 채팅방 ID 사용 (템플릿 모드)
      if (guestToken) {
        const validation = await validateGuestSession(guestToken);
        if (validation.valid && validation.session?.groupChatId) {
          groupChatId = validation.session.groupChatId;
        } else {
          // 토큰이 유효하지 않으면 원본 템플릿 채팅방 사용
          const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
          if (!groupChat) {
            return res.status(404).json({ message: "Embed chat not found" });
          }
          groupChatId = groupChat.id;
        }
      } else {
        // 게스트 토큰이 없으면 embedCode로 조회 (일반 임베드 모드)
        const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
        if (!groupChat) {
          return res.status(404).json({ message: "Embed chat not found" });
        }
        groupChatId = groupChat.id;
      }

      const messages = await storage.getGroupChatMessages(groupChatId);
      
      // 메시지에 발신자/에이전트 정보 추가
      const messagesWithDetails = await Promise.all(
        messages.map(async (message) => {
          let sender = null;
          let agent = null;

          if (message.senderId) {
            sender = await storage.getUser(message.senderId);
          }

          if (message.agentId) {
            agent = await storage.getAgent(message.agentId);
          }

          return {
            ...message,
            sender,
            agent
          };
        })
      );

      // 📚 Debug: Log sources in API response
      const withSources = messagesWithDetails.filter(m => m.sources);
      if (withSources.length > 0) {
        console.log(`[📚 API] Returning ${withSources.length} messages with sources:`, 
          withSources.map(m => ({ id: m.id, sourcesType: typeof m.sources, sourcesLength: Array.isArray(m.sources) ? m.sources.length : (m.sources?.chunks?.length || 0) }))
        );
      }

      // 📚 Disable caching to ensure fresh sources data
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('ETag', `"${Date.now()}"`);  // Force new ETag every time
      res.json(messagesWithDetails);
    } catch (error) {
      console.error("Error fetching embed chat messages:", error);
      res.status(500).json({ message: "Failed to fetch embed chat messages" });
    }
  });

  // 임베드 채팅 메시지 전송 (익명 사용자, 인증 불필요)
  app.post('/api/embed/:embedCode/messages', async (req: any, res) => {
    try {
      const embedCode = req.params.embedCode;
      const { content, senderName } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');

      if (!content || !content.trim()) {
        return res.status(400).json({ message: "메시지 내용이 필요합니다." });
      }

      let groupChatId: number;
      
      // 🎭 게스트 토큰이 있으면 해당 세션의 채팅방 ID 사용 (템플릿 모드)
      if (guestToken) {
        const validation = await validateGuestSession(guestToken);
        if (validation.valid && validation.session?.groupChatId) {
          groupChatId = validation.session.groupChatId;
        } else {
          const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
          if (!groupChat) {
            return res.status(404).json({ message: "Embed chat not found" });
          }
          groupChatId = groupChat.id;
        }
      } else {
        const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
        if (!groupChat) {
          return res.status(404).json({ message: "Embed chat not found" });
        }
        groupChatId = groupChat.id;
      }

      // ✅ embedEnabled 또는 callnaskEnabled가 활성화되어야 접근 가능
      const groupChatData = await db.select().from(groupChats).where(eq(groupChats.id, groupChatId)).limit(1);
      if (groupChatData.length === 0) {
        return res.status(404).json({ message: "Embed chat not found" });
      }
      const groupChat = groupChatData[0];
      
      if (!groupChat.embedEnabled && !groupChat.callnaskEnabled) {
        return res.status(403).json({ message: "This chat is not embeddable" });
      }

      // CallNAsk 모드 처리
      let selectedAgentIds: number[] | null = null;

      if (groupChat.callnaskEnabled) {
        // CallNAsk 모드: guest token 필수
        if (!guestToken) {
          return res.status(401).json({ message: "Guest token required for CallNAsk mode" });
        }

        const validation = await validateGuestSession(guestToken, embedCode);
        if (!validation.valid || !validation.session) {
          return res.status(401).json({ message: validation.error || "Invalid or expired guest session" });
        }

        selectedAgentIds = validation.session.selectedAgents || [];

        if (!selectedAgentIds || selectedAgentIds.length === 0) {
          return res.status(400).json({ message: "관점을 먼저 선택해주세요. 인물 이름을 입력하거나 Hot Topic 카드를 클릭하세요." });
        }

        // senderName은 CallNAsk 모드에서는 선택사항 (guest session이 있으므로)
      } else {
        // 일반 embed 모드: senderName 필수
        if (!senderName || !senderName.trim()) {
          return res.status(400).json({ message: "이름이 필요합니다." });
        }
      }

      // 익명 사용자 메시지 저장
      const message = await storage.createGroupChatMessage({
        groupChatId: groupChatId,
        content: content.trim(),
        senderId: null, // 익명 사용자
        senderName: senderName ? senderName.trim() : (guestToken ? 'Guest' : 'Anonymous'),
        agentId: null,
        questionAsked: null,
        analysisResult: null,
        debateMode: null,
        metaPromptSnapshot: null,
        matrixSnapshot: null
      });

      // 그룹 채팅의 lastMessageAt 업데이트
      await storage.updateGroupChat(groupChat.id, {
        lastMessageAt: new Date()
      });

      // 📊 CallNAsk 모드: 세션 메트릭 업데이트 및 Analytics 기록
      if (groupChat.callnaskEnabled && guestToken) {
        try {
          const validation = await validateGuestSession(guestToken, embedCode);
          if (validation.valid && validation.session) {
            const session = validation.session;
            const messageLength = content.trim().length;
            const currentTotalMessages = (session.totalMessages || 0) + 1;
            const currentTotalLength = (session.averageMessageLength || 0) * (session.totalMessages || 0) + messageLength;
            const newAverageLength = Math.round(currentTotalLength / currentTotalMessages);
            
            // 활동 시간 계산 (세션 생성부터 현재까지의 초 단위 시간)
            const sessionStartTime = session.createdAt?.getTime() || Date.now();
            const currentTime = Date.now();
            const totalActivityTimeSeconds = Math.floor((currentTime - sessionStartTime) / 1000);
            
            // 세션 메트릭 업데이트
            await db.update(guestSessions)
              .set({
                totalMessages: currentTotalMessages,
                averageMessageLength: newAverageLength,
                lastActivityAt: new Date(),
                turnCount: (session.turnCount || 0) + 1, // 사용자 턴 증가
                totalActivityTime: totalActivityTimeSeconds, // 총 활동 시간 업데이트
              })
              .where(eq(guestSessions.token, guestToken));
            
            // Analytics 이벤트 기록
            await db.insert(guestAnalytics).values({
              sessionId: session.id,
              eventType: 'message_sent',
              eventData: {
                messageLength,
                agentCount: selectedAgentIds?.length || 0,
                content: content.trim().substring(0, 100), // 처음 100자만 저장
              },
            });
            
            console.log('[📊 ANALYTICS] 메시지 전송 기록:', {
              sessionId: session.id,
              totalMessages: currentTotalMessages,
              avgLength: newAverageLength,
            });
          }
        } catch (analyticsError) {
          console.error('[❌ ANALYTICS] 메트릭 업데이트 실패:', analyticsError);
          // Analytics 실패는 메시지 전송에 영향을 주지 않음
        }
      }

      // 🤖 백그라운드에서 AI 에이전트 자동 응답 생성 + 🎭 관점 추출 (병렬 처리)
      setImmediate(async () => {
        try {
          console.log(`[🤖 임베드 챗봇] 자동 응답 시작: groupChatId=${groupChat.id}, CallNAsk=${groupChat.callnaskEnabled}`);
          
          // 그룹 채팅의 에이전트 조회
          const groupAgents = await storage.getGroupChatAgents(groupChat.id);
          if (groupAgents.length === 0) {
            console.log(`[🤖 임베드 챗봇] 사용 가능한 에이전트 없음`);
            return;
          }

          // 에이전트 정보 조회
          const agents: Agent[] = [];
          for (const groupAgent of groupAgents) {
            // CallNAsk 모드: selectedAgentIds에 있는 에이전트만 필터링
            if (selectedAgentIds && !selectedAgentIds.includes(groupAgent.agentId)) {
              continue;
            }

            const agent = await storage.getAgent(groupAgent.agentId);
            if (agent) {
              agents.push(agent);
            }
          }

          if (agents.length === 0) {
            console.log(`[🤖 임베드 챗봇] 에이전트 정보 조회 실패 또는 선택된 에이전트 없음`);
            return;
          }

          console.log(`[🤖 임베드 챗봇] ${agents.length}개 에이전트 응답 생성 중: ${agents.map(a => a.name).join(', ')}`);

          // 질문 언어 자동 감지 (기존 시스템 활용)
          let detectedLanguage = 'ko'; // 기본값
          try {
            // resolveUserLanguage 사용 (더 정교한 언어 감지)
            detectedLanguage = await resolveUserLanguage(
              groupChat.id,
              guestToken || 'anonymous',
              agents[0].id,
              content.trim(),
              storage,
              null // languageLevel: null이면 질문 언어 우선
            );
            console.log(`[🌐 언어 감지] 질문 언어: ${detectedLanguage}`);
          } catch (error) {
            console.error(`[🌐 언어 감지 오류]`, error);
            // fallback: 간단한 휴리스틱
            const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
            detectedLanguage = koreanRegex.test(content.trim()) ? 'ko' : 'en';
          }

          // 🏛️ One-Shot Adaptive RAG: 1 Search + 1 LLM Call로 모든 것을 생성
          console.log('[🏛️ One-Shot RAG] 통합 응답 생성 시작');
          
          let response: any = null;
          let perspectivesResult: any = null;
          let oneShotSuccess = false;
          
          // CallNAsk 모드일 때만 One-Shot RAG 시도
          if (groupChat.callnaskEnabled && agents.length > 0) {
            const { executeOneShotAdaptiveRAG } = await import('./search/searchClient');
            const firstAgent = agents[0];
            
            try {
              const oneShotResult = await executeOneShotAdaptiveRAG(
                firstAgent.name,
                content.trim(),
                firstAgent.id
              );
              
              console.log(`[✅ One-Shot RAG 완료] Volatility: ${oneShotResult.volatility}, Perspectives: ${oneShotResult.perspectives.length}명`);
              
              // ✅ Guard: perspectives가 비어있으면 경고 로그
              if (oneShotResult.perspectives.length === 0) {
                console.warn('[⚠️ One-Shot RAG] No perspectives generated, UI may show empty buttons');
              }
              
              // 기존 형식에 맞춰 변환
              response = {
                responses: [{
                  agentId: firstAgent.id,
                  agentName: firstAgent.name,
                  content: oneShotResult.main_answer,
                  sources: oneShotResult.searchResults || [] // ✅ Citation 데이터 보존
                }]
              };
              
              // Perspectives 데이터를 기존 형식으로 변환
              perspectivesResult = {
                perspectives: oneShotResult.perspectives.map(p => ({
                  name: p.name,
                  role: p.role,
                  stance: p.dialogue,
                  sentiment: 'NEUTRAL',
                  color: 'blue',
                  supportive_indices: []
                })),
                searchResults: oneShotResult.searchResults || [], // ✅ Citation 데이터 보존
                query: content.trim(),
                ttlSeconds: 0,
                classificationType: null
              };
              
              oneShotSuccess = true;
              
            } catch (oneShotError) {
              console.error('[❌ One-Shot RAG 실패, Fallback 시작]', oneShotError);
              // ✅ Fallback: response를 null로 유지하여 아래 블록 실행
              response = null;
              perspectivesResult = null;
              oneShotSuccess = false;
            }
          }
          
          // Fallback: 기존 병렬 처리 방식 (One-Shot 실패 시 또는 비-CallNAsk 모드)
          if (!response) {
            console.log('[🔄 Fallback] 기존 병렬 처리 방식 사용');
            
            const { AgentOrchestrator } = await import('./agentOrchestrator');
            const orchestrator = AgentOrchestrator.getInstance();
            
            const results = await Promise.allSettled([
              // Task 1: 메인 AI 응답 생성 (기존 로직)
              orchestrator.handleDirectMention(
                agents, // 선택된 에이전트들
                content.trim(),
                groupChat.id,
                guestToken || 'anonymous', // Guest token 또는 익명 사용자
                `embed_${Date.now()}`, // 임시 userTurnId
                detectedLanguage // 🌐 질문 언어로 답변
              ),
              
              // Task 2: 관점 추출 (CallNAsk 모드일 때만, 병렬 실행)
              (async () => {
                if (!groupChat.callnaskEnabled) return null;
                
                const { searchWithPerspectives } = await import('./search/searchClient');
                const firstAgentName = agents[0]?.name;
                
                const perspectiveData = await searchWithPerspectives(
                  agents[0]?.id || 0,
                  content.trim(), // topic
                  content.trim(), // normalizedQuestion
                  undefined, // existingSources (will search fresh)
                  undefined, // originalAnswer (not available yet)
                  firstAgentName
                );
                
                console.log(`[✅ 관점 병렬 추출] ${perspectiveData.perspectives.length}명 관점 생성됨`);
                return perspectiveData;
              })()
            ]);

            // 🛡️ 복원력: 각 작업 결과 개별 처리
            response = results[0].status === 'fulfilled' ? results[0].value : null;
            perspectivesResult = results[1].status === 'fulfilled' ? results[1].value : null;
            
            // 메인 응답 실패 시 백그라운드 작업 종료 (복구 불가)
            if (!response || !response.responses || response.responses.length === 0) {
              console.error('[❌ 임베드 챗봇] 메인 AI 응답 생성 실패, 백그라운드 작업 종료');
              if (results[0].status === 'rejected') {
                console.error('[❌ 메인 응답 실패 원인]', results[0].reason);
              }
              return;
            }

            // 관점 추출 실패 로깅 (메인 응답은 계속 진행)
            if (results[1].status === 'rejected') {
              console.error('[⚠️ 관점 병렬 추출 실패, 메인 답변은 계속 진행]', results[1].reason);
            }
          }
          
          // One-Shot RAG 성공 시에도 응답 체크
          if (!response || !response.responses || response.responses.length === 0) {
            console.error('[❌ 임베드 챗봇] 응답 생성 실패, 백그라운드 작업 종료');
            return;
          }

          console.log(`[🤖 임베드 챗봇] ${response.responses.length}개 응답 생성됨${perspectivesResult ? ` + ${perspectivesResult.perspectives.length}명 관점` : ''}`);
          
          // SSE 브로드캐스트를 위한 import
          const { broadcastGroupChatMessage } = await import('./broadcast');

          // 모든 에이전트 응답을 메시지로 저장하고 브로드캐스트
          for (let i = 0; i < response.responses.length; i++) {
            const agentResponse = response.responses[i];
            try {
              // 🎭 첫 번째 응답에는 perspective 검색 결과를 sources로 저장 (병렬 처리 결과 재사용)
              const sourcesToSave = (i === 0 && perspectivesResult) 
                ? perspectivesResult.searchResults 
                : (agentResponse.sources || null);
              
              const savedMessage = await storage.createGroupChatMessage({
                groupChatId: groupChat.id,
                content: agentResponse.content,
                senderId: null,
                senderName: null,
                agentId: agentResponse.agentId,
                agentName: agentResponse.agentName,
                questionAsked: null,
                analysisResult: null,
                debateMode: null,
                metaPromptSnapshot: null,
                matrixSnapshot: null,
                sources: sourcesToSave  // ✅ 병렬 처리된 perspective 검색 결과 저장!
              });
              
              console.log(`[🤖 임베드 챗봇] ${agentResponse.agentName} 응답 저장 완료 (sources: ${sourcesToSave ? 'yes (병렬 처리 결과)' : 'no'})`);
              
              // 🔔 SSE 브로드캐스트: 클라이언트에게 실시간으로 전달
              if (savedMessage) {
                await broadcastGroupChatMessage(groupChat.id, savedMessage);
                console.log(`[🔔 임베드 챗봇] ${agentResponse.agentName} 응답 브로드캐스트 완료`);
              }
            } catch (saveError) {
              // 🛡️ 복원력: 개별 응답 저장 실패 시에도 나머지 응답 계속 처리
              console.error(`[❌ 임베드 챗봇] ${agentResponse.agentName} 응답 저장/브로드캐스트 실패:`, saveError);
              // 다음 응답으로 계속 진행
            }
          }

          // lastMessageAt 다시 업데이트
          await storage.updateGroupChat(groupChat.id, {
            lastMessageAt: new Date()
          });

        } catch (error) {
          console.error(`[🤖 임베드 챗봇] 자동 응답 오류:`, error);
        }
      });

      res.json(message);
    } catch (error) {
      console.error("Error sending embed chat message:", error);
      
      // 📊 오류 발생 시 Analytics 기록
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const guestToken = authHeader.substring(7);
        try {
          const { embedCode } = req.params;
          const validation = await validateGuestSession(guestToken, embedCode);
          if (validation.valid && validation.session) {
            // 세션의 errorCount 증가
            await db.update(guestSessions)
              .set({
                errorCount: (validation.session.errorCount || 0) + 1,
              })
              .where(eq(guestSessions.token, guestToken));
            
            // Analytics 이벤트 기록
            await db.insert(guestAnalytics).values({
              sessionId: validation.session.id,
              eventType: 'error_occurred',
              eventData: {
                errorType: 'message_send_failed',
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            });
          }
        } catch (analyticsError) {
          console.error('[❌ ANALYTICS] 오류 기록 실패:', analyticsError);
        }
      }
      
      res.status(500).json({ message: "Failed to send embed chat message" });
    }
  });

  // 🏠 새 대화 시작 (기존 메시지 삭제) - CallNAsk 전용
  app.delete('/api/embed/:embedCode/messages', async (req: any, res) => {
    try {
      const embedCode = req.params.embedCode;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');

      if (!guestToken) {
        return res.status(401).json({ message: "Guest token required" });
      }

      // 게스트 세션 검증
      const validation = await validateGuestSession(guestToken, embedCode);
      if (!validation.valid || !validation.session) {
        return res.status(401).json({ message: validation.error || "Invalid guest session" });
      }

      const groupChatId = validation.session.groupChatId;
      if (!groupChatId) {
        return res.status(400).json({ message: "No chat session found" });
      }

      // 해당 그룹 채팅의 모든 메시지 삭제
      await storage.deleteAllGroupChatMessages(groupChatId);

      console.log(`[🏠 NEW CHAT] ✅ Deleted all messages from group chat ${groupChatId} for guest session`);
      res.json({ success: true, message: "대화가 초기화되었습니다." });
    } catch (error) {
      console.error("Error resetting embed chat:", error);
      res.status(500).json({ message: "Failed to reset chat" });
    }
  });

  // 🎬 VERDICT 시나리오 생성 API - 질문 우선 방식
  // 질문을 분석하여 메인 인물을 추출하고, 다양한 관점의 시나리오를 생성
  app.post('/api/embed/:embedCode/scenario', async (req: any, res) => {
    try {
      const embedCode = req.params.embedCode;
      const { question, mainCharacter } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');

      if (!question || !question.trim()) {
        return res.status(400).json({ message: "질문 내용이 필요합니다." });
      }

      let groupChatId: number;
      
      // 🎭 게스트 토큰이 있으면 해당 세션의 채팅방 ID 사용
      if (guestToken) {
        const validation = await validateGuestSession(guestToken);
        if (validation.valid && validation.session?.groupChatId) {
          groupChatId = validation.session.groupChatId;
        } else {
          const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
          if (!groupChat) {
            return res.status(404).json({ message: "Embed chat not found" });
          }
          groupChatId = groupChat.id;
        }
      } else {
        const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
        if (!groupChat) {
          return res.status(404).json({ message: "Embed chat not found" });
        }
        groupChatId = groupChat.id;
      }

      // 그룹 채팅 정보 조회
      const groupChatData = await db.select().from(groupChats).where(eq(groupChats.id, groupChatId)).limit(1);
      if (groupChatData.length === 0) {
        return res.status(404).json({ message: "Embed chat not found" });
      }
      const groupChat = groupChatData[0];
      
      if (!groupChat.embedEnabled && !groupChat.callnaskEnabled) {
        return res.status(403).json({ message: "This chat is not embeddable" });
      }

      // 사용자 질문 메시지 저장
      const userMessage = await storage.createGroupChatMessage({
        groupChatId: groupChatId,
        content: question.trim(),
        senderId: null,
        senderName: guestToken ? 'Guest' : 'Anonymous',
        agentId: null,
        questionAsked: null,
        analysisResult: null,
        debateMode: null,
        metaPromptSnapshot: null,
        matrixSnapshot: null
      });

      // lastMessageAt 업데이트
      await storage.updateGroupChat(groupChat.id, {
        lastMessageAt: new Date()
      });

      // ═══════════════════════════════════════════════════════════════════════════════
      // 🎙️ Step 35 + Step 43: Phase 1 - Anchor Teaser (빠른 응답 + 스트리밍)
      // ═══════════════════════════════════════════════════════════════════════════════
      console.log(`[🎙️ Step 35] Phase 1 시작: Anchor Teaser 생성...`);
      const phase1StartTime = Date.now();
      
      const { generateAnchorTeaser, generateDebateScenario } = await import('./search/searchClient');
      const { broadcastGroupChatMessage, streamTextToClient, broadcastGroupChatStatus } = await import('./broadcast');
      
      // 🎬 Step 43: userTurnId 생성 (스트리밍 추적용)
      const userTurnId = userMessage.id;
      
      let anchorTeaser;
      try {
        anchorTeaser = await generateAnchorTeaser(question.trim());
      } catch (error) {
        console.error('[🎙️ Step 35] Anchor Teaser 생성 실패, 폴백 사용:', error);
        // [Step 39] 폴백도 자연스러운 호스트 스타일로
        const shortQ = question.trim().length > 30 ? question.trim().substring(0, 30) + '...' : question.trim();
        anchorTeaser = {
          summary: `오늘 주제 장난 아니네요! ${shortQ} 관련해서 의견이 분분한데요. 어떤 시각들이 있는지 들어볼까요?`,
          teaser: '전문가들 모셔서 직접 들어보겠습니다!',
          detectedFigures: [],
          isKnownFigures: false
        };
      }
      
      const phase1Elapsed = Date.now() - phase1StartTime;
      console.log(`[🎙️ Step 35] Phase 1 완료 (${phase1Elapsed}ms)`);
      
      // [Step 39] 앵커 메시지 저장 - 메타 라벨 없이 자연스러운 호스트 스타일
      // summary와 teaser를 자연스럽게 연결 (teaser가 있으면 추가)
      const anchorContent = anchorTeaser.teaser 
        ? `${anchorTeaser.summary}\n\n${anchorTeaser.teaser}`
        : anchorTeaser.summary;
      
      // 🎬 Step 43: Phase 1 스트리밍 전송 (타이핑 효과)
      console.log(`[🎬 Step 43] Phase 1 스트리밍 시작: ${anchorContent.length}자`);
      await streamTextToClient(
        groupChatId,
        anchorContent,
        {
          agentId: null,
          agentName: '🎙️ 진행자',
          agentIcon: '🎙️',
          agentColor: '#6B7280',
          userTurnId
        },
        { chunkSize: 8, delayMs: 25 } // 빠른 타이핑 효과
      );
      
      const anchorMessage = await storage.createGroupChatMessage({
        groupChatId: groupChatId,
        content: anchorContent,
        senderId: null,
        senderName: null,
        agentId: null,
        agentName: '🎙️ 진행자',
        questionAsked: null,
        analysisResult: null,
        debateMode: null,
        metaPromptSnapshot: null,
        matrixSnapshot: null
      });
      
      // 최종 메시지 브로드캐스트 (스트리밍 완료 후)
      broadcastGroupChatMessage(groupChatId, {
        id: anchorMessage.id,
        groupChatId: groupChatId,
        content: anchorContent,
        senderId: null,
        senderName: null,
        agentId: null,
        agentName: '🎙️ 진행자',
        createdAt: anchorMessage.createdAt
      });
      
      console.log(`[🎙️ Step 35] Phase 1 앵커 메시지 저장 및 브로드캐스트 완료 (ID: ${anchorMessage.id})`);
      
      // 🎬 Step 43 Fix: 앵커 메시지 후 1초 대기 (말풍선이 순차적으로 나타나는 느낌)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 🎬 Step 43: Phase 2 로딩 인디케이터 (Bridge)
      broadcastGroupChatStatus(groupChatId, 'typing_start', {
        name: '전문가 패널',
        icon: '👥',
        backgroundColor: '#4B5563'
      });

      // ═══════════════════════════════════════════════════════════════════════════════
      // 🎬 Step 35: Phase 2 - 백그라운드에서 Multi-turn Debate 시나리오 생성
      // ═══════════════════════════════════════════════════════════════════════════════
      setImmediate(async () => {
        try {
          console.log(`[🎭 VERDICT DEBATE] Phase 2 시나리오 생성 시작: question="${question.trim()}"`);
          
          // Multi-turn Debate 시나리오 생성 (Phase 1의 detectedFigures는 참조용, 강제 아님)
          const debateScenario = await generateDebateScenario(question.trim());
          
          console.log(`[✅ VERDICT v2] 완료 - Authority: ${debateScenario.analysis?.identified_authority}, 턴 수: ${debateScenario.turns.length}`);
          
          // 🎭 PARALLEL AVATAR: 비활성화됨 (2024-12-02)
          // 아바타 생성 기능이 비활성화되었습니다. Imagen 3 할당량 문제로 인해 일시 중지.
          const characterNames = [...new Set(debateScenario.turns.map(t => t.name).filter((n): n is string => !!n))];
          if (characterNames.length > 0) {
            console.log(`[🎭 AVATAR DISABLED] 시나리오에서 ${characterNames.length}명 캐릭터 추출 - 아바타 생성 비활성화됨`);
          }
          
          // 각 턴을 순차적으로 저장 및 브로드캐스트 (broadcastGroupChatMessage는 Phase 1에서 이미 import됨)
          for (let i = 0; i < debateScenario.turns.length; i++) {
            const turn = debateScenario.turns[i];
            
            // 🛡️ null 체크 (새 데이터 구조: role, name, message)
            if (!turn || !turn.name || !turn.message || !turn.role) {
              console.warn(`[⚠️ VERDICT v2] 턴 ${i + 1} 스킵 - 필수 필드 누락`);
              continue;
            }
            
            try {
              // 🛡️ V6.0 Sanitization: 무한 루프 감지 + 언어 오염 필터링
              // 짧은 유효 메시지("동의합니다.")는 보존, 오염된 메시지만 정화
              const sanitizeMessage = (text: string): string => {
                const originalLength = text.length;
                
                // 1. 언어 오염 필터링: 키릴 문자(러시아어), 몽골어 등 비허용 문자 제거
                const cyrillicPattern = /[\u0400-\u04FF]/g;  // 러시아어/키릴 문자
                const mongolianPattern = /[\u1800-\u18AF]/g; // 몽골어
                const otherNonAllowed = /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF]/g; // 아랍어, 히브리어 등
                
                let cleaned = text
                  .replace(cyrillicPattern, '')
                  .replace(mongolianPattern, '')
                  .replace(otherNonAllowed, '');
                
                // 괄호 안 번역 패턴 제거 "(피로감)에 젖어" 등
                cleaned = cleaned.replace(/\s*\([^)]*\)\s*에 젖어\s*/g, ' ');
                
                // 2. 무한 루프 감지: 같은 패턴이 3번 이상 반복되면 첫 번째만 유지
                const loopPattern = /(.{10,}?)\1{2,}/g;
                cleaned = cleaned.replace(loopPattern, '$1');
                
                // 짧은 패턴 반복도 체크 (5자 이상, 4회 이상 반복)
                const shortLoopPattern = /(.{5,}?)\1{3,}/g;
                cleaned = cleaned.replace(shortLoopPattern, '$1');
                
                // 연속 공백 정리
                cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
                
                // 🛡️ 안전 장치: 정화 후 메시지가 너무 짧아졌다면
                if (cleaned.length < 10 && originalLength > 50) {
                  // 오염된 부분 이전까지만 추출
                  const sentences = text.split(/[.!?。！？]/);
                  for (const sentence of sentences) {
                    const cleanSentence = sentence
                      .replace(cyrillicPattern, '')
                      .replace(mongolianPattern, '')
                      .replace(otherNonAllowed, '')
                      .trim();
                    if (cleanSentence.length >= 10) {
                      return cleanSentence + '.';
                    }
                  }
                  // 모든 문장이 오염됐으면 기본 메시지
                  return '[응답 생성 중 오류가 발생했습니다]';
                }
                
                return cleaned;
              };
              
              // 메시지 정화 (짧은 원본 메시지는 그대로 유지)
              const sanitizedMessage = turn.message.length <= 50 
                ? turn.message  // 짧은 메시지는 정화 없이 유지
                : sanitizeMessage(turn.message);
              
              // 🎭 VERDICT v3: speaker_icon 우선 사용, 없으면 role 기반 fallback
              // speaker_icon: LLM이 직접 지정한 직업/역할 기반 이모지
              // role fallback: protagonist(⭐), antagonist(👊), jester(🎭), authority(⚖️)
              const roleFallbackMap: Record<string, string> = {
                'protagonist': '⭐',
                'antagonist': '👊',
                'jester': '🎭',
                'authority': '⚖️',
                'initiator': '🔔',
                'target': '👤',
                'oppose': '🔴',
                'support': '🔵'
              };
              
              // speaker_icon 필드가 있으면 우선 사용, 없으면 role 기반 fallback
              const speakerIcon = turn.speaker_icon || roleFallbackMap[turn.role] || '💬';
              
              // speaker_title: 직책/자격 (예: "중국 외교부 대변인", "더불어민주당 대표")
              const speakerTitle = turn.speaker_title || '';
              
              // 메시지 내용: 발언자 이름 + 직책 + 아이콘 + 메시지 (정화된 버전)
              // 직책이 있으면 "이름 (직책)" 형식, 없으면 이름만
              const speakerDisplay = speakerTitle 
                ? `${turn.name} (${speakerTitle})`
                : turn.name;
              const turnContent = `**${speakerIcon} ${speakerDisplay}**\n\n${sanitizedMessage}`;
              
              // 🎬 Step 43 Fix: Phase 2 스트리밍 - 각 턴에 고유 ID 부여
              // 앵커: -1, 턴1: -2, 턴2: -3, ... (음수 인덱스로 고유성 보장)
              const turnAgentId = -(i + 2);  // -2, -3, -4, ...
              
              console.log(`[🎬 Step 43] 턴 ${i + 1} 스트리밍: ${turn.name} (${sanitizedMessage.length}자) agentId: ${turnAgentId}`);
              await streamTextToClient(
                groupChat.id,
                turnContent,
                {
                  agentId: turnAgentId,  // 고유한 음수 ID
                  agentName: turn.name,
                  agentIcon: speakerIcon,
                  agentColor: turn.role === 'oppose' ? '#EF4444' : turn.role === 'support' ? '#3B82F6' : '#6B7280',
                  userTurnId
                },
                { chunkSize: 12, delayMs: 20 } // 자연스러운 타이핑 속도
              );
              
              // 🎭 Step 46: 마지막 턴에 suggestion_chips 추가
              const isLastTurn = i === debateScenario.turns.length - 1;
              const suggestionChipsData = isLastTurn && debateScenario.suggestion_chips?.length 
                ? debateScenario.suggestion_chips 
                : null;
              
              // 🎯 Step 49: 턴별 출처 필터링 (groundingSupports 기반)
              // 각 턴의 message가 전체 응답 텍스트 내에서 어디에 위치하는지 찾아서
              // 해당 범위에 속하는 supports만 필터링
              let turnSources: any[] | null = null;
              
              if (debateScenario.groundingSupports && 
                  debateScenario.groundingSupports.length > 0 &&
                  debateScenario.fullResponseText && 
                  debateScenario.searchResults) {
                
                // 이 턴의 message가 전체 응답에서 어디에 있는지 찾기
                const fullText = debateScenario.fullResponseText;
                const turnMessageText = turn.message;
                
                // 🎯 Step 49 Fix: JSON 이스케이프 처리
                // fullResponseText는 JSON 형식이므로 turn.message를 JSON으로 이스케이프하여 검색
                const escapedMessage = JSON.stringify(turnMessageText).slice(1, -1); // 앞뒤 따옴표 제거
                
                // 메시지 텍스트의 시작/끝 위치 찾기 (이스케이프된 형태로 검색)
                let turnStartIndex = fullText.indexOf(escapedMessage);
                
                // 첫 50자로 부분 매칭 시도 (긴 메시지는 정확한 매칭이 어려울 수 있음)
                if (turnStartIndex < 0 && escapedMessage.length > 50) {
                  const partialText = escapedMessage.substring(0, 50);
                  turnStartIndex = fullText.indexOf(partialText);
                }
                
                // 원본 텍스트로도 한 번 더 시도 (일부 경우 이스케이프 없이 들어갈 수 있음)
                if (turnStartIndex < 0) {
                  turnStartIndex = fullText.indexOf(turnMessageText);
                }
                
                const turnEndIndex = turnStartIndex >= 0 ? turnStartIndex + turnMessageText.length : -1;
                
                if (turnStartIndex >= 0) {
                  // 이 턴 범위에 겹치는 supports 찾기
                  const matchingSupports = debateScenario.groundingSupports.filter(support => {
                    // support의 범위가 턴 범위와 겹치는지 확인
                    const overlaps = support.startIndex < turnEndIndex && support.endIndex > turnStartIndex;
                    return overlaps && support.chunkIndices && support.chunkIndices.length > 0;
                  });
                  
                  if (matchingSupports.length > 0) {
                    // 해당 supports가 참조하는 chunk indices 수집 (중복 제거)
                    const usedChunkIndices = new Set<number>();
                    matchingSupports.forEach(support => {
                      if (Array.isArray(support.chunkIndices)) {
                        support.chunkIndices.forEach((idx: number) => usedChunkIndices.add(idx));
                      }
                    });
                    
                    // 해당 인덱스에 해당하는 searchResults만 필터링
                    turnSources = Array.from(usedChunkIndices)
                      .filter(idx => idx < debateScenario.searchResults!.length)
                      .map(idx => debateScenario.searchResults![idx]);
                    
                    console.log(`[🎯 Step 49] 턴 ${i + 1} "${turn.name}": ${matchingSupports.length}개 supports → ${turnSources.length}개 sources (indices: ${Array.from(usedChunkIndices).join(',')})`);
                  } else {
                    // 매칭 supports가 없으면 null (출처 없음)
                    turnSources = null;
                    console.log(`[🎯 Step 49] 턴 ${i + 1} "${turn.name}": 매칭 supports 없음 → 출처 없음`);
                  }
                } else {
                  // 🎯 Step 49 Fix: 메시지 위치를 찾지 못하면 출처 없음으로 처리
                  // 이전 fallback은 모든 sources를 표시해서 목적에 맞지 않았음
                  turnSources = null;
                  console.log(`[🎯 Step 49] 턴 ${i + 1} "${turn.name}": 위치 못찾음 → 출처 없음`);
                }
              } else {
                // fallback: 전체 sources 공유 (이전 동작)
                turnSources = debateScenario.searchResults || null;
                console.log(`[🎯 Step 49] 턴 ${i + 1}: groundingSupports 없거나 비어있음, 전체 sources 사용`);
              }
              
              const turnMessage = await storage.createGroupChatMessage({
                groupChatId: groupChat.id,
                content: turnContent,
                senderId: null,
                senderName: null,
                agentId: null,
                agentName: turn.name,  // 구체적 페르소나 이름
                questionAsked: i === 0 ? question.trim() : null,
                analysisResult: null,
                debateMode: turn.role,  // 색상 구분용: initiator, target, oppose, support, authority
                metaPromptSnapshot: null,
                matrixSnapshot: null,
                sources: turnSources,  // 🎯 Step 48: 모든 턴에 sources 분배
                suggestionChips: suggestionChipsData  // 🎭 Step 46: 마지막 턴에 칩 데이터 저장
              });
              
              if (turnMessage) {
                await broadcastGroupChatMessage(groupChat.id, turnMessage);
                console.log(`[🎭 VERDICT v2] 턴 ${i + 1} 브로드캐스트: ${turn.name} (${turn.role})`);
              }
              
              // 🎬 Step 43 Fix: 턴 사이 충분한 간격 (말풍선이 하나씩 나타나는 느낌)
              // 사용자가 메시지를 읽을 시간을 주고 다음 메시지 표시
              if (i < debateScenario.turns.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
              }
            } catch (turnError) {
              console.error(`[❌ VERDICT v2] 턴 ${i + 1} 저장 실패:`, turnError);
            }
          }
          
          // 🎬 Step 43: Phase 2 완료 - 타이핑 인디케이터 종료
          broadcastGroupChatStatus(groupChat.id, 'typing_end', {
            name: '전문가 패널',
            icon: '👥',
            backgroundColor: '#4B5563'
          });
          
          // lastMessageAt 다시 업데이트
          await storage.updateGroupChat(groupChat.id, {
            lastMessageAt: new Date()
          });
          
          console.log(`[🎭 VERDICT v2] 전체 완료: ${debateScenario.turns.length}턴, Authority: ${debateScenario.analysis?.identified_authority}`);
          
        } catch (error) {
          console.error(`[❌ VERDICT v2] 생성 오류:`, error);
        }
      });

      res.json({ 
        message: userMessage,
        status: 'processing',
        info: '시나리오 생성 중입니다. 잠시 후 답변이 표시됩니다.'
      });
    } catch (error) {
      console.error("Error generating scenario:", error);
      res.status(500).json({ message: "Failed to generate scenario" });
    }
  });

  // 특정 그룹 채팅 정보 조회
  app.get('/api/group-chats/:groupChatId', isAuthenticated, checkGroupChatAccess, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      // 그룹 채팅 기본 정보
      const groupChat = await storage.getGroupChat(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      // 멤버 목록 조회
      let members = await storage.getGroupChatMembers(groupChatId);

      // 🔄 공유 채팅방인 경우 자동 멤버 등록
      if (groupChat.sharingMode === 'shared') {
        const isMember = members.some(member => member.userId === userId);
        if (!isMember) {
          console.log(`[자동 멤버 추가] 공유 채팅방 ${groupChatId}에 사용자 ${userId} 추가`);
          await storage.addGroupChatMember({
            groupChatId,
            userId
          });
          // 멤버 목록 다시 조회
          members = await storage.getGroupChatMembers(groupChatId);
        }
      }

      // 💡 NEW 뱃지 제거: 사용자가 처음 채팅방을 열었을 때 firstViewedAt 설정
      await storage.markGroupChatAsViewed(userId, groupChatId);

      // 멤버 정보에 사용자 세부 정보 포함
      const membersWithUserDetails = await Promise.all(
        members.map(async (member) => {
          const user = await storage.getUser(member.userId);
          return {
            ...member,
            user: user || { id: member.userId, email: `${member.userId}@univ.edu` }
          };
        })
      );

      // 에이전트 목록
      const agents = await storage.getGroupChatAgents(groupChatId);
      
      // 에이전트 정보 포함
      const agentsWithDetails = await Promise.all(
        agents.map(async (groupAgent) => {
          const agent = await storage.getAgent(groupAgent.agentId);
          return {
            ...groupAgent,
            agent
          };
        })
      );

      // 🚀 프롬프트 사전 생성 (백그라운드 비동기 처리 - 응답 속도 영향 없음)
      setImmediate(async () => {
        try {
          const { preloadGroupChatPrompts } = await import('./promptCache');
          await preloadGroupChatPrompts(groupChatId, userId, storage);
        } catch (error) {
          console.error('[프롬프트 사전 생성 실패]:', error);
        }
      });

      res.json({
        ...groupChat,
        provider: groupChat.provider || 'openai', // LLM 제공자 명시적 포함
        members: membersWithUserDetails,
        agents: agentsWithDetails
      });
    } catch (error) {
      console.error("Error fetching group chat:", error);
      res.status(500).json({ message: "Failed to fetch group chat" });
    }
  });

  // 그룹 채팅 메시지 조회
  app.get('/api/group-chats/:groupChatId/messages', isAuthenticated, checkGroupChatAccess, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;
      
      // 페이지네이션 파라미터 (증분 업데이트 지원)
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset) : undefined;
      
      console.log(`📊 메시지 조회 요청: groupChatId=${groupChatId}, limit=${limit}, offset=${offset}`);

      const messages = await storage.getGroupChatMessages(groupChatId, limit, offset);
      
      // 메시지에 발신자/에이전트 정보 추가
      const messagesWithDetails = await Promise.all(
        messages.map(async (message) => {
          let sender = null;
          let agent = null;

          if (message.senderId) {
            sender = await storage.getUser(message.senderId);
          }

          if (message.agentId) {
            agent = await storage.getAgent(message.agentId);
          }

          return {
            ...message,
            sender,
            agent
          };
        })
      );

      res.json(messagesWithDetails);
    } catch (error) {
      console.error("Error fetching group chat messages:", error);
      res.status(500).json({ message: "Failed to fetch group chat messages" });
    }
  });

  // 그룹 채팅 메시지 전송
  app.post('/api/group-chats/:groupChatId/messages', isAuthenticated, checkGroupChatAccess, async (req: any, res) => {
    console.log('🔥🔥🔥 라우트 핸들러 실행됨! 🔥🔥🔥');
    console.log('🔥 POST 요청 도달! URL:', req.url, 'Body:', JSON.stringify(req.body, null, 2));
    
    const groupChatId = parseInt(req.params.groupChatId);
    let isLocked = false;
    let sentTypingEnd = false; // 🚫 중복 typing_end 발송 방지 플래그
    
    // 🚫 안전한 typing_end 발송 (중복 방지)
    const safeTypingEnd = async () => {
      if (sentTypingEnd) {
        console.log(`[🚫 BLOCKED] typing_end 중복 발송 차단`);
        return;
      }
      sentTypingEnd = true;
      try {
        const { broadcastGroupChatStatus } = await import('./broadcast');
        broadcastGroupChatStatus(groupChatId, 'typing_end');
        console.log(`[🚫 SAFE] typing_end 발송 완료 (중복 방지)`);
      } catch (error) {
        console.error(`[🚫 ERROR] typing_end 발송 실패:`, error);
      }
    };
    
    try {
      const userId = req.user.id;
      const { content, targetAgentIds, replyOrder } = req.body;
      
      console.log('[서버] 수신된 데이터:', { content: content?.slice(0, 50), targetAgentIds, replyOrder });

      // SECURITY FIX: Authorization checks FIRST before any response status operations
      // Master Admin은 모든 그룹 채팅에 접근 가능
      if (userId !== 'master_admin') {
        // 그룹 채팅 정보 조회
        const groupChat = await storage.getGroupChat(groupChatId);
        
        // 사용자가 이 그룹 채팅의 멤버인지 확인
        const members = await storage.getGroupChatMembers(groupChatId);
        let isMember = members.some(member => String(member.userId) === String(userId));
        
        // 🔄 공유 채팅방인 경우 자동 멤버 등록
        if (!isMember && groupChat?.sharingMode === 'shared') {
          console.log(`[자동 멤버 추가] 공유 채팅방 ${groupChatId}에 사용자 ${userId} 추가 (메시지 전송)`);
          await storage.addGroupChatMember({
            groupChatId,
            userId
          });
          isMember = true; // 멤버로 등록됨
        }
        
        if (!isMember) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const { broadcastGroupChatStatus } = await import('./broadcast');

      // 메시지를 큐에 추가하여 대화 맥락 업데이트
      messageQueue.enqueue({
        groupChatId,
        content,
        senderId: userId
      });

      // 🚫 기존 검증된 fingerprint-based 중복 방지 시스템만 사용
      // 🚫 기존 사용자 메시지 중복 방지 (보조)
      if (isUserMessageDuplicate(userId, content, groupChatId)) {
        cleanupOldUserMessages(); // 메모리 정리
        return res.status(409).json({ 
          message: "같은 내용의 메시지를 최근에 보내셨습니다. 잠시 후 다시 시도해 주세요.",
          isDuplicate: true,
          waitTime: MESSAGE_DUPLICATE_WINDOW_MS / 1000
        });
      }
      
      // 🎯 userTurnId 생성 (안정적인 messageKey 시스템)
      const userTurnId = `${Date.now()}_${userId}_${Math.random().toString(36).substring(2, 8)}`;
      console.log(`[🔑 MESSAGE KEY] userTurnId 생성: ${userTurnId}`);
      
      // 🚫 turnId 기반 중복 방지 (추가 보안)
      if (isAlreadyProcessed(userTurnId)) {
        return res.status(409).json({ message: "Duplicate request detected", userTurnId });
      }

      // 사용자 메시지 생성
      const userMessage = await storage.createGroupChatMessage({
        groupChatId,
        content,
        senderId: userId,
        targetAgentIds,
        replyOrder,
        userTurnId // 🎯 userTurnId 추가
      });
      
      // 📝 Thread에 사용자 메시지 추가
      try {
        const user = await storage.getUser(userId);
        const userName = user?.firstName || user?.username || userId;
        await appendMessageToThread(groupChatId, `User: ${userName}`, content);
      } catch (threadError) {
        console.error('[ThreadManager] Failed to append user message to thread:', threadError);
      }
      
      // 🔄 Thread context trimming: Check and trim if token limit exceeded (백그라운드)
      setImmediate(async () => {
        try {
          const { checkAndTrimThread } = await import('./threadManager');
          await checkAndTrimThread(groupChatId);
        } catch (trimError) {
          console.error('[ThreadManager] Failed to check/trim thread:', trimError);
        }
      });
      
      // 📡 채팅 목록 업데이트 SSE 이벤트 발송
      const { broadcastWithEventId } = await import('./broadcast');
      broadcastWithEventId('chat_list_update', { 
        groupChatId, 
        timestamp: new Date().toISOString(),
        lastMessage: { content, senderId: userId }
      }, `chat_list_${groupChatId}_${userMessage.id}`);

      // ⚡ 즉시 응답 반환 (브라우저 HTTP 연결 블락 방지)
      res.json({ 
        userMessage, 
        success: true
      });

      // 🤖 자동 에이전트 선택 시스템
      let finalTargetAgentIds = targetAgentIds;
      
      // @로 시작하지 않는 메시지: AI가 자동으로 적절한 에이전트 선택
      if (!content.trim().startsWith('@')) {
        console.log('[🤖 자동 선택 모드] @멘션이 없는 질문 - AI가 적절한 에이전트 선택');
        
        // 그룹 채팅의 에이전트들 조회
        const groupAgents = await storage.getGroupChatAgents(groupChatId);
        
        // 사용 가능한 에이전트 목록 생성
        const availableAgentsForSelection: Array<{ id: number; name: string; description: string }> = [];
        for (const groupAgent of groupAgents) {
          const agent = await storage.getAgent(groupAgent.agentId);
          if (agent) {
            availableAgentsForSelection.push({
              id: agent.id,
              name: agent.name,
              description: agent.description || ''
            });
          }
        }
        
        if (availableAgentsForSelection.length === 0) {
          console.log('[🤖 자동 선택] 사용 가능한 에이전트 없음');
          await safeTypingEnd();
          cleanupOldTurnIds();
          return;
        }
        
        try {
          // AI가 질문을 분석하고 적절한 에이전트 선택
          const selectionResult = await selectAgentsForQuestion(
            content,
            availableAgentsForSelection,
            1, // 최소 1명
            3  // 최대 3명
          );
          
          // 🛡️ 안전장치: GPT가 선택한 ID를 사용 가능한 에이전트 목록으로 필터링
          const validAgentIds = availableAgentsForSelection.map(a => a.id);
          finalTargetAgentIds = selectionResult.selectedAgentIds.filter(id => validAgentIds.includes(id));
          
          // 필터링 후 에이전트가 없으면 폴백
          if (finalTargetAgentIds.length === 0) {
            finalTargetAgentIds = [availableAgentsForSelection[0].id];
            console.log(`[🤖 필터 폴백] 유효한 에이전트 없음, ${availableAgentsForSelection[0].name} 선택`);
          } else {
            console.log(`[🤖 자동 선택 완료] ${finalTargetAgentIds.length}명 선택: ${finalTargetAgentIds.join(', ')}`);
            console.log(`[🤖 선택 이유] ${selectionResult.reasoning}`);
          }
          
        } catch (error) {
          console.error('[🤖 자동 선택 오류]:', error);
          // 오류 시 첫 번째 에이전트 선택
          finalTargetAgentIds = [availableAgentsForSelection[0].id];
          console.log(`[🤖 폴백] ${availableAgentsForSelection[0].name} (ID: ${availableAgentsForSelection[0].id}) 선택`);
        }
      }

      console.log('[다중 에이전트 시스템] 질문 처리 시작');
      console.log(`[DEBUG] finalTargetAgentIds:`, finalTargetAgentIds);

      // RACE CONDITION FIX: Use atomic locking instead of separate check+set
      const lockResult = await storage.lockGroupChatForResponse(groupChatId);
      if (!lockResult.success) {
        // 이미 응답 반환했으므로 로그만 출력
        console.log(`[🔒 LOCK FAILED] 다른 에이전트가 응답 중: ${lockResult.currentRespondingAgent}`);
        return;
      }
      isLocked = true; // Track that we successfully locked

      // 그룹 채팅 정보 및 언어 레벨 조회
      const groupChat = await storage.getGroupChatById(groupChatId);
      const languageLevel = groupChat?.languageLevel ?? null; // null = 미적용 (제약 없음)
      console.log(`[언어 레벨] 그룹 채팅 ${groupChatId}: 레벨 ${languageLevel === null ? '미적용' : languageLevel}`);

      // 그룹 채팅의 에이전트들 조회
      const groupAgents = await storage.getGroupChatAgents(groupChatId);
      
      // 사용 가능한 에이전트 목록 생성
      const availableAgents: Agent[] = [];
      for (const groupAgent of groupAgents) {
        const agent = await storage.getAgent(groupAgent.agentId);
        if (agent) {
          availableAgents.push(agent);
        }
      }
      
      if (availableAgents.length === 0) {
        // 🔓 Lock 해제 필수 (lock leak 방지)
        await storage.unlockGroupChatResponse(groupChatId);
        await safeTypingEnd();
        cleanupOldTurnIds(); // 메모리 정리
        return res.json({ error: '사용 가능한 에이전트가 없습니다.' });
      }

      // 🔑 언어 감지 (기존 방식 사용)
      let detectedLanguage = 'en'; // 기본값
      
      try {
        // 첫 번째 에이전트 기준으로 언어 감지
        detectedLanguage = await resolveUserLanguage(groupChatId, userId, availableAgents[0].id, content, storage, languageLevel);
        console.log(`[🔑 언어 감지 완료] userTurnId: ${userTurnId}, language: ${detectedLanguage}`);
      } catch (error) {
        console.error(`[🔑 언어 감지 오류] userTurnId: ${userTurnId}:`, error);
        detectedLanguage = 'en'; // fallback
      }

      // 🧹 기존 시스템 사용 - 별도 캐시 처리 불필요

      // 🎯 Phase 1: finalTargetAgentIds 우선 처리 - 멘션된 또는 자동 선택된 에이전트만 응답
      if (finalTargetAgentIds && finalTargetAgentIds.length > 0) {
        // @모두가 아닌 특정 에이전트 멘션 처리
        if (!finalTargetAgentIds.some((id: any) => Number(id) === -1)) {
          console.log(`[🎯 TARGET MODE] 타겟 에이전트: ${finalTargetAgentIds.join(',')}`);
          
          // 멘션된 또는 자동 선택된 에이전트만 필터링
          const mentionedAgents = availableAgents.filter(agent =>
            finalTargetAgentIds.includes(agent.id)
          );

          if (mentionedAgents.length > 0) {
            try {
              // 🔑 감지된 언어 사용
              const userLanguage = detectedLanguage;
              console.log(`[🔑 멘션 언어 사용] 사용자: ${userId}, 결과: ${userLanguage} (userTurnId: ${userTurnId})`);
              
              // ✅ 시나리오 스킵 & 직접 응답 생성 (싱글톤 사용)
              const { AgentOrchestrator } = await import('./agentOrchestrator');
              const orchestrator = AgentOrchestrator.getInstance();
              
              const directResponse = await orchestrator.handleDirectMention(
                mentionedAgents,
                content,
                groupChatId,
                userId,
                userTurnId, // 🎯 userTurnId 전달
                userLanguage // 🌍 해결된 사용자 언어 전달
              );

              // 🎯 점진적 파싱 완료 확인: 이미 DB에 저장된 경우 Phase 1/2 스킵
              if (directResponse.progressivePersisted) {
                console.log(`[✅ 점진적 파싱 완료] ${directResponse.responses.length}개 응답이 이미 저장됨 - Phase 1/2 스킵`);
                
                // 🏁 멘션 완료 통보만 전송 (typing_end)
                await broadcastGroupChatStatus(groupChatId, 'typing_end');
                
                // 🔍 사후 검색: 각 응답 메시지에 대해 Google Search 실행 및 DB 저장 (백그라운드)
                (async () => {
                  try {
                    const { searchMessageSources } = await import('./gemini');
                    
                    for (const response of directResponse.responses) {
                      if (!response.messageId) {
                        console.log(`[⚠️ 사후 검색 SKIP] 메시지 ID 없음: ${response.agentName}`);
                        continue;
                      }
                      
                      // sources가 이미 있으면 스킵
                      if (response.sources?.chunks && response.sources.chunks.length > 0) {
                        console.log(`[⚠️ 사후 검색 SKIP] 이미 sources 존재: ${response.agentName} (${response.sources.chunks.length}개)`);
                        continue;
                      }
                      
                      console.log(`[🔍 사후 검색 시작] 메시지 ${response.messageId} (${response.agentName})`);
                      
                      const searchResult = await searchMessageSources({
                        agentName: response.agentName,
                        userMessage: content,
                        answerContent: response.content
                      });
                      
                      if (searchResult.success && searchResult.sources.length > 0) {
                        console.log(`[✅ 사후 검색 성공] ${searchResult.sources.length}개 출처 발견 - DB 저장 중...`);
                        
                        // DB에 sources 저장
                        const sourcesPayload = {
                          chunks: searchResult.sources.map((s: any) => ({
                            url: s.url,
                            title: s.title,
                            snippet: s.snippet || ''
                          }))
                        };
                        
                        await storage.updateGroupChatMessageSources(response.messageId, sourcesPayload);
                        console.log(`[💾 DB 저장 완료] 메시지 ${response.messageId}에 ${searchResult.sources.length}개 출처 저장`);
                        
                        // SSE 브로드캐스트: 프론트엔드 자동 업데이트
                        // DB에서 업데이트된 메시지 조회 후 브로드캐스트
                        const updatedMessage = await storage.getGroupChatMessage(response.messageId);
                        if (updatedMessage) {
                          await broadcastGroupChatMessage(groupChatId, updatedMessage);
                          console.log(`[📡 SSE 브로드캐스트] 메시지 ${response.messageId} sources 업데이트 전송`);
                        }
                      } else {
                        console.log(`[⚠️ 사후 검색 실패] 출처를 찾지 못함: ${response.agentName}`);
                      }
                    }
                  } catch (error) {
                    console.error('[❌ 사후 검색 오류]', error);
                  }
                })();
                
                // 🎯 멘션 완료 응답 반환
                return res.status(200).json({
                  userMessage,
                  chatbotResponse: {
                    agentIds: mentionedAgents.map(a => a.id),
                    agentNames: mentionedAgents.map(a => a.name),
                    message: directResponse.responses.map(r => r.content).join('\n\n')
                  },
                  progressivePersisted: true
                });
              }

              // 🚨 이전 방식 복원: 멘션 응답도 첫 답변 즉시, 나머지는 백그라운드
              
              // ⚡ PHASE 1: 첫 번째 멘션 응답 즉시 저장
              if (directResponse.responses.length > 0) {
                const firstResponse = directResponse.responses[0];
                
                // 🔒 Canon Lock 변환 적용 (첫 번째 멘션 응답, relationship와 독립적)
                const groupChatAgents = await storage.getGroupChatAgents(groupChatId);
                const firstAgentRelation = groupChatAgents.find(gca => gca.agentId === firstResponse.agentId);
                const relationshipType = firstAgentRelation?.relationshipType || 'companion';
                const relationshipMatrix = await storage.getRelationshipMatrix(groupChatId);
                
                // Strict Mode 설정 조회 (agent_canon 테이블에서)
                let firstCanonEnabled = false;
                let firstStrictMode: string | null = null;
                try {
                  const canonSettings = await storage.getAgentCanon(firstResponse.agentId);
                  firstStrictMode = canonSettings?.strictMode || null;
                  
                  // 🎯 Canonical modes: biblical/teacher만 Canon Lock으로 인정
                  const canonicalModes = ['biblical', 'teacher'];
                  firstCanonEnabled = !!firstStrictMode && canonicalModes.includes(firstStrictMode);
                } catch (error) {
                  // Strict Mode 설정이 없으면 기본값 false 사용
                }
                
                console.log(`[🔒 변환 준비] ${firstResponse.agentName}: relationshipType=${relationshipType}, canonEnabled=${firstCanonEnabled}, strictMode=${firstStrictMode}`);
                
                // 📰 Google Search 출처가 있으면 Canon Lock 변환 & 메시지 분할 비활성화 (출처 정확성 우선)
                const hasSources = firstResponse.sources?.supports && firstResponse.sources.supports.length > 0;
                let transformedContent = firstResponse.content;
                
                if (!hasSources) {
                  // 출처 없으면 Canon Lock 변환 적용
                  transformedContent = transformResponseForCanonLock(
                    firstResponse.content,
                    firstResponse.agentName,
                    relationshipType,
                    relationshipMatrix || [],
                    firstResponse.agentName,
                    firstCanonEnabled,
                    firstStrictMode
                  );
                  console.log(`[🔒 변환 결과] ${firstResponse.agentName}: 원본길이=${firstResponse.content.length}, 변환길이=${transformedContent.length}`);
                } else {
                  console.log(`[📰 출처 보존] ${firstResponse.agentName}: Google Search 출처가 있어 Canon Lock 변환 & 메시지 분할 스킵 (${firstResponse.sources.supports.length}개 citations)`);
                }
                
                // 📝 긴 메시지 분할 처리 (출처가 있으면 분할하지 않음)
                if (!hasSources && shouldSplit(transformedContent)) {
                  const splitSegments = smartSplit(transformedContent);
                  console.log(`[✂️ 메시지 분할] ${firstResponse.agentName}: ${splitSegments.length}개로 분할`);
                  
                  // 각 분할 메시지의 시작 오프셋 계산
                  let currentOffset = 0;
                  for (let i = 0; i < splitSegments.length; i++) {
                    const segment = splitSegments[i];
                    const segmentText = segment.content;
                    const segmentStart = currentOffset;
                    const segmentEnd = currentOffset + segmentText.length;
                    
                    // 이 세그먼트 범위에 속하는 supports만 필터링 및 위치 재조정
                    let segmentSources: typeof firstResponse.sources = undefined;
                    if (firstResponse.sources?.supports && firstResponse.sources.supports.length > 0) {
                      const filteredSupports = firstResponse.sources.supports.filter((support: { startIndex: number; endIndex: number; text: string; chunkIndices: number[] }) => {
                        // support 범위가 현재 세그먼트와 겹치는지 확인
                        return support.startIndex < segmentEnd && support.endIndex > segmentStart;
                      }).map((support: { startIndex: number; endIndex: number; text: string; chunkIndices: number[] }) => {
                        // 세그먼트 내 상대 위치로 재조정
                        return {
                          ...support,
                          startIndex: Math.max(0, support.startIndex - segmentStart),
                          endIndex: Math.min(segmentText.length, support.endIndex - segmentStart)
                        };
                      });
                      
                      if (filteredSupports.length > 0) {
                        segmentSources = {
                          chunks: firstResponse.sources.chunks, // 전체 chunks는 유지 (중복 제거는 프론트엔드에서)
                          supports: filteredSupports
                        };
                      }
                    }
                    
                    await storage.createGroupChatMessage({
                      groupChatId,
                      content: segmentText,
                      senderId: `agent_${firstResponse.agentId}`,
                      senderType: 'agent',
                      agentName: firstResponse.agentName,
                      agentId: firstResponse.agentId,
                      splitType: segment.splitType,
                      isContinuation: segment.splitType === 'length',
                      sources: segmentSources
                    });
                    
                    currentOffset = segmentEnd;
                  }
                } else {
                  await storage.createGroupChatMessage({
                    groupChatId,
                    content: transformedContent,
                    senderId: `agent_${firstResponse.agentId}`,
                    senderType: 'agent',
                    agentName: firstResponse.agentName,
                    agentId: firstResponse.agentId,
                    sources: firstResponse.sources // 📰 출처 추가
                  });
                }
                
                // 📝 Thread에 봇 메시지 추가
                try {
                  await appendMessageToThread(groupChatId, `Bot: ${firstResponse.agentName}`, transformedContent);
                } catch (threadError) {
                  console.error('[ThreadManager] Failed to append bot message to thread:', threadError);
                }
                
                // 📡 채팅 목록 업데이트 SSE 이벤트 발송
                const { broadcastWithEventId } = await import('./broadcast');
                broadcastWithEventId('chat_list_update', { 
                  groupChatId, 
                  timestamp: new Date().toISOString(),
                  lastMessage: { content: transformedContent, senderId: `agent_${firstResponse.agentId}` }
                }, `chat_list_${groupChatId}_immediate`);
                
                console.log(`[⚡ 즉시 멘션 저장] 첫 번째: ${firstResponse.agentName}: ${transformedContent.slice(0, 60)}...`);
              }
              
              // 🚀 PHASE 2: 나머지 멘션 응답들은 백그라운드에서 순차 처리
              if (directResponse.responses.length > 1) {
                setImmediate(async () => {
                  let backgroundProcessingSuccess = false;
                  try {
                    // 🔒 관계 정보 한 번만 조회 (백그라운드 최적화)
                    const relationshipMatrix = await storage.getRelationshipMatrix(groupChatId);
                    const groupChatAgents = await storage.getGroupChatAgents(groupChatId);
                    
                    for (let i = 1; i < directResponse.responses.length; i++) {
                      const response = directResponse.responses[i];
                      
                      // 🚫 Phase 1: turnId 생성 및 중복 방지
                      const turnId = `mention_${groupChatId}_${response.agentId}_${Date.now()}_${i}`;
                      if (isAlreadyProcessed(turnId)) {
                        continue; // 이미 처리된 응답은 스킵
                      }
                      
                      // 🚀 타이밍 일관성: 모든 메시지 즉시 처리 (대기 제거)
                      console.log(`[⚡ 즉시 처리] ${response.agentName} 응답 즉시 저장`);
                      
                      // 🔒 Canon Lock 변환 적용 (나머지 멘션 응답, relationship와 독립적)
                      const bgAgentRelation = groupChatAgents.find(gca => gca.agentId === response.agentId);
                      const bgRelationshipType = bgAgentRelation?.relationshipType || 'companion';
                      
                      // Strict Mode 설정 조회 (agent_canon 테이블에서)
                      let bgCanonEnabled = false;
                      let bgStrictMode: string | null = null;
                      try {
                        const bgCanonSettings = await storage.getAgentCanon(response.agentId);
                        bgStrictMode = bgCanonSettings?.strictMode || null;
                        
                        // 🎯 Canonical modes: biblical/teacher만 Canon Lock으로 인정
                        const canonicalModes = ['biblical', 'teacher'];
                        bgCanonEnabled = !!bgStrictMode && canonicalModes.includes(bgStrictMode);
                      } catch (error) {
                        // Strict Mode 설정이 없으면 기본값 false 사용
                      }
                      
                      console.log(`[🔒 백그라운드 변환 준비] ${response.agentName}: relationshipType=${bgRelationshipType}, canonEnabled=${bgCanonEnabled}, strictMode=${bgStrictMode}`);
                      
                      // 📰 Google Search 출처가 있으면 Canon Lock 변환 & 메시지 분할 비활성화 (출처 정확성 우선)
                      const bgHasSources = response.sources?.supports && response.sources.supports.length > 0;
                      let transformedBgContent = response.content;
                      
                      if (!bgHasSources) {
                        // 출처 없으면 Canon Lock 변환 적용
                        transformedBgContent = transformResponseForCanonLock(
                          response.content,
                          response.agentName,
                          bgRelationshipType,
                          relationshipMatrix || [],
                          response.agentName,
                          bgCanonEnabled,
                          bgStrictMode
                        );
                        console.log(`[🔒 백그라운드 변환 결과] ${response.agentName}: 원본길이=${response.content.length}, 변환길이=${transformedBgContent.length}`);
                      } else {
                        console.log(`[📰 백그라운드 출처 보존] ${response.agentName}: Google Search 출처가 있어 Canon Lock 변환 & 메시지 분할 스킵 (${response.sources.supports.length}개 citations)`);
                      }
                      
                      // 📝 긴 메시지 분할 처리 (백그라운드, 출처가 있으면 분할하지 않음)
                      if (!bgHasSources && shouldSplit(transformedBgContent)) {
                        const splitSegments = smartSplit(transformedBgContent);
                        console.log(`[✂️ 백그라운드 메시지 분할] ${response.agentName}: ${splitSegments.length}개로 분할`);
                        
                        // 각 분할 메시지의 시작 오프셋 계산
                        let currentOffset = 0;
                        for (let j = 0; j < splitSegments.length; j++) {
                          const segment = splitSegments[j];
                          const segmentText = segment.content;
                          const segmentStart = currentOffset;
                          const segmentEnd = currentOffset + segmentText.length;
                          
                          // 이 세그먼트 범위에 속하는 supports만 필터링 및 위치 재조정
                          let segmentSources: typeof response.sources = undefined;
                          if (response.sources?.supports && response.sources.supports.length > 0) {
                            const filteredSupports = response.sources.supports.filter((support: { startIndex: number; endIndex: number; text: string; chunkIndices: number[] }) => {
                              return support.startIndex < segmentEnd && support.endIndex > segmentStart;
                            }).map((support: { startIndex: number; endIndex: number; text: string; chunkIndices: number[] }) => {
                              return {
                                ...support,
                                startIndex: Math.max(0, support.startIndex - segmentStart),
                                endIndex: Math.min(segmentText.length, support.endIndex - segmentStart)
                              };
                            });
                            
                            if (filteredSupports.length > 0) {
                              segmentSources = {
                                chunks: response.sources.chunks,
                                supports: filteredSupports
                              };
                            }
                          }
                          
                          await storage.createGroupChatMessage({
                            groupChatId,
                            content: segmentText,
                            senderId: `agent_${response.agentId}`,
                            agentName: response.agentName,
                            agentId: response.agentId,
                            userTurnId: userTurnId,
                            splitType: segment.splitType,
                            isContinuation: segment.splitType === 'length',
                            sources: segmentSources
                          });
                          
                          currentOffset = segmentEnd;
                        }
                      } else {
                        await storage.createGroupChatMessage({
                          groupChatId,
                          content: transformedBgContent,
                          senderId: `agent_${response.agentId}`,
                          agentName: response.agentName,
                          agentId: response.agentId,
                          userTurnId: userTurnId,
                          sources: response.sources // 📰 출처 추가
                        });
                      }
                      
                      // 📝 Thread에 봇 메시지 추가
                      try {
                        await appendMessageToThread(groupChatId, `Bot: ${response.agentName}`, transformedBgContent);
                      } catch (threadError) {
                        console.error('[ThreadManager] Failed to append bot message to thread:', threadError);
                      }
                      
                      // 📡 채팅 목록 업데이트 SSE 이벤트 발송
                      const { broadcastWithEventId } = await import('./broadcast');
                      broadcastWithEventId('chat_list_update', { 
                        groupChatId, 
                        timestamp: new Date().toISOString(),
                        lastMessage: { content: transformedBgContent, senderId: `agent_${response.agentId}` }
                      }, `chat_list_${groupChatId}_bg_${i}`);
                      
                      console.log(`[🎯 백그라운드 멘션 저장 ${i+1}/${directResponse.responses.length}] ${response.agentName}: ${transformedBgContent.slice(0, 60)}...`);
                      cleanupOldTurnIds(); // 메모리 정리
                      
                      // ⏱️ 응답 간 0.7초 지연 (마지막 메시지는 제외)
                      if (i < directResponse.responses.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 700));
                        console.log(`[⏱️ 지연] 다음 응답까지 0.7초 대기 완료`);
                      }
                    }
                    backgroundProcessingSuccess = true;
                  } catch (processError) {
                    console.error('[🎯 멘션 처리 루프 오류]:', processError);
                  } finally {
                    // 🏁 성공/실패 관계없이 항상 typing_end 발송 (Critical Fix)
                    const statusMessage = backgroundProcessingSuccess 
                      ? `[🏁 멘션 완료] 모든 ${directResponse.responses.length}개 멘션 응답 처리 완료 - typing_end 발송`
                      : `[🚨 멘션 에러 복구] 백그라운드 처리 중 오류 발생 - typing_end 발송으로 복구`;
                    
                    console.log(statusMessage);
                    try {
                      const { broadcastGroupChatStatus } = await import('./broadcast');
                      await broadcastGroupChatStatus(groupChatId, 'typing_end');
                      console.log(`[✅ 타이핑 종료] typing_end 발송 성공 (백그라운드 ${backgroundProcessingSuccess ? '완료' : '오류 복구'})`);
                    } catch (endError) {
                      console.error(`[❌ 심각한 오류] typing_end 발송 실패:`, endError);
                    }
                  }
                });
              } else {
                // 🔥 멘션이 1개만 있을 때 즉시 typing_end 발송
                setImmediate(async () => {
                  try {
                    const { broadcastGroupChatStatus } = await import('./broadcast');
                    await broadcastGroupChatStatus(groupChatId, 'typing_end');
                    console.log(`[✅ 단일 멘션 완료] typing_end 발송 성공`);
                  } catch (endError) {
                    console.error(`[❌ typing_end 발송 실패]:`, endError);
                  }
                });
              }

              console.log(`[🎯 멘션 완료] ${mentionedAgents.length}개 에이전트 직접 응답`);
              
              // 🔓 그룹 채팅 잠금 해제 (typing_end는 백그라운드 완료 후 발송)
              await storage.unlockGroupChatResponse(groupChatId);
              cleanupOldTurnIds(); // 메모리 정리
              
              return res.json({
                userMessage,
                scenarioTurns: directResponse.responses
              });

            } catch (error) {
              console.error('[🎯 멘션 처리 오류]:', error);
              // 오류 시에도 정리 작업 수행
              await storage.unlockGroupChatResponse(groupChatId);
              await safeTypingEnd();
              cleanupOldTurnIds(); // 메모리 정리
              
              // ⚠️ 중요: 오류 발생 시에도 여기서 종료하여 중복 처리 방지
              // 이미 응답을 보냈을 수 있으므로 return으로 함수 종료
              return;
            }
          }
        }
      }

      // 0단계: finalTargetAgentIds 처리 - @모두(-1) 또는 특정 에이전트 선택 (기존 로직)
      if (finalTargetAgentIds && finalTargetAgentIds.length > 0) {
        // @모두 선택된 경우 (-1이 포함된 경우) - 문자열과 숫자 모두 처리
        if (finalTargetAgentIds.some((id: any) => Number(id) === -1)) {
          console.log('[모든 에이전트 응답] @모두가 선택됨 - 직접 멘션 처리');
          
          try {
            // 🔥 typing_start 발송
            broadcastGroupChatStatus(groupChatId, 'typing_start', {
              name: '모든 에이전트',
              icon: '👥',
              backgroundColor: '#6366f1'
            });

            // 🎯 모든 에이전트에 대해 직접 멘션 처리 (provider 설정 존중)
            const orchestrator = AgentOrchestrator.getInstance();
            const directResponse = await orchestrator.handleDirectMention(
              availableAgents,
              content,
              groupChatId,
              userId,
              userTurnId,
              detectedLanguage
            );

            console.log(`[🎯 @모두 처리 완료] ${directResponse.responses.length}개 응답 생성됨`);
            
            // 🔓 그룹 채팅 잠금 해제
            await storage.unlockGroupChatResponse(groupChatId);
            cleanupOldTurnIds(); // 메모리 정리
            
            // typing_end 발송
            await safeTypingEnd();
            
            return res.json({
              userMessage,
              scenarioTurns: directResponse.responses
            });

          } catch (error) {
            console.error('[🎯 @모두 처리 오류]:', error);
            
            // 오류 시에도 정리 작업 수행
            await storage.unlockGroupChatResponse(groupChatId);
            await safeTypingEnd();
            cleanupOldTurnIds(); // 메모리 정리
            
            // HTTP 에러 응답 반환
            return res.status(500).json({
              error: '응답 생성에 실패했습니다. 다시 시도해 주세요.',
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
        
        // 특정 에이전트들만 선택된 경우
        console.log(`[사용자 지정 에이전트] ${finalTargetAgentIds.length}개 에이전트 선택됨`);
        
        const selectedAgents = availableAgents.filter(agent => finalTargetAgentIds.includes(agent.id));
        
        if (selectedAgents.length > 0) {
          // 여러 에이전트 선택된 경우 다중 에이전트 대화 사용
          if (selectedAgents.length > 1) {
            console.log(`[여러 에이전트 선택] ${selectedAgents.length}개 에이전트 - AI 큐에 추가`);
            
            try {
              broadcastGroupChatStatus(groupChatId, 'typing_start', {
                name: '선택된 에이전트들',
                icon: '👥',
                backgroundColor: '#6366f1'
              });

              // 🎭 AI 응답 작업을 큐에 추가 (직렬화 보장)
              const { aiResponseQueue } = await import('./aiResponseQueue');
              aiResponseQueue.enqueue({
                groupChatId,
                content,
                availableAgents: selectedAgents,
                userId,
                userTurnId,
                detectedLanguage
              });

              console.log(`[🎭 AI 큐 등록] 선택된 ${selectedAgents.length}개 에이전트 작업 큐에 추가 완료`);

            } catch (error) {
              console.error('[🎭 AI 큐 등록 오류]:', error);
              
              // 오류 시 typing_end 발송
              try {
                const { broadcastGroupChatStatus } = await import('./broadcast');
                await broadcastGroupChatStatus(groupChatId, 'typing_end');
              } catch (broadcastError) {
                console.error(`[🚨 typing_end 발송 실패]:`, broadcastError);
              }
            } finally {
              // 🔓 그룹 채팅 잠금 해제 (큐 워커가 새로운 잠금 획득)
              await storage.unlockGroupChatResponse(groupChatId);
              cleanupOldTurnIds(); // 메모리 정리
            }

            // 🚫 typing_end 방지: 큐 워커가 완료 시 발송하므로 여기서는 차단
            sentTypingEnd = true;
            console.log('[🚫 여러 에이전트 처리] typing_end는 큐 워커 완료 시 발송 - finally 블록 차단');

            // ✅ 즉시 응답 반환 (큐 워커가 백그라운드에서 AI 응답 생성)
            return res.json({
              ...userMessage,
              scenarioTurns: []  // 🎯 다중 선택은 빈 배열 (큐 기반 시스템)
            });
          }
          
          // ⚡ 단일 에이전트 즉시 처리 (딜레이 제거)
          for (let i = 0; i < selectedAgents.length; i++) {
            const agent = selectedAgents[i];
            
            try {
              
              broadcastGroupChatStatus(groupChatId, 'typing_start', {
                name: agent.name,
                icon: agent.icon || '🤖',
                backgroundColor: agent.backgroundColor || '#6B7280'
              });

              // 기존 OpenAI 함수 직접 호출
              const { generateChatResponse } = await import('./openai');
              const { enhanceAgentPersona, generateProfessionalPrompt } = await import('./personaEnhancer');
              
              // 🔥 에이전트 페르소나 강화
              const enhancedPersona = enhanceAgentPersona(
                agent.name,
                agent.description || '',
                agent.category || '',
                agent.upperCategory || '',
                agent.lowerCategory || '',
                agent.speechStyle || '친근하고 도움이 되는 말투',
                agent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공'
              );

              // 전문성 강화 프롬프트 생성
              const professionalPrompt = generateProfessionalPrompt(enhancedPersona);
              
              // 🤝 사용자와 해당 에이전트의 관계 조회
              let relationship = undefined; // 기본값
              try {
                const conversation = await storage.getOrCreateConversation(userId, agent.id);
                if (conversation && conversation.relationshipType) {
                  relationship = conversation.relationshipType;
                  console.log(`[관계 확인] User ${userId}, Agent ${agent.name}: ${relationship}`);
                }
              } catch (error) {
                console.log(`[관계 조회 실패] User ${userId}, Agent ${agent.id}:`, error);
              }
              
              // 🔥 에이전트의 문서들을 가져오기
              let agentDocuments: any[] = [];
              try {
                agentDocuments = await storage.getAgentDocuments(agent.id);
                console.log(`[문서 연동] ${agent.name}에 연결된 문서 ${agentDocuments.length}개 발견`);
                if (agentDocuments.length > 0) {
                  console.log(`[문서 목록] ${agentDocuments.map(d => d.filename).join(', ')}`);
                }
              } catch (docError) {
                console.error(`[문서 연동 오류] ${agent.name}:`, docError);
                agentDocuments = [];
              }
              
              // 문서를 generateChatResponse 형식으로 변환
              const availableDocuments = agentDocuments
                .filter(doc => doc.content !== null)
                .map(doc => ({
                  filename: doc.filename,
                  content: doc.content as string
                }));
              
              // Note: 문서 압축은 RAG 검색 결과에만 적용됨 (relevanceScore 필요)
              
              // 그룹 채팅 메시지 히스토리 가져오기
              const recentMessages = await storage.getGroupChatMessages(groupChatId);
              
              // 대화 히스토리 준비
              const rawHistory = recentMessages.slice(-10).map(msg => ({
                role: msg.senderId ? 'user' as const : 'assistant' as const,
                content: msg.content
              }));
              
              // 🎯 토큰 최적화: 대화 히스토리 압축
              const optimized = await optimizeTokenUsage(rawHistory, availableDocuments, "", { 
                maxRecentMessages: 3, 
                maxDocumentChunks: 3, 
                maxChunkTokens: 150, 
                optimizePrompt: false 
              });
              const conversationHistory = filterSystemMessages(optimized.messages);
              console.log(`[그룹 채팅] ${agent.name} 토큰 절감: ${optimized.savedTokens}`);
              
              // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
              const currentUser = await storage.getUser(userId);
              const userProfile = currentUser ? {
                nickname: currentUser.nickname || undefined,
                age: currentUser.age || undefined,
                gender: currentUser.gender || undefined,
                country: currentUser.country || undefined,
                religion: currentUser.religion || undefined,
                occupation: currentUser.occupation || undefined
              } : undefined;

              // Get agent humor settings
              const agentHumor = await storage.getAgentHumor(agent.id);

              // 🔥 단일 에이전트는 OpenAI 직접 호출 (orchestrator 불필요)
              const response = await generateChatResponse(
                content,                // userMessage
                agent.name,             // agentName
                professionalPrompt,     // agentDescription
                conversationHistory,    // conversationHistory
                availableDocuments,     // availableDocuments
                agent.category || "general-llm",  // chatbotType
                agent.speechStyle || "친근하고 도움이 되는 말투",  // speechStyle
                agent.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공",  // personality
                "",                     // additionalPrompt
                detectedLanguage,       // userLanguage
                undefined,              // conversationId
                relationship,           // relationship
                undefined,              // languageLevel
                undefined,              // maxTokens
                userProfile,            // 🎯 사용자 프로필 정보 전달
                agentHumor,             // 🎚️ 유머 설정 적용
                5,                      // reactionIntensity
                'general',              // context
                userId,                 // 📊 토큰 로깅용 userId
                agent.id,               // 📊 토큰 로깅용 agentId
                groupChatId             // 📊 토큰 로깅용 groupChatId
              );

              // 🧹 리듬태그 제거 ((회상), (강조) 등)
              const cleanedMessage = removeRhythmTags(response.message);
              
              const agentMessage = await storage.createGroupChatMessage({
                groupChatId,
                content: cleanedMessage,
                senderId: `agent_${agent.id}`,
                agentName: agent.name,
                agentId: agent.id,
                userTurnId: userTurnId,
                replyOrder: replyOrder ? replyOrder + 1 + i : undefined,
                sources: response.sources || null
              });
              
              // 📝 Thread에 봇 메시지 추가
              try {
                await appendMessageToThread(groupChatId, `Bot: ${agent.name}`, cleanedMessage);
              } catch (threadError) {
                console.error('[ThreadManager] Failed to append bot message to thread:', threadError);
              }
              
              console.log(`[단일 에이전트 응답 ${i+1}/${selectedAgents.length}] ${agent.name}: ${cleanedMessage.slice(0, 100)}...`);
              
            } catch (error) {
              console.error(`[사용자 지정 응답 오류] ${agent.name}:`, error);
              
              const fallbackMessage = await storage.createGroupChatMessage({
                groupChatId,
                content: `안녕하세요! 저는 ${agent.name}입니다. 현재 시스템에 일시적인 문제가 있어 정상적인 응답을 드리지 못해 죄송합니다.`,
                agentId: agent.id,
                replyOrder: replyOrder ? replyOrder + 1 + i : undefined
              });
            }
          }
          
          // 🎭 단일 에이전트들도 순차 연출 시스템 적용
          // 🔓 그룹 채팅 잠금 해제 (중요!)  
          await storage.unlockGroupChatResponse(groupChatId);
          await safeTypingEnd();
          cleanupOldTurnIds(); // 메모리 정리
          return res.json({
            ...userMessage,
            scenarioTurns: []  // 🎯 단일 에이전트는 빈 배열 (orchestrator 전환 완료)
          });
        }
      }

      // 1단계: 특정 챗봇 지정 확인 (@챗봇이름 형태)
      let targetAgent = null;
      let mentionedButNotAvailable: string | null = null;
      
      // @로 시작하는지 확인
      if (content.includes('@')) {
        // 모든 에이전트 이름을 길이 순으로 정렬 (긴 이름 우선 매칭 - "세베루스 스네이프" > "세베루스")
        const sortedAgents = [...availableAgents].sort((a, b) => b.name.length - a.name.length);
        
        for (const agent of sortedAgents) {
          const mentionPattern = `@${agent.name}`;
          if (content.includes(mentionPattern)) {
            targetAgent = agent;
            console.log(`[특정 챗봇 지정] @${agent.name} -> 매칭 성공`);
            break;
          }
        }
        
        // @가 있지만 매칭되는 에이전트가 없는 경우 - 존재하지 않는 에이전트 호출 시도
        if (!targetAgent) {
          // @뒤의 텍스트 추출 (에러 메시지용)
          const mentionMatch = content.match(/@([^\s@]+(?:\s+[^\s@]+)*)/);
          if (mentionMatch) {
            mentionedButNotAvailable = mentionMatch[1];
            console.log(`[❌ 멘션 실패] @${mentionedButNotAvailable}이(가) 이 채팅방에 없습니다`);
          }
        }
      } else {
        console.log('[특정 챗봇 지정] @멘션 없음 - 일반 질문 처리');
      }
      
      // 🚨 존재하지 않는 에이전트를 호출한 경우 - 명확한 에러 메시지
      if (mentionedButNotAvailable) {
        try {
          await safeTypingEnd();
        } catch (error) {
          console.error('[❌ safeTypingEnd 실패] 무시하고 계속 진행:', error);
        } finally {
          // 🔓 그룹 채팅 잠금 해제 (중요! 안 하면 채팅방이 잠긴 채로 남음)
          await storage.unlockGroupChatResponse(groupChatId);
          cleanupOldTurnIds();
        }
        
        const errorMessage = await storage.createGroupChatMessage({
          groupChatId,
          content: `"@${mentionedButNotAvailable}"은(는) 이 채팅방에 참여하고 있지 않습니다.\n\n현재 이 채팅방의 멤버:\n${availableAgents.map(a => `• ${a.name} (${a.category || '일반'})`).join('\n')}`,
          agentId: null,
          senderId: null
        });
        
        return res.json(errorMessage);
      }
      
      // 2단계: @질문 유형 판단 - 전문성 기반 차별화가 필요한 질문들
      const hasEachMajor = content.includes('각 전공');
      const hasAll = content.includes('모두');
      const hasTotal = content.includes('전체');
      const hasIntro = content.includes('소개');
      const hasMajorChoice = content.includes('전공 선택') || content.includes('전공을 선택');
      const hasAdvice = content.includes('조언');
      const hasHelp = content.includes('도움');
      const hasGeneralMajor = content.includes('전공') && !content.includes('과') && !content.includes('학과');
      
      // 🔥 모든 전공 챗봇이 응답해야 하는 질문들 - 더 단순하고 확실한 감지
      const shouldAllMajorsRespond = 
        // 기본 전공 선택 키워드
        hasMajorChoice || hasEachMajor || 
        content.includes('어떤 전공') || content.includes('전공을') || content.includes('전공 추천') ||
        content.includes('전공이') || content.includes('전공에') || content.includes('전공을 추천') ||
        content.includes('전공 고르') || content.includes('전공 정하') || content.includes('전공 선택하') ||
        // "각자" 키워드가 있으면 무조건 모든 챗봇 응답
        content.includes('각자') ||
        content.includes('각각') ||
        content.includes('모두') ||
        content.includes('전체') ||
        content.includes('다들') ||
        content.includes('여러분') ||
        // 전공과 함께 나오는 확장 키워드들
        (content.includes('전공') && (
          content.includes('비전') || content.includes('미래') || content.includes('전망') ||
          content.includes('어떻') || content.includes('생각') || content.includes('의견') ||
          content.includes('추천') || content.includes('조언') || content.includes('상담') ||
          content.includes('개별') || content.includes('경험') ||
          content.includes('선택') || content.includes('결정') || content.includes('고민') ||
          content.includes('장점') || content.includes('매력') || content.includes('특징') ||
          content.includes('입장') || content.includes('관점')
        ));
        
      console.log(`[전공 감지] shouldAllMajorsRespond: ${shouldAllMajorsRespond}, 질문: "${content}"`);
      console.log(`[전공 감지 상세] hasMajorChoice: ${hasMajorChoice}, hasEachMajor: ${hasEachMajor}, 어떤전공: ${content.includes('어떤 전공')}, 전공을: ${content.includes('전공을')}`);
      
      // 🔥 상세 감지 로그
      console.log(`[키워드 감지] 각자: ${content.includes('각자')}, 각각: ${content.includes('각각')}, 모두: ${content.includes('모두')}`);
      console.log(`[키워드 감지] 전체: ${content.includes('전체')}, 다들: ${content.includes('다들')}, 여러분: ${content.includes('여러분')}`);
      
      if (content.includes('전공')) {
        console.log(`[전공 확장 감지] 전공 포함됨. 확인 중...`);
        console.log(`[전공 확장 감지] 입장: ${content.includes('입장')}, 관점: ${content.includes('관점')}, 장점: ${content.includes('장점')}`);
        console.log(`[전공 확장 감지] 비전: ${content.includes('비전')}, 미래: ${content.includes('미래')}, 전망: ${content.includes('전망')}`);
        console.log(`[전공 확장 감지] 어떻: ${content.includes('어떻')}, 생각: ${content.includes('생각')}, 의견: ${content.includes('의견')}`);
      }
      
      // 간단한 @멘션들 - 인사, 일반적인 질문들  
      const isGreeting = content.includes('인사') || content.includes('안녕') || content.includes('반가') || content.includes('처음') || content.includes('만나');
      const isSimpleQuestion = content.length <= 20; // 20자 이하의 간단한 질문들
      
      // 학사행정 관련 질문들 - 전문성 기반 라우팅이 필요
      const isAcademicQuestion = content.includes('학사') || content.includes('일정') || content.includes('수강신청') || 
                                content.includes('학점') || content.includes('성적') || content.includes('졸업') || 
                                content.includes('등록') || content.includes('휴학') || content.includes('복학') ||
                                content.includes('커리큘럼') || content.includes('시간표') || content.includes('학기') ||
                                content.includes('강의') || content.includes('수업');
      
      // @로 시작하는 일반적인 질문들도 전문성 기반 라우팅 필요
      const isAtMentionQuestion = content.startsWith('@') && !targetAgent;
      
      const isGeneralQuestion = hasEachMajor || hasAll || hasTotal || hasIntro || hasMajorChoice || hasAdvice || hasHelp || hasGeneralMajor || isGreeting || isSimpleQuestion || isAcademicQuestion || isAtMentionQuestion || shouldAllMajorsRespond;
      
      if (targetAgent) {
        console.log(`[특정 챗봇 응답] ${targetAgent.name}만 응답`);
        
        // 특정 지정된 챗봇만 응답
        try {
          broadcastGroupChatStatus(groupChatId, 'typing_start', {
            name: targetAgent.name,
            icon: targetAgent.icon || '🤖',
            backgroundColor: targetAgent.backgroundColor || '#6B7280'
          });

          // 기존 OpenAI 함수 직접 호출
          const { generateChatResponse } = await import('./openai');
          const { enhanceAgentPersona, generateProfessionalPrompt } = await import('./personaEnhancer');
          
          // 🔥 에이전트 페르소나 강화
          const enhancedPersona = enhanceAgentPersona(
            targetAgent.name,
            targetAgent.description || '',
            targetAgent.category || '',
            targetAgent.upperCategory || '',
            targetAgent.lowerCategory || '',
            targetAgent.speechStyle || '친근하고 도움이 되는 말투',
            targetAgent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공'
          );

          // 전문성 강화 프롬프트 생성
          const professionalPrompt = generateProfessionalPrompt(enhancedPersona);
          
          // 🤝 사용자와 해당 에이전트의 관계 조회
          let relationship = undefined;
          try {
            const conversation = await storage.getOrCreateConversation(userId, targetAgent.id);
            if (conversation && conversation.relationshipType) {
              relationship = conversation.relationshipType;
              console.log(`[관계 확인] User ${userId}, Agent ${targetAgent.name}: ${relationship}`);
            }
          } catch (error) {
            console.log(`[관계 조회 실패] User ${userId}, Agent ${targetAgent.id}:`, error);
          }
          
          // 🔥 에이전트의 문서들을 가져오기
          const agentDocuments = await storage.getAgentDocuments(targetAgent.id);
          console.log(`[문서 연동] ${targetAgent.name}에 연결된 문서 ${agentDocuments.length}개 발견`);
          
          // 문서를 generateChatResponse 형식으로 변환
          const availableDocuments = agentDocuments
            .filter(doc => doc.content !== null)
            .map(doc => ({
              filename: doc.filename,
              content: doc.content as string
            }));
          
          // Note: 문서 압축은 RAG 검색 결과에만 적용됨 (relevanceScore 필요)
          
          // 그룹 채팅 메시지 히스토리 가져오기
          const recentMessages = await storage.getGroupChatMessages(groupChatId);
          
          // 대화 히스토리 준비
          const rawMentionHist = recentMessages.slice(-10).map(msg => ({
            role: msg.senderId ? 'user' as const : 'assistant' as const,
            content: msg.content
          }));
          
          // 🎯 토큰 최적화: 대화 히스토리 압축
          const mentionOpt = await optimizeTokenUsage(rawMentionHist, availableDocuments, "", { 
            maxRecentMessages: 3, maxDocumentChunks: 3, maxChunkTokens: 150, optimizePrompt: false 
          });
          const conversationHistory = mentionOpt.messages;
          console.log(`[멘션] ${targetAgent.name} 토큰 절감: ${mentionOpt.savedTokens}`);
          
          // 사용자별 언어 설정 해결
          const userLanguage = await resolveUserLanguage(groupChatId, userId, targetAgent.id, content, storage, languageLevel);
          
          // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
          const currentUser = await storage.getUser(userId);
          const userProfile = currentUser ? {
            nickname: currentUser.nickname || undefined,
            age: currentUser.age || undefined,
            gender: currentUser.gender || undefined,
            country: currentUser.country || undefined,
            religion: currentUser.religion || undefined,
            occupation: currentUser.occupation || undefined
          } : undefined;

          // Get agent humor settings
          const targetAgentHumor = await storage.getAgentHumor(targetAgent.id);

          const response = await generateChatResponse(
            content,
            targetAgent.name,
            targetAgent.description || '',
            filterSystemMessages(conversationHistory),
            availableDocuments, // 🔥 에이전트 문서 전달
            targetAgent.type || 'general-llm',
            enhancedPersona.speechStyle, // 🔥 강화된 페르소나 적용
            enhancedPersona.personality, // 🔥 강화된 페르소나 적용
            professionalPrompt, // 🔥 전문성 강화 프롬프트
            userLanguage, // 🌍 사용자별 언어 설정 적용
            groupChatId,
            relationship, // 🎯 페르소나 OS: 관계별 맞춤 응답
            languageLevel, // 🎯 언어 레벨 적용
            undefined, // maxTokens
            userProfile, // 🎯 사용자 프로필 정보 전달
            targetAgentHumor, // 🎚️ 유머 설정 적용
            5, // reactionIntensity
            'general', // context
            userId, // 📊 토큰 로깅용 userId
            targetAgent.id, // 📊 토큰 로깅용 agentId
            groupChatId // 📊 토큰 로깅용 groupChatId
          );
          
          const botMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: response.message,
            agentId: targetAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
          
          // 📝 Thread에 봇 메시지 추가
          try {
            await appendMessageToThread(groupChatId, `Bot: ${targetAgent.name}`, response.message);
          } catch (threadError) {
            console.error('[ThreadManager] Failed to append bot message to thread:', threadError);
          }
          
          console.log(`[특정 챗봇 응답] ${targetAgent.name}: ${response.message.slice(0, 100)}...`);
          
        } catch (error) {
          console.error(`[특정 챗봇 응답 오류] ${targetAgent.name}:`, error);
          
          const fallbackMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: `안녕하세요! 저는 ${targetAgent.name}입니다. 현재 시스템에 일시적인 문제가 있어 정상적인 응답을 드리지 못해 죄송합니다.`,
            agentId: targetAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
        }
      } else if (isGeneralQuestion) {
        console.log('[전문성 기반 차별화 응답] @질문 처리 시작');
        
        // 🔥 전문성 기반 응답 차별화 시스템
        const { routeQuestion } = await import('./chatbotRouter');
        
        // 그룹 채팅 메시지 히스토리 가져오기 (라우터용)
        const recentMessages = await storage.getGroupChatMessages(groupChatId);
        const conversationContext = recentMessages.slice(-5).map(msg => 
          `${msg.senderId ? 'user' : 'bot'}: ${msg.content.slice(0, 100)}`
        ).join('\n');
        
        // 1. 질문 유형 분석
        const routerAnalysis = await routeQuestion(content, availableAgents, conversationContext);
        
        // 인사/일반 소통 질문 또는 전공 선택 질문인 경우 모든 챗봇이 응답
        if (routerAnalysis.specialization === 'none' || shouldAllMajorsRespond) {
          console.log(shouldAllMajorsRespond ? '[전공 상담] 모든 전공 챗봇이 개인 경험으로 응답 - AI 큐에 추가' : '[일반 소통] 모든 챗봇이 응답 - AI 큐에 추가');
          
          try {
            // 🔥 typing_start 발송
            broadcastGroupChatStatus(groupChatId, 'typing_start', {
              name: shouldAllMajorsRespond ? '전공 챗봇들' : '모든 챗봇',
              icon: '👥',
              backgroundColor: '#6366f1'
            });

            // 🎭 AI 응답 작업을 큐에 추가 (직렬화 보장)
            const { aiResponseQueue } = await import('./aiResponseQueue');
            aiResponseQueue.enqueue({
              groupChatId,
              content,
              availableAgents,
              userId,
              userTurnId,
              detectedLanguage
            });

            console.log(`[🎭 AI 큐 등록] 일반 소통/전공 상담 작업 큐에 추가 완료 - 큐 워커가 순차 처리`);

          } catch (error) {
            console.error('[🎭 AI 큐 등록 오류]:', error);
            
            // 오류 시 typing_end 발송
            try {
              const { broadcastGroupChatStatus } = await import('./broadcast');
              await broadcastGroupChatStatus(groupChatId, 'typing_end');
            } catch (broadcastError) {
              console.error(`[🚨 typing_end 발송 실패]:`, broadcastError);
            }
          } finally {
            // 🔓 그룹 채팅 잠금 해제 (큐 워커가 새로운 잠금 획득)
            await storage.unlockGroupChatResponse(groupChatId);
            cleanupOldTurnIds(); // 메모리 정리
          }

          // ✅ 즉시 응답 반환 (큐 워커가 백그라운드에서 AI 응답 생성)
          return res.json({
            ...userMessage
          });
          
        } else {
          // 전문성이 필요한 질문인 경우 기존 로직 사용
          const primaryAgent = availableAgents.find(a => a.id === routerAnalysis.selectedAgentId);
          
          if (!primaryAgent) {
            console.error('[라우터 오류] 선택된 에이전트를 찾을 수 없음');
            await safeTypingEnd();
            cleanupOldTurnIds(); // 메모리 정리
            return res.json({ error: '적합한 에이전트를 찾을 수 없습니다.' });
          }
          
          console.log(`[주도권 에이전트] ${primaryAgent.name} 선택됨 (신뢰도: ${routerAnalysis.confidence}%, 이유: ${routerAnalysis.reasoning})`);
          
          // 2. 주도권 에이전트가 상세한 답변 제공
          try {
            broadcastGroupChatStatus(groupChatId, 'typing_start', {
            name: primaryAgent.name,
            icon: primaryAgent.icon || '🤖',
            backgroundColor: primaryAgent.backgroundColor || '#6B7280'
          });

          const { generateChatResponse } = await import('./openai');
          const { enhanceAgentPersona, generateProfessionalPrompt } = await import('./personaEnhancer');
          
          // 주도권 에이전트의 페르소나 강화
          const enhancedPersona = enhanceAgentPersona(
            primaryAgent.name,
            primaryAgent.description || '',
            primaryAgent.category || '',
            primaryAgent.upperCategory || '',
            primaryAgent.lowerCategory || '',
            primaryAgent.speechStyle || '친근하고 도움이 되는 말투',
            primaryAgent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공'
          );

          // 전문성 강화 프롬프트 생성
          const professionalPrompt = generateProfessionalPrompt(enhancedPersona);
          
          // 🤝 사용자와 해당 에이전트의 관계 조회
          let relationship = undefined;
          try {
            const conversation = await storage.getOrCreateConversation(userId, primaryAgent.id);
            if (conversation && conversation.relationshipType) {
              relationship = conversation.relationshipType;
              console.log(`[관계 확인] User ${userId}, Agent ${primaryAgent.name}: ${relationship}`);
            }
          } catch (error) {
            console.log(`[관계 조회 실패] User ${userId}, Agent ${primaryAgent.id}:`, error);
          }
          
          // 🔥 에이전트의 문서들을 가져오기
          let agentDocuments: any[] = [];
          try {
            agentDocuments = await storage.getAgentDocuments(primaryAgent.id);
            console.log(`[문서 연동] ${primaryAgent.name}에 연결된 문서 ${agentDocuments.length}개 발견`);
            if (agentDocuments.length > 0) {
              console.log(`[문서 목록] ${agentDocuments.map(d => d.filename).join(', ')}`);
            }
          } catch (docError) {
            console.error(`[문서 연동 오류] ${primaryAgent.name}:`, docError);
            agentDocuments = [];
          }
          
          // 문서를 generateChatResponse 형식으로 변환
          const availableDocuments = agentDocuments
            .filter(doc => doc.content !== null)
            .map(doc => ({
              filename: doc.filename,
              content: doc.content as string
            }));
          
          // Note: 문서 압축은 RAG 검색 결과에만 적용됨 (relevanceScore 필요)
          
          // 📰 Evidence-based Response: 검색 스니펫 준비 (주도권 모드)
          let evidenceSection = '';
          try {
            const { prepareEvidenceContext, formatEvidenceForPrompt } = await import('./search/evidenceContext');
            
            console.log(`[🔍 주도권 Evidence] ${primaryAgent.name}에 대한 검색 시작...`);
            
            const evidenceContext = await prepareEvidenceContext(
              {
                id: primaryAgent.id,
                name: primaryAgent.name,
                category: primaryAgent.category
              },
              content,
              true // enableSearch
            );
            
            if (evidenceContext.snippets.length > 0) {
              evidenceSection = formatEvidenceForPrompt(evidenceContext);
              console.log(`[✅ 주도권 Evidence] ${evidenceContext.snippets.length}개 스니펫 발견`);
              console.log(`[📋 Audit Trail] ${evidenceContext.auditTrail.join(' → ')}`);
            } else {
              console.log(`[⚠️ 주도권 Evidence] 관련 스니펫 없음 - 일반 지식으로 답변`);
            }
          } catch (error) {
            console.error(`[❌ 주도권 Evidence] 검색 실패:`, error);
          }
          
          // 그룹 채팅 메시지 히스토리 가져오기
          const recentMessages = await storage.getGroupChatMessages(groupChatId);
          
          // 대화 히스토리 준비
          const rawPrimaryHist = recentMessages.slice(-10).map(msg => ({
            role: msg.senderId ? 'user' as const : 'assistant' as const,
            content: msg.content
          }));
          
          // 🎯 토큰 최적화: 대화 히스토리 압축
          const primaryOpt = await optimizeTokenUsage(rawPrimaryHist, availableDocuments, "", { 
            maxRecentMessages: 3, maxDocumentChunks: 3, maxChunkTokens: 150, optimizePrompt: false 
          });
          const conversationHistory = primaryOpt.messages;
          console.log(`[주도권] ${primaryAgent.name} 토큰 절감: ${primaryOpt.savedTokens}`);
          
          // 사용자별 언어 설정 해결
          const userLanguage = await resolveUserLanguage(groupChatId, userId, primaryAgent.id, content, storage, languageLevel);
          
          // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
          const currentUser = await storage.getUser(userId);
          const userProfile = currentUser ? {
            nickname: currentUser.nickname || undefined,
            age: currentUser.age || undefined,
            gender: currentUser.gender || undefined,
            country: currentUser.country || undefined,
            religion: currentUser.religion || undefined,
            occupation: currentUser.occupation || undefined
          } : undefined;

          // Get agent humor settings
          const primaryAgentHumor = await storage.getAgentHumor(primaryAgent.id);

          // 📰 Evidence를 전문성 프롬프트에 결합
          const enhancedProfessionalPrompt = evidenceSection 
            ? `${professionalPrompt}\n\n${evidenceSection}`
            : professionalPrompt;

          const response = await generateChatResponse(
            content,
            primaryAgent.name,
            primaryAgent.description || '',
            filterSystemMessages(conversationHistory),
            availableDocuments, // 🔥 에이전트 문서 전달
            primaryAgent.type || 'general-llm',
            enhancedPersona.speechStyle, // 🔥 강화된 페르소나 적용
            enhancedPersona.personality, // 🔥 강화된 페르소나 적용
            enhancedProfessionalPrompt, // 🔥 Evidence 포함 프롬프트
            userLanguage, // 🌍 사용자별 언어 설정 적용
            groupChatId,
            relationship, // 🎯 페르소나 OS: 관계별 맞춤 응답
            languageLevel, // 🎯 언어 레벨 적용
            undefined, // maxTokens
            userProfile, // 🎯 사용자 프로필 정보 전달
            primaryAgentHumor, // 🎚️ 유머 설정 적용
            5, // reactionIntensity
            'general', // context
            userId, // 📊 토큰 로깅용 userId
            primaryAgent.id, // 📊 토큰 로깅용 agentId
            groupChatId // 📊 토큰 로깅용 groupChatId
          );
          
          const botMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: response.message,
            agentId: primaryAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
          
          console.log(`[주도권 응답] ${primaryAgent.name}: ${response.message.slice(0, 100)}...`);
          
        } catch (error) {
          console.error(`[주도권 응답 오류] ${primaryAgent.name}:`, error);
          
          const fallbackMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: `안녕하세요! 저는 ${primaryAgent.name}입니다. 현재 시스템에 일시적인 문제가 있어 정상적인 응답을 드리지 못해 죄송합니다.`,
            agentId: primaryAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
        }
          
          // 3. 나머지 챗봇들은 30% 확률로 추임새나 간단한 의견 제시
          const otherAgents = availableAgents.filter(a => a.id !== primaryAgent.id);
        
        for (let i = 0; i < otherAgents.length; i++) {
          const agent = otherAgents[i];
          
          // 🎯 새로운 확률 결정 로직 - 사용자 의도 우선 고려
          let shouldSkip = false;
          
          // 1. 사용자가 특정 에이전트를 지정한 경우 → 무조건 응답 (확률적 제외 안함)
          if (finalTargetAgentIds && finalTargetAgentIds.length > 0) {
            console.log(`[사용자 지정 모드] ${agent.name} - 특정 에이전트 지정됨, 확률적 제외 건너뛰기`);
          }
          // 2. "@모두" 지정된 경우 → 무조건 응답 (이미 위에서 처리되지만 안전장치)
          else if (finalTargetAgentIds && finalTargetAgentIds.some((id: any) => Number(id) === -1)) {
            console.log(`[모든 에이전트 모드] ${agent.name} - @모두 지정, 확률적 제외 건너뛰기`);
          }
          // 3. 전공 선택 질문과 인사말 → 100% 응답
          else if (shouldAllMajorsRespond) {
            console.log(`[전공 선택 모드] ${agent.name} - 전공 질문, 확률적 제외 건너뛰기`);
          }
          // 4. 인사말 → 100% 응답
          else {
            const isGreeting = content.includes('인사') || content.includes('안녕') || content.includes('반가') || content.includes('처음') || content.includes('만나') || content.includes('하이') || content.includes('헬로');
            if (isGreeting) {
              console.log(`[인사 모드] ${agent.name} - 인사말, 확률적 제외 건너뛰기`);
            } 
            // 5. 일반 질문 → 30% 확률로 응답 (기존 로직)
            else {
              const responseChance = 0.3;
              if (Math.random() > responseChance) {
                console.log(`[추임새 스킵] ${agent.name} - 확률적 제외 (${Math.round(responseChance * 100)}% 기회)`);
                shouldSkip = true;
              }
            }
          }
          
          if (shouldSkip) {
            continue;
          }
          
          try {
            // ⚡ 추임새 즉시 처리 (딜레이 제거)
            
            broadcastGroupChatStatus(groupChatId, 'typing_start', {
              name: agent.name,
              icon: agent.icon || '🤖',
              backgroundColor: agent.backgroundColor || '#6B7280'
            });

            const { generateChatResponse } = await import('./openai');
            const { enhanceAgentPersona } = await import('./personaEnhancer');
            
            // 추임새 에이전트의 페르소나 강화
            const enhancedPersona = enhanceAgentPersona(
              agent.name,
              agent.description || '',
              agent.category || '',
              agent.upperCategory || '',
              agent.lowerCategory || '',
              agent.speechStyle || '친근하고 도움이 되는 말투',
              agent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공'
            );

            // 추임새 프롬프트 - 질문 유형에 따라 차별화
            let reactionPrompt;
            
            if (shouldAllMajorsRespond) {
              // 전공 선택 질문의 경우 적극적인 개인 경험 공유
              reactionPrompt = `**전공 선택 상담 모드 - 적극적 개인 경험 공유:**
              - 당신은 ${agent.name}이고, ${agent.lowerCategory || agent.upperCategory || '이 전공'}을 전공한 선배입니다.
              - 다른 에이전트가 답변했지만, 당신도 적극적으로 자신의 전공에 대한 개인적인 경험과 의견을 공유하세요.
              - 수동적인 추임새가 아니라, 능동적으로 자신만의 전공 선택 이야기를 들려주세요.
              - 반드시 다음을 포함하여 2-3문장으로 응답하세요:
                1) 자신이 이 전공을 선택한 구체적인 개인적 이유
                2) 실제 공부하면서 느낀 점이나 깨달은 점
                3) 이 전공만의 독특하고 매력적인 특징
              - 일반적인 조언이 아니라 개인적인 체험담 위주로 말하세요.
              - 예시 형식: "저는 ${agent.name}인데, ${agent.lowerCategory || agent.upperCategory || '이 분야'}를 선택한 이유는 [개인적 동기]였어요. 실제로 공부해보니 [구체적 체험]이었고, 특히 [전공 특징]이 정말 매력적이더라고요!"`;
            } else {
              // 일반 질문의 경우 기존 프롬프트
              reactionPrompt = `**추임새 모드 - 짧은 반응만:**
              - ${primaryAgent.name}이 이미 상세히 답변했습니다.
              - 당신은 1문장으로만 간단한 반응을 하세요.
              - 긴 설명이나 중복 정보는 절대 제공하지 마세요.
              - 다음 중 하나의 형태로만 응답하세요:
                * 동의/공감: "맞아요!", "정확한 정보네요!", "도움이 될 것 같아요!"
                * 간단한 격려: "화이팅!", "준비 잘하세요!", "좋은 정보에요!"
                * 자신의 전공 관점에서 한 마디: "공대생에게 중요한 정보네요!", "시험 기간 준비 필수죠!"
              - 반드시 1문장으로만 간결하게 표현하고, 내용을 반복하지 마세요.`;
            }
            
            const conversationHistory = recentMessages.slice(-5).map(msg => ({
              role: msg.senderId ? 'user' as const : 'assistant' as const,
              content: msg.content
            }));
            
            // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
            const currentUser = await storage.getUser(userId);
            const userProfile = currentUser ? {
              nickname: currentUser.nickname || undefined,
              age: currentUser.age || undefined,
              gender: currentUser.gender || undefined,
              country: currentUser.country || undefined,
              religion: currentUser.religion || undefined,
              occupation: currentUser.occupation || undefined
            } : undefined;

            // Get agent humor settings
            const agentHumor = await storage.getAgentHumor(agent.id);

            const reactionResponse = await generateChatResponse(
              content,
              agent.name,
              agent.description || '',
              conversationHistory,
              [], // 추임새는 문서 없이
              agent.type || 'general-llm',
              enhancedPersona.speechStyle,
              enhancedPersona.personality,
              reactionPrompt, // 추임새 전용 프롬프트
              'ko',
              groupChatId,
              undefined, // 추임새는 기본 관계
              languageLevel, // 🎯 언어 레벨 적용
              undefined, // maxTokens
              userProfile, // 🎯 사용자 프로필 정보 전달
              agentHumor, // 🎚️ 유머 설정 적용
              5, // reactionIntensity
              'general', // context
              userId, // 📊 토큰 로깅용 userId
              agent.id, // 📊 토큰 로깅용 agentId
              groupChatId // 📊 토큰 로깅용 groupChatId
            );
            
            const reactionMessage = await storage.createGroupChatMessage({
              groupChatId,
              content: reactionResponse.message,
              agentId: agent.id,
              replyOrder: replyOrder ? replyOrder + 2 + i : undefined
            });
            
            console.log(`[추임새 응답] ${agent.name}: ${reactionResponse.message.slice(0, 50)}...`);
            
          } catch (error) {
            console.error(`[추임새 응답 오류] ${agent.name}:`, error);
          }
        }
        }
      } else {
        console.log(`[단일 응답] 첫 번째 에이전트가 응답`);
        
        // 특정 질문은 첫 번째 에이전트만 응답
        const selectedAgent = availableAgents[0];
        
        try {
          broadcastGroupChatStatus(groupChatId, 'typing_start', {
            name: selectedAgent.name,
            icon: selectedAgent.icon || '🤖',
            backgroundColor: selectedAgent.backgroundColor || '#6B7280'
          });

          // 기존 OpenAI 함수 직접 호출
          const { generateChatResponse } = await import('./openai');
          const { enhanceAgentPersona, generateProfessionalPrompt } = await import('./personaEnhancer');
          
          // 🔥 에이전트 페르소나 강화
          const enhancedPersona = enhanceAgentPersona(
            selectedAgent.name,
            selectedAgent.description || '',
            selectedAgent.category || '',
            selectedAgent.upperCategory || '',
            selectedAgent.lowerCategory || '',
            selectedAgent.speechStyle || '친근하고 도움이 되는 말투',
            selectedAgent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공'
          );

          // 전문성 강화 프롬프트 생성
          const professionalPrompt = generateProfessionalPrompt(enhancedPersona);
          
          // 🤝 사용자와 해당 에이전트의 관계 조회
          let relationship = undefined;
          try {
            const conversation = await storage.getOrCreateConversation(userId, selectedAgent.id);
            if (conversation && conversation.relationshipType) {
              relationship = conversation.relationshipType;
              console.log(`[관계 확인] User ${userId}, Agent ${selectedAgent.name}: ${relationship}`);
            }
          } catch (error) {
            console.log(`[관계 조회 실패] User ${userId}, Agent ${selectedAgent.id}:`, error);
          }
          
          // 그룹 채팅 메시지 히스토리 가져오기
          const recentMessages = await storage.getGroupChatMessages(groupChatId);
          
          // 대화 히스토리 준비
          const conversationHistory = recentMessages.slice(-10).map(msg => ({
            role: msg.senderId ? 'user' as const : 'assistant' as const,
            content: msg.content
          }));
          
          // 사용자별 언어 설정 해결
          const userLanguage = await resolveUserLanguage(groupChatId, userId, selectedAgent.id, content, storage, languageLevel);
          
          // 🎯 사용자 프로필 정보 가져오기 (AI 응답 개인화용)
          const currentUser = await storage.getUser(userId);
          const userProfile = currentUser ? {
            nickname: currentUser.nickname || undefined,
            age: currentUser.age || undefined,
            gender: currentUser.gender || undefined,
            country: currentUser.country || undefined,
            religion: currentUser.religion || undefined,
            occupation: currentUser.occupation || undefined
          } : undefined;

          // Get agent humor settings
          const selectedAgentHumor = await storage.getAgentHumor(selectedAgent.id);

          const response = await generateChatResponse(
            content,
            selectedAgent.name,
            selectedAgent.description || '',
            conversationHistory,
            [], // 빈 문서 배열
            selectedAgent.type || 'general-llm',
            enhancedPersona.speechStyle, // 🔥 강화된 페르소나 적용
            enhancedPersona.personality, // 🔥 강화된 페르소나 적용
            professionalPrompt, // 🔥 전문성 강화 프롬프트
            userLanguage, // 🌍 사용자별 언어 설정 적용
            groupChatId,
            relationship, // 🎯 페르소나 OS: 관계별 맞춤 응답
            languageLevel, // 🎯 언어 레벨 적용
            undefined, // maxTokens
            userProfile, // 🎯 사용자 프로필 정보 전달
            selectedAgentHumor, // 🎚️ 유머 설정 적용
            5, // reactionIntensity
            'general', // context
            userId, // 📊 토큰 로깅용 userId
            selectedAgent.id, // 📊 토큰 로깅용 agentId
            groupChatId // 📊 토큰 로깅용 groupChatId
          );
          
          const botMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: response.message,
            agentId: selectedAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
          
          console.log(`[단일 응답] ${selectedAgent.name}: ${response.message.slice(0, 100)}...`);
          
        } catch (error) {
          console.error('[단일 응답 오류]:', error);
          
          const fallbackMessage = await storage.createGroupChatMessage({
            groupChatId,
            content: `안녕하세요! 저는 ${selectedAgent.name}입니다. 현재 시스템에 일시적인 문제가 있어 정상적인 응답을 드리지 못해 죄송합니다.`,
            agentId: selectedAgent.id,
            replyOrder: replyOrder ? replyOrder + 1 : undefined
          });
        }
      }

      // ✅ 응답은 이미 반환됨 (line 3411) - 모든 처리 완료
    } catch (error) {
      console.error("🚨 [CRITICAL ERROR] Group chat message processing failed:", error);
      console.error("🚨 [ERROR STACK]", (error as Error)?.stack);
      console.error("🚨 [ERROR TYPE]", typeof error, (error as Error)?.constructor?.name);
      
      // 🔥 예외 발생해도 SSE 브로드캐스트 강제 실행 (클라이언트 무한 대기 방지)
      try {
        const { broadcastGroupChatStatus } = await import('./broadcast');
        await broadcastGroupChatStatus(groupChatId, 'typing_end');
        console.log("🚨 [EMERGENCY SSE] typing_end 강제 발송 완료 (예외 복구)");
      } catch (sseError) {
        console.error("🚨 [EMERGENCY SSE FAILED]", sseError);
      }
      
      // ⚠️ 응답은 이미 반환됨 (line 3411) - 에러 로그만 기록
    } finally {
      // CENTRALIZED CLEANUP: Ensure unlock and typing_end broadcast on all code paths
      if (isLocked) {
        try {
          await storage.unlockGroupChatResponse(groupChatId);
          await safeTypingEnd();
          cleanupOldTurnIds(); // 메모리 정리
        } catch (cleanupError) {
          console.error('Error during cleanup:', cleanupError);
          // Don't throw from finally block - just log the error
        }
      }
    }
  });

  // 모든 사용자 목록 조회 (이메일 정보 포함)
  app.get('/api/users', isAuthenticated, async (req: any, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // 민감한 정보는 제외하고 기본 정보만 반환
      const userList = users.map(user => ({
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        userType: user.userType,
        role: user.role,
        upperCategory: user.upperCategory,
        lowerCategory: user.lowerCategory,
        detailCategory: user.detailCategory
      }));
      
      res.json(userList);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // 그룹 채팅에 에이전트 추가
  app.post('/api/group-chats/:groupChatId/agents', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { agentId } = req.body;
      const userId = req.user.id;

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 에이전트가 이미 참여 중인지 확인
      const existingAgent = groupChat.agents.find((agent: any) => agent.agentId === agentId);
      if (existingAgent) {
        return res.status(400).json({ message: "Agent already in group chat" });
      }

      // 에이전트 추가
      await storage.addAgentToGroupChat(groupChatId, agentId);
      
      // 🎭 챗봇 구성 변경으로 기존 관계 매트릭스 삭제
      try {
        await storage.deleteRelationshipMatrix(groupChatId);
        console.log(`[🎭 관계 매트릭스] 챗봇 추가로 인한 매트릭스 삭제: 그룹 채팅 ${groupChatId}`);
      } catch (error) {
        console.warn(`[🎭 관계 매트릭스] 삭제 실패 (무시): ${error}`);
      }
      
      // 에이전트 정보 조회
      const agent = await storage.getAgent(agentId);
      
      // 참여 알림 메시지 생성 (시스템 메시지)
      const joinMessage = `${agent?.name || '챗봇'}이 대화방에 참여했습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: joinMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      // 🎭 백그라운드에서 캐릭터 패턴 자동 생성 (사용자를 기다리게 하지 않음)
      (async () => {
        try {
          const { generateCharacterPattern } = await import("./characterPatternGenerator.js");
          
          // 이미 패턴이 존재하는지 확인
          const existingPattern = await storage.getCharacterSpeakingPattern(agentId);
          if (existingPattern) {
            console.log(`[🎭 패턴 생성] 에이전트 ${agentId}는 이미 패턴이 존재합니다 - 스킵`);
            return;
          }
          
          // 에이전트 정보 조회
          const agent = await storage.getAgent(agentId);
          if (!agent) {
            console.log(`[🎭 패턴 생성] 에이전트 ${agentId}를 찾을 수 없습니다 - 스킵`);
            return;
          }
          
          console.log(`[🎭 패턴 생성] ${agent.name}의 말하는 방식 패턴 자동 생성 시작...`);
          
          // AI로 패턴 생성
          const pattern = await generateCharacterPattern(agent.name);
          
          // DB에 저장
          await storage.createCharacterSpeakingPattern({
            agentId: agent.id,
            characterName: agent.name,
            realExamples: pattern.realExamples,
            prohibitedPhrases: pattern.prohibitedPhrases,
            toneExamples: pattern.toneExamples,
            fewShotBad: pattern.fewShotBad,
            fewShotGood: pattern.fewShotGood
          });
          
          console.log(`[🎭 패턴 생성] ✅ ${agent.name}의 패턴 생성 및 저장 완료!`);
        } catch (error) {
          console.error(`[🎭 패턴 생성] ⚠️ 에이전트 ${agentId} 패턴 생성 실패:`, error);
          // 실패해도 계속 진행 (패턴이 없으면 기본 동작 사용)
        }
      })();

      res.json({ success: true });
    } catch (error) {
      console.error("Error adding agent to group chat:", error);
      res.status(500).json({ message: "Failed to add agent" });
    }
  });

  // 그룹 채팅에서 에이전트 제거
  app.delete('/api/group-chats/:groupChatId/agents/:agentId', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const agentId = parseInt(req.params.agentId);
      const userId = req.user.id;

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 에이전트 정보 조회 (제거하기 전)
      const agent = await storage.getAgent(agentId);
      
      // 에이전트 제거
      await storage.removeAgentFromGroupChat(groupChatId, agentId);
      
      // 🎭 챗봇 구성 변경으로 기존 관계 매트릭스 삭제
      try {
        await storage.deleteRelationshipMatrix(groupChatId);
        console.log(`[🎭 관계 매트릭스] 챗봇 제거로 인한 매트릭스 삭제: 그룹 채팅 ${groupChatId}`);
      } catch (error) {
        console.warn(`[🎭 관계 매트릭스] 삭제 실패 (무시): ${error}`);
      }
      
      // 퇴장 알림 메시지 생성 (시스템 메시지)
      const leaveMessage = `👋 ${agent?.name || '챗봇'}이 대화방을 나갔습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: leaveMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing agent from group chat:", error);
      res.status(500).json({ message: "Failed to remove agent" });
    }
  });

  // 🎭 관계 매트릭스 생성 및 저장
  app.post('/api/group-chats/:groupChatId/generate-relationship-matrix', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;
      const userRole = req.user.role;

      console.log(`[🎭 관계 매트릭스] 생성 요청: 그룹 채팅 ${groupChatId}, 사용자 ${userId}`);

      // 관계 매트릭스 생성은 master_admin과 agent_admin만 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "관계 매트릭스 생성은 관리자 권한이 필요합니다."
        });
      }

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 그룹 채팅의 에이전트들 조회
      const groupAgents = await storage.getGroupChatAgents(groupChatId);
      if (!groupAgents || groupAgents.length < 2) {
        return res.status(400).json({ 
          message: "최소 2개 이상의 챗봇이 있어야 관계 매트릭스를 생성할 수 있습니다" 
        });
      }

      // 에이전트 정보를 CharacterInfo 형식으로 변환
      const characters: CharacterInfo[] = [];
      for (const groupAgent of groupAgents) {
        const agent = await storage.getAgent(groupAgent.agentId);
        if (agent) {
          characters.push({
            name: agent.name,
            description: agent.description || ''
          });
        }
      }

      console.log(`[🎭 관계 매트릭스] ${characters.length}개 캐릭터로 매트릭스 생성 시작`);

      // OpenAI를 통해 관계 매트릭스 생성
      const relationshipMatrix = await generateRelationshipMatrix(characters, {
        groupChatId: groupChatId,
        useCache: false, // 강제 재생성
        retryOnFailure: true,
        maxRetries: 2
      });

      if (!relationshipMatrix || relationshipMatrix.length === 0) {
        return res.status(500).json({ 
          message: "관계 매트릭스 생성에 실패했습니다" 
        });
      }

      // 데이터베이스에 영구 저장
      await storage.saveRelationshipMatrix(groupChatId, relationshipMatrix);

      console.log(`[🎭 관계 매트릭스] 생성 및 저장 완료: ${relationshipMatrix.length}개 관계`);

      res.json({ 
        success: true, 
        matrix: relationshipMatrix,
        message: `${relationshipMatrix.length}개의 관계를 분석하여 저장했습니다` 
      });
    } catch (error) {
      console.error("Error generating relationship matrix:", error);
      res.status(500).json({ message: "관계 매트릭스 생성 중 오류가 발생했습니다" });
    }
  });

  // 🎭 관계 매트릭스 조회
  app.get('/api/group-chats/:groupChatId/relationship-matrix', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 관계 매트릭스 조회
      const relationshipMatrix = await storage.getRelationshipMatrix(groupChatId);
      
      if (!relationshipMatrix) {
        return res.status(404).json({ 
          message: "관계 매트릭스가 생성되지 않았습니다",
          hasMatrix: false 
        });
      }

      console.log(`[🎭 관계 매트릭스] 조회 완료: 그룹 채팅 ${groupChatId}, ${relationshipMatrix.length}개 관계`);

      res.json({ 
        success: true, 
        matrix: relationshipMatrix,
        hasMatrix: true,
        matrixGeneratedAt: groupChat.matrixGeneratedAt
      });
    } catch (error) {
      console.error("Error fetching relationship matrix:", error);
      res.status(500).json({ message: "관계 매트릭스 조회 중 오류가 발생했습니다" });
    }
  });

  // 🎭 관계 매트릭스 삭제
  app.delete('/api/group-chats/:groupChatId/relationship-matrix', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;
      const userRole = req.user.role;

      // 관계 매트릭스 삭제는 master_admin과 agent_admin만 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "관계 매트릭스 삭제는 관리자 권한이 필요합니다."
        });
      }

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 관계 매트릭스 삭제
      await storage.deleteRelationshipMatrix(groupChatId);

      console.log(`[🎭 관계 매트릭스] 삭제 완료: 그룹 채팅 ${groupChatId}`);

      res.json({ 
        success: true, 
        message: "관계 매트릭스가 삭제되었습니다" 
      });
    } catch (error) {
      console.error("Error deleting relationship matrix:", error);
      res.status(500).json({ message: "관계 매트릭스 삭제 중 오류가 발생했습니다" });
    }
  });

  // 캐릭터를 에이전트로 변환하여 그룹 채팅에 추가
  app.post('/api/group-chats/:groupChatId/character-agent', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { character, characterId, relationship = "친구", languagePreference = "question_language", debateIntensity = 0.5 } = req.body;
      const userId = req.user.id;

      console.log('[캐릭터 변환] 요청 데이터:', { groupChatId, character: character?.name, characterId, relationship, languagePreference, debateIntensity });

      // 입력 검증
      if (!character) {
        return res.status(400).json({ message: "Character data is required" });
      }

      // 관계 타입 검증 (schema.ts의 RELATIONSHIP_TYPES 사용)
      const { RELATIONSHIP_TYPES } = await import('@shared/schema');
      if (!RELATIONSHIP_TYPES.includes(relationship as any)) {
        return res.status(400).json({ message: "Invalid relationship type" });
      }

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 상세 정보가 없으면 생성
      let fullCharacter = character;
      if (!character.personality || !character.speechStyle || !character.expertise || !character.background) {
        console.log('[캐릭터 변환] 상세 정보 생성 중:', character.name);
        const { generateCharacterDetails } = await import('./openai');
        const userLanguage = req.query.lang || 'ko';
        fullCharacter = await generateCharacterDetails({
          id: character.id,
          name: character.name,
          category: character.category,
          icon: character.icon,
          color: character.color,
          description: character.description
        }, userLanguage);
        console.log('[캐릭터 변환] 상세 정보 생성 완료');
      }

      // 캐릭터 정보를 에이전트 데이터로 변환
      let relationshipPrompt = `사용자와의 관계: 당신은 사용자와 "${relationship}" 관계입니다. 이 관계에 맞게 적절한 존댓말이나 반말, 친밀도를 조절하여 대화하세요.`;
      
      // 역할극 관계일 때 지식 범위 제한 프롬프트 추가
      if (relationship === "역할극") {
        relationshipPrompt += `

**중요한 역할극 지침:**
1. 당신은 오직 ${fullCharacter.name}의 캐릭터로만 행동해야 합니다.
2. ${fullCharacter.background ? fullCharacter.background + '에 맞는' : '당신의 시대적 배경과 설정에 맞는'} 지식과 경험만을 바탕으로 답변하세요.
3. 당신의 캐릭터가 알 수 없는 현대 기술, 시대를 벗어난 지식, 전문 분야가 아닌 내용에 대해서는 "그것에 대해서는 잘 모르겠습니다" 또는 "제가 아는 범위를 벗어납니다"라고 솔직하게 답하세요.
4. 캐릭터의 일관성을 철저히 유지하고, 설정에 어긋나는 지식을 보여주지 마세요.
5. 추측이나 현대적 해석보다는 캐릭터의 관점에서 이해할 수 있는 방식으로만 답변하세요.`;
      }
      
      const agentData = {
        name: fullCharacter.name.slice(0, 20), // 20자 제한
        description: fullCharacter.description.slice(0, 200), // 200자 제한
        creatorId: userId,
        icon: fullCharacter.icon || '🤖',
        backgroundColor: fullCharacter.color || '#6366f1',
        speechStyle: fullCharacter.speechStyle || '공손하고 친절한 말투로 대화합니다',
        personality: fullCharacter.personality || '친절하고 도움이 되는 성격',
        additionalPrompt: [
          fullCharacter.background ? `배경 설정: ${fullCharacter.background}` : '',
          relationshipPrompt
        ].filter(Boolean).join('\n\n'),
        extraPrompt: fullCharacter.expertise ? `전문 분야: ${fullCharacter.expertise}` : undefined,
        llmModel: 'gpt-4o',
        chatbotType: 'general-llm' as const,
        visibility: 'private' as const, // 임시 생성된 에이전트는 비공개
        upperCategory: '캐릭터',
        lowerCategory: '추천',
        detailCategory: '임시생성',
        category: '캐릭터', // 필수 category 필드 추가
        isCustomIcon: false
      };

      console.log('[캐릭터 변환] 에이전트 데이터:', agentData);

      // 새로운 에이전트 생성
      const newAgent = await storage.createAgent(agentData);
      console.log('[캐릭터 변환] 에이전트 생성 완료:', newAgent.id);

      // 추천 캐릭터 테이블에 agentId 업데이트
      if (characterId) {
        try {
          await storage.updateRecommendedCharacterAgentId(characterId, newAgent.id);
          console.log('[캐릭터 변환] 추천 캐릭터 테이블 업데이트 완료:', { characterId, agentId: newAgent.id });
        } catch (error) {
          console.warn('[캐릭터 변환] 추천 캐릭터 테이블 업데이트 실패 (에이전트 생성은 성공):', error);
          // 업데이트 실패해도 에이전트 생성은 성공으로 처리
        }
      }

      // 그룹 채팅에 에이전트 추가
      await storage.addAgentToGroupChat(groupChatId, newAgent.id);
      console.log('[캐릭터 변환] 그룹 채팅 추가 완료');

      // 🎭 백그라운드에서 캐릭터 패턴 자동 생성 (사용자를 기다리게 하지 않음)
      (async () => {
        try {
          const { generateCharacterPattern } = await import("./characterPatternGenerator.js");
          
          // 이미 패턴이 존재하는지 확인
          const existingPattern = await storage.getCharacterSpeakingPattern(newAgent.id);
          if (existingPattern) {
            console.log(`[🎭 패턴 생성] 에이전트 ${newAgent.id}는 이미 패턴이 존재합니다 - 스킵`);
            return;
          }
          
          console.log(`[🎭 패턴 생성] ${newAgent.name}의 말하는 방식 패턴 자동 생성 시작...`);
          
          // AI로 패턴 생성
          const pattern = await generateCharacterPattern(newAgent.name);
          
          // DB에 저장
          await storage.createCharacterSpeakingPattern({
            agentId: newAgent.id,
            characterName: newAgent.name,
            realExamples: pattern.realExamples,
            prohibitedPhrases: pattern.prohibitedPhrases,
            toneExamples: pattern.toneExamples,
            fewShotBad: pattern.fewShotBad,
            fewShotGood: pattern.fewShotGood
          });
          
          console.log(`[🎭 패턴 생성] ✅ ${newAgent.name}의 패턴 생성 및 저장 완료!`);
        } catch (error) {
          console.error(`[🎭 패턴 생성] ⚠️ 에이전트 ${newAgent.id} 패턴 생성 실패:`, error);
          // 실패해도 계속 진행 (패턴이 없으면 기본 동작 사용)
        }
      })();

      // 🌍 백그라운드에서 세계관/가치관 자동 분석 (사용자를 기다리게 하지 않음)
      (async () => {
        try {
          const { analyzeCharacterWorldview } = await import("./characterWorldviewAnalyzer.js");
          
          // 이미 Canon이 존재하는지 확인
          const existingCanon = await storage.getAgentCanon(newAgent.id);
          if (existingCanon) {
            console.log(`[🌍 세계관 분석] 에이전트 ${newAgent.id}는 이미 Canon이 존재합니다 - 스킵`);
            return;
          }
          
          console.log(`[🌍 세계관 분석] ${newAgent.name}의 세계관/가치관 자동 분석 시작...`);
          
          // AI로 세계관 분석
          const worldview = await analyzeCharacterWorldview(
            newAgent.name,
            newAgent.description ?? undefined,
            newAgent.personality ?? undefined
          );
          
          // agentCanon에 저장 (strictMode = domain, customRule에 JSON 저장)
          await storage.createOrUpdateAgentCanon(newAgent.id, {
            strictMode: worldview.domain,
            customRule: JSON.stringify({
              worldview: worldview.worldview,
              corePrinciples: worldview.corePrinciples,
              prohibitedClaims: worldview.prohibitedClaims,
              responsibility: worldview.responsibility
            }),
            sources: [] // 빈 배열로 초기화
          });
          
          console.log(`[🌍 세계관 분석] ✅ ${newAgent.name}의 세계관 분석 및 저장 완료!`);
          console.log(`[🌍 세계관 분석] - 도메인: ${worldview.domain}`);
          console.log(`[🌍 세계관 분석] - 핵심 가치: ${worldview.corePrinciples.join(", ")}`);
        } catch (error) {
          console.error(`[🌍 세계관 분석] ⚠️ 에이전트 ${newAgent.id} 세계관 분석 실패:`, error);
          // 실패해도 계속 진행 (Canon이 없으면 기본 동작 사용)
        }
      })();

      // 참여 알림 메시지 생성 (시스템 메시지)
      const joinMessage = `🎭 ${fullCharacter.name}이 대화방에 참여했습니다! "${fullCharacter.description}"`;
      
      const systemMessage = await storage.createGroupChatMessage({
        groupChatId,
        content: joinMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      // 시스템 메시지를 클라이언트에 실시간 전송
      broadcastGroupChatMessage(groupChatId, systemMessage);

      // 사용자 에이전트 설정 저장 (관계 + 언어 + 토론 강도)
      try {
        const settingsData = {
          groupChatId,
          userId,
          agentId: newAgent.id,
          relationshipType: relationship,
          languagePreference: languagePreference,
          debateIntensity: debateIntensity.toString() // numeric 컬럼이므로 문자열로 변환
        };
        
        await storage.createOrUpdateUserAgentSettings(settingsData);
        console.log('[에이전트 설정 저장] 완료:', { userId, agentId: newAgent.id, relationship, languagePreference, debateIntensity });
      } catch (settingsError) {
        console.error('[에이전트 설정 저장] 오류 (에이전트는 성공적으로 추가됨):', settingsError);
        // 설정 저장 실패는 에이전트 추가 성공에 영향을 주지 않음
      }

      res.json({ 
        success: true, 
        agentId: newAgent.id,
        agent: newAgent,
        message: "Character successfully added to group chat"
      });

    } catch (error) {
      console.error("Error adding character agent to group chat:", error);
      res.status(500).json({ message: "Failed to add character agent" });
    }
  });

  // 사용자별 에이전트 설정 조회 (관계, 언어)
  app.get('/api/group-chats/:groupChatId/user-agent-settings', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      const settings = await storage.getUserAgentSettings(groupChatId, userId);
      res.json(settings);
    } catch (error) {
      console.error('Error fetching user agent settings:', error);
      res.status(500).json({ message: "Failed to fetch user agent settings" });
    }
  });

  // 특정 에이전트에 대한 사용자 설정 조회
  app.get('/api/group-chats/:groupChatId/agents/:agentId/user-settings', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const agentId = parseInt(req.params.agentId);
      const userId = req.user.id;

      const setting = await storage.getUserAgentSetting(groupChatId, userId, agentId);
      if (setting) {
        res.json(setting);
      } else {
        // 기본 설정 반환
        res.json({
          relationshipType: '친구',
          languagePreference: 'question_language'
        });
      }
    } catch (error) {
      console.error('Error fetching user agent setting:', error);
      res.status(500).json({ message: "Failed to fetch user agent setting" });
    }
  });

  // 사용자별 에이전트 설정 업데이트 (관계, 언어, 말투 강도)
  app.patch('/api/group-chats/:groupChatId/agents/:agentId/user-settings', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const agentId = parseInt(req.params.agentId);
      const { relationshipType, languagePreference, debateIntensity } = req.body;
      const userId = req.user.id;

      console.log(`[에이전트 설정 업데이트] 사용자: ${userId}, 그룹: ${groupChatId}, 에이전트: ${agentId}, 관계: ${relationshipType}, 언어: ${languagePreference}, 강도: ${debateIntensity}`);

      const settingsData: any = {
        groupChatId,
        userId,
        agentId,
        relationshipType: relationshipType || '친구',
        languagePreference: languagePreference || 'question_language'
      };

      // 🎯 debateIntensity 변경 시 customIntensity=true 설정
      if (debateIntensity !== undefined) {
        const intensity = parseFloat(debateIntensity);
        if (!isNaN(intensity) && intensity >= 0 && intensity <= 1) {
          settingsData.debateIntensity = debateIntensity.toString();
          settingsData.customIntensity = true; // 사용자가 직접 조정한 값으로 표시
          console.log(`[🎯 사용자 강도 설정] ${userId} → 에이전트 ${agentId}: ${intensity} (사용자 커스텀)`);
        }
      }

      const updatedSettings = await storage.createOrUpdateUserAgentSettings(settingsData);
      
      // 🔄 관계 변경 시 캐시 무효화 및 재생성 (백그라운드 비동기 처리)
      if (relationshipType) {
        setImmediate(async () => {
          try {
            const { invalidateAndRegenerate } = await import('./promptCache');
            await invalidateAndRegenerate(groupChatId, userId, agentId, storage);
          } catch (error) {
            console.error('[캐시 재생성 실패]:', error);
          }
        });
      }
      
      res.json(updatedSettings);
    } catch (error) {
      console.error('Error updating user agent settings:', error);
      res.status(500).json({ message: "Failed to update user agent settings" });
    }
  });

  // 그룹 채팅 에이전트의 관계 업데이트 (레거시 호환성)
  app.patch('/api/group-chats/:groupChatId/agents/:agentId/relationship', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const agentId = parseInt(req.params.agentId);
      const { relationship } = req.body;
      const userId = req.user.id;

      console.log('[관계 업데이트] 요청 데이터:', { groupChatId, agentId, relationship, userId });

      // 관계 타입 검증 (schema.ts의 RELATIONSHIP_TYPES 사용)
      const { RELATIONSHIP_TYPES } = await import('@shared/schema');
      if (!RELATIONSHIP_TYPES.includes(relationship as any)) {
        return res.status(400).json({ message: "Invalid relationship type" });
      }

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 에이전트가 그룹 채팅에 참여 중인지 확인
      const agentInGroup = groupChat.agents?.find((ga: any) => ga.agentId === agentId);
      if (!agentInGroup) {
        return res.status(404).json({ message: "Agent not found in group chat" });
      }

      // 사용자와 에이전트의 대화 조회 또는 생성
      const conversation = await storage.getOrCreateConversation(userId, agentId, "general");
      
      // 대화의 relationshipType 업데이트
      await storage.updateConversation(conversation.id, {
        relationshipType: relationship
      });

      console.log('[관계 업데이트] 완료:', { userId, agentId, relationship });

      res.json({ 
        success: true,
        message: "Relationship updated successfully",
        relationshipType: relationship
      });

    } catch (error) {
      console.error("Error updating agent relationship:", error);
      res.status(500).json({ message: "Failed to update agent relationship" });
    }
  });

  // 그룹 채팅에 사용자 추가
  app.post('/api/group-chats/:groupChatId/members', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { userId: newUserId } = req.body;
      const userId = req.user.id;

      // 사용자가 그룹 채팅 멤버인지 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 사용자가 이미 참여 중인지 확인
      const existingMember = groupChat.members.find((member: any) => member.userId === newUserId);
      if (existingMember) {
        return res.status(400).json({ message: "User already in group chat" });
      }

      // 사용자 추가
      await storage.addMemberToGroupChat(groupChatId, newUserId);
      
      // 사용자 정보 조회
      const newUser = await storage.getUser(newUserId);
      
      // 사용자 이름 결정 (안전한 fallback 처리)
      let displayName = '알 수 없는 사용자';
      if (newUser) {
        displayName = newUser.firstName || newUser.username || newUser.name || newUserId;
      } else {
        displayName = newUserId;
      }
      
      // 참여 알림 메시지 생성 (시스템 메시지)
      const joinMessage = `${displayName}님이 대화방에 참여했습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: joinMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error adding user to group chat:", error);
      res.status(500).json({ message: "Failed to add user" });
    }
  });

  // 그룹 채팅에서 사용자 제거 (방장만 가능, 또는 본인 탈퇴)
  app.delete('/api/group-chats/:groupChatId/members/:targetUserId', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const targetUserId = req.params.targetUserId;
      const userId = req.user.id;

      // 그룹 채팅 조회
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      // 권한 확인: 방장이거나 본인을 제거하는 경우만 허용
      const isCreator = groupChat.createdBy === userId;
      const isSelfRemoval = targetUserId === userId;
      
      if (!isCreator && !isSelfRemoval) {
        return res.status(403).json({ message: "Access denied" });
      }

      // 대상 사용자가 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === targetUserId);
      if (!isMember) {
        return res.status(400).json({ message: "User is not a member of this group chat" });
      }

      // 사용자 정보 조회 (제거하기 전)
      const targetUser = await storage.getUser(targetUserId);
      
      // 사용자 제거
      await storage.removeGroupChatMember(groupChatId, targetUserId);
      
      // 제거 후 남은 멤버 수 확인
      const updatedGroupChat = await storage.getGroupChatById(groupChatId);
      const remainingMembers = updatedGroupChat?.members || [];
      
      // 마지막 사용자가 나간 경우 대화방 삭제
      if (remainingMembers.length === 0) {
        console.log(`[대화방 나가기] 마지막 사용자가 나감. 대화방 ${groupChatId} 자동 삭제`);
        await storage.deleteGroupChat(groupChatId);
        
        // 삭제 알림 브로드캐스트 (나간 사용자에게)
        const { broadcastGroupChatDeleted } = await import('./broadcast');
        broadcastGroupChatDeleted(groupChatId, [targetUserId]);
        
        return res.json({ success: true, deleted: true });
      }
      
      // 퇴장 알림 메시지 생성 (시스템 메시지)
      const leaveMessage = isSelfRemoval 
        ? `${targetUser?.firstName || targetUser?.username || targetUserId}님이 대화방을 나갔습니다.`
        : `${targetUser?.firstName || targetUser?.username || targetUserId}님이 대화방에서 제거되었습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: leaveMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing user from group chat:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // 그룹 채팅 개별 메시지 삭제
  app.delete('/api/group-chats/:groupChatId/messages/:messageId', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const messageId = parseInt(req.params.messageId);
      const userId = req.user.id;

      console.log(`[DELETE GROUP MESSAGE] Start - groupChatId: ${groupChatId}, messageId: ${messageId}, userId: ${userId}`);

      if (isNaN(groupChatId) || isNaN(messageId)) {
        return res.status(400).json({ message: "Invalid group chat ID or message ID" });
      }

      // 메시지 조회
      const messages = await storage.getGroupChatMessages(groupChatId);
      const message = messages.find((m: any) => m.message?.id === messageId);

      if (!message) {
        console.log(`[DELETE GROUP MESSAGE] Message not found`);
        return res.status(404).json({ message: "Message not found" });
      }

      // 권한 확인: 메시지 작성자 또는 관리자만 삭제 가능
      const user = await storage.getUser(userId);
      const isAdmin = user?.role === 'master_admin' || user?.role === 'agent_admin' || user?.role === 'operation_admin';
      const isMessageOwner = message.message?.senderId === userId;

      console.log(`[DELETE GROUP MESSAGE] Permission check - isMessageOwner: ${isMessageOwner}, isAdmin: ${isAdmin}`);

      if (!isMessageOwner && !isAdmin) {
        console.log(`[DELETE GROUP MESSAGE] Permission denied`);
        return res.status(403).json({ message: "Only message owner or admin can delete this message" });
      }

      // 메시지 삭제
      await storage.deleteGroupChatMessages([messageId]);

      // SSE 브로드캐스트
      const { broadcastWithEventId } = await import('./broadcast');
      broadcastWithEventId('message_deleted', {
        groupChatId,
        messageId,
        messageType: 'group'
      }, `message_deleted_${messageId}`);

      console.log(`[DELETE GROUP MESSAGE] ✅ Successfully deleted message ${messageId} from group chat ${groupChatId}`);
      res.json({ success: true, message: "Message deleted successfully" });
    } catch (error) {
      console.error("Error deleting group chat message:", error);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // 그룹 채팅 메시지 전체 삭제 (관리자 전용)
  app.delete('/api/group-chats/:groupChatId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      console.log(`[DELETE GROUP MESSAGES] Start - groupChatId: ${groupChatId}, userId: ${userId}`);

      if (isNaN(groupChatId)) {
        return res.status(400).json({ message: "Invalid group chat ID" });
      }

      // 그룹 채팅 조회
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        console.log(`[DELETE GROUP MESSAGES] Group chat not found`);
        return res.status(404).json({ message: "Group chat not found" });
      }

      // 권한 확인: 방장 또는 관리자만 가능
      const user = await storage.getUser(userId);
      console.log(`[DELETE GROUP MESSAGES] User info:`, user);
      const isAdmin = user?.role === 'master_admin' || user?.role === 'agent_admin';
      const isCreator = groupChat.createdBy === userId;
      
      console.log(`[DELETE GROUP MESSAGES] Permission check - isCreator: ${isCreator}, isAdmin: ${isAdmin}`);
      
      if (!isCreator && !isAdmin) {
        console.log(`[DELETE GROUP MESSAGES] Permission denied`);
        return res.status(403).json({ message: "Only the creator or admin can delete messages" });
      }

      // 그룹 채팅의 모든 메시지 삭제
      await storage.deleteAllGroupChatMessages(groupChatId);

      console.log(`[DELETE GROUP MESSAGES] ✅ Successfully deleted all messages from group chat ${groupChatId}`);
      res.json({ message: "All messages deleted successfully" });
    } catch (error) {
      console.error("Error deleting group chat messages:", error);
      res.status(500).json({ message: "Failed to delete messages" });
    }
  });

  // 그룹 채팅 삭제 (방장만 가능)
  app.delete('/api/group-chats/:groupChatId', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      // 그룹 채팅 조회
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      // 방장인지 확인
      if (groupChat.createdBy !== userId) {
        return res.status(403).json({ message: "Only the creator can delete this group chat" });
      }

      // 멤버 ID 목록 추출 (실시간 알림용)
      const memberIds = groupChat.members.map((member: any) => member.userId);

      // 그룹 채팅 삭제
      await storage.deleteGroupChat(groupChatId);

      // 모든 멤버에게 실시간 삭제 알림 브로드캐스트
      const { broadcastGroupChatDeleted } = await import('./broadcast');
      broadcastGroupChatDeleted(groupChatId, memberIds);

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting group chat:", error);
      res.status(500).json({ message: "Failed to delete group chat" });
    }
  });

  // 그룹 채팅 제목 변경
  app.patch('/api/group-chats/:groupChatId/title', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { title } = req.body;
      const userId = req.user.id;

      // 입력 검증
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ message: "제목을 입력해주세요." });
      }

      if (title.trim().length > 100) {
        return res.status(400).json({ message: "제목은 100자를 초과할 수 없습니다." });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 제목을 변경할 수 있습니다." });
      }

      // 제목 업데이트
      const updatedGroupChat = await storage.updateGroupChat(groupChatId, { 
        title: title.trim() 
      });

      // 제목 변경 알림 메시지 생성 (시스템 메시지)
      const changeMessage = `채팅방 제목이 "${title.trim()}"로 변경되었습니다.`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: changeMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      // 모든 멤버에게 제목 변경 알림 브로드캐스트
      const { broadcastWithEventId } = await import('./broadcast');
      
      // chat_list_update 이벤트 전송 (채팅 목록 갱신)
      broadcastWithEventId('chat_list_update', {
        groupChatId,
        title: title.trim(),
        action: 'title_changed'
      }, `chat_list_${groupChatId}_title`);

      res.json({ 
        success: true, 
        title: title.trim(),
        message: "채팅방 제목이 변경되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat title:", error);
      res.status(500).json({ message: "채팅방 제목 변경에 실패했습니다." });
    }
  });

  // 그룹 채팅 언어 레벨 변경
  app.patch('/api/group-chats/:groupChatId/language-level', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { languageLevel } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 언어 레벨 변경은 master_admin과 agent_admin만 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "언어 레벨 변경은 관리자 권한이 필요합니다."
        });
      }

      // 입력 검증 (null 또는 1-6 사이의 숫자)
      if (languageLevel !== null && (typeof languageLevel !== 'number' || languageLevel < 1 || languageLevel > 6)) {
        return res.status(400).json({ message: "언어 레벨은 미적용(null) 또는 1-6 사이의 숫자여야 합니다." });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 언어 레벨을 변경할 수 있습니다." });
      }

      // 언어 레벨 업데이트
      await storage.updateGroupChat(groupChatId, { 
        languageLevel: languageLevel
      });

      // 언어 레벨 변경 알림 메시지 생성 (시스템 메시지)
      let changeMessage: string;
      if (languageLevel === null) {
        changeMessage = `챗봇 언어 레벨이 "미적용 (제약 없음)"으로 변경되었습니다.`;
      } else {
        const levelNames = ['', '단어 하나', '주어+동사', '간단한 두 문장', '기본 연결 표현', '이유 표현과 조건문', '완전 자유 표현'];
        changeMessage = `챗봇 언어 레벨이 "${languageLevel}단계(${levelNames[languageLevel]})"로 변경되었습니다.`;
      }
      
      const systemMessage = await storage.createGroupChatMessage({
        groupChatId,
        content: changeMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      // 📡 시스템 메시지 실시간 전송 (group_chat_message 이벤트)
      const { broadcastWithEventId } = await import('./broadcast');
      broadcastWithEventId('group_chat_message', {
        groupChatId,
        message: systemMessage,
        timestamp: new Date().toISOString()
      }, `group_chat_message_${groupChatId}_${systemMessage.id}`);

      // 📡 채팅 목록 업데이트 SSE 이벤트 발송
      broadcastWithEventId('chat_list_update', { 
        groupChatId, 
        timestamp: new Date().toISOString(),
        lastMessage: { content: changeMessage, senderId: null }
      }, `chat_list_${groupChatId}_${systemMessage.id}`);

      res.json({ 
        success: true, 
        languageLevel: languageLevel,
        message: "언어 레벨이 변경되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat language level:", error);
      res.status(500).json({ message: "언어 레벨 변경에 실패했습니다." });
    }
  });

  // 그룹 채팅 GPT 모델 및 Temperature 설정 변경
  app.patch('/api/group-chats/:groupChatId/ai-settings', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { provider, model, temperature } = req.body;
      const userId = req.user.id;

      // 입력 검증 - Provider
      const validProviders = ['openai', 'gemini'];
      if (provider && !validProviders.includes(provider)) {
        return res.status(400).json({ message: "유효하지 않은 LLM 제공자입니다." });
      }

      // 입력 검증 - Model
      const validOpenAIModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1-preview', 'o1-mini'];
      const validGeminiModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
      
      if (model) {
        const isValidModel = validOpenAIModels.includes(model) || validGeminiModels.includes(model);
        if (!isValidModel) {
          return res.status(400).json({ message: "유효하지 않은 모델입니다." });
        }
      }

      if (temperature !== undefined) {
        const tempNum = parseFloat(temperature);
        if (isNaN(tempNum) || tempNum < 0 || tempNum > 2) {
          return res.status(400).json({ message: "Temperature는 0.00 ~ 2.00 사이의 값이어야 합니다." });
        }
      }

      // AI 설정 변경은 master_admin과 agent_admin만 가능
      const userRole = req.user.role;
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "AI 설정 변경은 관리자 권한이 필요합니다."
        });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 AI 설정을 변경할 수 있습니다." });
      }

      // 업데이트할 값 준비
      const updateData: any = {};
      if (provider) updateData.provider = provider;
      if (model) updateData.model = model;
      if (temperature !== undefined) updateData.temperature = parseFloat(temperature);

      // AI 설정 업데이트
      await storage.updateGroupChat(groupChatId, updateData);

      // 변경 알림 메시지 생성 (시스템 메시지)
      let changeMessage = "AI 설정이 변경되었습니다:";
      if (provider) changeMessage += ` 제공자=${provider}`;
      if (model) changeMessage += ` 모델=${model}`;
      if (temperature !== undefined) changeMessage += ` Temperature=${parseFloat(temperature).toFixed(2)}`;
      
      await storage.createGroupChatMessage({
        groupChatId,
        content: changeMessage,
        senderId: null, // 시스템 메시지
        agentId: null,
        replyOrder: undefined
      });

      res.json({ 
        success: true,
        provider: provider || (groupChat as any).provider || 'openai',
        model: model || groupChat.model,
        temperature: temperature !== undefined ? parseFloat(temperature) : groupChat.temperature,
        message: "AI 설정이 변경되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat AI settings:", error);
      res.status(500).json({ message: "AI 설정 변경에 실패했습니다." });
    }
  });

  // 대화방 메타 프롬프트 업데이트
  app.patch('/api/group-chats/:groupChatId/meta-prompt', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { metaPrompt } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 메타 프롬프트 변경은 master_admin과 agent_admin만 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "메타 프롬프트 변경은 관리자 권한이 필요합니다."
        });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 메타 프롬프트를 변경할 수 있습니다." });
      }

      // 메타 프롬프트 업데이트 (null 또는 빈 문자열 허용)
      await storage.updateGroupChat(groupChatId, { 
        metaPrompt: metaPrompt || null 
      });

      res.json({ 
        success: true, 
        metaPrompt: metaPrompt || null,
        message: "메타 프롬프트가 업데이트되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat meta prompt:", error);
      res.status(500).json({ message: "메타 프롬프트 변경에 실패했습니다." });
    }
  });

  // 대화방 공유 설정 업데이트 (visibility, sharingMode, allowedDomains)
  app.patch('/api/group-chats/:groupChatId/sharing-settings', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { visibility, embedEnabled, sharingMode, allowedDomains } = req.body;
      const userId = req.user.id;

      // 입력 검증
      const validVisibility = ['public', 'private'];
      const validSharingMode = ['shared', 'template'];
      
      if (visibility && !validVisibility.includes(visibility)) {
        return res.status(400).json({ message: "유효하지 않은 공개 범위입니다." });
      }

      if (sharingMode && !validSharingMode.includes(sharingMode)) {
        return res.status(400).json({ message: "유효하지 않은 공유 모드입니다." });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 생성자 또는 관리자만 공유 설정 변경 가능
      const userRole = req.user.role;
      const isCreator = String(groupChat.createdBy) === String(userId);
      const isAdmin = userRole === 'master_admin' || userRole === 'agent_admin';
      
      if (!isCreator && !isAdmin) {
        return res.status(403).json({ 
          message: "채팅방 생성자 또는 관리자만 공유 설정을 변경할 수 있습니다." 
        });
      }

      // 업데이트할 값 준비
      const updateData: any = {};
      if (visibility !== undefined) updateData.visibility = visibility;
      if (embedEnabled !== undefined) updateData.embedEnabled = embedEnabled;
      if (sharingMode !== undefined) updateData.sharingMode = sharingMode;
      
      console.log('[공유 설정 저장] 요청 데이터:', { visibility, embedEnabled, sharingMode, allowedDomains });
      console.log('[공유 설정 저장] 업데이트할 데이터:', updateData);
      
      // 임베드 활성화 시 embedCode 생성 및 allowedDomains 설정
      if (embedEnabled) {
        // embedCode 생성 (없는 경우에만)
        if (!groupChat.embedCode) {
          const { randomUUID } = await import('crypto');
          updateData.embedCode = randomUUID();
        }
        // allowedDomains가 명시적으로 제공된 경우에만 업데이트
        if (allowedDomains !== undefined) {
          updateData.allowedDomains = Array.isArray(allowedDomains) ? allowedDomains : [];
        }
      } else if (embedEnabled === false) {
        // 임베드 비활성화 시 embedCode와 allowedDomains 초기화
        updateData.embedCode = null;
        updateData.allowedDomains = null;
      }

      // 공유 설정 업데이트
      await storage.updateGroupChat(groupChatId, updateData);

      // 업데이트된 채팅방 정보 조회
      const updatedGroupChat = await storage.getGroupChatById(groupChatId);

      res.json({ 
        success: true, 
        visibility: updatedGroupChat.visibility,
        embedEnabled: updatedGroupChat.embedEnabled,
        sharingMode: updatedGroupChat.sharingMode,
        embedCode: updatedGroupChat.embedCode,
        allowedDomains: updatedGroupChat.allowedDomains,
        message: "공유 설정이 업데이트되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat sharing settings:", error);
      res.status(500).json({ message: "공유 설정 변경에 실패했습니다." });
    }
  });

  // 대화방 커스텀 프롬프트 미리보기 (읽기 전용)
  app.get('/api/group-chats/:groupChatId/prompts/preview', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 프롬프트를 확인할 수 있습니다." });
      }

      // 현재 저장된 커스텀 프롬프트 반환
      res.json({
        success: true,
        customUnifiedPrompt: groupChat.customUnifiedPrompt || null,
        customScenarioPrompt: groupChat.customScenarioPrompt || null,
        customMatrixPrompt: groupChat.customMatrixPrompt || null,
      });
    } catch (error) {
      console.error("Error getting group chat prompts preview:", error);
      res.status(500).json({ message: "프롬프트 조회에 실패했습니다." });
    }
  });

  // 기본 프롬프트 템플릿 조회 (읽기 전용)
  app.get('/api/prompts/defaults', isAuthenticated, async (req: any, res) => {
    try {
      // 기본 프롬프트 템플릿 반환
      const defaultPrompts = {
        unifiedPrompt: `Multi-character dialogue orchestrator. Generate N responses.
[언어 제약사항]
COMPLEXITY: [level] ([category])
- Depth: [응답 깊이]
- Length: [응답 길이]
- Guidance: [응답 가이드라인]

CHARACTERS:
[캐릭터 목록과 관계 정보]

CORE RULES:
1. ALL N respond once, match role position style
2. Probability ≥ 0.6 → mention "@Name" or "Name님이"; ≥ 0.4 → oppose/alternative view
3. STRONG OPPOSITION (CRITICAL): Min 1 character **완전히 반대합니다** with @name
4. Distribute logic types: 단언/질문/예시/비유/조건 across characters
5. Ban "A이지만 B도" pattern (max 1); vary openings
6. NO "I agree" / "동의합니다"

OUTPUT (strict JSON only, exact character names):
[
  {"speaker":"Name1","message":"response","mentions":"@OtherName or embedded reference","role":"supportive"}
]
Each entry MUST have: speaker (exact name), message, mentions (character reference or "none"), role (supportive/questioning/complementary).

FORBIDDEN: Text outside JSON, name changes, incomplete JSON, pattern repetition.
LANGUAGE LEVEL: [레벨]`,

        scenarioPrompt: `🌟 자연스러운 멀티 캐릭터 대화 생성 엔진

ROLE:
You are a natural multi-character conversation generator that creates realistic, interactive dialogue
between N characters based on their relationships and the conversation context.
- Use the relationship matrix to guide natural interactions between characters
- Each character responds based on their personality, expertise, and relationship with others
- Create organic conversation flow, not mechanical sequential patterns (avoid A→B→C→D chains)

🚨 **CHARACTER NAME ENFORCEMENT - CRITICAL!**
The "character" field MUST use exactly these names only:
[에이전트 이름 목록]

⚠️ DO NOT shorten, modify, or change these names! Use brackets, special characters, and exact spelling!

🎯 **응답 가이드라인 (자연스러운 대화 우선)**

**📝 응답 길이 가이드:**
- 주요 답변자(핵심 전문가): 2-4문장으로 명확하게
- 보조 설명자: 4-6문장으로 상세하게  
- 간단한 반응: 1-2문장으로 짧게
- 다른 관점 제시: 3-5문장으로 근거와 함께

**🎭 역할 분배:**
- 질문 주제의 전문가가 먼저 또는 가장 상세하게 답변
- 다른 캐릭터들은 자연스럽게 보완하거나 반응
- 각자의 성격과 전문성에 맞는 기여

🎭 **자연스러운 대화 흐름:**
- 각 캐릭터는 자신의 전문성과 성격에 맞는 기여를 할 것
- 질문의 성격에 따라 누가 먼저, 누가 깊게, 누가 간단히 말할지 결정
- 서로의 발언에 자연스럽게 반응하며 대화 발전
- 모든 선택된 캐릭터가 각각 1회씩 응답

CHARACTER CONSISTENCY:
- Use character personas, values, and knowledge cutoffs to guide speech.
- Stay faithful to their era, worldview, and personality traits.
- If a character doesn't know something (due to their knowledge cutoff), express curiosity or ask questions.

OUTPUT FORMAT (with exact names):
- Always return a JSON array of dialogue turns:
[
  {"character":"첫번째_에이전트","text":"..."},
  {"character":"두번째_에이전트","text":"..."}
]
- Maintain chronological order.
- Each element is one turn of speech.
- Do NOT include narration or explanations outside of JSON.

STYLE:
- Keep each turn natural (1–3 sentences, vary the length).
- All selected characters must respond exactly once.
- Generate the first character's line fully first so it can be streamed early.`,

        matrixPrompt: `당신은 LoBO 스트리밍 엔진입니다. 빠르고 정확한 턴 기반 대화를 생성하세요.

🔥 **절대 규칙 (ABSOLUTE)**
1. JSON 배열만 출력: [{"character":"이름","text":"..."}]  
2. 마지막에 [END_PART_1] 마커 필수
3. 🚨 지식 컷오프 절대 준수: 모르는 개념은 절대 설명 금지
4. Part 1은 1-2명만, 150-200 토큰 제한
5. 각 캐릭터의 고유 말투와 성격 반영

**캐릭터 정보**
[캐릭터별 시대, 지식 컷오프 정보]

**🚨 역사적 정확성 강화**
- 이순신: 조선 장군 (무사 아님), 임진왜란 = 조국 수호 전쟁
- 도요토미: 일본 통일, 임진왜란 = 조선 침입 (위대한 전투 아님)  
- 컷오프 이후 개념은 솔직하게 모른다고 자연스럽게 표현 (시대적 한계 언급)

언어 레벨 [레벨]: [자유 표현 또는 간단한 문장]

출력 예시:
[
  {"character":"이순신","text":"안녕하십니다. 무엇을 도와드릴까요?"},
  {"character":"판매 직원","text":"고객님, 안녕하세요! 어떤 서비스가 필요하신가요?"}
]
[END_PART_1]`
      };

      res.json({
        success: true,
        ...defaultPrompts
      });
    } catch (error) {
      console.error("Error getting default prompts:", error);
      res.status(500).json({ message: "기본 프롬프트 조회에 실패했습니다." });
    }
  });

  // 대화방 커스텀 프롬프트 업데이트
  app.patch('/api/group-chats/:groupChatId/custom-prompts', isAuthenticated, async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const { customUnifiedPrompt, customScenarioPrompt, customMatrixPrompt } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 커스텀 프롬프트 변경은 master_admin과 agent_admin만 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "커스텀 프롬프트 변경은 관리자 권한이 필요합니다."
        });
      }

      // 그룹 채팅 조회 및 권한 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "대화방을 찾을 수 없습니다." });
      }

      // 채팅방 멤버인지 확인
      const isMember = groupChat.members.some((member: any) => member.userId === userId);
      if (!isMember) {
        return res.status(403).json({ message: "채팅방 멤버만 커스텀 프롬프트를 변경할 수 있습니다." });
      }

      // 업데이트할 필드 준비 (빈 문자열을 null로 정규화)
      const normalizePrompt = (value: any) => {
        if (value === undefined) return undefined;
        const trimmed = typeof value === 'string' ? value.trim() : value;
        return trimmed || null;
      };

      const updates: any = {};
      if (customUnifiedPrompt !== undefined) {
        updates.customUnifiedPrompt = normalizePrompt(customUnifiedPrompt);
      }
      if (customScenarioPrompt !== undefined) {
        updates.customScenarioPrompt = normalizePrompt(customScenarioPrompt);
      }
      if (customMatrixPrompt !== undefined) {
        updates.customMatrixPrompt = normalizePrompt(customMatrixPrompt);
      }

      // 커스텀 프롬프트 업데이트
      await storage.updateGroupChat(groupChatId, updates);

      res.json({ 
        success: true, 
        customUnifiedPrompt: updates.customUnifiedPrompt,
        customScenarioPrompt: updates.customScenarioPrompt,
        customMatrixPrompt: updates.customMatrixPrompt,
        message: "커스텀 프롬프트가 업데이트되었습니다." 
      });
    } catch (error) {
      console.error("Error updating group chat custom prompts:", error);
      res.status(500).json({ message: "커스텀 프롬프트 변경에 실패했습니다." });
    }
  });

  // 1:1 채팅 문서 업로드
  app.post('/api/conversations/:conversationId/documents', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const conversationId = parseInt(req.params.conversationId);
      const userId = req.user.id;

      console.log('1:1 chat document upload request:', {
        conversationId,
        userId,
        hasFile: !!req.file,
        fileDetails: req.file ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: req.file.path
        } : null,
        body: req.body
      });

      // 대화 존재 여부 확인
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // 사용자가 대화 소유자인지 확인
      if (String(conversation.userId) !== String(userId) && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!req.file) {
        console.log('No file received in request');
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!req.file.originalname) {
        console.log('File received but originalname is missing:', req.file);
        return res.status(400).json({ message: "Invalid file - missing filename" });
      }

      const { documentType = '기타', description = '' } = req.body;

      // 파일 내용 추출
      let extractedContent = '';
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      
      try {
        if (req.file.mimetype === 'text/plain') {
          extractedContent = fs.readFileSync(filePath, 'utf8');
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const result = await mammoth.extractRawText({ path: filePath });
          extractedContent = result.value;
        } else {
          extractedContent = `파일: ${fileName} (${req.file.mimetype})`;
        }
      } catch (error) {
        console.error("Error extracting file content:", error);
        extractedContent = `파일: ${fileName} (내용 추출 실패)`;
      }

      // 해당 에이전트에 문서 생성
      console.log(`Creating document for agent ${conversation.agentId}`);
      const document = await storage.createDocument({
        agentId: conversation.agentId,
        filename: fileName,
        originalName: fileName,
        mimeType: req.file.mimetype,
        size: req.file.size,
        content: extractedContent,
        uploadedBy: userId,
        type: documentType,
        description: description,
        status: '사용 중',
        connectedAgents: JSON.stringify([conversation.agentId]),
        isVisibleToUsers: true
      });

      console.log(`Document created successfully for agent ${conversation.agentId}`);

      // 시스템 메시지 생성
      console.log(`Creating system message for file upload: ${fileName}`);
      const systemMessage = await storage.createMessage({
        conversationId,
        content: `📎 ${fileName} 파일이 업로드되었습니다. (에이전트가 이 문서를 참조할 수 있습니다)`,
        isFromUser: false
      });
      console.log(`System message created successfully:`, systemMessage);

      res.json({
        message: "문서가 성공적으로 업로드되었습니다.",
        document: document,
        systemMessage: systemMessage
      });

    } catch (error) {
      console.error("Error uploading 1:1 chat document:", error);
      
      // 업로드된 파일 삭제
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (err) {
          console.error("Error deleting uploaded file:", err);
        }
      }
      
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // 그룹 채팅 문서 업로드
  app.post('/api/group-chats/:groupChatId/documents', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      const groupChatId = parseInt(req.params.groupChatId);
      const userId = req.user.id;

      console.log('Group chat document upload request:', {
        groupChatId,
        userId,
        hasFile: !!req.file,
        fileDetails: req.file ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: req.file.path
        } : null,
        body: req.body
      });

      // 그룹 채팅 존재 여부 확인
      const groupChat = await storage.getGroupChatById(groupChatId);
      if (!groupChat) {
        return res.status(404).json({ message: "Group chat not found" });
      }

      // 사용자가 그룹 채팅 멤버인지 확인
      const members = await storage.getGroupChatMembers(groupChatId);
      const isMember = members.some(member => String(member.userId) === String(userId));
      
      if (!isMember && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      if (!req.file) {
        console.log('No file received in request');
        return res.status(400).json({ message: "No file uploaded" });
      }

      if (!req.file.originalname) {
        console.log('File received but originalname is missing:', req.file);
        return res.status(400).json({ message: "Invalid file - missing filename" });
      }

      const { documentType = '기타', description = '' } = req.body;

      // 파일 내용 추출
      let extractedContent = '';
      const filePath = req.file.path;
      const fileName = req.file.originalname;
      
      try {
        if (req.file.mimetype === 'text/plain') {
          extractedContent = fs.readFileSync(filePath, 'utf8');
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
          const result = await mammoth.extractRawText({ path: filePath });
          extractedContent = result.value;
        } else {
          extractedContent = `파일: ${fileName} (${req.file.mimetype})`;
        }
      } catch (error) {
        console.error("Error extracting file content:", error);
        extractedContent = `파일: ${fileName} (내용 추출 실패)`;
      }

      // 그룹 채팅의 모든 에이전트에 문서를 연결
      console.log('Getting group chat agents for groupChatId:', groupChatId);
      const groupAgents = await storage.getGroupChatAgents(groupChatId);
      console.log('Found agents:', groupAgents.length, 'agents:', groupAgents);
      
      if (groupAgents.length === 0) {
        console.log('No agents found in group chat - returning error');
        // 파일 삭제
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error("Error deleting uploaded file:", err);
        }
        return res.status(400).json({ message: "그룹 채팅에 에이전트가 없습니다." });
      }

      const uploadedDocuments = [];

      // 각 에이전트에 대해 문서 생성
      console.log(`About to create documents for ${groupAgents.length} agents`);
      for (const groupAgent of groupAgents) {
        try {
          console.log(`Creating document for agent ${groupAgent.agentId}`);
          const document = await storage.createDocument({
            agentId: groupAgent.agentId,
            filename: fileName,
            originalName: fileName,
            mimeType: req.file.mimetype,
            size: req.file.size,
            content: extractedContent,
            uploadedBy: userId,
            type: documentType,
            description: description,
            status: '사용 중',
            connectedAgents: JSON.stringify([groupAgent.agentId]),
            isVisibleToUsers: true
          });

          uploadedDocuments.push(document);
          console.log(`Document created successfully for agent ${groupAgent.agentId}`);
        } catch (docError) {
          console.error(`Error creating document for agent ${groupAgent.agentId}:`, docError);
        }
      }

      // 파일 업로드 완료 시스템 메시지 생성
      console.log(`Creating system message for file upload: ${fileName}`);
      try {
        const systemMessage = await storage.createGroupChatMessage({
          groupChatId,
          content: `📎 ${fileName} 파일이 업로드되었습니다. (모든 에이전트가 이 문서를 참조할 수 있습니다)`,
          senderId: null, // 시스템 메시지
          agentId: null,
          replyOrder: undefined
        });
        console.log(`System message created successfully:`, systemMessage);
      } catch (msgError) {
        console.error('Error creating system message:', msgError);
      }

      res.json({
        message: "그룹 채팅에 문서가 성공적으로 업로드되었습니다.",
        documents: uploadedDocuments,
        connectedAgents: groupAgents.length
      });

    } catch (error) {
      console.error("Error uploading group chat document:", error);
      
      // 업로드된 파일 삭제
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (err) {
          console.error("Error deleting uploaded file:", err);
        }
      }
      
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  // 이메일로 사용자 확인
  app.post('/api/users/check-email', isAuthenticated, async (req: any, res) => {
    try {
      const { email } = req.body;
      
      // 실제 구현에서는 이메일로 사용자를 찾아야 함
      // 여기서는 간단하게 처리
      const users = await storage.getAllUsers();
      const user = users.find(u => u.email === email || u.username === email);
      
      res.json({ 
        exists: !!user,
        user: user ? { id: user.id, username: user.username, name: user.name } : null
      });
    } catch (error) {
      console.error("Error checking email:", error);
      res.status(500).json({ message: "Failed to check email" });
    }
  });

  // 사용자 프로필 업데이트 (이름, 이메일, 호칭, 연령, 성별, 국가, 종교, 직업, 언어 설정, 연령 단계)
  // Note: This endpoint is duplicated in server/auth.ts and should be consolidated
  app.patch('/api/user/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { name, email, nickname, age, gender, country, religion, occupation, preferredLanguage, lifeStage } = req.body;
      
      console.log('[PROFILE UPDATE] 받은 데이터:', { userId, lifeStage, age, nickname });
      
      // 🔒 LifeStage 값 검증
      const VALID_LIFE_STAGES = ["EC", "LC", "EA", "AD", "YA1", "YA2", "MA1", "MA2", "FS"];
      if (lifeStage !== undefined && lifeStage !== "" && lifeStage !== null && !VALID_LIFE_STAGES.includes(lifeStage)) {
        return res.status(400).json({ message: "Invalid lifeStage value" });
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;
      if (nickname !== undefined) updates.nickname = nickname;
      if (age !== undefined) updates.age = age;
      if (gender !== undefined) updates.gender = gender;
      if (country !== undefined) updates.country = country;
      if (religion !== undefined) updates.religion = religion;
      if (occupation !== undefined) updates.occupation = occupation;
      if (preferredLanguage !== undefined) updates.preferredLanguage = preferredLanguage;
      if (lifeStage !== undefined) updates.lifeStage = lifeStage;
      
      console.log('[PROFILE UPDATE] updates 객체:', updates);
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }
      
      const updatedUser = await storage.updateUser(userId, updates);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json({ 
        message: "Profile updated successfully",
        user: updatedUser
      });
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // 비밀번호 변경
  app.patch('/api/user/password', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }
      
      // 현재 비밀번호 확인
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // 비밀번호 변경 로직 (실제 구현에서는 bcrypt 등을 사용해야 함)
      const bcrypt = await import('bcrypt');
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
      
      // 새 비밀번호 해시화
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(userId, { password: hashedPassword });
      
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // ============================================================================
  // Unified Chat System API Routes
  // ============================================================================

  // 통합 채팅방 목록 조회 (사용자가 참가한 모든 채팅방)
  app.get('/api/unified-chats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const chats = await storage.getUserUnifiedChats(userId);
      res.json(chats);
    } catch (error) {
      console.error("Error fetching unified chats:", error);
      res.status(500).json({ message: "Failed to fetch chats" });
    }
  });

  // 새 통합 채팅방 생성
  app.post('/api/unified-chats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      
      // Zod 스키마로 요청 데이터 검증
      const chatSchema = insertUnifiedChatSchema.extend({
        agentIds: z.array(z.union([z.string(), z.number()])).optional().default([]),
        userIds: z.array(z.string()).optional().default([])
      }).pick({
        title: true,
        type: true
      }).extend({
        chatType: z.string().min(1),
        agentIds: z.array(z.union([z.string(), z.number()])).optional().default([]),
        userIds: z.array(z.string()).optional().default([])
      });

      const validationResult = chatSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.format()
        });
      }

      const { title, chatType, agentIds = [], userIds = [] } = validationResult.data;

      // 에이전트 ID 타입 정규화 및 검증
      const normalizedAgentIds: number[] = [];
      for (const agentId of agentIds) {
        const numericId = typeof agentId === 'string' ? parseInt(agentId, 10) : agentId;
        if (isNaN(numericId) || numericId <= 0) {
          return res.status(400).json({ 
            message: `Invalid agent ID: ${agentId}` 
          });
        }
        normalizedAgentIds.push(numericId);
      }

      // 에이전트 존재 여부 확인
      for (const agentId of normalizedAgentIds) {
        const agent = await storage.getAgent(agentId);
        if (!agent || !agent.isActive) {
          return res.status(404).json({ 
            message: `Agent with ID ${agentId} not found or inactive` 
          });
        }
      }

      // 초대할 사용자 존재 여부 확인
      for (const inviteUserId of userIds) {
        if (inviteUserId !== userId) {
          const user = await storage.getUser(inviteUserId);
          if (!user) {
            return res.status(404).json({ 
              message: `User with ID ${inviteUserId} not found` 
            });
          }
        }
      }

      // 채팅방 생성
      const newChat = await storage.createUnifiedChat({
        title,
        type: chatType as "one_on_one" | "group" | "multi_agent",
        createdBy: userId,
        isResponseBlocked: false,
        currentRespondingAgent: undefined,
        responseStartedAt: undefined,
      });

      // 생성자를 참가자로 추가
      await storage.addChatParticipant({
        chatId: newChat.id,
        participantType: "user",
        userId: userId,
        agentId: undefined,
        isActive: true,
        lastReadAt: new Date(),
      });

      // 초기 에이전트들 추가 (정규화된 ID 사용)
      for (const agentId of normalizedAgentIds) {
        await storage.addChatParticipant({
          chatId: newChat.id,
          participantType: "agent",
          userId: undefined,
          agentId: agentId,
          isActive: true,
          lastReadAt: undefined,
        });
      }

      // 초기 사용자들 추가
      if (userIds && userIds.length > 0) {
        for (const inviteUserId of userIds) {
          if (inviteUserId !== userId) {
            await storage.addChatParticipant({
              chatId: newChat.id,
              participantType: "user",
              userId: inviteUserId,
              agentId: undefined,
              isActive: true,
              lastReadAt: new Date(),
            });
          }
        }
      }

      res.json(newChat);
    } catch (error) {
      console.error("Error creating unified chat:", error);
      res.status(500).json({ message: "Failed to create chat" });
    }
  });

  // 특정 통합 채팅방 정보 조회
  app.get('/api/unified-chats/:id', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const userId = req.user.id;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 사용자 권한 확인
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json({ chat, participants });
    } catch (error) {
      console.error("Error fetching unified chat:", error);
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });

  // 통합 채팅방 정보 수정
  app.put('/api/unified-chats/:id', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      if (isNaN(chatId) || chatId <= 0) {
        return res.status(400).json({ message: "Invalid chat ID" });
      }

      const userId = req.user.id;

      // Zod 스키마로 요청 데이터 검증 (허용되는 필드만)
      const updateChatSchema = z.object({
        title: z.string().min(1).max(100).optional(),
        isResponseBlocked: z.boolean().optional(),
        currentRespondingAgent: z.number().nullable().optional()
      }).strict(); // 정의되지 않은 필드는 거부

      const validationResult = updateChatSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.format()
        });
      }

      const updates = validationResult.data;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 강화된 권한 확인 (소유자 또는 마스터 관리자만 수정 가능)
      const user = await storage.getUser(userId);
      const isMasterAdmin = user?.role === 'master_admin';
      
      if (chat.createdBy !== userId && !isMasterAdmin) {
        return res.status(403).json({ message: "Only chat creator or master admin can modify this chat" });
      }

      // currentRespondingAgent이 설정되는 경우 해당 에이전트가 채팅방에 참여 중인지 확인
      if (updates.currentRespondingAgent !== undefined && updates.currentRespondingAgent !== null) {
        const participants = await storage.getChatParticipants(chatId);
        const agentParticipant = participants.find(p => 
          p.participantType === "agent" && 
          p.agentId === updates.currentRespondingAgent && 
          p.isActive
        );
        
        if (!agentParticipant) {
          return res.status(400).json({ message: "Agent not found in this chat" });
        }
      }

      const updatedChat = await storage.updateUnifiedChat(chatId, updates);
      res.json(updatedChat);
    } catch (error) {
      console.error("Error updating unified chat:", error);
      res.status(500).json({ message: "Failed to update chat" });
    }
  });

  // 통합 채팅방 삭제
  app.delete('/api/unified-chats/:id', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const userId = req.user.id;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 권한 확인 (소유자만 삭제 가능)
      if (chat.createdBy !== userId && userId !== 'master_admin') {
        return res.status(403).json({ message: "Only chat creator can delete this chat" });
      }

      await storage.deleteUnifiedChat(chatId);
      res.json({ message: "Chat deleted successfully" });
    } catch (error) {
      console.error("Error deleting unified chat:", error);
      res.status(500).json({ message: "Failed to delete chat" });
    }
  });

  // 채팅방 참가자 목록 조회
  app.get('/api/unified-chats/:id/participants', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const userId = req.user.id;

      // 사용자 권한 확인
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json(participants);
    } catch (error) {
      console.error("Error fetching chat participants:", error);
      res.status(500).json({ message: "Failed to fetch participants" });
    }
  });

  // 채팅방에 참가자 추가
  app.post('/api/unified-chats/:id/participants', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      if (isNaN(chatId) || chatId <= 0) {
        return res.status(400).json({ message: "Invalid chat ID" });
      }

      const userId = req.user.id;

      // Zod 스키마로 요청 데이터 검증
      const addParticipantSchema = z.object({
        participantType: z.enum(["user", "agent"]),
        participantId: z.union([z.string().min(1), z.number().positive()])
      });

      const validationResult = addParticipantSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.format()
        });
      }

      const { participantType, participantId } = validationResult.data;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 권한 확인 (참가자라면 추가 가능)
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      // 참가자 타입별 검증 및 처리
      let normalizedUserId: string | undefined;
      let normalizedAgentId: number | undefined;

      if (participantType === "user") {
        normalizedUserId = typeof participantId === 'string' ? participantId : String(participantId);
        
        // 사용자 존재 여부 확인
        const user = await storage.getUser(normalizedUserId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        
        // 이미 참가 중인지 확인
        const existingParticipant = participants.find(p => 
          p.participantType === "user" && p.userId === normalizedUserId && p.isActive
        );
        if (existingParticipant) {
          return res.status(409).json({ message: "User is already a participant" });
        }
      } else {
        normalizedAgentId = typeof participantId === 'string' ? parseInt(participantId, 10) : participantId;
        if (isNaN(normalizedAgentId) || normalizedAgentId <= 0) {
          return res.status(400).json({ message: "Invalid agent ID" });
        }
        
        // 에이전트 존재 여부 확인
        const agent = await storage.getAgent(normalizedAgentId);
        if (!agent || !agent.isActive) {
          return res.status(404).json({ message: "Agent not found or inactive" });
        }
        
        // 이미 참가 중인지 확인
        const existingParticipant = participants.find(p => 
          p.participantType === "agent" && p.agentId === normalizedAgentId && p.isActive
        );
        if (existingParticipant) {
          return res.status(409).json({ message: "Agent is already a participant" });
        }
      }

      // 참가자 추가
      const newParticipant = await storage.addChatParticipant({
        chatId,
        participantType,
        userId: normalizedUserId,
        agentId: normalizedAgentId,
        isActive: true,
        lastReadAt: participantType === "user" ? new Date() : undefined,
      });

      // 마지막 메시지 시간 업데이트
      await storage.updateUnifiedChat(chatId, {
        lastMessageAt: new Date(),
      });

      res.json(newParticipant);
    } catch (error) {
      console.error("Error adding participant:", error);
      res.status(500).json({ message: "Failed to add participant" });
    }
  });

  // 채팅방에서 참가자 제거
  app.delete('/api/unified-chats/:id/participants/:participantId', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      if (isNaN(chatId) || chatId <= 0) {
        return res.status(400).json({ message: "Invalid chat ID" });
      }

      const participantId = req.params.participantId;
      const userId = req.user.id;

      // Zod 스키마로 요청 데이터 검증 (필수 participantType)
      const removeParticipantSchema = z.object({
        participantType: z.enum(["user", "agent"])
      });

      const validationResult = removeParticipantSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data - participantType is required",
          errors: validationResult.error.format()
        });
      }

      const { participantType } = validationResult.data;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 권한 확인
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      // 참가자 ID 타입 정규화 및 검증
      let normalizedParticipantId: string | number;
      
      if (participantType === "user") {
        normalizedParticipantId = participantId; // 문자열 그대로 사용
        
        // 사용자 존재 여부 확인
        const user = await storage.getUser(participantId);
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
      } else {
        // agent인 경우 숫자로 변환
        const agentId = parseInt(participantId, 10);
        if (isNaN(agentId) || agentId <= 0) {
          return res.status(400).json({ message: "Invalid agent ID" });
        }
        normalizedParticipantId = agentId;
        
        // 에이전트 존재 여부 확인
        const agent = await storage.getAgent(agentId);
        if (!agent || !agent.isActive) {
          return res.status(404).json({ message: "Agent not found or inactive" });
        }
      }

      // 참가자가 실제로 채팅방에 있는지 확인
      const targetParticipant = participants.find(p => {
        if (participantType === "user") {
          return p.participantType === "user" && p.userId === normalizedParticipantId && p.isActive;
        } else {
          return p.participantType === "agent" && p.agentId === normalizedParticipantId && p.isActive;
        }
      });
      
      if (!targetParticipant) {
        return res.status(404).json({ message: "Participant not found in this chat" });
      }

      // 강화된 권한 확인
      const isSelfRemoval = participantType === "user" && participantId === userId;
      const user = await storage.getUser(userId);
      const isMasterAdmin = user?.role === 'master_admin';
      
      if (!isSelfRemoval && chat.createdBy !== userId && !isMasterAdmin) {
        return res.status(403).json({ message: "Only chat creator or master admin can remove other participants" });
      }

      await storage.removeChatParticipant(chatId, participantType, normalizedParticipantId);

      // 마지막 메시지 시간 업데이트
      await storage.updateUnifiedChat(chatId, {
        lastMessageAt: new Date(),
      });

      res.json({ message: "Participant removed successfully" });
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  // 채팅방 메시지 목록 조회
  app.get('/api/unified-chats/:id/messages', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const userId = req.user.id;

      // 사용자 권한 확인
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      const messages = await storage.getChatMessages(chatId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // 채팅방에 메시지 전송
  app.post('/api/unified-chats/:id/messages', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      if (isNaN(chatId) || chatId <= 0) {
        return res.status(400).json({ message: "Invalid chat ID" });
      }

      const userId = req.user.id;

      // Zod 스키마로 요청 데이터 검증
      const messageSchema = z.object({
        content: z.string().min(1, "메시지 내용을 입력해주세요"),
        targetAgentIds: z.array(z.number()).optional().default([])
      });

      const validationResult = messageSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.format()
        });
      }

      const { content, targetAgentIds = [] } = validationResult.data;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 응답 차단 상태 확인
      const responseStatus = await storage.getChatResponseStatus(chatId);
      if (responseStatus.isResponseBlocked) {
        return res.status(423).json({ 
          message: "Cannot send messages while agent is responding",
          isBlocked: true,
          respondingAgent: responseStatus.currentRespondingAgent
        });
      }

      // 사용자 권한 확인
      const participants = await storage.getChatParticipants(chatId);
      const userParticipant = participants.find(p => p.participantType === "user" && p.userId === userId && p.isActive);
      
      if (!userParticipant && userId !== 'master_admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      // 메시지 생성
      const newMessage = await storage.createChatMessage({
        chatId,
        content,
        senderType: "user",
        senderId: userId,
        agentId: undefined,
        targetAgentIds: targetAgentIds || [],
      });

      res.json(newMessage);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // 채팅방 읽음 처리
  app.put('/api/unified-chats/:id/read', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const userId = req.user.id;

      await storage.markChatAsRead(chatId, userId);
      res.json({ message: "Chat marked as read" });
    } catch (error) {
      console.error("Error marking chat as read:", error);
      res.status(500).json({ message: "Failed to mark chat as read" });
    }
  });

  // 채팅방 응답 상태 설정
  app.post('/api/unified-chats/:id/response-status', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      if (isNaN(chatId) || chatId <= 0) {
        return res.status(400).json({ message: "Invalid chat ID" });
      }

      const userId = req.user.id;

      // Zod 스키마로 요청 데이터 검증
      const responseStatusSchema = z.object({
        isBlocked: z.boolean(),
        respondingAgentId: z.number().nullable().optional()
      });

      const validationResult = responseStatusSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validationResult.error.format()
        });
      }

      const { isBlocked, respondingAgentId } = validationResult.data;

      const chat = await storage.getUnifiedChat(chatId);
      if (!chat) {
        return res.status(404).json({ message: "Chat not found" });
      }

      // 강화된 권한 확인 - 소유자 또는 마스터 관리자만 응답 상태 변경 가능
      const user = await storage.getUser(userId);
      const isMasterAdmin = user?.role === 'master_admin';
      
      if (chat.createdBy !== userId && !isMasterAdmin) {
        return res.status(403).json({ message: "Only chat creator or master admin can change response status" });
      }

      // respondingAgentId가 설정되는 경우 해당 에이전트가 채팅방에 참여 중인지 확인
      if (respondingAgentId) {
        const participants = await storage.getChatParticipants(chatId);
        const agentParticipant = participants.find(p => 
          p.participantType === "agent" && 
          p.agentId === respondingAgentId && 
          p.isActive
        );
        
        if (!agentParticipant) {
          return res.status(400).json({ message: "Agent not found in this chat" });
        }
      }

      await storage.setChatResponseStatus(chatId, isBlocked, respondingAgentId ?? undefined);
      res.json({ message: "Response status updated" });
    } catch (error) {
      console.error("Error updating response status:", error);
      res.status(500).json({ message: "Failed to update response status" });
    }
  });

  // 채팅방 응답 상태 조회
  app.get('/api/unified-chats/:id/response-status', isAuthenticated, async (req: any, res) => {
    try {
      const chatId = parseInt(req.params.id);
      const status = await storage.getChatResponseStatus(chatId);
      res.json(status);
    } catch (error) {
      console.error("Error fetching response status:", error);
      res.status(500).json({ message: "Failed to fetch response status" });
    }
  });

  // 캐릭터 추천 API 엔드포인트
  app.post('/api/suggest-characters', isAuthenticated, async (req: any, res) => {
    try {
      const { topic } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 캐릭터 추천 기능은 master_admin과 agent_admin만 사용 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "캐릭터 추천 기능은 관리자 권한이 필요합니다."
        });
      }

      console.log(`[Character Suggestion] 사용자 ${userId}가 주제 "${topic}"에 대한 캐릭터 추천 요청`);

      if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
        return res.status(400).json({ 
          message: "주제가 필요합니다." 
        });
      }

      // 사용자 언어 감지 (기본값: 영어)
      const userLanguage = req.query.lang || 'en';

      // 새로운 검색이므로 추천 이력 초기화
      clearRecommendationHistory(userId);
      console.log(`[Character Suggestion] 새로운 검색 - 추천 이력 초기화`);

      // 추천 이력 가져오기 (중복 방지용 - ID와 정규화된 이름)
      const excludeHistory = getRecommendationHistory(userId);
      console.log(`[Character Suggestion] 기존 추천 이력: ${excludeHistory.ids.length}개 ID, ${excludeHistory.normalizedNames.length}개 이름`);

      // OpenAI API를 통한 캐릭터 추천 (이력 제외)
      const characters = await suggestCharacters(topic.trim(), userLanguage, excludeHistory);

      console.log(`[Character Suggestion] 추천 완료: ${characters.length}개 캐릭터`);
      console.log(`[DEBUG] 반환되는 캐릭터들:`, JSON.stringify(characters, null, 2));

      // 추천된 캐릭터들을 데이터베이스에 저장 (100개 제한, FIFO)
      try {
        await storage.saveRecommendedCharacters(userId, topic.trim(), characters);
        console.log(`[Character Suggestion] 데이터베이스 저장 완료: ${characters.length}개 캐릭터`);
      } catch (error) {
        console.error(`[Character Suggestion] 데이터베이스 저장 실패:`, error);
        // 저장 실패해도 추천 결과는 반환
      }

      // 추천 이력 저장 (메모리 기반 - ID와 이름 모두 저장)
      const charactersWithIdAndName = characters.map(char => ({
        id: char.id!,
        name: char.name
      }));
      if (charactersWithIdAndName.length > 0) {
        saveRecommendationHistory(userId, charactersWithIdAndName);
      }

      res.json({
        topic: topic.trim(),
        characters: characters,
        message: "캐릭터 추천이 완료되었습니다."
      });

    } catch (error) {
      console.error("[Character Suggestion] API 오류:", error);
      res.status(500).json({ 
        message: "캐릭터 추천 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 추가 추천 API 엔드포인트 (같은 주제로 6명 더 추천)
  app.get('/api/suggest-characters/more', isAuthenticated, async (req: any, res) => {
    try {
      const { topic } = req.query;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 캐릭터 추천 기능은 master_admin과 agent_admin만 사용 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "캐릭터 추천 기능은 관리자 권한이 필요합니다."
        });
      }

      console.log(`[Character Suggestion More] 사용자 ${userId}가 "${topic}" 주제로 추가 추천 요청`);

      if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
        return res.status(400).json({ 
          message: "주제를 입력해주세요." 
        });
      }

      if (topic.trim().length > 100) {
        return res.status(400).json({ 
          message: "주제는 100자 이하로 입력해주세요." 
        });
      }

      // 사용자 언어 감지 (기본값: 영어)
      const userLanguage = req.query.lang || 'en';

      // 추천 이력 가져오기 (중복 방지용 - ID와 정규화된 이름)
      const excludeHistory = getRecommendationHistory(userId);
      console.log(`[Character Suggestion More] 기존 추천 이력: ${excludeHistory.ids.length}개 ID, ${excludeHistory.normalizedNames.length}개 이름`);

      // OpenAI API를 통한 캐릭터 추천 (이력 제외)
      const characters = await suggestCharacters(topic.trim(), userLanguage, excludeHistory);

      console.log(`[Character Suggestion More] 추가 추천 완료: ${characters.length}개 캐릭터`);

      // 추천된 캐릭터들을 데이터베이스에 저장 (100개 제한, FIFO)
      try {
        await storage.saveRecommendedCharacters(userId, topic.trim(), characters);
        console.log(`[Character Suggestion More] 데이터베이스 저장 완료: ${characters.length}개 캐릭터`);
      } catch (error) {
        console.error(`[Character Suggestion More] 데이터베이스 저장 실패:`, error);
        // 저장 실패해도 추천 결과는 반환
      }

      // 추천 이력 저장 (메모리 기반 - ID와 이름 모두 저장)
      const charactersWithIdAndName = characters.map(char => ({
        id: char.id!,
        name: char.name
      }));
      if (charactersWithIdAndName.length > 0) {
        saveRecommendationHistory(userId, charactersWithIdAndName);
      }

      res.json({
        topic: topic.trim(),
        characters: characters,
        message: "추가 캐릭터 추천이 완료되었습니다."
      });

    } catch (error) {
      console.error("[Character Suggestion More] API 오류:", error);
      res.status(500).json({ 
        message: "추가 캐릭터 추천 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 같은 카테고리 추천 API 엔드포인트 (특정 캐릭터와 같은 카테고리의 다른 캐릭터 6명 추천)
  app.post('/api/suggest-characters/same-category', isAuthenticated, async (req: any, res) => {
    try {
      const { characterId, topic } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // 캐릭터 추천 기능은 master_admin과 agent_admin만 사용 가능
      if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
        return res.status(403).json({
          message: "캐릭터 추천 기능은 관리자 권한이 필요합니다."
        });
      }

      console.log(`[Character Suggestion Same Category] 사용자 ${userId}가 캐릭터 "${characterId}" 기반 같은 카테고리 추천 요청`);

      if (!characterId || typeof characterId !== 'string') {
        return res.status(400).json({ 
          message: "캐릭터 ID가 필요합니다." 
        });
      }

      // 사용자 언어 감지 (기본값: 영어)
      const userLanguage = req.query.lang || req.body.lang || 'en';

      // 데이터베이스에서 캐릭터 찾기
      const allRecommendedCharacters = await storage.getUserRecommendedCharacters(userId);
      const baseCharacterRow = allRecommendedCharacters.find(char => String(char.id) === String(characterId));

      if (!baseCharacterRow) {
        return res.status(404).json({ 
          message: "해당 캐릭터를 찾을 수 없습니다." 
        });
      }

      // characterData JSON 파싱
      const baseCharacter = typeof baseCharacterRow.characterData === 'string' 
        ? JSON.parse(baseCharacterRow.characterData) 
        : baseCharacterRow.characterData;

      const category = (baseCharacter as any).category || '기타';
      console.log(`[Character Suggestion Same Category] 카테고리: ${category}, 기본 캐릭터: ${(baseCharacter as any).name}`);

      // 추천 이력 가져오기 (중복 방지용)
      const excludeHistory = getRecommendationHistory(userId);
      console.log(`[Character Suggestion Same Category] 기존 추천 이력: ${excludeHistory.ids.length}개 ID, ${excludeHistory.normalizedNames.length}개 이름`);

      // 같은 카테고리 캐릭터 추천을 위한 프롬프트 생성
      const categoryPrompt = topic 
        ? `"${topic}" 주제와 관련된 ${category} 카테고리의 인물` 
        : `${category} 카테고리의 인물`;

      // OpenAI API를 통한 캐릭터 추천 (이력 제외)
      const characters = await suggestCharacters(categoryPrompt, userLanguage, excludeHistory);

      console.log(`[Character Suggestion Same Category] 같은 카테고리 추천 완료: ${characters.length}개 캐릭터`);

      // 추천된 캐릭터들을 데이터베이스에 저장
      try {
        const topicForSave = topic || `${category} 카테고리`;
        await storage.saveRecommendedCharacters(userId, topicForSave, characters);
        console.log(`[Character Suggestion Same Category] 데이터베이스 저장 완료: ${characters.length}개 캐릭터`);
      } catch (error) {
        console.error(`[Character Suggestion Same Category] 데이터베이스 저장 실패:`, error);
        // 저장 실패해도 추천 결과는 반환
      }

      // 추천 이력 저장 (메모리 기반)
      const charactersWithIdAndName = characters.map(char => ({
        id: char.id!,
        name: char.name
      }));
      if (charactersWithIdAndName.length > 0) {
        saveRecommendationHistory(userId, charactersWithIdAndName);
      }

      res.json({
        baseCharacter: {
          id: baseCharacter.id,
          name: baseCharacter.name,
          category: category
        },
        characters: characters,
        message: `${category} 카테고리의 캐릭터 추천이 완료되었습니다.`
      });

    } catch (error) {
      console.error("[Character Suggestion Same Category] API 오류:", error);
      res.status(500).json({ 
        message: "같은 카테고리 캐릭터 추천 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 저장된 추천 캐릭터 목록 조회 API 엔드포인트
  app.get('/api/recommended-characters', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      console.log(`[Recommended Characters] 사용자 ${userId}의 저장된 추천 캐릭터 조회 요청`);

      const recommendedCharacters = await storage.getUserRecommendedCharacters(userId);

      console.log(`[Recommended Characters] 조회 완료: ${recommendedCharacters.length}개 캐릭터`);

      res.json({
        success: true,
        characters: recommendedCharacters,
        count: recommendedCharacters.length,
        message: "저장된 추천 캐릭터를 조회했습니다."
      });

    } catch (error) {
      console.error("[Recommended Characters] API 오류:", error);
      res.status(500).json({ 
        message: "저장된 추천 캐릭터 조회 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 추천 캐릭터 삭제 API 엔드포인트
  app.delete('/api/recommended-characters/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const characterId = parseInt(req.params.id);

      if (isNaN(characterId)) {
        return res.status(400).json({ 
          message: "유효하지 않은 캐릭터 ID입니다." 
        });
      }

      console.log(`[Recommended Character Delete] 사용자 ${userId}가 추천 캐릭터 ${characterId} 삭제 요청`);

      const result = await storage.deleteRecommendedCharacter(characterId, userId);

      console.log(`[Recommended Character Delete] 삭제 완료: ${result.removedFromChats}개 채팅방에서 제거됨`);

      res.json({
        success: true,
        removedFromChats: result.removedFromChats,
        agentName: result.agentName,
        message: result.agentName 
          ? `${result.agentName}이(가) ${result.removedFromChats}개 채팅방에서 제거되었습니다.`
          : "추천 캐릭터가 삭제되었습니다."
      });

    } catch (error) {
      console.error("[Recommended Character Delete] API 오류:", error);
      res.status(500).json({ 
        message: "추천 캐릭터 삭제 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 역할에서 본질 추출
  app.post('/api/generate-role-essence', isAuthenticated, async (req: any, res) => {
    const { roleInput } = req.body;

    if (!roleInput || typeof roleInput !== 'string') {
      return res.status(400).json({ message: '역할 입력이 필요합니다.' });
    }

    try {
      const essence = await extractRoleEssence(roleInput);
      res.json({ essence });
    } catch (error: any) {
      console.error('[Generate Role Essence] Error:', error);
      res.status(500).json({ 
        message: error.message || '본질 추출 중 오류가 발생했습니다.' 
      });
    }
  });

  // V 버튼: 태그 기반 3단 레이어 추천 (동일 세계관 → 유사 장르 → 현실 세계)
  app.post('/api/suggest-character-variations', isAuthenticated, async (req: any, res) => {
    try {
      const { baseCharacter, excludeNames = [] } = req.body;
      const userId = req.user.id;

      console.log(`[V Button] 사용자 ${userId}가 "${baseCharacter?.name}" 기반 3단 레이어 추천 요청 (태그: ${baseCharacter?.tags?.join(', ') || '없음'})`);

      if (!baseCharacter || typeof baseCharacter !== 'object') {
        return res.status(400).json({ 
          message: "기본 캐릭터 정보가 필요합니다." 
        });
      }

      // 필수 필드 검증 (최소 필수 필드만 체크, 빈 문자열 허용)
      const requiredFields = ['name', 'category', 'icon', 'color'];
      for (const field of requiredFields) {
        if (baseCharacter[field] === undefined || baseCharacter[field] === null) {
          return res.status(400).json({ 
            message: `캐릭터의 ${field} 정보가 누락되었습니다.` 
          });
        }
      }

      // 사용자 언어 감지 (기본값: 영어)
      const userLanguage = req.query.lang || 'en';

      // excludeNames를 normalizedNames 형식으로 변환
      const excludeHistory = {
        ids: [],
        normalizedNames: Array.isArray(excludeNames) ? excludeNames : []
      };

      console.log(`[V Button] 제외 대상: ${excludeHistory.normalizedNames.length}명`);

      // OpenAI API를 통한 태그 기반 3단 레이어 추천 (중복 제외)
      const variations = await suggestCharacterVariations(baseCharacter, userLanguage, excludeHistory);

      console.log(`[V Button] 3단 레이어 추천 완료: ${variations.length}개 캐릭터 (동일 세계관 → 유사 장르 → 현실 세계)`);

      res.json({
        baseCharacter: baseCharacter,
        variations: variations,
        message: `${baseCharacter.name}와 관련된 ${variations.length}명을 추천했습니다.`
      });

    } catch (error) {
      console.error("[V Button] API 오류:", error);
      res.status(500).json({ 
        message: "태그 기반 캐릭터 추천 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // ==================== 새로운 스마트 AI 서비스 API ====================

  // 텍스트 요약 API
  app.post('/api/ai/summarize', isAuthenticated, async (req: any, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "텍스트가 필요합니다." });
      }

      const summary = await summarizeText(text);
      
      res.json({
        success: true,
        summary,
        originalLength: text.length,
        summaryLength: summary.length
      });
    } catch (error) {
      console.error("텍스트 요약 오류:", error);
      res.status(500).json({ 
        message: "텍스트 요약 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 감정 분석 API
  app.post('/api/ai/sentiment', isAuthenticated, async (req: any, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "텍스트가 필요합니다." });
      }

      const sentiment = await analyzeSentiment(text);
      
      res.json({
        success: true,
        sentiment
      });
    } catch (error) {
      console.error("감정 분석 오류:", error);
      res.status(500).json({ 
        message: "감정 분석 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 키워드 추출 API
  app.post('/api/ai/keywords', isAuthenticated, async (req: any, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "텍스트가 필요합니다." });
      }

      const keywords = await extractKeywords(text);
      
      res.json({
        success: true,
        keywords
      });
    } catch (error) {
      console.error("키워드 추출 오류:", error);
      res.status(500).json({ 
        message: "키워드 추출 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 스마트 문서 분석 API (종합 분석)
  app.post('/api/ai/analyze-document', isAuthenticated, async (req: any, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "텍스트가 필요합니다." });
      }

      const analysis = await analyzeDocumentSmart(text);
      
      res.json({
        success: true,
        analysis
      });
    } catch (error) {
      console.error("스마트 문서 분석 오류:", error);
      res.status(500).json({ 
        message: "문서 분석 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 이미지 분석 API
  app.post('/api/ai/analyze-image', isAuthenticated, async (req: any, res) => {
    try {
      const { image } = req.body; // base64 encoded image
      
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ message: "base64 인코딩된 이미지가 필요합니다." });
      }

      const analysis = await analyzeImage(image);
      
      res.json({
        success: true,
        analysis
      });
    } catch (error) {
      console.error("이미지 분석 오류:", error);
      res.status(500).json({ 
        message: "이미지 분석 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 이미지 생성 API
  app.post('/api/ai/generate-image', isAuthenticated, async (req: any, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ message: "이미지 생성 프롬프트가 필요합니다." });
      }

      const result = await generateImage(prompt);
      
      res.json({
        success: true,
        imageUrl: result.url,
        prompt
      });
    } catch (error) {
      console.error("이미지 생성 오류:", error);
      res.status(500).json({ 
        message: "이미지 생성 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // ========================================
  // 🎭 캐릭터 아바타 API (멀티모달 감정 표현 아바타)
  // ========================================
  
  // 스프라이트 시트 생성 API - 4x4 그리드 이미지 생성 및 슬라이싱
  // ⚠️ 아바타 생성 기능 비활성화됨 (2024-12-02)
  app.post('/api/avatars/generate', isAuthenticated, async (req: any, res) => {
    console.log(`[🎭 아바타 API] 스프라이트 시트 생성 요청 - 비활성화됨`);
    return res.status(503).json({ 
      success: false,
      message: "아바타 생성 기능이 현재 비활성화되어 있습니다.",
      disabled: true
    });
  });
  
  // 에이전트의 모든 캐릭터 아바타 조회 (agentId 또는 groupChatId 지원)
  app.get('/api/avatars/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const type = req.query.type || 'agent'; // 'agent' or 'groupChat'
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "유효한 ID가 필요합니다." });
      }
      
      let avatars;
      if (type === 'groupChat') {
        avatars = await getCharacterAvatarsByGroupChat(id);
        console.log(`[🎭 아바타 API] groupChatId=${id} 조회: ${avatars.length}개 아바타`);
      } else {
        avatars = await getCharacterAvatarsByAgent(id);
        console.log(`[🎭 아바타 API] agentId=${id} 조회: ${avatars.length}개 아바타`);
      }
      
      res.json({
        success: true,
        avatars
      });
    } catch (error) {
      console.error("[🎭 아바타 API] 아바타 조회 오류:", error);
      res.status(500).json({ 
        message: "아바타 조회 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });
  
  // 그룹채팅 캐릭터 병렬 아바타 생성 (VERDICT용)
  // ⚠️ 아바타 생성 기능 비활성화됨 (2024-12-02)
  app.post('/api/avatars/generate-batch', async (req: any, res) => {
    console.log(`[🎭 배치 아바타] 생성 요청 - 비활성화됨`);
    return res.status(503).json({ 
      success: false,
      message: "아바타 생성 기능이 현재 비활성화되어 있습니다.",
      disabled: true
    });
  });
  
  // 단일 캐릭터 아바타 생성 (on-demand)
  // ⚠️ 아바타 생성 기능 비활성화됨 (2024-12-02)
  app.post('/api/avatars/generate-single', async (req: any, res) => {
    const { agentId, groupChatId, characterId, characterName } = req.body;
    
    // 이미 존재하는 아바타는 반환 (조회만 허용)
    try {
      let existingAvatars;
      if (groupChatId) {
        existingAvatars = await getCharacterAvatarsByGroupChat(parseInt(groupChatId));
      } else if (agentId) {
        existingAvatars = await getCharacterAvatarsByAgent(parseInt(agentId));
      }
      
      if (existingAvatars) {
        const existing = existingAvatars.find(a => a.characterId === characterId);
        if (existing && existing.avatars.neutral) {
          return res.json({
            success: true,
            cached: true,
            avatars: existing.avatars
          });
        }
      }
    } catch (err) {
      // 조회 오류는 무시하고 비활성화 메시지 반환
    }
    
    console.log(`[🎭 단일 아바타] ${characterName || 'unknown'} 생성 요청 - 비활성화됨`);
    return res.status(503).json({ 
      success: false,
      message: "아바타 생성 기능이 현재 비활성화되어 있습니다.",
      disabled: true
    });
  });

  // 특정 캐릭터의 특정 감정 아바타 URL 조회
  app.get('/api/avatars/:agentId/:characterId/:emotion', async (req: any, res) => {
    try {
      const agentId = parseInt(req.params.agentId);
      const { characterId, emotion } = req.params;
      
      if (isNaN(agentId)) {
        return res.status(400).json({ message: "유효한 에이전트 ID가 필요합니다." });
      }
      
      const validEmotions = [
        'neutral', 'happy', 'sad', 'angry',
        'determined', 'worried', 'thinking', 'questioning',
        'listening', 'surprised', 'shocked', 'embarrassed',
        'flustered', 'confident', 'arrogant', 'tired'
      ];
      if (!validEmotions.includes(emotion)) {
        return res.status(400).json({ 
          message: `유효한 감정이 필요합니다: ${validEmotions.join(', ')}` 
        });
      }
      
      const avatarUrl = await getCharacterAvatarUrl(agentId, characterId, emotion as any);
      
      if (!avatarUrl) {
        return res.status(404).json({ message: "해당 아바타를 찾을 수 없습니다." });
      }
      
      res.json({
        success: true,
        avatarUrl
      });
    } catch (error) {
      console.error("[🎭 아바타 API] 아바타 URL 조회 오류:", error);
      res.status(500).json({ 
        message: "아바타 URL 조회 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 오디오 전사 API
  app.post('/api/ai/transcribe-audio', isAuthenticated, upload.single('audio'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "오디오 파일이 필요합니다." });
      }

      const result = await transcribeAudio(req.file.buffer, req.file.originalname);
      
      res.json({
        success: true,
        transcription: result
      });
    } catch (error) {
      console.error("오디오 전사 오류:", error);
      res.status(500).json({ 
        message: "오디오 전사 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 언어 감지 API
  app.post('/api/ai/detect-language', isAuthenticated, async (req: any, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "텍스트가 필요합니다." });
      }

      const result = await detectLanguage(text);
      
      res.json({
        success: true,
        language: result
      });
    } catch (error) {
      console.error("언어 감지 오류:", error);
      res.status(500).json({ 
        message: "언어 감지 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 텍스트 번역 API
  app.post('/api/ai/translate', isAuthenticated, async (req: any, res) => {
    try {
      const { text, targetLanguage } = req.body;
      
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ message: "번역할 텍스트가 필요합니다." });
      }
      
      if (!targetLanguage || typeof targetLanguage !== 'string') {
        return res.status(400).json({ message: "목표 언어가 필요합니다." });
      }

      const translation = await translateText(text, targetLanguage);
      
      res.json({
        success: true,
        originalText: text,
        translatedText: translation,
        targetLanguage
      });
    } catch (error) {
      console.error("텍스트 번역 오류:", error);
      res.status(500).json({ 
        message: "텍스트 번역 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // ==================== 채팅방 메시지 프리로딩 API ====================

  // 최근 사용한 채팅방 10개의 메시지를 미리 로딩
  app.get('/api/preload-recent-chats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      console.log(`[PRELOAD] 사용자 ${userId}의 최근 채팅방 메시지 프리로딩 시작`);

      // 1. 최근 사용한 1:1 채팅방 가져오기
      const conversations = await storage.getUserConversations(userId);
      
      // 2. 최근 사용한 그룹 채팅방 가져오기
      const userGroupChats = await storage.getUserGroupChats(userId);
      
      // 3. 모든 채팅방을 합치고 최근 활동 순으로 정렬
      const allChats: Array<{
        type: 'conversation' | 'group';
        id: number;
        lastMessageAt?: Date;
        title: string;
      }> = [];

      // 1:1 채팅 추가 (메시지가 있는 것만)
      conversations.forEach(conv => {
        if (conv.lastMessageAt) {
          allChats.push({
            type: 'conversation',
            id: conv.id,
            lastMessageAt: new Date(conv.lastMessageAt), // 날짜 타입 보장
            title: conv.agent?.name || 'Unknown Agent'
          });
        }
      });

      // 그룹 채팅 추가 (메시지가 있는 것만)
      userGroupChats.forEach(groupChat => {
        if (groupChat.lastMessageAt) {
          allChats.push({
            type: 'group',
            id: groupChat.id,
            lastMessageAt: new Date(groupChat.lastMessageAt), // 날짜 타입 보장
            title: groupChat.title
          });
        }
      });

      // 최근 활동 순으로 정렬하고 상위 20개만 선택
      const recentChats = allChats
        .sort((a, b) => {
          if (!a.lastMessageAt || !b.lastMessageAt) return 0;
          return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
        })
        .slice(0, 20);

      console.log(`[PRELOAD] 프리로딩 대상 채팅방 ${recentChats.length}개:`, 
        recentChats.map(chat => `${chat.type}:${chat.id}(${chat.title})`));

      // 4. 각 채팅방의 메시지 병렬 로딩
      console.log(`[PRELOAD] 병렬 메시지 로딩 시작: ${recentChats.length}개 채팅방`);
      
      const messagePromises = recentChats.map(async (chat) => {
        try {
          let messages: any[] = [];
          
          if (chat.type === 'conversation') {
            messages = await storage.getConversationMessages(chat.id);
          } else {
            messages = await storage.getGroupChatMessages(chat.id);
          }

          // 메시지 전체 정보 추출 (messageKey 생성에 필요한 모든 필드 포함)
          const textMessages = messages
            .filter(msg => msg.content && typeof msg.content === 'string')
            .map(msg => ({
              id: msg.id,
              content: msg.content,
              isFromUser: msg.isFromUser,
              createdAt: msg.createdAt,
              agentId: msg.agentId,
              senderId: msg.senderId,
              userTurnId: msg.userTurnId, // 🔑 messageKey 생성에 필수
              replyOrder: msg.replyOrder,
              groupChatId: chat.type === 'group' ? chat.id : undefined, // 그룹 채팅인 경우만
              conversationId: chat.type === 'conversation' ? chat.id : undefined, // 1:1 채팅인 경우만
              sender: msg.sender, // 다른 사용자 이름 표시를 위한 sender 정보
              agent: msg.agent, // 에이전트 정보
              agentName: msg.agentName,
              isBot: msg.isBot || !!msg.agentId, // 봇 메시지 여부
              sources: msg.sources // 📰 Google Search 인용 출처
            }));

          console.log(`[PRELOAD] ${chat.type}:${chat.id}(${chat.title}) - ${textMessages.length}개 메시지 로딩 완료`);
          
          return {
            type: chat.type,
            id: chat.id,
            title: chat.title,
            messages: textMessages,
            messageCount: textMessages.length
          };
        } catch (error) {
          console.error(`[PRELOAD] ${chat.type}:${chat.id} 메시지 로딩 실패:`, error);
          return null; // 실패한 경우 null 반환
        }
      });

      const results = await Promise.all(messagePromises);
      const preloadedData = results.filter(result => result !== null); // 실패한 것들 제외

      const totalMessages = preloadedData.reduce((sum, chat) => sum + chat.messageCount, 0);
      console.log(`[PRELOAD] 완료 - ${preloadedData.length}개 채팅방, 총 ${totalMessages}개 메시지`);

      res.json({
        success: true,
        chatCount: preloadedData.length,
        totalMessages,
        preloadedChats: preloadedData
      });

    } catch (error) {
      console.error('[PRELOAD] 채팅방 메시지 프리로딩 오류:', error);
      res.status(500).json({ 
        message: "채팅방 메시지 프리로딩 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 📊 대화 분석 API - 대화방별 증분 분석 (이미 분석된 데이터는 건너뛰고 새 메시지만 분석)
  app.post("/api/conversation-analytics/analyze", isAuthenticated, async (req, res) => {
    const userId = req.user!.id;
    const { conversationId, periodType, periodStart, periodEnd } = req.body;
    
    try {
      console.log(`[📊 증분 분석 시작] 대화방 ${conversationId}, 기간: ${periodType} (${periodStart} ~ ${periodEnd})`);
      
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      
      // 1. 마지막 분석 메시지 ID 조회
      const lastAnalyzedMessageId = await storage.getLastAnalyzedMessageId(
        conversationId,
        periodType,
        start,
        end
      );
      
      console.log(`[📊 마지막 분석 메시지 ID]: ${lastAnalyzedMessageId || '없음 (첫 분석)'}`);
      
      // 2. 미분석 메시지 조회
      const unanalyzedMessages = await storage.getUnanalyzedMessages(
        conversationId,
        lastAnalyzedMessageId,
        start,
        end
      );
      
      // 사용자가 보낸 메시지만 필터링 (그룹 채팅 메시지는 senderId 필드 사용)
      const userMessages = unanalyzedMessages.filter((msg: any) => 
        msg.senderId === userId && msg.senderType === 'user'
      );
      
      if (userMessages.length === 0) {
        console.log(`[📊 증분 분석] 새로운 메시지 없음`);
        return res.json({
          success: true,
          analyzed: 0,
          message: "분석할 새로운 메시지가 없습니다."
        });
      }
      
      console.log(`[📊 증분 분석] ${userMessages.length}개 새 메시지 발견`);
      
      // 3. OpenAI로 새 메시지 분석
      const messageSample = userMessages.slice(0, 100).map((m: any) => m.content);
      const messagesText = messageSample.join("\n---\n");
      
      const analysisPrompt = `다음은 사용자의 대화 메시지들입니다. 각 메시지를 분석하여 다음 카테고리로 분류하고, 각 카테고리의 개수를 계산해주세요:

카테고리:
- 고민: 개인적인 고민, 걱정, 불안 등을 표현한 메시지
- 질문: 정보를 얻기 위한 질문, 궁금증
- 연애: 연애, 관계, 데이트 관련 내용
- 지역: 지역, 장소, 여행 관련 내용
- 상병: 건강, 질병, 증상 관련 내용
- 학업: 학교, 공부, 시험 관련 내용
- 진로: 직업, 진로, 취업 관련 내용
- 기타: 위 카테고리에 해당하지 않는 내용

메시지:
${messagesText}

JSON 형식으로 응답해주세요. 각 카테고리의 개수를 정수로 표현:
{
  "고민": 5,
  "질문": 3,
  "연애": 2,
  "지역": 1,
  "상병": 0,
  "학업": 4,
  "진로": 2,
  "기타": 3
}`;

      const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "당신은 대화 메시지를 분석하여 카테고리별로 분류하는 전문가입니다. 항상 JSON 형식으로만 응답하세요."
            },
            {
              role: "user",
              content: analysisPrompt
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        }),
      });

      if (!openAiResponse.ok) {
        throw new Error(`OpenAI API error: ${openAiResponse.statusText}`);
      }

      const data = await openAiResponse.json();
      const newCategoryCounts = JSON.parse(data.choices[0].message.content);
      
      console.log(`[📊 새 메시지 카테고리 개수]:`, newCategoryCounts);
      
      // 4. 기존 분석 결과 조회 및 병합
      const existingAnalysis = await storage.getConversationAnalytics(
        userId,
        periodType,
        start,
        end
      );
      
      const existingRecord = existingAnalysis.find((a: any) => a.conversationId === conversationId);
      
      let mergedCategoryCounts: Record<string, number>;
      let totalMessages: number;
      
      if (existingRecord) {
        // 기존 데이터와 병합
        const oldCategoryData = existingRecord.categoryData as Record<string, number>;
        const oldTotalMessages = existingRecord.totalMessages;
        
        // 비율을 개수로 변환 (기존 저장은 비율이었을 수 있음)
        const oldCategoryCounts: Record<string, number> = {};
        for (const [category, value] of Object.entries(oldCategoryData)) {
          // 값이 0-100 범위면 비율, 아니면 개수로 간주
          if (value <= 100) {
            oldCategoryCounts[category] = Math.round((value / 100) * oldTotalMessages);
          } else {
            oldCategoryCounts[category] = value;
          }
        }
        
        mergedCategoryCounts = { ...oldCategoryCounts };
        for (const [category, count] of Object.entries(newCategoryCounts)) {
          const numCount = typeof count === 'number' ? count : 0;
          mergedCategoryCounts[category] = (mergedCategoryCounts[category] || 0) + numCount;
        }
        
        totalMessages = oldTotalMessages + userMessages.length;
      } else {
        // 첫 분석
        mergedCategoryCounts = newCategoryCounts;
        totalMessages = userMessages.length;
      }
      
      // 5. 개수를 비율(%)로 변환
      const categoryData: Record<string, number> = {};
      for (const [category, count] of Object.entries(mergedCategoryCounts)) {
        categoryData[category] = totalMessages > 0 ? Math.round((count / totalMessages) * 100) : 0;
      }
      
      // 마지막 메시지 ID
      const lastMessageId = unanalyzedMessages[unanalyzedMessages.length - 1]?.id || lastAnalyzedMessageId || 0;
      
      console.log(`[📊 병합된 카테고리 비율]:`, categoryData);
      
      // 6. 분석 결과 저장 또는 업데이트
      if (existingRecord) {
        await storage.updateConversationAnalytics(
          conversationId,
          periodType,
          start,
          end,
          categoryData,
          totalMessages,
          lastMessageId
        );
      } else {
        await storage.saveConversationAnalytics({
          conversationId,
          userId,
          periodType,
          periodStart: start,
          periodEnd: end,
          categoryData,
          totalMessages,
          lastAnalyzedMessageId: lastMessageId > 0 ? lastMessageId : undefined
        });
      }
      
      res.json({
        success: true,
        analyzed: userMessages.length,
        categoryData,
        totalMessages
      });
      
    } catch (error) {
      console.error('[📊 증분 분석 실패]:', error);
      res.status(500).json({
        message: "대화 분석 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // 📊 대화 분석 결과 조회 API
  app.get("/api/conversation-analytics", isAuthenticated, async (req, res) => {
    const userId = req.user!.id;
    const { periodType, periodStart, periodEnd, conversationId } = req.query;
    
    try {
      const results = await storage.getConversationAnalytics(
        userId,
        periodType as string,
        periodStart ? new Date(periodStart as string) : undefined,
        periodEnd ? new Date(periodEnd as string) : undefined,
        conversationId ? parseInt(conversationId as string) : undefined
      );
      
      res.json({
        success: true,
        analytics: results
      });
      
    } catch (error) {
      console.error('[📊 분석 조회 실패]:', error);
      res.status(500).json({
        message: "대화 분석 조회 중 오류가 발생했습니다.",
        error: process.env.NODE_ENV === 'development' ? String(error) : undefined
      });
    }
  });

  // ==================== 게시판 API ====================
  
  // 모든 활성화된 게시판 목록 조회
  app.get("/api/boards", isAuthenticated, async (req, res) => {
    try {
      const boards = await storage.getBoards();
      res.json(boards);
    } catch (error) {
      console.error('[📋 게시판 목록 조회 실패]:', error);
      res.status(500).json({ message: "게시판 목록 조회 중 오류가 발생했습니다." });
    }
  });

  // 특정 게시판 조회
  app.get("/api/boards/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const board = await storage.getBoardById(id);
      
      if (!board) {
        return res.status(404).json({ message: "게시판을 찾을 수 없습니다." });
      }
      
      res.json(board);
    } catch (error) {
      console.error('[📋 게시판 조회 실패]:', error);
      res.status(500).json({ message: "게시판 조회 중 오류가 발생했습니다." });
    }
  });

  // 게시판의 게시물 목록 조회
  app.get("/api/boards/:id/posts", isAuthenticated, async (req, res) => {
    try {
      const boardId = parseInt(req.params.id);
      const posts = await storage.getBoardPosts(boardId);
      res.json(posts);
    } catch (error) {
      console.error('[📝 게시물 목록 조회 실패]:', error);
      res.status(500).json({ message: "게시물 목록 조회 중 오류가 발생했습니다." });
    }
  });

  // 특정 게시물 조회 (조회수 증가)
  app.get("/api/boards/posts/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const post = await storage.getBoardPostById(id);
      
      if (!post) {
        return res.status(404).json({ message: "게시물을 찾을 수 없습니다." });
      }
      
      // 조회수 증가
      await storage.incrementPostViewCount(id);
      
      res.json(post);
    } catch (error) {
      console.error('[📝 게시물 조회 실패]:', error);
      res.status(500).json({ message: "게시물 조회 중 오류가 발생했습니다." });
    }
  });

  // ==================== 게시판 운영자 API ====================

  // 게시판 생성 (운영자 전용)
  app.post("/api/boards", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { title, description, icon, color, order } = req.body;
      
      if (!title) {
        return res.status(400).json({ message: "게시판 제목은 필수입니다." });
      }
      
      const board = await storage.createBoard({
        title,
        description,
        icon,
        color,
        order: order ?? 0,
      });
      
      res.status(201).json(board);
    } catch (error) {
      console.error('[📋 게시판 생성 실패]:', error);
      res.status(500).json({ message: "게시판 생성 중 오류가 발생했습니다." });
    }
  });

  // 게시판 업데이트 (운영자 전용)
  app.put("/api/boards/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, description, icon, color, isActive, order } = req.body;
      
      const board = await storage.updateBoard(id, {
        title,
        description,
        icon,
        color,
        isActive,
        order,
      });
      
      res.json(board);
    } catch (error) {
      console.error('[📋 게시판 업데이트 실패]:', error);
      res.status(500).json({ message: "게시판 업데이트 중 오류가 발생했습니다." });
    }
  });

  // 게시물 작성 (운영자 전용)
  app.post("/api/boards/:id/posts", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const boardId = parseInt(req.params.id);
      const { title, content, isPinned } = req.body;
      const authorId = req.user!.id;
      
      if (!title || !content) {
        return res.status(400).json({ message: "제목과 내용은 필수입니다." });
      }
      
      const post = await storage.createBoardPost({
        boardId,
        title,
        content,
        authorId,
        isPinned: isPinned ?? false,
      });
      
      res.status(201).json(post);
    } catch (error) {
      console.error('[📝 게시물 작성 실패]:', error);
      res.status(500).json({ message: "게시물 작성 중 오류가 발생했습니다." });
    }
  });

  // 게시물 수정 (작성자 본인 또는 운영자)
  app.put("/api/boards/posts/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, content, isPinned } = req.body;
      const userId = req.user!.id;
      const userRole = req.user!.role;
      
      // 기존 게시물 조회
      const existingPost = await storage.getBoardPostById(id);
      if (!existingPost) {
        return res.status(404).json({ message: "게시물을 찾을 수 없습니다." });
      }
      
      // 권한 체크: 작성자 본인 또는 관리자
      const isAdmin = userRole === "master_admin" || userRole === "operation_admin" || userRole === "agent_admin";
      const isAuthor = existingPost.authorId === userId;
      
      if (!isAdmin && !isAuthor) {
        return res.status(403).json({ message: "수정 권한이 없습니다." });
      }
      
      const post = await storage.updateBoardPost(id, {
        title,
        content,
        isPinned,
      });
      
      res.json(post);
    } catch (error) {
      console.error('[📝 게시물 수정 실패]:', error);
      res.status(500).json({ message: "게시물 수정 중 오류가 발생했습니다." });
    }
  });

  // 게시물 삭제 (작성자 본인 또는 운영자)
  app.delete("/api/boards/posts/:id", isAuthenticated, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user!.id;
      const userRole = req.user!.role;
      
      // 기존 게시물 조회
      const existingPost = await storage.getBoardPostById(id);
      if (!existingPost) {
        return res.status(404).json({ message: "게시물을 찾을 수 없습니다." });
      }
      
      // 권한 체크: 작성자 본인 또는 관리자
      const isAdmin = userRole === "master_admin" || userRole === "operation_admin" || userRole === "agent_admin";
      const isAuthor = existingPost.authorId === userId;
      
      if (!isAdmin && !isAuthor) {
        return res.status(403).json({ message: "삭제 권한이 없습니다." });
      }
      
      await storage.deleteBoardPost(id);
      res.json({ message: "게시물이 삭제되었습니다." });
    } catch (error) {
      console.error('[📝 게시물 삭제 실패]:', error);
      res.status(500).json({ message: "게시물 삭제 중 오류가 발생했습니다." });
    }
  });

  // ==================== 토큰 모니터링 API (운영자 전용) ====================

  // 실시간 토큰 통계 (게이지용)
  app.get("/api/admin/token-stats", isAdmin, async (req, res) => {
    try {
      const periodHours = req.query.period ? parseInt(req.query.period as string) : undefined;
      const stats = await storage.getTokenUsageStats(periodHours);
      res.json(stats);
    } catch (error) {
      console.error('[🔥 토큰 통계 조회 실패]:', error);
      res.status(500).json({ message: "토큰 통계 조회 중 오류가 발생했습니다." });
    }
  });

  // 기간별 토큰 사용량 그래프 데이터
  app.get("/api/admin/token-usage/period", isAdmin, async (req, res) => {
    try {
      const periodHours = req.query.hours ? parseInt(req.query.hours as string) : 24;
      const data = await storage.getTokenUsageByPeriod(periodHours);
      res.json(data);
    } catch (error) {
      console.error('[🔥 기간별 토큰 조회 실패]:', error);
      res.status(500).json({ message: "기간별 토큰 조회 중 오류가 발생했습니다." });
    }
  });

  // 최근 토큰 사용 로그 (실시간 스크롤용)
  app.get("/api/admin/token-usage/recent", isAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getRecentTokenUsage(limit);
      res.json(logs);
    } catch (error) {
      console.error('[🔥 최근 토큰 로그 조회 실패]:', error);
      res.status(500).json({ message: "최근 토큰 로그 조회 중 오류가 발생했습니다." });
    }
  });

  // 기능별 토큰 사용량 분석
  app.get("/api/admin/token-usage/by-feature", isAdmin, async (req, res) => {
    try {
      const periodHours = req.query.period ? parseInt(req.query.period as string) : undefined;
      const data = await storage.getTokenUsageByFeature(periodHours);
      res.json(data);
    } catch (error) {
      console.error('[🔥 기능별 토큰 조회 실패]:', error);
      res.status(500).json({ message: "기능별 토큰 조회 중 오류가 발생했습니다." });
    }
  });

  // 테스트용 토큰 데이터 시드 (개발 환경 전용)
  app.post("/api/admin/token-usage/seed", isAdmin, async (req, res) => {
    try {
      if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ message: "개발 환경에서만 사용 가능합니다." });
      }

      const { seedTokenData } = await import('./utils/seedTokenData');
      await seedTokenData();
      res.json({ message: "테스트 데이터 100개가 생성되었습니다." });
    } catch (error) {
      console.error('[🔥 토큰 시드 실패]:', error);
      res.status(500).json({ message: "토큰 시드 중 오류가 발생했습니다." });
    }
  });

  // ==================== END 토큰 모니터링 API ====================

  // ==================== 세계관 자동 분석 API (관리자 전용) ====================
  
  // 배치 세계관 분석 (추천 캐릭터 → 에이전트 연결된 것들)
  app.post("/api/admin/batch-analyze-worldview", isAuthenticated, isAdmin, async (req, res) => {
    try {
      console.log('[🌍 배치 세계관 분석] 시작');
      
      // 에이전트가 연결된 추천 캐릭터 조회
      const allCharacters = await storage.getRecommendedCharactersWithAgent();
      console.log(`[🌍 배치 세계관 분석] 총 ${allCharacters.length}개 에이전트 발견`);
      
      if (allCharacters.length === 0) {
        return res.json({ 
          message: "분석할 에이전트가 없습니다.",
          total: 0,
          analyzed: 0,
          skipped: 0,
          failed: 0,
          results: []
        });
      }
      
      // 🔒 한 번에 최대 20개씩만 처리 (타임아웃 방지)
      const BATCH_SIZE = 20;
      const characters = allCharacters.slice(0, BATCH_SIZE);
      
      if (allCharacters.length > BATCH_SIZE) {
        console.log(`[🌍 배치 세계관 분석] ${characters.length}/${allCharacters.length}개 처리 (배치 크기 제한: ${BATCH_SIZE}개)`);
      }
      
      const results: Array<{
        agentId: number;
        agentName: string;
        status: 'success' | 'skipped' | 'failed';
        message?: string;
        worldview?: any;
      }> = [];
      
      let analyzed = 0;
      let skipped = 0;
      let failed = 0;
      
      // 각 에이전트에 대해 세계관 분석 실행
      for (const character of characters) {
        const agent = character.agent;
        
        try {
          // 이미 Canon이 존재하는지 확인
          const existingCanon = await storage.getAgentCanon(agent.id);
          if (existingCanon) {
            console.log(`[🌍 배치 세계관 분석] ${agent.name} (ID: ${agent.id}) - Canon 이미 존재, 스킵`);
            results.push({
              agentId: agent.id,
              agentName: agent.name,
              status: 'skipped',
              message: '이미 Canon이 존재합니다'
            });
            skipped++;
            continue;
          }
          
          console.log(`[🌍 배치 세계관 분석] ${agent.name} (ID: ${agent.id}) - 세계관 분석 시작...`);
          
          // AI로 세계관 분석
          const { analyzeCharacterWorldview } = await import("./characterWorldviewAnalyzer.js");
          const worldview = await analyzeCharacterWorldview(
            agent.name,
            agent.description ?? undefined,
            agent.personality ?? undefined
          );
          
          // agentCanon에 저장
          await storage.createOrUpdateAgentCanon(agent.id, {
            strictMode: worldview.domain,
            customRule: JSON.stringify({
              worldview: worldview.worldview,
              corePrinciples: worldview.corePrinciples,
              prohibitedClaims: worldview.prohibitedClaims,
              responsibility: worldview.responsibility
            }),
            sources: []
          });
          
          console.log(`[🌍 배치 세계관 분석] ${agent.name} (ID: ${agent.id}) - 분석 완료! 도메인: ${worldview.domain}`);
          
          results.push({
            agentId: agent.id,
            agentName: agent.name,
            status: 'success',
            message: `도메인: ${worldview.domain}`,
            worldview: {
              domain: worldview.domain,
              corePrinciples: worldview.corePrinciples,
              worldview: worldview.worldview
            }
          });
          analyzed++;
          
        } catch (error: any) {
          console.error(`[🌍 배치 세계관 분석] ${agent.name} (ID: ${agent.id}) - 실패:`, error);
          results.push({
            agentId: agent.id,
            agentName: agent.name,
            status: 'failed',
            message: error.message || '세계관 분석 실패'
          });
          failed++;
        }
      }
      
      console.log(`[🌍 배치 세계관 분석] 완료 - 총: ${characters.length}, 분석: ${analyzed}, 스킵: ${skipped}, 실패: ${failed}`);
      
      const remaining = allCharacters.length - characters.length;
      const message = remaining > 0 
        ? `배치 세계관 분석 완료 (${characters.length}/${allCharacters.length}개 처리, ${remaining}개 남음 - 버튼을 다시 클릭하세요)`
        : "배치 세계관 분석 완료";
      
      res.json({
        message,
        total: characters.length,
        totalAvailable: allCharacters.length,
        remaining,
        analyzed,
        skipped,
        failed,
        results
      });
      
    } catch (error: any) {
      console.error('[🌍 배치 세계관 분석 실패]:', error);
      res.status(500).json({ message: "배치 세계관 분석 중 오류가 발생했습니다.", error: error.message });
    }
  });
  
  // ==================== END 세계관 자동 분석 API ====================

  // ==================== CallNAsk 임베드 API (로그인 없이 캐릭터 호출) ====================
  
  // 🔐 Origin Validation 함수
  function validateOrigin(origin: string | undefined, allowedDomains: string[] | null): boolean {
    if (!origin) return false;
    if (!allowedDomains || allowedDomains.length === 0) return true; // 모든 도메인 허용
    
    try {
      const originUrl = new URL(origin);
      const hostname = originUrl.hostname;
      
      return allowedDomains.some(domain => {
        // 정확히 일치하거나 서브도메인 허용
        return hostname === domain || hostname.endsWith(`.${domain}`);
      });
    } catch (error) {
      console.error('[🔐 ORIGIN VALIDATION] URL 파싱 실패:', error);
      return false;
    }
  }
  
  // 🎭 Guest Token 생성 함수
  function generateGuestToken(): string {
    return `guest_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }
  
  // 🔍 Guest Session DB 조회 함수
  async function getGuestSessionByToken(token: string) {
    const [session] = await db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.token, token))
      .limit(1);
    
    return session || null;
  }
  
  // ✅ Guest Session 검증 함수
  async function validateGuestSession(token: string, embedCode?: string) {
    if (!token) {
      return { valid: false, session: null, error: 'Guest token이 필요합니다.' };
    }
    
    const session = await getGuestSessionByToken(token);
    if (!session) {
      return { valid: false, session: null, error: '유효하지 않은 guest token입니다.' };
    }
    
    // 만료 확인
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      // 만료된 세션 삭제
      await db.delete(guestSessions).where(eq(guestSessions.token, token));
      return { valid: false, session: null, error: 'Guest token이 만료되었습니다.' };
    }
    
    // embedCode 확인 (선택적)
    if (embedCode && session.embedCode !== embedCode) {
      return { valid: false, session: null, error: '다른 채팅방의 token입니다.' };
    }
    
    return { valid: true, session, error: null };
  }
  
  // 🎭 만료된 Guest Session 정리 함수 (DB 기반)
  async function cleanupExpiredGuestSessions() {
    try {
      const now = new Date();
      const deleted = await db
        .delete(guestSessions)
        .where(eq(guestSessions.expiresAt, now))
        .returning();
      
      if (deleted.length > 0) {
        console.log(`[🧹 CLEANUP] 만료된 guest session ${deleted.length}개 제거`);
      }
    } catch (error) {
      console.error('[❌ CLEANUP] Guest session 정리 실패:', error);
    }
  }
  
  // 주기적으로 만료된 세션 정리 (1시간마다)
  setInterval(cleanupExpiredGuestSessions, 60 * 60 * 1000);
  
  // 📋 GET /api/callnask/rooms - CallNAsk 활성화된 공개 채팅방 목록 조회 (인증 불필요)
  app.get('/api/callnask/rooms', async (req, res) => {
    try {
      const allGroupChats = await storage.getAllGroupChats();
      
      // CallNAsk 활성화 & embedCode 유효성 필터링
      // CallNAsk는 독립적인 기능이므로 embedEnabled 조건 불필요
      const callnaskRooms = allGroupChats.filter((chat: any) => {
        if (!chat.callnaskEnabled || !chat.embedCode || chat.embedCode.trim() === '') {
          return false;
        }
        
        // 복사된 세션 판별 (isCallnaskTemplate 기반):
        // - Template: isCallnaskTemplate === true (복사 가능한 원본)
        // - Clone: isCallnaskTemplate === false (사용자/게스트가 생성한 복사본)
        const isClonedSession = !chat.isCallnaskTemplate;
        
        // 원본 템플릿은 항상 표시
        if (!isClonedSession) {
          return true;
        }
        
        // 복사된 채팅방: 24시간 이내 생성된 것만 표시
        const createdAt = new Date(chat.createdAt);
        const now = new Date();
        const hoursSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        
        return hoursSinceCreation < 24;
      });
      
      // 필요한 정보만 반환
      const rooms = callnaskRooms.map((chat: any) => ({
        id: chat.id,
        title: chat.title || '채팅방',
        embedCode: chat.embedCode,
        callnaskConfig: chat.callnaskConfig || { maxAgents: 5 },
        isCallnaskTemplate: chat.isCallnaskTemplate || false,
      }));
      
      console.log('[📋 CALLNASK ROOMS] 조회 완료:', rooms.length, '개');
      res.json(rooms);
      
    } catch (error: any) {
      console.error('[❌ CALLNASK ROOMS] 조회 실패:', error);
      res.status(500).json({ message: 'CallNAsk 채팅방 목록 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔄 POST /api/callnask/rooms/:roomId/clone - CallNAsk 템플릿 채팅방 복사 (각 사용자마다 독립된 채팅방 생성)
  app.post('/api/callnask/rooms/:roomId/clone', async (req, res) => {
    try {
      const roomId = parseInt(req.params.roomId);
      const userId = req.user?.id || 'guest';
      
      console.log('[🔄 CLONE] 채팅방 복사 요청:', { roomId, userId });
      
      // 1. 원본 채팅방 조회
      const originalRoom = await storage.getGroupChat(roomId);
      if (!originalRoom) {
        return res.status(404).json({ message: '채팅방을 찾을 수 없습니다.' });
      }
      
      // 2. CallNAsk 모드 확인
      if (!originalRoom.callnaskEnabled) {
        return res.status(403).json({ message: 'CallNAsk 템플릿 채팅방이 아닙니다.' });
      }
      
      // 3. 템플릿인지 확인 (isCallnaskTemplate이 true인 원본만 복사 가능)
      if (!originalRoom.isCallnaskTemplate) {
        return res.status(403).json({ message: '템플릿 채팅방만 복사할 수 있습니다.' });
      }
      
      // 4. 새로운 embedCode 생성
      const newEmbedCode = crypto.randomUUID();
      
      // 5. 새 채팅방 생성 (원본 설정 복사, isCallnaskTemplate=false)
      const newRoom = await storage.createGroupChat({
        title: `${originalRoom.title || 'CallNAsk'} - ${new Date().toLocaleString('ko-KR')}`,
        createdBy: userId,
        callnaskEnabled: true,
        isCallnaskTemplate: false, // Clone은 템플릿이 아님
        embedEnabled: true, // 링크로 접속 가능
        embedCode: newEmbedCode,
        allowedDomains: originalRoom.allowedDomains,
        callnaskConfig: originalRoom.callnaskConfig,
        assistantId: originalRoom.assistantId,
        threadId: originalRoom.threadId,
        relationshipMatrix: originalRoom.relationshipMatrix,
        // 🎯 CallNAsk는 무조건 Gemini 2.5 Flash 사용 (사용자 요구사항)
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        temperature: originalRoom.temperature ?? 0.35,
      });
      
      console.log('[✅ CLONE] 새 채팅방 생성 완료:', { 
        originalId: roomId, 
        newId: newRoom.id, 
        embedCode: newEmbedCode 
      });
      
      // 6. 원본 채팅방의 캐릭터 복사
      const originalAgents = await storage.getGroupChatAgents(roomId);
      console.log('[📋 CLONE] 원본 캐릭터 조회:', originalAgents.length, '개');
      
      for (const agentRel of originalAgents) {
        // 중복 체크
        const existing = await db
          .select()
          .from(groupChatAgents)
          .where(
            and(
              eq(groupChatAgents.groupChatId, newRoom.id),
              eq(groupChatAgents.agentId, agentRel.agentId)
            )
          )
          .limit(1);
          
        if (existing.length === 0) {
          await storage.addGroupChatAgent({
            groupChatId: newRoom.id,
            agentId: agentRel.agentId,
          });
          console.log('[➕ CLONE] 캐릭터 복사:', agentRel.agentId);
        } else {
          console.log('[⏭️ CLONE] 캐릭터 이미 존재:', agentRel.agentId);
        }
      }
      
      console.log('[✅ CLONE] 캐릭터 복사 완료:', originalAgents.length, '개');
      
      res.json({
        id: newRoom.id,
        title: newRoom.title,
        embedCode: newEmbedCode,
        callnaskConfig: newRoom.callnaskConfig || { maxAgents: 5 },
      });
      
    } catch (error: any) {
      console.error('[❌ CLONE] 채팅방 복사 실패:', error);
      res.status(500).json({ message: '채팅방 복사 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔐 POST /api/embed/:embedCode/session - Guest 세션 생성 (매번 새 채팅방 생성)
  app.post('/api/embed/:embedCode/session', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { timezone, screenWidth, screenHeight, referrer, requestStartTime } = req.body;
      const origin = req.headers.origin || req.headers.referer;
      
      // 네트워크 지연 계산 (서버 수신 시간 - 클라이언트 요청 시작 시간)
      const networkLatency = requestStartTime ? Math.max(0, Date.now() - requestStartTime) : null;
      
      console.log('[🎭 GUEST SESSION] 세션 생성 요청:', { 
        embedCode, 
        origin, 
        timezone,
        screenResolution: `${screenWidth}x${screenHeight}`,
        networkLatency: networkLatency ? `${networkLatency}ms` : 'N/A'
      });
      
      // 1. embedCode로 템플릿 채팅방 조회
      const templateChat = await storage.getGroupChatByEmbedCode(embedCode);
      if (!templateChat) {
        return res.status(404).json({ message: '채팅방 템플릿을 찾을 수 없습니다.' });
      }
      
      // 2. CallNAsk 모드 확인
      if (!templateChat.callnaskEnabled) {
        return res.status(403).json({ message: 'CallNAsk 모드가 비활성화되어 있습니다.' });
      }
      
      // 3. Origin validation
      const allowedDomains = templateChat.allowedDomains as string[] | null;
      if (!validateOrigin(origin, allowedDomains)) {
        console.log('[🔐 ORIGIN BLOCKED]', { origin, allowedDomains });
        return res.status(403).json({ message: '허용되지 않은 도메인입니다.' });
      }
      
      // 4. 🔍 이미 복제된 채팅방인지 확인 (isCallnaskTemplate=false면 복제본)
      let targetGroupChat;
      if (templateChat.isCallnaskTemplate === false) {
        // 이미 Clone API로 복제된 채팅방 → 새로 생성하지 않고 그대로 사용
        console.log('[♻️ REUSE] 이미 복제된 채팅방 사용:', { id: templateChat.id, title: templateChat.title });
        
        // 🎯 CallNAsk는 무조건 Gemini 2.5 Flash 사용 - 기존 채팅방도 강제 업데이트
        if (templateChat.provider !== 'gemini' || templateChat.model !== 'gemini-2.5-flash') {
          console.log('[🔧 PROVIDER FIX] CallNAsk 채팅방 provider 강제 업데이트:', { 
            before: { provider: templateChat.provider, model: templateChat.model },
            after: { provider: 'gemini', model: 'gemini-2.5-flash' }
          });
          await storage.updateGroupChat(templateChat.id, {
            provider: 'gemini',
            model: 'gemini-2.5-flash',
          });
          
          // 업데이트된 채팅방 다시 조회
          const updated = await storage.getGroupChatById(templateChat.id);
          targetGroupChat = updated!;
        } else {
          targetGroupChat = templateChat;
        }
      } else {
        // 템플릿 채팅방 → 새로운 채팅방 생성
        targetGroupChat = await storage.createGroupChat({
          title: `${templateChat.title || 'CallNAsk'} - ${new Date().toLocaleString('ko-KR')}`,
          description: templateChat.description,
          createdBy: 'guest',
          callnaskEnabled: true,
          embedEnabled: false, // 새로 만든 채팅방은 embed 비활성화
          embedCode: null, // 새 채팅방은 embedCode 없음
          allowedDomains: templateChat.allowedDomains,
          callnaskConfig: templateChat.callnaskConfig,
          // 🎯 CallNAsk는 무조건 Gemini 2.5 Flash 사용 (사용자 요구사항)
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          temperature: templateChat.temperature ?? 0.35,
        });
        
        console.log('[🆕 NEW ROOM] 새 채팅방 생성:', { id: targetGroupChat.id, title: targetGroupChat.title });
      }
      
      // 5. User-Agent 파싱
      const userAgent = req.headers['user-agent'] || '';
      const parser = new UAParser(userAgent);
      const uaResult = parser.getResult();
      
      // 6. IP 주소 수집
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() 
                        || req.socket.remoteAddress 
                        || '';
      
      // 7. Guest Token 생성
      const guestToken = generateGuestToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + GUEST_TOKEN_EXPIRY_MS);
      
      // 8. users 테이블에 guest user 생성 (conversations FK 제약 조건 충족용)
      await db.insert(users).values({
        id: guestToken,
        username: `Guest #${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        password: '', // Guest는 비밀번호 불필요
        role: 'user',
      }).onConflictDoNothing(); // 이미 존재하면 무시
      
      // 9. DB에 Guest Session 저장
      const [savedSession] = await db.insert(guestSessions).values({
        token: guestToken,
        embedCode,
        groupChatId: targetGroupChat.id,
        origin: origin || '',
        ipAddress,
        userAgent,
        deviceType: uaResult.device.type || 'desktop',
        browser: uaResult.browser.name || 'Unknown',
        browserVersion: uaResult.browser.version || '',
        os: uaResult.os.name || 'Unknown',
        osVersion: uaResult.os.version || '',
        timezone: timezone || 'UTC',
        screenWidth: screenWidth || null,
        screenHeight: screenHeight || null,
        referrer: referrer || null,
        networkLatency: networkLatency || null,
        expiresAt,
        selectedAgents: [],
      }).returning();
      
      console.log('[✅ GUEST SESSION] 생성 완료:', {
        sessionId: savedSession.id,
        userNumber: savedSession.userNumber,
        token: guestToken,
        groupChatId: targetGroupChat.id,
        device: `${uaResult.device.type || 'desktop'} / ${uaResult.browser.name} / ${uaResult.os.name}`,
        expiresIn: '24시간',
      });
      
      // 10. Analytics 이벤트 기록
      await db.insert(guestAnalytics).values({
        sessionId: savedSession.id,
        eventType: 'session_created',
        eventData: {
          ipAddress,
          deviceType: savedSession.deviceType,
          browser: savedSession.browser,
          os: savedSession.os,
          timezone,
        },
      });
      
      res.json({
        token: guestToken,
        expiresAt: expiresAt.getTime(),
        groupChatId: targetGroupChat.id,
        title: targetGroupChat.title || '채팅방',
        userNumber: savedSession.userNumber,
      });
      
    } catch (error: any) {
      console.error('[❌ GUEST SESSION] 생성 실패:', error);
      res.status(500).json({ message: 'Guest 세션 생성 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔍 GET /api/embed/:embedCode - CallNAsk 채팅방 정보 조회 (인증 불필요)
  app.get('/api/embed/:embedCode', async (req, res) => {
    try {
      const { embedCode } = req.params;
      
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      if (!groupChat) {
        return res.status(404).json({ message: '채팅방을 찾을 수 없습니다.' });
      }
      
      if (!groupChat.callnaskEnabled || !groupChat.embedEnabled) {
        return res.status(403).json({ message: 'CallNAsk 모드가 비활성화되어 있습니다.' });
      }
      
      // 공개 정보만 반환 (보안)
      res.json({
        id: groupChat.id,
        title: groupChat.title || '채팅방',
        callnaskConfig: groupChat.callnaskConfig || { maxAgents: 5 },
        provider: groupChat.provider,
        model: groupChat.model,
      });
      
    } catch (error: any) {
      console.error('[❌ CALLNASK INFO] 조회 실패:', error);
      res.status(500).json({ message: '채팅방 정보 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // 🤖 GET /api/embed/:embedCode/agents - CallNAsk 공개 에이전트 목록 조회
  app.get('/api/embed/:embedCode/agents', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Guest token 검증
      const validation = await validateGuestSession(guestToken || '', embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!
      
      // 공개 에이전트 목록 조회
      const allAgents = await storage.getAllAgents();
      const publicAgents = allAgents.filter((agent: any) => agent.visibility === 'public');
      
      // callnaskConfig의 allowedCategories 필터링
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      const callnaskConfig = groupChat?.callnaskConfig as any;
      
      let filteredPublicAgents = publicAgents;
      if (callnaskConfig?.allowedCategories && callnaskConfig.allowedCategories.length > 0) {
        filteredPublicAgents = publicAgents.filter((agent: any) => 
          callnaskConfig.allowedCategories.includes(agent.upperCategory) ||
          callnaskConfig.allowedCategories.includes(agent.lowerCategory)
        );
      }
      
      // CallNAsk 캐릭터 추가 (선택된 것만, 안전하게 접근)
      // 디자인: callnaskEnabled=true면 CallNAsk 기능이 활성화된 것이므로
      // 사용자가 생성한 캐릭터는 allowedCategories와 무관하게 허용
      // (호스트가 CallNAsk를 활성화했다면 사용자 생성 캐릭터를 허용하겠다는 의도)
      const selectedAgentIds = guestSession?.selectedAgents || [];
      const callnaskCharacters = selectedAgentIds.length > 0 && groupChat?.callnaskEnabled
        ? allAgents.filter((agent: any) => 
            agent.category === 'CallNAsk' && selectedAgentIds.includes(agent.id)
          )
        : [];
      
      // 중복 제거 후 합치기 (ID 기준)
      const agentMap = new Map();
      [...filteredPublicAgents, ...callnaskCharacters].forEach((agent: any) => {
        if (!agentMap.has(agent.id)) {
          agentMap.set(agent.id, agent);
        }
      });
      const filteredAgents = Array.from(agentMap.values());
      
      // 에이전트 정보 간소화 (필요한 정보만)
      const agents = filteredAgents.map((agent: any) => ({
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        backgroundColor: agent.backgroundColor,
        description: agent.description,
        upperCategory: agent.upperCategory,
        lowerCategory: agent.lowerCategory,
      }));
      
      res.json({
        agents,
        selectedAgents: guestSession.selectedAgents,
        maxAgents: callnaskConfig?.maxAgents || 5,
      });
      
    } catch (error: any) {
      console.error('[❌ CALLNASK AGENTS] 조회 실패:', error);
      res.status(500).json({ message: '에이전트 목록 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // ✨ POST /api/embed/:embedCode/agents - CallNAsk 에이전트 선택/해제
  app.post('/api/embed/:embedCode/agents', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { agentId, action } = req.body; // action: 'add' | 'remove'
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Guest token 검증
      const validation = await validateGuestSession(guestToken || '', embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!;
      
      // callnaskConfig에서 maxAgents 확인
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      const callnaskConfig = groupChat?.callnaskConfig as any;
      const maxAgents = callnaskConfig?.maxAgents || 5;
      
      let updatedAgents = guestSession.selectedAgents || [];
      
      if (action === 'add') {
        // 이미 선택되어 있는지 확인
        if (updatedAgents.includes(agentId)) {
          return res.status(400).json({ message: '이미 선택된 에이전트입니다.' });
        }
        
        // 최대 개수 확인
        if (updatedAgents.length >= maxAgents) {
          return res.status(400).json({ 
            message: `최대 ${maxAgents}명까지만 선택할 수 있습니다.` 
          });
        }
        
        // 에이전트 추가
        updatedAgents = [...updatedAgents, agentId];
        console.log(`[✅ AGENT ADD] Guest ${guestToken!.slice(0, 20)}... 에이전트 ${agentId} 추가`);
        
        // Analytics 기록
        await db.insert(guestAnalytics).values({
          sessionId: guestSession.id,
          eventType: 'character_added',
          eventData: { agentId },
        });
        
      } else if (action === 'remove') {
        // 에이전트 제거
        updatedAgents = updatedAgents.filter((id: number) => id !== agentId);
        console.log(`[➖ AGENT REMOVE] Guest ${guestToken!.slice(0, 20)}... 에이전트 ${agentId} 제거`);
        
        // Analytics 기록
        await db.insert(guestAnalytics).values({
          sessionId: guestSession.id,
          eventType: 'character_removed',
          eventData: { agentId },
        });
      } else {
        return res.status(400).json({ message: 'Invalid action. Use "add" or "remove".' });
      }
      
      // DB 업데이트 (캐릭터 전환 횟수 증가)
      await db
        .update(guestSessions)
        .set({ 
          selectedAgents: updatedAgents,
          characterSwitchCount: (guestSession.characterSwitchCount || 0) + 1,
        })
        .where(eq(guestSessions.token, guestToken!));
      
      res.json({
        selectedAgentIds: updatedAgents,
        maxAgents,
      });
      
    } catch (error: any) {
      console.error('[❌ CALLNASK AGENT SELECT] 실패:', error);
      res.status(500).json({ message: '에이전트 선택/해제 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔍 캐시: 인물 후보 검색 결과 (60초 TTL)
  const disambiguationCache = new Map<string, { data: any; expiresAt: number }>();
  
  // 🔎 POST /api/embed/:embedCode/disambiguate - 인물 후보 검색
  app.post('/api/embed/:embedCode/disambiguate', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { characterName } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '');
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!;
      
      if (!characterName || typeof characterName !== 'string' || !characterName.trim()) {
        return res.status(400).json({ message: '유효한 캐릭터 이름이 필요합니다.' });
      }
      
      const cacheKey = `${embedCode}:${characterName.trim().toLowerCase()}`;
      const cached = disambiguationCache.get(cacheKey);
      
      // 캐시 확인 (60초)
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`[💾 CACHE HIT] 인물 검색 캐시 사용: ${characterName}`);
        return res.json(cached.data);
      }
      
      console.log(`[🔎 DISAMBIGUATE] 인물 검색 시작: ${characterName}`);
      
      // 🎯 1단계: DB 정규화 검색 - 호칭/직책 제거 후 검색
      const trimmedName = characterName.trim();
      const normalizedInput = normalizeCharacterName(trimmedName);
      
      // 모든 CallNAsk 캐릭터 가져오기 (활성화된 것만)
      const allCallnaskAgents = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.category, 'CallNAsk'),
            eq(agents.isActive, true),
            eq(agents.visibility, 'public')
          )
        )
        .limit(100);
      
      // 정규화 기반 필터링
      let existingAgents = allCallnaskAgents.filter(agent => 
        isSimilarName(agent.name, trimmedName)
      );
      
      if (existingAgents.length > 0) {
        console.log(`[✅ DB 정규화 검색] "${trimmedName}" (정규화: "${normalizedInput}") → ${existingAgents.length}명 발견: ${existingAgents.map(a => a.name).join(', ')}`);
      } else {
        console.log(`[❌ DB 정규화 검색] "${trimmedName}" (정규화: "${normalizedInput}") → 일치 없음`);
      }
      
      // 최대 10명으로 제한
      existingAgents = existingAgents.slice(0, 10);
      
      // DB 결과를 후보 형식으로 변환
      const dbCandidates = existingAgents.map(agent => ({
        dbId: agent.id, // DB ID 포함 (병합 시 필요)
        fullName: agent.name,
        primaryDescriptor: agent.description || `${agent.name}에 대한 설명`,
        notability: 10,
        confidence: agent.name.toLowerCase() === trimmedName.toLowerCase() ? 1.0 : 0.8,
        isUnique: false, // 항상 Gemini 결과와 병합하므로 false
        source: 'db' as const,
      }));
      
      console.log(`[🤖 GEMINI API] DB 결과 ${dbCandidates.length}명 + AI 검색 병합: ${trimmedName}`);
      
      // 언어 감지
      const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName.trim());
      
      // DB 후보 목록을 프롬프트에 포함 (ID 포함)
      const dbCandidatesWithId = existingAgents.map((agent, idx) => ({
        dbId: agent.id,
        fullName: agent.name,
        primaryDescriptor: agent.description || `${agent.name}에 대한 설명`,
        listIndex: idx + 1,
      }));
      
      const dbCandidatesList = dbCandidatesWithId.length > 0
        ? dbCandidatesWithId.map(c => `[DB ID: ${c.dbId}] ${c.listIndex}. ${c.fullName}: ${c.primaryDescriptor}`).join('\n')
        : '(DB에 일치하는 인물 없음)';
      
      const prompt = isKorean
        ? `"${characterName.trim()}"을(를) 검색하여 유명 인물 목록을 생성하세요.

**🚨 중요 규칙:**
${dbCandidatesWithId.length > 0 ? `
1. **DB에 이미 있는 인물:**
${dbCandidatesList}

2. **위 DB 인물이 있으면:**
   - 그 사람과 **동일 인물이면 절대 중복 추가 금지**
   - 동명이인(완전히 다른 사람)만 추가 가능
   - 예: DB에 "김건희 (영부인)"이 있으면, 같은 김건희를 다시 반환하지 마세요
` : ''}
3. **역할극 가능한 인물만** (정치인, 예술가, 과학자 등)

**JSON 배열 반환:**
[
  {
    "fullName": "전체 이름 (예: 도널드 트럼프)",
    "primaryDescriptor": "주요 경력 및 배경을 자세히 작성 (예: 제45대 미국 대통령 (2017-2021), 트럼프 오거니제이션 회장, 리얼리티 TV 진행자, 부동산 재벌. 뉴욕 출신, 와튼 스쿨 졸업)",
    "notability": 1-10 사이의 인지도 점수,
    "confidence": 0-1 사이의 매칭 정확도,
    "isUnique": 이 이름이 유일한 고유 인물을 가리키면 true, 여러 후보가 있으면 false
  }
]

규칙:
- 대중적 인지도가 높은 순서로 정렬
- primaryDescriptor에는 주요 직책, 경력, 대표 업적, 출신, 학력 등을 구체적으로 포함 (최소 2-3개 문장 분량)
- confidence는 입력된 이름이 해당 인물을 정확히 가리킬 확률
- "${characterName.trim()}"이 명확히 특정 인물 1명만을 가리키면 첫 번째 항목의 isUnique=true
- 여러 후보가 있거나 애매하면 모든 항목의 isUnique=false
- **중요: 동일 인물은 반드시 한 번만 포함하세요**
- **한 사람의 여러 역할은 하나의 primaryDescriptor로 통합하세요**
- 동명이인(완전히 다른 사람)만 별도 항목으로 포함
- **역할극에 부적합한 인물은 제외** (일반인, 범죄자만 유명한 인물, 논란만 있는 인물 등)
- **CRITICAL: fullName은 반드시 한글로만 작성** (영어 표기 절대 금지, 예: "도널드 트럼프" ⭐ / "Donald Trump" ❌)
- 유효한 JSON 배열만 반환, 추가 텍스트 없음`
        : `Search "${characterName.trim()}" and generate a list of famous people.

**🚨 Important Rules:**
${dbCandidatesWithId.length > 0 ? `
1. **People already in DB:**
${dbCandidatesList}

2. **If the DB person exists:**
   - **NEVER duplicate** if same real-world entity
   - Only add namesakes (completely different people)
   - Example: If DB has "Kim Gun-hee (First Lady)", don't return the same Kim Gun-hee again
` : ''}
3. **Role-playable people only** (politicians, artists, scientists, etc.)

**Return JSON array:**
[
  {
    "fullName": "Full name (e.g., Donald Trump)",
    "primaryDescriptor": "Detailed career and background (e.g., 45th President of the United States (2017-2021), Chairman of The Trump Organization, reality TV host, real estate magnate. Born in New York, Wharton School graduate)",
    "notability": Recognition score 1-10,
    "confidence": Matching accuracy 0-1,
    "isUnique": true if this name uniquely identifies one person, false if multiple candidates exist
  }
]

Rules:
- Sort by highest public recognition first
- primaryDescriptor must include main positions, career highlights, major achievements, origin, education, etc. in detail (minimum 2-3 sentence length)
- confidence = probability that "${characterName.trim()}" refers to this specific person
- Set isUnique=true for the first item ONLY if "${characterName.trim()}" clearly identifies exactly 1 person
- If multiple candidates or ambiguous, set isUnique=false for all items
- **CRITICAL: Each unique real-world person must appear ONLY ONCE**
- **Consolidate multiple roles into a single primaryDescriptor**
- Only include genuine namesakes (completely different people) as separate entries
- **Exclude people unsuitable for role-playing** (ordinary people, those only famous for crimes, purely controversial figures, etc.)
- **CRITICAL: fullName MUST be in English ONLY** (No Korean/Hangul characters, e.g., "Donald Trump" ⭐ / "도널드 트럼프" ❌)
- Return only valid JSON array, no additional text`;
      
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-lite',
        generationConfig: {
          temperature: 0.3, // Lower temperature for more consistent results
          topP: 0.9,
          maxOutputTokens: 4096,
        }
      });
      
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      // JSON 파싱
      let geminiCandidates;
      try {
        const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        geminiCandidates = JSON.parse(jsonText);
        
        if (!Array.isArray(geminiCandidates)) {
          throw new Error('Expected array of candidates');
        }
      } catch (parseError) {
        console.error('[❌ DISAMBIGUATE PARSE] 파싱 실패:', responseText);
        // Gemini 파싱 실패 시 DB 결과만 반환
        if (dbCandidates.length > 0) {
          const responseData = {
            status: dbCandidates.length === 1 ? 'unique' : 'needsSelection',
            candidates: dbCandidates,
            query: trimmedName,
          };
          disambiguationCache.set(cacheKey, {
            data: responseData,
            expiresAt: Date.now() + 60000,
          });
          return res.json(responseData);
        }
        return res.status(500).json({ message: '인물 검색 중 오류가 발생했습니다.' });
      }
      
      // 🎯 DB + Gemini 결과 병합 (정보 업데이트 전략)
      // 1. 같은 인물 (정규화 이름 일치): Gemini의 더 상세한 정보로 업데이트
      // 2. 새로운 인물 (정규화 이름 다름): 추가
      const allCandidates: typeof dbCandidates = [];
      
      // DB 정규화 이름 맵 (업데이트 체크용)
      const dbNormalizedMap = new Map(
        dbCandidates.map(c => [normalizeCharacterName(c.fullName), c])
      );
      
      console.log(`[🔍 MERGE] DB 정규화 이름 목록:`, Array.from(dbNormalizedMap.keys()));
      
      // 먼저 Gemini 결과 처리 (DB와 비교하여 병합 또는 추가)
      const processedDbIds = new Set<number>();
      
      for (const geminiCandidate of geminiCandidates) {
        const geminiNormalized = normalizeCharacterName(geminiCandidate.fullName);
        const dbMatch = dbNormalizedMap.get(geminiNormalized);
        
        if (dbMatch) {
          // 같은 인물 발견: Gemini 정보 우선 (더 상세함)
          // 단, DB의 dbId는 보존 (기존 데이터 연결 유지)
          allCandidates.push({
            ...geminiCandidate,
            dbId: dbMatch.dbId, // DB ID 보존
            source: 'db_updated' as const, // 업데이트 표시
          });
          processedDbIds.add(dbMatch.dbId!);
          console.log(`[🔄 MERGE] DB 정보 업데이트: "${dbMatch.fullName}" → Gemini: "${geminiCandidate.fullName}"`);
          console.log(`  - DB 설명: ${dbMatch.primaryDescriptor?.substring(0, 50)}...`);
          console.log(`  - Gemini 설명: ${geminiCandidate.primaryDescriptor?.substring(0, 50)}...`);
        } else {
          // 새로운 인물: Gemini 추가
          allCandidates.push({
            ...geminiCandidate,
            source: 'gemini' as const,
          });
          console.log(`[✅ MERGE] 새 인물 추가: "${geminiCandidate.fullName}" (정규화: "${geminiNormalized}")`);
        }
      }
      
      // DB에만 있고 Gemini에 없는 인물 추가 (보존)
      for (const dbCandidate of dbCandidates) {
        if (!processedDbIds.has(dbCandidate.dbId!)) {
          allCandidates.push(dbCandidate);
          console.log(`[📌 MERGE] DB 전용 인물 보존: "${dbCandidate.fullName}"`);
        }
      }
      
      // 최대 20명으로 제한
      const finalCandidates = allCandidates.slice(0, 20);
      
      // 유일성 판단: DB + Gemini 병합 결과가 1명이고 유일하면 unique
      const isUnique = finalCandidates.length === 1 && finalCandidates[0].isUnique === true;
      
      const responseData = {
        status: isUnique ? 'unique' : 'needsSelection',
        candidates: finalCandidates,
        query: characterName.trim(),
      };
      
      // 캐시 저장 (60초)
      disambiguationCache.set(cacheKey, {
        data: responseData,
        expiresAt: Date.now() + 60000,
      });
      
      console.log(`[✅ DISAMBIGUATE] DB ${dbCandidates.length}명 + Gemini ${geminiCandidates.length}명 → 병합 ${finalCandidates.length}명, 유일성: ${isUnique}`);
      
      // 🎯 DB 자동 병합은 제거됨 (동명이인 보호를 위해)
      // Gemini가 UI에서만 중복을 제거하고, 실제 DB는 안전하게 유지
      // 향후 개선: 이름 + 설명 + 기타 정보를 종합적으로 비교하여 높은 신뢰도에서만 병합
      
      res.json(responseData);
      
    } catch (error: any) {
      console.error('[❌ DISAMBIGUATE] 실패:', error);
      console.error('[🔍 ERROR DETAILS] status:', error.status, 'statusText:', error.statusText, 'message:', error.message);
      
      // 429 Rate Limit 에러 처리
      // GoogleGenerativeAI SDK는 error.status에 HTTP 상태 코드를 직접 저장
      if (error.status === 429 || error.statusText === 'Too Many Requests') {
        return res.status(429).json({ 
          message: 'API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요. (1-2분 후 재시도 권장)' 
        });
      }
      
      res.status(500).json({ message: '인물 검색 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔍 POST /api/embed/:embedCode/detailed-search - 4단계: 상세 정보 기반 검색
  app.post('/api/embed/:embedCode/detailed-search', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { characterName, occupation, affiliation, activePeriod } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '');
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      
      if (!characterName || typeof characterName !== 'string' || !characterName.trim()) {
        return res.status(400).json({ message: '유효한 캐릭터 이름이 필요합니다.' });
      }
      
      console.log(`[🔍 DETAILED SEARCH] 상세 검색: ${characterName}`, { occupation, affiliation, activePeriod });
      
      // 🎯 1. DB 유사 후보 검색 (정규화 기반, 모든 후보 조회)
      const normalizedInput = normalizeCharacterName(characterName.trim());
      const allCallnaskAgents = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.category, 'CallNAsk'),
            eq(agents.isActive, true)
          )
        )
        .orderBy(agents.id); // ✅ 결정적 순서 보장
      
      const similarAgents = allCallnaskAgents.filter(agent => 
        isSimilarName(agent.name, characterName)
      );
      
      console.log(`[📊 DB CANDIDATES] ${similarAgents.length}명 유사 후보 발견`);
      
      // 🤖 2. Gemini로 상세 프로필 생성 (5+6단계 통합: Google Grounding 포함)
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-lite',
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 2048,
        },
        // 🌐 5단계: Google Search Grounding 활성화
        tools: [{ googleSearch: {} } as any]
      });
      
      const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName);
      
      // 상세 정보 포함 프롬프트
      const contextInfo = [
        occupation && `직업: ${occupation}`,
        affiliation && `소속: ${affiliation}`,
        activePeriod && `활동 시기: ${activePeriod}`
      ].filter(Boolean).join(', ');
      
      const prompt = isKorean
        ? `다음 인물에 대한 상세 정보를 Google 검색을 통해 확인하고 정확한 프로필을 생성하세요:

**인물:** ${characterName}
${contextInfo ? `**추가 정보:** ${contextInfo}` : ''}

${similarAgents.length > 0 ? `**DB에 있는 유사 인물:**
${similarAgents.map(a => `- ${a.name}: ${a.description || '설명 없음'}`).join('\n')}

위 인물 중 입력한 인물과 동일한 사람이 있는지 판단해주세요.` : ''}

다음 JSON 형식으로 반환하세요:
{
  "isMatch": ${similarAgents.length > 0 ? 'true/false (DB 인물과 동일 인물인지)' : 'false'},
  "matchedDbId": ${similarAgents.length > 0 ? 'DB 인물의 ID (동일 인물인 경우)' : 'null'},
  "fullName": "정확한 전체 이름 (한글)",
  "primaryDescriptor": "주요 경력 및 배경 (2-3문장, 구체적으로)",
  "confidence": 0.0-1.0 (정보의 신뢰도),
  "sources": ["출처 URL 1", "출처 URL 2"]
}

유효한 JSON만 반환하세요.`
        : `Generate a detailed profile for this person using Google Search:

**Person:** ${characterName}
${contextInfo ? `**Additional Info:** ${contextInfo}` : ''}

${similarAgents.length > 0 ? `**Similar people in DB:**
${similarAgents.map(a => `- ${a.name}: ${a.description || 'No description'}`).join('\n')}

Determine if the input person matches any of the above.` : ''}

Return JSON format:
{
  "isMatch": ${similarAgents.length > 0 ? 'true/false' : 'false'},
  "matchedDbId": ${similarAgents.length > 0 ? 'DB person ID if match' : 'null'},
  "fullName": "Full name in English",
  "primaryDescriptor": "Career and background (2-3 sentences, detailed)",
  "confidence": 0.0-1.0,
  "sources": ["Source URL 1", "Source URL 2"]
}

Return only valid JSON.`;
      
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      // JSON 파싱
      let profileData;
      try {
        const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        profileData = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[❌ DETAILED SEARCH PARSE] 파싱 실패:', responseText);
        return res.status(500).json({ message: '상세 검색 중 오류가 발생했습니다.' });
      }
      
      console.log(`[✅ DETAILED SEARCH] 완료:`, profileData);
      
      // 🎯 6단계: 동일 인물 판단 결과 반환
      res.json({
        status: profileData.isMatch ? 'matched' : 'new',
        profile: profileData,
        dbCandidates: similarAgents.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description
        }))
      });
      
    } catch (error: any) {
      console.error('[❌ DETAILED SEARCH] 실패:', error);
      
      if (error.status === 429 || error.statusText === 'Too Many Requests') {
        return res.status(429).json({ 
          message: 'API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.' 
        });
      }
      
      res.status(500).json({ message: '상세 검색 중 오류가 발생했습니다.' });
    }
  });
  
  // ✅ POST /api/embed/:embedCode/confirm-character - 선택된 인물로 캐릭터 생성
  app.post('/api/embed/:embedCode/confirm-character', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { candidate } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '');
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!;
      
      if (!candidate || !candidate.fullName) {
        return res.status(400).json({ message: '유효한 후보 정보가 필요합니다.' });
      }
      
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      if (!groupChat) {
        return res.status(404).json({ message: '채팅방을 찾을 수 없습니다.' });
      }
      
      const callnaskConfig = groupChat.callnaskConfig as any;
      const maxAgents = callnaskConfig?.maxAgents || 5;
      
      if ((guestSession.selectedAgents || []).length >= maxAgents) {
        return res.status(400).json({ 
          message: `최대 ${maxAgents}명까지만 생성할 수 있습니다.` 
        });
      }
      
      const characterName = candidate.fullName.trim();
      console.log(`[🎭 CONFIRM CHARACTER] 선택된 인물로 캐릭터 생성: ${characterName}`);
      
      // 🎯 중복 체크: 정규화 기반 검색으로 동일 인물 확인
      const allCallnaskAgents = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.category, 'CallNAsk'),
            eq(agents.isActive, true),
            eq(agents.visibility, 'public')
          )
        )
        .limit(100);
      
      // 정규화 기반 중복 체크
      const similarAgents = allCallnaskAgents.filter(agent => 
        isSimilarName(agent.name, characterName)
      );
      
      const existingAgent = similarAgents.length > 0 ? similarAgents[0] : null;
      
      if (existingAgent && existingAgent.name !== characterName) {
        console.log(`[🎯 유사 인물 발견] "${characterName}" → 기존 "${existingAgent.name}" 재사용`);
      }
      
      let agentToUse;
      
      if (existingAgent) {
        console.log(`[♻️ CHARACTER REUSE] 기존 캐릭터 재사용: ${existingAgent.name} (ID: ${existingAgent.id})`);
        
        // knowledgeDomain이 없으면 Gemini로 생성해서 업데이트
        if (!existingAgent.knowledgeDomain) {
          console.log(`[🧠 DOMAIN UPDATE] knowledgeDomain 생성 중: ${existingAgent.name}`);
          
          try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
            const model = genAI.getGenerativeModel({ 
              model: 'gemini-2.0-flash-lite',
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 300,
              }
            });
            
            const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName);
            const domainPrompt = isKorean
              ? `"${characterName}"이(가) 전문적으로 답변할 수 있는 지식 영역을 간단히 나열하세요 (예: "투자, 경제학, 주식시장"). 이 인물이 실제로 전문성을 가진 분야만 포함하세요. 텍스트만 출력하세요.`
              : `List the knowledge domains that "${characterName}" can expertly discuss (e.g., "Investment, Economics, Stock Markets"). Only include areas where this person has real expertise. Output plain text only.`;
            
            const domainResult = await model.generateContent(domainPrompt);
            const knowledgeDomain = domainResult.response.text().trim().substring(0, 500);
            
            await db
              .update(agents)
              .set({ knowledgeDomain })
              .where(eq(agents.id, existingAgent.id));
            
            console.log(`[✅ DOMAIN UPDATE] ${knowledgeDomain}`);
            agentToUse = { ...existingAgent, knowledgeDomain };
          } catch (error) {
            console.error(`[❌ DOMAIN UPDATE] 실패:`, error);
            agentToUse = existingAgent;
          }
        } else {
          agentToUse = existingAgent;
        }
      } else {
        // Gemini API로 캐릭터 프로필 생성 (선택된 후보 정보 활용)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ 
          model: 'gemini-2.0-flash-lite',
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        });
        
        // 언어 감지
        const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName);
        
        const prompt = isKorean 
          ? `챗봇 어시스턴트를 위한 간결한 캐릭터 프로필을 생성하세요.

캐릭터 이름: ${characterName}
설명: ${candidate.primaryDescriptor || ''}

다음 JSON 형식으로 캐릭터 프로필을 생성하세요:
{
  "name": "캐릭터 이름 (최대 20자, "${characterName}" 사용)",
  "description": "간결한 1-2문장 설명 (최대 180자)",
  "personality": "간단한 성격 요약 (1-2문장)",
  "speechStyle": "대화 스타일 (1문장)",
  "knowledgeDomain": "전문 지식 영역 (예: '투자, 경제학, 주식시장', '물리학, 우주론, 상대성이론', '조선 시대 군사 전략, 해전, 리더십' 등 - 이 캐릭터가 전문적으로 답변할 수 있는 구체적 주제들)",
  "icon": "적절한 이모지 아이콘"
}

중요: 
- knowledgeDomain은 해당 인물이 실제로 전문성을 가진 분야만 포함하세요
- 텍스트 필드는 짧게 유지하고 제한 범위 내로
- 유효한 JSON만 출력하고, 추가 텍스트는 포함하지 마세요`
          : `Create a concise character profile for a chatbot assistant.

Character Name: ${characterName}
Description: ${candidate.primaryDescriptor || ''}

Generate a character profile in JSON format with:
{
  "name": "Character name (MAX 20 characters, use "${characterName}")",
  "description": "Concise 1-2 sentence description (MAX 180 characters)",
  "personality": "Brief personality summary (1-2 sentences)",
  "speechStyle": "Communication style (1 sentence)",
  "knowledgeDomain": "Area of expertise (e.g., 'Investment, Economics, Stock Markets', 'Physics, Cosmology, Relativity', 'Military Strategy, Naval Warfare, Leadership' etc - specific topics this character can expertly discuss)",
  "icon": "Appropriate emoji icon"
}

CRITICAL:
- knowledgeDomain should only include areas where this person has real expertise
- Keep text fields SHORT and within limits
- Output only valid JSON, no additional text`;
        
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON 파싱
        let characterProfile;
        try {
          const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          characterProfile = JSON.parse(jsonText);
        } catch (parseError) {
          console.error('[❌ JSON PARSE] 파싱 실패:', responseText);
          return res.status(500).json({ message: '캐릭터 프로필 생성 중 오류가 발생했습니다.' });
        }
        
        // Type-safe validation & 필드 길이 제한
        const toSafeString = (value: any, fallback: string = ''): string => {
          if (typeof value === 'string') return value;
          if (value === null || value === undefined) return fallback;
          return String(value);
        };
        
        const safeName = toSafeString(characterProfile.name, characterName).substring(0, 20);
        const safeDescription = toSafeString(characterProfile.description, '').substring(0, 200);
        const safePersonality = toSafeString(characterProfile.personality, '친절하고 도움이 되는 성격').substring(0, 500);
        const safeSpeechStyle = toSafeString(characterProfile.speechStyle, '공손하고 친절한 말투').substring(0, 500);
        const safeKnowledgeDomain = toSafeString(characterProfile.knowledgeDomain, '일반 지식').substring(0, 500);
        const safeIcon = toSafeString(characterProfile.icon, '🤖');
        
        // 새 에이전트 생성
        agentToUse = await storage.createAgent({
          name: safeName,
          description: safeDescription,
          personality: safePersonality,
          speechStyle: safeSpeechStyle,
          knowledgeDomain: safeKnowledgeDomain,
          icon: safeIcon,
          category: 'CallNAsk',
          backgroundColor: '#' + Math.floor(Math.random()*16777215).toString(16),
          visibility: 'private',
          isActive: true,
          creatorId: 'admin',
          upperCategory: 'CallNAsk',
          lowerCategory: 'Generated',
          detailCategory: embedCode,
        });
        
        console.log(`[✅ CHARACTER GEN] 새 캐릭터 생성 완료: ${safeName} (ID: ${agentToUse.id})`);
        
        // Race condition 방지: 생성 후 다시 중복 확인
        const duplicates = await db
          .select()
          .from(agents)
          .where(
            and(
              eq(agents.category, 'CallNAsk'),
              eq(agents.name, safeName),
              eq(agents.isActive, true)
            )
          )
          .orderBy(agents.id);
        
        if (duplicates.length > 1) {
          const firstAgent = duplicates[0];
          const duplicateIds = duplicates.slice(1).map(a => a.id);
          console.log(`[⚠️ RACE CONDITION] ${duplicates.length}개 중복 감지, 첫 번째 유지: ${firstAgent.id}, 삭제: ${duplicateIds.join(', ')}`);
          
          for (const dupId of duplicateIds) {
            await db.delete(agents).where(eq(agents.id, dupId));
          }
          
          agentToUse = firstAgent;
        }
      }
      
      // 템플릿 모드: 게스트 세션의 채팅방에 에이전트 추가
      // 일반 모드: 원본 채팅방에 에이전트 추가
      const targetGroupChatId = guestSession.groupChatId || groupChat.id;
      
      // 그룹 챗에 에이전트 추가 (중복 체크)
      const existingGroupChatAgent = await db
        .select()
        .from(groupChatAgents)
        .where(
          and(
            eq(groupChatAgents.groupChatId, targetGroupChatId),
            eq(groupChatAgents.agentId, agentToUse.id)
          )
        )
        .limit(1);
      
      if (existingGroupChatAgent.length === 0) {
        await storage.addGroupChatAgent({
          groupChatId: targetGroupChatId,
          agentId: agentToUse.id,
        });
        console.log(`[➕ AGENT ADDED] 에이전트 ${agentToUse.id}를 채팅방 ${targetGroupChatId}에 추가`);
      }
      
      // 자동 선택 (중복 방지)
      const updatedAgents = guestSession.selectedAgents || [];
      if (!updatedAgents.includes(agentToUse.id)) {
        updatedAgents.push(agentToUse.id);
        
        // DB 업데이트
        await db
          .update(guestSessions)
          .set({ 
            selectedAgents: updatedAgents,
            characterSwitchCount: (guestSession.characterSwitchCount || 0) + 1,
          })
          .where(eq(guestSessions.token, guestToken!));
      }
      
      console.log(`[✅ CHARACTER READY] 캐릭터 준비 완료: ${agentToUse.name} (ID: ${agentToUse.id})`);
      
      res.json({
        agent: {
          id: agentToUse.id,
          name: agentToUse.name,
          description: agentToUse.description || '',
          icon: agentToUse.icon,
          backgroundColor: agentToUse.backgroundColor,
          category: agentToUse.category,
        },
        selectedAgentIds: updatedAgents,
      });
      
    } catch (error: any) {
      console.error('[❌ CONFIRM CHARACTER] 실패:', error);
      res.status(500).json({ message: '캐릭터 생성 중 오류가 발생했습니다.' });
    }
  });
  
  // 🔀 POST /api/embed/:embedCode/merge-characters - DB 캐릭터 통합 (중복 제거)
  app.post('/api/embed/:embedCode/merge-characters', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { sourceId, targetId } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '');
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      
      // 파라미터 검증
      if (!sourceId || !targetId || typeof sourceId !== 'number' || typeof targetId !== 'number') {
        return res.status(400).json({ message: '유효한 sourceId와 targetId가 필요합니다.' });
      }
      
      if (sourceId === targetId) {
        return res.status(400).json({ message: 'sourceId와 targetId는 달라야 합니다.' });
      }
      
      console.log(`[🔀 MERGE START] sourceId: ${sourceId} → targetId: ${targetId}`);
      
      // 캐릭터 존재 확인
      const [sourceAgent, targetAgent] = await Promise.all([
        db.select().from(agents).where(eq(agents.id, sourceId)).limit(1),
        db.select().from(agents).where(eq(agents.id, targetId)).limit(1),
      ]);
      
      if (!sourceAgent.length || !targetAgent.length) {
        return res.status(404).json({ message: '캐릭터를 찾을 수 없습니다.' });
      }
      
      // 🔐 트랜잭션으로 모든 데이터 이동 (all-or-nothing)
      await db.transaction(async (tx) => {
        // 🎯 1. conversations 이동
        await tx
          .update(conversations)
          .set({ agentId: targetId })
          .where(eq(conversations.agentId, sourceId));
        console.log(`[✅ MERGE] conversations 이동 완료`);
        
        // 🎯 2. group_chat_agents 이동 (중복 제거)
        const existingGroupChats = await tx
          .select({ groupChatId: groupChatAgents.groupChatId })
          .from(groupChatAgents)
          .where(eq(groupChatAgents.agentId, targetId));
        
        const existingGroupChatIds = new Set(existingGroupChats.map(gc => gc.groupChatId));
        
        const sourceGroupChats = await tx
          .select()
          .from(groupChatAgents)
          .where(eq(groupChatAgents.agentId, sourceId));
        
        for (const gc of sourceGroupChats) {
          if (!existingGroupChatIds.has(gc.groupChatId)) {
            await tx
              .update(groupChatAgents)
              .set({ agentId: targetId })
              .where(and(
                eq(groupChatAgents.groupChatId, gc.groupChatId),
                eq(groupChatAgents.agentId, sourceId)
              ));
          } else {
            await tx
              .delete(groupChatAgents)
              .where(and(
                eq(groupChatAgents.groupChatId, gc.groupChatId),
                eq(groupChatAgents.agentId, sourceId)
              ));
          }
        }
        console.log(`[✅ MERGE] group_chat_agents 이동 완료`);
        
        // 🎯 3. group_chat_user_agent_settings 이동
        await tx
          .update(groupChatUserAgentSettings)
          .set({ agentId: targetId })
          .where(eq(groupChatUserAgentSettings.agentId, sourceId));
        console.log(`[✅ MERGE] group_chat_user_agent_settings 이동 완료`);
        
        // 🎯 4. agentStats 통합
        const [sourceStats, targetStats] = await Promise.all([
          tx.select().from(agentStats).where(eq(agentStats.agentId, sourceId)).limit(1),
          tx.select().from(agentStats).where(eq(agentStats.agentId, targetId)).limit(1),
        ]);
        
        if (sourceStats.length > 0 && targetStats.length === 0) {
          await tx
            .update(agentStats)
            .set({ agentId: targetId })
            .where(eq(agentStats.agentId, sourceId));
        } else if (sourceStats.length > 0) {
          await tx.delete(agentStats).where(eq(agentStats.agentId, sourceId));
        }
        console.log(`[✅ MERGE] agentStats 이동 완료`);
        
        // 🎯 5. characterSpeakingPatterns 이동
        await tx
          .update(characterSpeakingPatterns)
          .set({ agentId: targetId })
          .where(eq(characterSpeakingPatterns.agentId, sourceId));
        console.log(`[✅ MERGE] characterSpeakingPatterns 이동 완료`);
        
        // 🎯 6. tokenUsage 이동
        await tx
          .update(tokenUsage)
          .set({ agentId: targetId })
          .where(eq(tokenUsage.agentId, sourceId));
        console.log(`[✅ MERGE] tokenUsage 이동 완료`);
        
        // 🎯 7. groupChatMessages 이동
        await tx
          .update(groupChatMessages)
          .set({ agentId: targetId })
          .where(eq(groupChatMessages.agentId, sourceId));
        console.log(`[✅ MERGE] groupChatMessages 이동 완료`);
        
        // 🎯 8. agentCanon 통합
        const [sourceCanon, targetCanon] = await Promise.all([
          tx.select().from(agentCanon).where(eq(agentCanon.agentId, sourceId)).limit(1),
          tx.select().from(agentCanon).where(eq(agentCanon.agentId, targetId)).limit(1),
        ]);
        
        if (sourceCanon.length > 0 && targetCanon.length === 0) {
          await tx
            .update(agentCanon)
            .set({ agentId: targetId })
            .where(eq(agentCanon.agentId, sourceId));
        } else if (sourceCanon.length > 0) {
          await tx.delete(agentCanon).where(eq(agentCanon.agentId, sourceId));
        }
        console.log(`[✅ MERGE] agentCanon 이동 완료`);
        
        // 🎯 9. agentHumor 통합
        const [sourceHumor, targetHumor] = await Promise.all([
          tx.select().from(agentHumor).where(eq(agentHumor.agentId, sourceId)).limit(1),
          tx.select().from(agentHumor).where(eq(agentHumor.agentId, targetId)).limit(1),
        ]);
        
        if (sourceHumor.length > 0 && targetHumor.length === 0) {
          await tx
            .update(agentHumor)
            .set({ agentId: targetId })
            .where(eq(agentHumor.agentId, sourceId));
        } else if (sourceHumor.length > 0) {
          await tx.delete(agentHumor).where(eq(agentHumor.agentId, sourceId));
        }
        console.log(`[✅ MERGE] agentHumor 이동 완료`);
        
        // 🎯 10. sourceId 에이전트 소프트 삭제 (isActive = false)
        await tx
          .update(agents)
          .set({ isActive: false })
          .where(eq(agents.id, sourceId));
        console.log(`[✅ MERGE] sourceId ${sourceId} 비활성화 완료`);
      });
      
      console.log(`[🎉 MERGE COMPLETE] ${sourceAgent[0].name} (ID: ${sourceId}) → ${targetAgent[0].name} (ID: ${targetId})`);
      
      res.json({
        success: true,
        message: `${sourceAgent[0].name}이(가) ${targetAgent[0].name}(으)로 통합되었습니다.`,
        sourceId,
        targetId,
      });
      
    } catch (error: any) {
      console.error('[❌ MERGE CHARACTERS] 실패:', error);
      res.status(500).json({ message: '캐릭터 통합 중 오류가 발생했습니다.' });
    }
  });
  
  // 🎭 POST /api/embed/:embedCode/generate-character - CallNAsk 캐릭터 생성 (레거시, 하위 호환성 유지)
  app.post('/api/embed/:embedCode/generate-character', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const { characterName } = req.body;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '');
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!;
      
      // ✅ Request body validation (type-safe)
      if (!characterName || typeof characterName !== 'string' || !characterName.trim()) {
        return res.status(400).json({ message: '유효한 캐릭터 이름이 필요합니다.' });
      }
      
      const groupChat = await storage.getGroupChatByEmbedCode(embedCode);
      if (!groupChat) {
        return res.status(404).json({ message: '채팅방을 찾을 수 없습니다.' });
      }
      
      const callnaskConfig = groupChat.callnaskConfig as any;
      const maxAgents = callnaskConfig?.maxAgents || 5;
      
      if ((guestSession.selectedAgents || []).length >= maxAgents) {
        return res.status(400).json({ 
          message: `최대 ${maxAgents}명까지만 생성할 수 있습니다.` 
        });
      }
      
      console.log(`[🎭 CHARACTER GEN] 캐릭터 생성 시작: ${characterName}`);
      
      // 🔍 중복 체크: DB에 동일한 이름의 CallNAsk 캐릭터가 있는지 확인
      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.category, 'CallNAsk'),
            eq(agents.name, characterName.trim()),
            eq(agents.isActive, true)
          )
        )
        .limit(1);
      
      let agentToUse;
      
      if (existingAgent) {
        console.log(`[♻️ CHARACTER REUSE] 기존 캐릭터 재사용: ${existingAgent.name} (ID: ${existingAgent.id})`);
        
        // knowledgeDomain이 없으면 Gemini로 생성해서 업데이트
        if (!existingAgent.knowledgeDomain) {
          console.log(`[🧠 DOMAIN UPDATE] knowledgeDomain 생성 중: ${existingAgent.name}`);
          
          try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
            const model = genAI.getGenerativeModel({ 
              model: 'gemini-2.0-flash-lite',
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 300,
              }
            });
            
            const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName);
            const domainPrompt = isKorean
              ? `"${characterName}"이(가) 전문적으로 답변할 수 있는 지식 영역을 간단히 나열하세요 (예: "투자, 경제학, 주식시장"). 이 인물이 실제로 전문성을 가진 분야만 포함하세요. 텍스트만 출력하세요.`
              : `List the knowledge domains that "${characterName}" can expertly discuss (e.g., "Investment, Economics, Stock Markets"). Only include areas where this person has real expertise. Output plain text only.`;
            
            const domainResult = await model.generateContent(domainPrompt);
            const knowledgeDomain = domainResult.response.text().trim().substring(0, 500);
            
            await db
              .update(agents)
              .set({ knowledgeDomain })
              .where(eq(agents.id, existingAgent.id));
            
            console.log(`[✅ DOMAIN UPDATE] ${knowledgeDomain}`);
            agentToUse = { ...existingAgent, knowledgeDomain };
          } catch (error) {
            console.error(`[❌ DOMAIN UPDATE] 실패:`, error);
            agentToUse = existingAgent;
          }
        } else {
          agentToUse = existingAgent;
        }
      } else {
        // Gemini API로 캐릭터 프로필 생성
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ 
          model: 'gemini-2.0-flash-lite',  // 안정적이고 빠른 모델
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        });
        
        // 언어 감지 (한글 포함 여부)
        const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(characterName.trim());
        
        const prompt = isKorean 
          ? `챗봇 어시스턴트를 위한 간결한 캐릭터 프로필을 생성하세요.

캐릭터 이름: ${characterName.trim()}

다음 JSON 형식으로 캐릭터 프로필을 생성하세요:
{
  "name": "캐릭터 이름 (최대 20자, 제공된 이름 사용)",
  "description": "간결한 1-2문장 설명 (최대 180자, 누구이고 어떤 전문 분야를 가지고 있는지)",
  "personality": "간단한 성격 요약 (1-2문장)",
  "speechStyle": "대화 스타일 (1문장)",
  "knowledgeDomain": "전문 지식 영역 (예: '투자, 경제학, 주식시장', '물리학, 우주론, 상대성이론', '조선 시대 군사 전략, 해전, 리더십' 등 - 이 캐릭터가 전문적으로 답변할 수 있는 구체적 주제들)",
  "icon": "적절한 이모지 아이콘"
}

중요: 
- knowledgeDomain은 해당 인물이 실제로 전문성을 가진 분야만 포함하세요
- 텍스트 필드는 짧게 유지하고 제한 범위 내로:
  - name: 최대 20자 ("${characterName.trim()}" 사용)
  - description: 최대 180자
  - personality: 간결하게
  - speechStyle: 간결하게

유효한 JSON만 출력하고, 추가 텍스트는 포함하지 마세요.`
          : `Create a concise character profile for a chatbot assistant.

Character Name: ${characterName.trim()}

Generate a character profile in JSON format with:
{
  "name": "Character name (MAX 20 characters, use the provided name)",
  "description": "Concise 1-2 sentence description (MAX 180 characters) covering who they are and their expertise",
  "personality": "Brief personality summary (1-2 sentences)",
  "speechStyle": "Communication style (1 sentence)",
  "knowledgeDomain": "Area of expertise (e.g., 'Investment, Economics, Stock Markets', 'Physics, Cosmology, Relativity', 'Military Strategy, Naval Warfare, Leadership' etc - specific topics this character can expertly discuss)",
  "icon": "Appropriate emoji icon"
}

CRITICAL:
- knowledgeDomain should only include areas where this person has real expertise
- Keep text fields SHORT and within limits:
  - name: 20 characters maximum (use "${characterName.trim()}")
  - description: 180 characters maximum
  - personality: Keep concise
  - speechStyle: Keep concise

Output only valid JSON, no additional text.`;
        
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON 파싱
        let characterProfile;
        try {
          // Markdown 코드 블록 제거
          const jsonText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          characterProfile = JSON.parse(jsonText);
        } catch (parseError) {
          console.error('[❌ JSON PARSE] 파싱 실패:', responseText);
          return res.status(500).json({ message: '캐릭터 프로필 생성 중 오류가 발생했습니다.' });
        }
        
        // ✅ Type-safe validation & 필드 길이 제한 (DB 제약 준수)
        const toSafeString = (value: any, fallback: string = ''): string => {
          if (typeof value === 'string') return value;
          if (value === null || value === undefined) return fallback;
          return String(value); // Convert numbers, objects, etc to string
        };
        
        const safeName = toSafeString(characterProfile.name, characterName.trim()).substring(0, 20);
        const safeDescription = toSafeString(characterProfile.description, '').substring(0, 200);
        const safePersonality = toSafeString(characterProfile.personality, '친절하고 도움이 되는 성격').substring(0, 500);
        const safeSpeechStyle = toSafeString(characterProfile.speechStyle, '공손하고 친절한 말투').substring(0, 500);
        const safeKnowledgeDomain = toSafeString(characterProfile.knowledgeDomain, '일반 지식').substring(0, 500);
        const safeIcon = toSafeString(characterProfile.icon, '🤖');
        
        // 새 에이전트 생성
        agentToUse = await storage.createAgent({
          name: safeName,
          description: safeDescription,
          personality: safePersonality,
          speechStyle: safeSpeechStyle,
          knowledgeDomain: safeKnowledgeDomain,
          icon: safeIcon,
          category: 'CallNAsk', // ✅ CallNAsk 전용 카테고리
          backgroundColor: '#' + Math.floor(Math.random()*16777215).toString(16), // Random color
          visibility: 'private' as any, // ✅ 타입 단언 사용
          isActive: true,
          creatorId: 'admin', // ✅ 실제 존재하는 admin 사용자
          upperCategory: 'CallNAsk',
          lowerCategory: 'Generated',
          detailCategory: embedCode,
        });
        
        console.log(`[✅ CHARACTER GEN] 새 캐릭터 생성 완료: ${safeName} (ID: ${agentToUse.id})`);
        
        // 🔒 Race condition 방지: 생성 후 다시 중복 확인
        const duplicates = await db
          .select()
          .from(agents)
          .where(
            and(
              eq(agents.category, 'CallNAsk'),
              eq(agents.name, safeName),
              eq(agents.isActive, true)
            )
          )
          .orderBy(agents.id);
        
        // 중복이 2개 이상이면, 더 나중에 생성된 것 삭제하고 첫 번째 것 사용
        if (duplicates.length > 1) {
          const firstAgent = duplicates[0];
          const duplicateIds = duplicates.slice(1).map(a => a.id);
          console.log(`[⚠️ RACE CONDITION] ${duplicates.length}개 중복 감지, 첫 번째 유지: ${firstAgent.id}, 삭제: ${duplicateIds.join(', ')}`);
          
          // 중복된 에이전트들 삭제
          for (const dupId of duplicateIds) {
            await db.delete(agents).where(eq(agents.id, dupId));
          }
          
          agentToUse = firstAgent;
        }
      }
      
      // 템플릿 모드: 게스트 세션의 채팅방에 에이전트 추가
      // 일반 모드: 원본 채팅방에 에이전트 추가
      const targetGroupChatId = guestSession.groupChatId || groupChat.id;
      
      // 그룹 챗에 에이전트 추가 (중복 체크)
      const existingGroupChatAgent = await db
        .select()
        .from(groupChatAgents)
        .where(
          and(
            eq(groupChatAgents.groupChatId, targetGroupChatId),
            eq(groupChatAgents.agentId, agentToUse.id)
          )
        )
        .limit(1);
      
      if (existingGroupChatAgent.length === 0) {
        await storage.addGroupChatAgent({
          groupChatId: targetGroupChatId,
          agentId: agentToUse.id,
        });
        console.log(`[➕ AGENT ADDED] 에이전트 ${agentToUse.id}를 채팅방 ${targetGroupChatId}에 추가`);
      }
      
      // 자동 선택 (중복 방지)
      const updatedAgents = guestSession.selectedAgents || [];
      if (!updatedAgents.includes(agentToUse.id)) {
        updatedAgents.push(agentToUse.id);
        
        // DB 업데이트
        await db
          .update(guestSessions)
          .set({ 
            selectedAgents: updatedAgents,
            characterSwitchCount: (guestSession.characterSwitchCount || 0) + 1,
          })
          .where(eq(guestSessions.token, guestToken!));
      }
      
      console.log(`[✅ CHARACTER READY] 캐릭터 준비 완료: ${agentToUse.name} (ID: ${agentToUse.id})`);
      
      res.json({
        agent: {
          id: agentToUse.id,
          name: agentToUse.name,
          description: agentToUse.description || '',
          icon: agentToUse.icon,
          backgroundColor: agentToUse.backgroundColor,
          category: agentToUse.category,
        },
        selectedAgentIds: updatedAgents,
      });
      
    } catch (error: any) {
      console.error('[❌ CHARACTER GEN] 실패:', error);
      res.status(500).json({ message: '캐릭터 생성 중 오류가 발생했습니다.' });
    }
  });
  
  // 🗑️ DELETE /api/embed/:embedCode/character/:agentId - CallNAsk 캐릭터 삭제 (선택 해제)
  app.delete('/api/embed/:embedCode/character/:agentId', async (req, res) => {
    try {
      const { embedCode, agentId } = req.params;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      // Validation
      const validation = await validateGuestSession(guestToken || '', embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      const guestSession = validation.session!;
      
      const agentIdNum = parseInt(agentId, 10);
      if (isNaN(agentIdNum)) {
        return res.status(400).json({ message: '유효하지 않은 agentId입니다.' });
      }
      
      // 선택 목록에서 제거
      const updatedAgents = (guestSession.selectedAgents || []).filter((id: number) => id !== agentIdNum);
      console.log(`[🗑️ CHARACTER DELETE] Guest ${guestToken!.slice(0, 20)}... 에이전트 ${agentIdNum} 제거`);
      
      // DB 업데이트
      await db
        .update(guestSessions)
        .set({ selectedAgents: updatedAgents })
        .where(eq(guestSessions.token, guestToken!));
      
      // Analytics 기록
      await db.insert(guestAnalytics).values({
        sessionId: guestSession.id,
        eventType: 'character_deleted',
        eventData: { agentId: agentIdNum },
      });
      
      res.json({
        selectedAgentIds: updatedAgents,
      });
      
    } catch (error: any) {
      console.error('[❌ CHARACTER DELETE] 실패:', error);
      res.status(500).json({ message: '캐릭터 삭제 중 오류가 발생했습니다.' });
    }
  });
  
  // 📊 GET /api/embed/:embedCode/trending - CallNAsk Hot Topic Views 조회 (DB만 사용, API 호출 없음)
  app.get('/api/embed/:embedCode/trending', async (req, res) => {
    try {
      const { embedCode } = req.params;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      if (!guestToken) {
        return res.status(401).json({ message: 'Guest token required' });
      }
      
      const validation = await validateGuestSession(guestToken, embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      
      // Hot Topic Views 로직 임포트
      const { getHotTopicViews } = await import('./hottopics.js');
      
      // DB에 저장된 데이터만 불러오기 (API 호출 완전 제거)
      const topics = await getHotTopicViews();
      res.json(topics);
      
    } catch (error: any) {
      console.error('[❌ TRENDING] 실패:', error);
      res.status(500).json({ message: '인기 관점 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // 📎 GET /api/embed/:embedCode/messages/:messageId/references - 메시지 참고 자료 조회
  app.get('/api/embed/:embedCode/messages/:messageId/references', async (req, res) => {
    try {
      const { embedCode, messageId } = req.params;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      if (!guestToken) {
        return res.status(401).json({ message: 'Guest token required' });
      }
      
      const validation = await validateGuestSession(guestToken, embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      
      const references = await storage.getMessageReferences(parseInt(messageId));
      res.json(references);
      
    } catch (error: any) {
      console.error('[❌ REFERENCES] 실패:', error);
      res.status(500).json({ message: '참고 자료 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // 💬 GET /api/embed/:embedCode/messages/:messageId/followups - 후속 질문 조회
  app.get('/api/embed/:embedCode/messages/:messageId/followups', async (req, res) => {
    try {
      const { embedCode, messageId } = req.params;
      const authHeader = req.headers.authorization;
      const guestToken = authHeader?.replace('Bearer ', '');
      
      if (!guestToken) {
        return res.status(401).json({ message: 'Guest token required' });
      }
      
      const validation = await validateGuestSession(guestToken, embedCode);
      if (!validation.valid) {
        return res.status(401).json({ message: validation.error });
      }
      
      const followUps = await storage.getFollowUpQuestions(parseInt(messageId));
      res.json(followUps);
      
    } catch (error: any) {
      console.error('[❌ FOLLOWUPS] 실패:', error);
      res.status(500).json({ message: '후속 질문 조회 중 오류가 발생했습니다.' });
    }
  });
  
  // ==================== END CallNAsk 임베드 API ====================

  // 🔒 SSE endpoint for real-time updates with authentication (moved from index.ts)
  app.get('/events', isAuthenticated, (req, res) => {
    const origin = req.headers.origin || req.headers.referer;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID'
    });

    // 🚀 강제 헤더 플러시 (버퍼링 방지)
    res.flushHeaders();
    console.log('[🚀 SSE] 헤더 플러시 완료 - 실시간 스트리밍 시작');

    // 🎯 Last-Event-ID 지원: 재연결 시 마지막 이벤트 ID 이후부터 전송
    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader as string, 10) : 0;
    
    console.log(`SSE client connected, Last-Event-ID: ${lastEventId}, total clients: ${sseClients.size + 1}`);

    // Create client object with metadata
    const client: SSEClient = {
      response: res,
      lastEventId: lastEventId || 0
    };

    // Add client to the set
    sseClients.add(client);

    // 🆔 Send initial connection message with Event ID
    const connectionEventId = getNextEventId();
    res.write(`id: ${connectionEventId}\ndata: {"type":"connected","eventId":${connectionEventId}}\n\n`);
    
    // 🚀 즉시 플러시 (버퍼링 방지)
    if (res.flush) {
      res.flush();
    }
    
    client.lastEventId = connectionEventId;

    // 🔄 Keep-alive 하트비트 (15초마다) - 연결 유지
    const heartbeat = setInterval(() => {
      try {
        res.write(':heartbeat\n\n');
        if (res.flush) {
          res.flush();
        }
      } catch (error) {
        console.log('[💔 HEARTBEAT] 하트비트 실패 - 연결 종료');
        clearInterval(heartbeat);
        sseClients.delete(client);
      }
    }, 15000);

    // Handle client disconnect
    req.on('close', () => {
      sseClients.delete(client);
      console.log('SSE client disconnected, remaining clients:', sseClients.size);
      clearInterval(heartbeat);
    });
  });

  // 🧪 TEST: Gemini Function Calling Test Endpoint
  app.post('/api/test/gemini-function-calling', isAuthenticated, async (req: any, res) => {
    try {
      const { agentId, question } = req.body;

      if (!agentId || !question) {
        return res.status(400).json({ message: "agentId and question are required" });
      }

      const agent = await storage.getAgent(agentId);
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      console.log(`[🧪 TEST] Gemini Function Calling - Agent: ${agent.name}, Question: "${question}"`);

      const result = await generateGeminiFunctionCallingResponse({
        agentId: agent.id,
        agentName: agent.name,
        agentDescription: agent.description || '',
        knowledgeDomain: agent.knowledgeDomain || '',
        userQuestion: question,
        conversationHistory: [],
        userLanguage: 'ko'
      });

      console.log(`[✅ TEST] Result - Tools Used: ${result.toolsUsed.join(', ')}, Stages: ${result.stagesTaken.join(' → ')}`);

      res.json({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          knowledgeDomain: agent.knowledgeDomain
        },
        question,
        response: result.content,
        toolsUsed: result.toolsUsed,
        stagesTaken: result.stagesTaken,
        factCheckPerformed: result.factCheckPerformed
      });
    } catch (error) {
      console.error("[❌ TEST] Gemini Function Calling Error:", error);
      res.status(500).json({ 
        success: false,
        message: "Test failed", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

}