import { useEffect, useRef, useReducer } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';

interface MessageWithSequence {
  groupChatId: number;
  message: any;
  sequence: number;
  eventId: string;
}

interface MessageState {
  pendingMessages: Map<string, MessageWithSequence>;
  lastProcessedSequence: number;
}

type MessageAction = 
  | { type: 'ADD_MESSAGE'; payload: MessageWithSequence }
  | { type: 'PROCESS_MESSAGE'; payload: { eventId: string; sequence: number } }
  | { type: 'CLEAR_ALL' };

function messageReducer(state: MessageState, action: MessageAction): MessageState {
  switch (action.type) {
    case 'ADD_MESSAGE': {
      const newPending = new Map(state.pendingMessages);
      newPending.set(action.payload.eventId, action.payload);
      return {
        ...state,
        pendingMessages: newPending
      };
    }
    case 'PROCESS_MESSAGE': {
      const newPending = new Map(state.pendingMessages);
      newPending.delete(action.payload.eventId);
      return {
        ...state,
        pendingMessages: newPending,
        lastProcessedSequence: action.payload.sequence
      };
    }
    case 'CLEAR_ALL': {
      return {
        pendingMessages: new Map(),
        lastProcessedSequence: -1
      };
    }
    default:
      return state;
  }
}

export function useSSE(isAuthenticated: boolean, currentUserId?: string) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const sequenceCounterRef = useRef<number>(0);
  const currentUserIdRef = useRef<string | undefined>(currentUserId);
  
  // Update ref when currentUserId changes (but don't trigger reconnection)
  currentUserIdRef.current = currentUserId;
  
  const [messageState, dispatch] = useReducer(messageReducer, {
    pendingMessages: new Map(),
    lastProcessedSequence: -1
  });

  useEffect(() => {
    console.log('[🔄 SSE EFFECT] useEffect 실행 - isAuthenticated:', isAuthenticated, 'currentUserId:', currentUserIdRef.current);
    
    if (!isAuthenticated) {
      if (eventSourceRef.current) {
        console.log('[🔒 SSE] 인증 안됨 - 기존 연결 종료');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      dispatch({ type: 'CLEAR_ALL' });
      return;
    }

    if (eventSourceRef.current) {
      console.log('[✅ SSE] 이미 연결되어 있음 - 스킵');
      return;
    }

    console.log('[🚀 SSE] 새 EventSource 연결 시작...');
    const eventSource = new EventSource('/events');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[🔗 SSE OPENED] Connection established for real-time updates');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[📨 SSE RECEIVED] Type: ${data.type}, Event ID: ${data.eventId}`);
        
        if (data.type === 'agent_update') {
          queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
          queryClient.invalidateQueries({ queryKey: ['/api/admin/agents'] });
          queryClient.invalidateQueries({ queryKey: ['/api/agents/managed'] });
          queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
          
          console.log(`실시간 에이전트 아이콘 업데이트 수신됨 (에이전트 ID: ${data.agentId})`);
        } else if (data.type === 'agent_streaming_chunk') {
          // 🎬 실시간 타이핑: 부분 응답 수신
          const { groupChatId, agentId, agentName, agentIcon, agentColor, partialContent, userTurnId } = data;
          
          console.log(`[🎬 SSE STREAMING] ${agentName} 부분 응답: ${partialContent.length}자`);
          
          // 커스텀 이벤트로 컴포넌트에 전달 (실시간 업데이트)
          const streamingEvent = new CustomEvent('agentStreaming', {
            detail: {
              groupChatId,
              agentId,
              agentName,
              agentIcon,
              agentColor,
              partialContent,
              userTurnId
            }
          });
          window.dispatchEvent(streamingEvent);
        } else if (data.type === 'agent_streaming_complete') {
          // 🎬 Step 43: 스트리밍 완료 신호 - streamingByTurn 정리
          const { groupChatId, agentId, agentName, userTurnId, finalLength } = data;
          
          console.log(`[🎬 SSE COMPLETE] ${agentName} 스트리밍 완료 (${finalLength}자)`);
          
          // 커스텀 이벤트로 컴포넌트에 전달 (스트리밍 정리)
          const completeEvent = new CustomEvent('agentStreamingComplete', {
            detail: {
              groupChatId,
              agentId,
              agentName,
              userTurnId,
              finalLength
            }
          });
          window.dispatchEvent(completeEvent);
        } else if (data.type === 'group_chat_message') {
          const { groupChatId, message } = data;
          
          // 🚫 내가 보낸 사용자 메시지만 SSE 무시 (낙관적 업데이트 이미 처리됨)
          // senderId가 있으면 사용자 메시지, agentId가 있으면 AI 메시지
          const isUserMessage = !!message.senderId;
          const isMyMessage = message.senderId === currentUserIdRef.current;
          
          if (isUserMessage && isMyMessage) {
            console.log(`[🚫 SSE SKIP] 내가 보낸 사용자 메시지는 낙관적 업데이트로 이미 처리됨 - 메시지 ID: ${message.id}, senderId: ${message.senderId}`);
            return;
          }
          
          // ✅ 다른 사람이 보낸 사용자 메시지는 표시
          if (isUserMessage && !isMyMessage) {
            console.log(`[📨 SSE 다른 사용자 메시지] 사용자 ${message.senderId}의 메시지 수신 - 메시지 ID: ${message.id}`);
          }
          
          if (!message.messageKey && message.agentId && message.userTurnId) {
            const turnIndex = message.replyOrder || 0;
            message.messageKey = `${groupChatId}:${message.userTurnId}:${message.agentId}:${turnIndex}`;
          }
          
          const sequence = sequenceCounterRef.current++;
          const eventId = data.eventId || `${groupChatId}_${message.id}_${sequence}`;
          
          console.log(`[🚀 SSE MESSAGE] 그룹채팅 ${groupChatId} - 메시지 ${message.id} 수신 (seq: ${sequence}, key: ${message.messageKey})`);
          
          dispatch({
            type: 'ADD_MESSAGE',
            payload: { groupChatId, message, sequence, eventId }
          });
        } else if (data.type === 'group_chat_deleted') {
          // 그룹 채팅 삭제 이벤트 처리
          console.log(`[🗑️ SSE DELETE] 그룹채팅 ${data.groupChatId} 삭제됨`);
          
          // 그룹 채팅 목록에서 삭제된 채팅 제거 (부드러운 UI 업데이트)
          queryClient.setQueryData(["/api/group-chats"], (oldData: any) => {
            if (!oldData) return [];
            return oldData.filter((chat: any) => chat.id !== data.groupChatId);
          });
          
          // 그룹 채팅 목록 쿼리 무효화
          queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
          
          // 커스텀 이벤트로 컴포넌트에 전달
          const customEvent = new CustomEvent('groupChatDeleted', {
            detail: {
              groupChatId: data.groupChatId,
              memberIds: data.memberIds,
              timestamp: data.timestamp
            }
          });
          window.dispatchEvent(customEvent);
        } else if (data.type === 'chat_list_update') {
          // 📡 채팅 목록 업데이트 이벤트 처리
          console.log(`[📡 SSE CHAT LIST] 채팅방 ${data.groupChatId} 목록 업데이트 수신`);
          
          // 채팅 목록 쿼리들 무효화하여 실시간 업데이트
          queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
          queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
          
          // ⚠️ 메시지 목록은 절대 invalidate하지 않음
          // - 사용자/챗봇 메시지는 이미 group_chat_message SSE 이벤트로 실시간 추가됨
          // - 시스템 메시지도 group_chat_message 이벤트로 전송됨
          // - Invalidate하면 optimistic update가 깜빡이고 스크롤이 점프함
          
          console.log(`[✅ CHAT LIST ONLY] 메시지 목록은 SSE로만 업데이트 - 깜빡임 방지`);
        } else if (data.type === 'group_chat_status') {
          // 🎯 타이핑 상태 이벤트를 커스텀 이벤트로 전달하여 GroupChat 컴포넌트에서 처리
          console.log(`[🎯 SSE STATUS] 그룹채팅 ${data.groupChatId} 상태: ${data.status}`);
          
          const customEvent = new CustomEvent('groupChatStatus', {
            detail: data
          });
          window.dispatchEvent(customEvent);
        } else if (data.type === 'vision_progress') {
          // 🖼️ Vision API 진행 상황 이벤트를 커스텀 이벤트로 전달
          console.log(`[🖼️ SSE VISION] 문서 ${data.documentId} Vision API 진행: ${data.step}`);
          
          const customEvent = new CustomEvent('visionProgress', {
            detail: data
          });
          window.dispatchEvent(customEvent);
        } else if (data.type === 'message_deleted') {
          // 🗑️ 메시지 삭제 이벤트 처리
          console.log(`[🗑️ SSE MESSAGE DELETED] ${data.messageType} 메시지 ${data.messageId} 삭제됨`);
          
          if (data.messageType === '1:1' && data.conversationId) {
            // 1:1 채팅 메시지 목록 업데이트
            const conversationMessagesKey = [`/api/conversations/${data.conversationId}/messages`];
            queryClient.setQueryData(conversationMessagesKey, (oldMessages: any[]) => {
              if (!oldMessages) return oldMessages;
              return oldMessages.filter((msg: any) => msg.id !== data.messageId);
            });
            console.log(`[✅ MESSAGE DELETED] 1:1 채팅 메시지 ${data.messageId} 로컬 캐시에서 제거됨`);
          } else if (data.messageType === 'group' && data.groupChatId) {
            // 그룹 채팅 메시지 목록 업데이트
            const groupChatMessagesKey = [`/api/group-chats/${data.groupChatId}/messages`];
            queryClient.setQueryData(groupChatMessagesKey, (oldMessages: any[]) => {
              if (!oldMessages) return oldMessages;
              return oldMessages.filter((msg: any) => msg.id !== data.messageId);
            });
            console.log(`[✅ MESSAGE DELETED] 그룹 채팅 메시지 ${data.messageId} 로컬 캐시에서 제거됨`);
          }
        }
      } catch (error) {
        console.error('SSE 메시지 파싱 오류:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[❌ SSE ERROR] 연결 오류:', error);
      console.error('[❌ SSE ERROR] ReadyState:', eventSource.readyState);
      console.error('[❌ SSE ERROR] URL:', eventSource.url);
      
      // ReadyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
      if (eventSource.readyState === EventSource.CLOSED) {
        console.error('[❌ SSE ERROR] 연결이 서버에 의해 닫혔습니다');
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        console.error('[❌ SSE ERROR] 재연결 시도 중...');
      }
    };

    return () => {
      console.log('[🧹 SSE CLEANUP] useEffect 정리 함수 실행');
      if (eventSourceRef.current) {
        console.log('[🛑 SSE] EventSource 연결 종료 중...');
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        console.log('[✅ SSE] 연결 종료 완료');
      }
      dispatch({ type: 'CLEAR_ALL' });
    };
  }, [isAuthenticated]); // Only reconnect when authentication changes

  useEffect(() => {
    const sortedMessages = Array.from(messageState.pendingMessages.values())
      .sort((a, b) => a.sequence - b.sequence);

    for (const item of sortedMessages) {
      if (item.sequence <= messageState.lastProcessedSequence) {
        continue;
      }

      const { groupChatId, message, sequence, eventId } = item;
      const messagesQueryKey = [`/api/group-chats/${groupChatId}/messages`];

      console.log(`[📤 REDUCER PROCESSING] 메시지 ${message.id} 처리 중 (seq: ${sequence})`);

      try {
        queryClient.setQueryData(messagesQueryKey, (oldMessages: any[]) => {
          if (!oldMessages) return [message];

          // 🔑 messageKey 우선 중복 체크 (가장 신뢰할 수 있는 식별자)
          if (message.messageKey) {
            const existingByKey = oldMessages.find((msg: any) => msg.messageKey === message.messageKey);
            
            if (existingByKey) {
              console.log(`[🚫 REDUCER DUPLICATE] 메시지 key=${message.messageKey} 이미 존재 - UPSERT`);
              
              // UPSERT: 기존 메시지를 새 메시지로 교체 (실제 ID가 있는 메시지로 업데이트)
              return oldMessages.map((msg: any) => {
                if (msg.messageKey === message.messageKey) {
                  // 새 메시지가 더 완전한 데이터를 가지고 있으면 교체
                  const hasRicherData = message.id && (!msg.id || message.createdAt);
                  return hasRicherData ? message : msg;
                }
                return msg;
              });
            }
          }

          // ID 기반 중복 체크 (messageKey가 없는 경우 fallback)
          const existingByID = oldMessages.find((msg: any) => String(msg.id) === String(message.id));
          
          if (existingByID) {
            console.log(`[🚫 REDUCER DUPLICATE] 메시지 ID=${message.id} 이미 존재 - 스킵`);
            return oldMessages;
          }

          // 새 메시지 추가
          console.log(`[✅ REDUCER ADD] 메시지 ${message.id} 캐시 추가 (seq: ${sequence}, key: ${message.messageKey})`);
          return [...oldMessages, message];
        });

        dispatch({ type: 'PROCESS_MESSAGE', payload: { eventId, sequence } });
      } catch (error) {
        console.error(`[❌ REDUCER ERROR] 메시지 ${message.id} 처리 실패:`, error);
      }
    }
  }, [messageState, queryClient]);
}