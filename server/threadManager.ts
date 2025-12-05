import OpenAI from 'openai';
import { storage } from './storage';
import { CharacterState, ScenarioSummary } from '@shared/schema';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TOKEN_LIMIT = 2000;
const SUMMARY_TOKEN_TARGET = 400;

export function estimateTokenCount(text: string): number {
  const koreanCharCount = (text.match(/[\u3131-\uD79D]/g) || []).length;
  const otherCharCount = text.length - koreanCharCount;
  
  // 🔧 더 정확한 토큰 계산 (OpenAI 실제 토큰과 유사하게)
  // 한글: 1글자 ≈ 2.5 토큰, 영문: 1글자 ≈ 0.4 토큰 (단어 기준)
  return Math.ceil(koreanCharCount * 2.5 + otherCharCount * 0.4);
}

export function countThreadTokens(messages: any[]): number {
  let totalTokens = 0;
  
  for (const msg of messages) {
    const senderPrefix = msg.senderId ? 'User: ' : (msg.agentId ? 'Agent: ' : 'System: ');
    totalTokens += estimateTokenCount(senderPrefix + msg.content);
  }
  
  return totalTokens;
}

// 🎯 구조화된 시나리오 요약 생성 (캐릭터 상태 + 스토리 요약)
export async function generateStructuredSummary(
  groupChatId: number,
  messages: any[]
): Promise<ScenarioSummary> {
  try {
    // 에이전트 정보 조회
    const groupAgents = await storage.getGroupChatAgents(groupChatId);
    const agentNames = groupAgents?.map(a => a.name) || [];
    
    // 대화 텍스트 생성
    const conversationText = messages.map(msg => {
      if (msg.senderId) {
        return `User: ${msg.content}`;
      } else if (msg.agentId) {
        const agentName = msg.agent?.name || `Agent ${msg.agentId}`;
        return `${agentName}: ${msg.content}`;
      } else {
        return `System: ${msg.content}`;
      }
    }).join('\n');

    // 구조화된 요약 생성 프롬프트
    const summaryPrompt = `다음 대화를 구조화된 형태로 요약해주세요. 반드시 JSON 형식으로 응답하세요.

참여 캐릭터: ${agentNames.join(', ')}

대화 내용:
${conversationText}

다음 JSON 형식으로 응답하세요:
{
  "storySummary": "전체 스토리 요약 (사건 전개, 주요 결론)",
  "characterStates": [
    {
      "name": "캐릭터 이름",
      "style": "말투/스타일 특징",
      "currentRelations": {"다른캐릭터": "관계변화"},
      "emotionalState": "현재 감정 상태"
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "당신은 대화를 구조화된 형태로 요약하는 전문가입니다. 캐릭터별 상태, 관계 변화, 감정을 추적하며 JSON 형식으로 요약합니다."
        },
        {
          role: "user",
          content: summaryPrompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.3
    });

    const summaryData = JSON.parse(response.choices[0]?.message?.content || '{}');
    
    return {
      storySummary: summaryData.storySummary || "요약 생성 실패",
      characterStates: summaryData.characterStates || [],
      turnCount: messages.length,
      lastUpdatedAt: new Date()
    };
  } catch (error) {
    console.error('[🎯 STRUCTURED SUMMARY ERROR]:', error);
    // 폴백: 기본 구조 반환
    return {
      storySummary: "요약 생성 중 오류 발생",
      characterStates: [],
      turnCount: messages.length,
      lastUpdatedAt: new Date()
    };
  }
}

export async function summarizeThread(groupChatId: number): Promise<void> {
  try {
    console.log(`[🔄 THREAD SUMMARIZATION] Starting for group chat ${groupChatId}`);
    
    const messages = await storage.getGroupChatMessages(groupChatId);
    
    if (messages.length === 0) {
      console.log(`[🔄 THREAD SUMMARIZATION] No messages to summarize`);
      return;
    }
    
    const totalTokens = countThreadTokens(messages);
    console.log(`[🔄 THREAD SUMMARIZATION] Current tokens: ${totalTokens}`);
    
    if (totalTokens <= TOKEN_LIMIT) {
      console.log(`[🔄 THREAD SUMMARIZATION] Token count ${totalTokens} is below limit ${TOKEN_LIMIT}, no summarization needed`);
      return;
    }
    
    // 🎯 요약할 메시지 범위 결정 (전체 메시지의 70%)
    const messagesNeededToSummarize = Math.ceil(messages.length * 0.7);
    const messagesToSummarize = messages.slice(0, messagesNeededToSummarize);
    
    if (messagesToSummarize.length === 0) {
      console.log(`[🔄 THREAD SUMMARIZATION] No messages to summarize`);
      return;
    }
    
    // 🎯 구조화된 요약 생성
    const structuredSummary = await generateStructuredSummary(groupChatId, messagesToSummarize);
    
    console.log(`[🔄 THREAD SUMMARIZATION] Summary created: ${structuredSummary.storySummary.substring(0, 100)}...`);
    
    // DB에 시나리오 요약 저장 (내부용 - AI 프롬프트에 활용)
    await storage.saveScenarioSummary({
      groupChatId,
      storySummary: structuredSummary.storySummary,
      characterStates: structuredSummary.characterStates,
      turnCount: messages.length
    });
    
    // 오래된 요약 정리 (최신 3개만 유지)
    await storage.deleteOldScenarioSummaries(groupChatId, 3);
    
    console.log(`[🎯 시나리오 요약] 그룹 채팅 ${groupChatId}에 요약 저장 완료 (메시지 ${messagesToSummarize.length}/${messages.length}개 요약)`);
    
  } catch (error) {
    console.error('[🔄 THREAD SUMMARIZATION ERROR]:', error);
    throw error;
  }
}

export async function checkAndTrimThread(groupChatId: number): Promise<void> {
  try {
    const messages = await storage.getGroupChatMessages(groupChatId);
    const totalTokens = countThreadTokens(messages);
    
    if (totalTokens <= TOKEN_LIMIT) {
      return; // 토큰 제한 이하면 요약 불필요
    }
    
    // 🔒 중복 실행 방지: 최근 요약 확인
    const latestSummary = await storage.getLatestScenarioSummary(groupChatId);
    
    if (latestSummary) {
      const messagesSinceLastSummary = messages.length - latestSummary.turnCount;
      
      // 마지막 요약 이후 메시지가 5개 미만이면 스킵 (불필요한 재요약 방지)
      if (messagesSinceLastSummary < 5) {
        console.log(`[🔄 AUTO-TRIM] 최근 요약 존재 (메시지 ${messagesSinceLastSummary}개 증가) - 요약 스킵`);
        return;
      }
    }
    
    console.log(`[🔄 AUTO-TRIM] Thread ${groupChatId} exceeds ${TOKEN_LIMIT} tokens (${totalTokens}), triggering summarization`);
    await summarizeThread(groupChatId);
  } catch (error) {
    console.error('[🔄 AUTO-TRIM ERROR]:', error);
  }
}
