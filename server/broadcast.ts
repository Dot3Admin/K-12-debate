// 🚀 브로드캐스트 단일화 & 이벤트 ID 시스템
// 순환 참조 방지를 위해 별도 파일로 분리

export interface SSEClient {
  response: any;
  lastEventId: number;
}

export interface BroadcastEvent {
  id: number;
  type: string;
  data: any;
  timestamp: string;
}

// Store connected SSE clients with metadata
export const sseClients = new Set<SSEClient>();

// 🆔 단조 증가 Event ID 시스템
let globalEventId = Date.now(); // ISO timestamp 기반 시작점

// 🚫 브로드캐스트 중복 방지 LRU Set (messageId/turnId 기반)
const broadcastedEventIds = new Set<string>();
const MAX_BROADCAST_CACHE = 1000;

// 🧹 오래된 브로드캐스트 이벤트 정리
export function cleanupOldBroadcastEvents() {
  if (broadcastedEventIds.size > MAX_BROADCAST_CACHE) {
    console.log(`[🧹 이벤트 정리] ${broadcastedEventIds.size}개 → ${MAX_BROADCAST_CACHE}개로 정리`);
    broadcastedEventIds.clear(); // 간단한 전체 정리 (실제론 LRU 방식 권장)
  }
}

// 🆔 다음 Event ID 생성
export function getNextEventId(): number {
  return ++globalEventId;
}

// 🚀 강화된 브로드캐스트 함수: Event ID + 중복 방지
export function broadcastWithEventId(eventType: string, eventData: any, uniqueKey?: string): number {
  console.log(`[📡 BROADCAST CALLED] 타입: ${eventType}, uniqueKey: ${uniqueKey}, 현재 클라이언트: ${sseClients.size}개`);
  
  // 🚫 중복 방지: uniqueKey가 있다면 이미 브로드캐스트된 것인지 확인
  if (uniqueKey && broadcastedEventIds.has(uniqueKey)) {
    console.log(`[🚫 BROADCAST DUPLICATE] ${uniqueKey} already sent - skipping`);
    return 0;
  }

  const eventId = getNextEventId();
  const message = JSON.stringify({
    type: eventType,
    eventId,
    timestamp: new Date().toISOString(),
    ...eventData
  });
  
  // 🚀 FIX: onmessage 핸들러와 호환되도록 기본 message 이벤트 사용
  const messageData = `id: ${eventId}\ndata: ${message}\n\n`;
  
  let successCount = 0;
  const clientsToRemove: SSEClient[] = [];
  
  sseClients.forEach((client) => {
    try {
      client.response.write(messageData);
      
      // 🚀 즉시 플러시 (버퍼링 방지)
      if (client.response.flush) {
        client.response.flush();
      }
      
      client.lastEventId = eventId;
      successCount++;
    } catch (error) {
      // Mark dead connections for removal
      clientsToRemove.push(client);
    }
  });
  
  // Remove dead connections
  clientsToRemove.forEach(client => sseClients.delete(client));
  
  // 🚫 중복 방지: uniqueKey 등록 (성공적으로 브로드캐스트된 경우에만)
  if (uniqueKey && successCount > 0) {
    broadcastedEventIds.add(uniqueKey);
    cleanupOldBroadcastEvents();
    console.log(`[✅ BROADCAST SUCCESS] eventId=${eventId}, type=${eventType}, clients=${successCount}, key=${uniqueKey}`);
  } else if (successCount > 0) {
    console.log(`[✅ BROADCAST SUCCESS] eventId=${eventId}, type=${eventType}, clients=${successCount}`);
  } else {
    console.log(`[❌ BROADCAST FAILED] eventId=${eventId}, type=${eventType}, no active clients`);
  }
  
  return eventId;
}

// Broadcast function for sending updates to all clients
export function broadcastAgentUpdate(agentId: number, updateData: any) {
  return broadcastWithEventId('agent_update', {
    agentId,
    data: updateData
  }, `agent_update_${agentId}`);
}

// Broadcast function for group chat deletion
export function broadcastGroupChatDeleted(groupChatId: number, memberIds: string[]) {
  return broadcastWithEventId('group_chat_deleted', {
    groupChatId,
    memberIds
  }, `group_chat_deleted_${groupChatId}`);
}

// 🚫 타이핑 상태 중복 방지를 위한 상태 추적
const typingStatusCache = new Map<string, { status: string, timestamp: number }>();
const TYPING_STATUS_THROTTLE = 500; // 500ms 내 동일한 상태는 중복 차단

// Broadcast group chat status updates with enhanced duplicate prevention
export function broadcastGroupChatStatus(groupChatId: number, status: 'typing_start' | 'typing_end', botInfo?: {name: string, icon?: string, backgroundColor?: string}) {
  const statusKey = `${groupChatId}_${status}`;
  const now = Date.now();
  
  // 🚫 타이핑 상태 중복 방지: 짧은 시간 내 동일한 상태는 차단
  const cachedStatus = typingStatusCache.get(statusKey);
  if (cachedStatus && (now - cachedStatus.timestamp) < TYPING_STATUS_THROTTLE) {
    console.log(`[🚫 TYPING THROTTLE] ${statusKey} within ${TYPING_STATUS_THROTTLE}ms - skipping`);
    return 0;
  }
  
  // 상태 캐시 업데이트
  typingStatusCache.set(statusKey, { status, timestamp: now });
  
  // 🧹 오래된 타이핑 상태 정리 (1분 이상된 것들)
  for (const [key, value] of Array.from(typingStatusCache.entries())) {
    if (now - value.timestamp > 60000) { // 1분
      typingStatusCache.delete(key);
    }
  }
  
  return broadcastWithEventId('group_chat_status', {
    groupChatId,
    status,
    botInfo
  }, `group_chat_status_${groupChatId}_${status}_${Math.floor(now / TYPING_STATUS_THROTTLE)}`);
}

// 🚀 NEW: 개별 메시지 실시간 브로드캐스트 (핵심 수정)
export function broadcastGroupChatMessage(groupChatId: number, messageData: any) {
  const messageKey = `group_chat_message_${groupChatId}_${messageData.id}`;
  
  console.log(`[🚀 MESSAGE BROADCAST] 그룹채팅 ${groupChatId} - 메시지 ${messageData.id} 실시간 전송`);
  
  return broadcastWithEventId('group_chat_message', {
    groupChatId,
    message: messageData
  }, messageKey);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎬 Step 43: Streaming Chunk Broadcast (타이핑 효과)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 스트리밍 청크 브로드캐스트 - 타이핑 효과를 위해 텍스트를 청크 단위로 전송
 * 프론트엔드의 agentStreaming 이벤트 핸들러와 연동
 */
export function broadcastStreamingChunk(
  groupChatId: number,
  data: {
    agentId: number | null;
    agentName: string;
    agentIcon?: string;
    agentColor?: string;
    partialContent: string;
    userTurnId: number;
  }
) {
  // agentId가 null이면 가상 ID 부여 (앵커용)
  const effectiveAgentId = data.agentId ?? -1; // -1 = 앵커/진행자
  
  return broadcastWithEventId('agent_streaming_chunk', {
    groupChatId,
    agentId: effectiveAgentId,
    agentName: data.agentName,
    agentIcon: data.agentIcon || '🎙️',
    agentColor: data.agentColor || '#6B7280',
    partialContent: data.partialContent,
    userTurnId: data.userTurnId
  });
  // uniqueKey 생략 - 스트리밍은 중복 체크 불필요
}

/**
 * 텍스트를 청크 단위로 스트리밍 전송 (누적 텍스트 방식)
 * 
 * 🎬 Step 43 Fix: 각 청크마다 **누적된 전체 텍스트**를 전송
 * - 순서 보장: 프론트엔드는 단순히 partialContent를 교체하면 됨
 * - 깜빡임 방지: 누락된 청크가 있어도 문제 없음
 * 
 * @param text 전송할 전체 텍스트
 * @param chunkSize 청크 크기 (기본: 10자)
 * @param delayMs 청크 간 딜레이 (기본: 30ms)
 */
export async function streamTextToClient(
  groupChatId: number,
  text: string,
  agentInfo: {
    agentId: number | null;
    agentName: string;
    agentIcon?: string;
    agentColor?: string;
    userTurnId: number;
  },
  options: { chunkSize?: number; delayMs?: number } = {}
): Promise<void> {
  const { chunkSize = 10, delayMs = 30 } = options;
  
  // 청크 개수 계산
  const totalChunks = Math.ceil(text.length / chunkSize);
  
  console.log(`[🎬 STREAM] 시작: ${text.length}자 → ${totalChunks}개 청크 (${chunkSize}자씩, ${delayMs}ms 딜레이)`);
  
  // 🎬 누적 방식: 매번 전체 텍스트를 0부터 현재까지 전송
  for (let i = 0; i < totalChunks; i++) {
    const endIndex = Math.min((i + 1) * chunkSize, text.length);
    const cumulativeText = text.slice(0, endIndex);
    
    broadcastStreamingChunk(groupChatId, {
      ...agentInfo,
      partialContent: cumulativeText  // 누적된 전체 텍스트
    });
    
    // 마지막 청크가 아니면 딜레이
    if (i < totalChunks - 1 && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.log(`[🎬 STREAM] 완료: ${agentInfo.agentName}`);
  
  // 🎬 Step 43 Fix: 스트리밍 완료 신호 발송
  broadcastStreamingComplete(groupChatId, {
    agentId: agentInfo.agentId,
    agentName: agentInfo.agentName,
    userTurnId: agentInfo.userTurnId,
    finalLength: text.length
  });
}

/**
 * 🎬 Step 43: 스트리밍 완료 신호
 * 특정 에이전트의 스트리밍이 완료되었음을 알림 (프론트엔드에서 streamingByTurn 정리용)
 */
export function broadcastStreamingComplete(
  groupChatId: number,
  data: {
    agentId: number | null;
    agentName: string;
    userTurnId: number;
    finalLength: number;
  }
) {
  const effectiveAgentId = data.agentId ?? -1;
  
  console.log(`[🎬 STREAM COMPLETE] ${data.agentName} (${data.finalLength}자)`);
  
  return broadcastWithEventId('agent_streaming_complete', {
    groupChatId,
    agentId: effectiveAgentId,
    agentName: data.agentName,
    userTurnId: data.userTurnId,
    finalLength: data.finalLength
  });
}
