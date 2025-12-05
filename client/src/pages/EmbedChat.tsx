import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { useLanguage } from "@/contexts/LanguageContext";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GroupChatMessage, GroupChatWithDetails } from "@/types/agent";

interface Perspective {
  name: string;
  role: string;
  stance: string;
  sentiment: string;
  supportive_indices: number[];
  color: string;
}

export default function EmbedChat() {
  const { embedCode } = useParams<{ embedCode: string }>();
  const [message, setMessage] = useState("");
  const [userName, setUserName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [tempName, setTempName] = useState("");
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { language } = useLanguage();
  const { toast } = useToast();
  
  // 🎭 Perspectives 상태
  const [perspectivesByMessage, setPerspectivesByMessage] = useState<Record<number, Perspective[]>>({});
  const [loadingPerspectives, setLoadingPerspectives] = useState(false);
  
  // 🎭 Perspectives fetch 함수
  const fetchPerspectives = useCallback(async (topic: string, question: string, messageId: number) => {
    if (!embedCode || loadingPerspectives) return;
    
    setLoadingPerspectives(true);
    try {
      const response = await fetch('/api/search/perspectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          question: question.trim(),
          agentId: 1 // Default agent ID
        })
      });
      
      const data = await response.json();
      
      if (data.success && data.perspectives) {
        console.log(`[🎭 PERSPECTIVES] Fetched ${data.perspectives.length} perspectives for message ${messageId}`);
        setPerspectivesByMessage(prev => ({
          ...prev,
          [messageId]: data.perspectives
        }));
      } else {
        console.warn('[🎭 PERSPECTIVES] No perspectives returned');
      }
    } catch (error) {
      console.error('[🎭 PERSPECTIVES] Error fetching perspectives:', error);
      toast({
        title: "관점 로드 실패",
        description: "다양한 관점을 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setLoadingPerspectives(false);
    }
  }, [embedCode, loadingPerspectives, toast]);
  
  // 🎭 Perspective 전환 핸들러
  const handlePerspectiveSwitch = useCallback((perspective: Perspective) => {
    console.log('[🎭 PERSPECTIVE SWITCH]', {
      name: perspective.name,
      role: perspective.role,
      stance: perspective.stance,
      supportive_indices: perspective.supportive_indices
    });
    
    toast({
      title: `${perspective.name} 관점으로 전환`,
      description: `${perspective.role} - ${perspective.stance}`,
    });
  }, [toast]);

  // 로컬스토리지에서 사용자 이름 로드 또는 언어별 게스트 이름 자동 설정
  useEffect(() => {
    const savedName = localStorage.getItem("embedChatName");
    if (savedName) {
      setUserName(savedName);
    } else {
      // 언어에 따라 자동으로 게스트 이름 설정
      const guestName = language === 'en' ? 'Guest' : language === 'jp' ? 'ゲスト' : '게스트';
      setUserName(guestName);
      localStorage.setItem("embedChatName", guestName);
    }
  }, [language]);

  const { data: groupChat, isLoading: isLoadingChat, error: chatError, fetchStatus } = useQuery<GroupChatWithDetails>({
    queryKey: [`/api/embed/${embedCode}`],
    queryFn: async () => {
      const res = await fetch(`/api/embed/${embedCode}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text() || res.statusText}`);
      }
      return res.json();
    },
    enabled: !!embedCode,
    retry: false,
    staleTime: 0,
  });

  const { data: messages = [], isLoading: isLoadingMessages, error: messagesError, fetchStatus: messagesFetchStatus} = useQuery<GroupChatMessage[]>({
    queryKey: [`/api/embed/${embedCode}/messages`],
    queryFn: async () => {
      const res = await fetch(`/api/embed/${embedCode}/messages`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text() || res.statusText}`);
      }
      return res.json();
    },
    enabled: !!embedCode,
    refetchInterval: 3000,
    retry: false,
    staleTime: 0,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, senderName }: { content: string; senderName: string }) => {
      const res = await fetch(`/api/embed/${embedCode}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ content, senderName }),
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || "Failed to send message");
      }
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      console.log('[SPINNER] Setting isWaitingForResponse = true');
      setIsWaitingForResponse(true);
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
    },
  });

  const handleSendMessage = () => {
    if (!message.trim() || !userName) return;
    sendMessageMutation.mutate({ content: message.trim(), senderName: userName });
  };

  const handleSaveName = () => {
    if (!tempName.trim()) return;
    localStorage.setItem("embedChatName", tempName.trim());
    setUserName(tempName.trim());
    setShowNamePrompt(false);
  };

  // 새 메시지가 추가될 때마다 스크롤을 맨 아래로 이동
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // 봇 응답이 도착하면 스피너 숨김
  useEffect(() => {
    console.log('[SPINNER] useEffect - messages.length:', messages.length, 'isWaitingForResponse:', isWaitingForResponse);
    if (messages.length > 0 && isWaitingForResponse) {
      const lastMessage = messages[messages.length - 1];
      console.log('[SPINNER] lastMessage:', lastMessage, 'hasAgentId:', !!lastMessage.agentId);
      // 마지막 메시지가 봇 메시지(agentId가 있음)라면 스피너 숨김
      if (lastMessage.agentId) {
        console.log('[SPINNER] Setting isWaitingForResponse = false (bot message received)');
        setIsWaitingForResponse(false);
      }
    }
  }, [messages, isWaitingForResponse]);
  
  // 🎭 자동 perspectives 로드 (데모용 - 첫 번째 에이전트 답변에 대해)
  useEffect(() => {
    console.log('[🎭 PERSPECTIVES DEBUG]', {
      embedCode,
      messagesLength: messages.length,
      messages: messages.map(m => ({ id: m.id, agentId: m.agentId, content: m.content?.substring(0, 30) })),
      perspectivesByMessage,
      loadingPerspectives
    });
    
    if (!embedCode || messages.length === 0) {
      console.log('[🎭 SKIP] No embedCode or messages');
      return;
    }
    
    // 마지막 2개 메시지 확인 (사용자 질문 + 에이전트 답변)
    if (messages.length >= 2) {
      const lastMsg = messages[messages.length - 1];
      const prevMsg = messages[messages.length - 2];
      
      console.log('[🎭 CHECK]', {
        lastMsgId: lastMsg.id,
        lastMsgAgentId: lastMsg.agentId,
        prevMsgAgentId: prevMsg.agentId,
        hasPerspectives: !!perspectivesByMessage[lastMsg.id!],
        isLoading: loadingPerspectives
      });
      
      // 에이전트 메시지이고, 이전 메시지가 사용자 메시지이며, 아직 perspectives가 없는 경우
      if (
        lastMsg.agentId && 
        !prevMsg.agentId && // 이전 메시지가 사용자 메시지 (agentId 없음)
        lastMsg.id &&
        !perspectivesByMessage[lastMsg.id] &&
        !loadingPerspectives
      ) {
        // 질문 내용에서 topic 추출 (간단하게 처음 50자 사용)
        const question = prevMsg.content;
        const topic = question.substring(0, 50).replace(/\?/g, '').trim();
        
        console.log(`[🎭 AUTO FETCH] Fetching perspectives for message ${lastMsg.id}`);
        fetchPerspectives(topic, question, lastMsg.id);
      }
    }
  }, [messages, embedCode, perspectivesByMessage, loadingPerspectives, fetchPerspectives]);

  useEffect(() => {
    console.log('[EMBED] embedCode:', embedCode);
    console.log('[EMBED] isLoadingChat:', isLoadingChat, 'fetchStatus:', fetchStatus, 'chatError:', chatError);
    console.log('[EMBED] isLoadingMessages:', isLoadingMessages, 'messagesFetchStatus:', messagesFetchStatus, 'messagesError:', messagesError);
    console.log('[EMBED] groupChat:', groupChat);
    console.log('[EMBED] messages:', messages);
    
    if (chatError) {
      console.error('[EMBED] Chat Error:', chatError);
    }
    if (messagesError) {
      console.error('[EMBED] Messages Error:', messagesError);
    }
  }, [embedCode, isLoadingChat, isLoadingMessages, groupChat, messages, chatError, messagesError, fetchStatus, messagesFetchStatus]);

  if (chatError || messagesError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">오류 발생</h2>
          <p className="text-gray-600">{(chatError as Error)?.message || (messagesError as Error)?.message}</p>
        </div>
      </div>
    );
  }

  if (isLoadingChat || isLoadingMessages) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!groupChat) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">채팅방을 찾을 수 없습니다</h2>
          <p className="text-gray-600">유효한 임베드 코드가 아닙니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* 이름 입력 모달 */}
      {showNamePrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-xl font-bold mb-4">이름을 입력해주세요</h2>
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSaveName()}
              placeholder="닉네임"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 mb-4"
              autoFocus
            />
            <button
              onClick={handleSaveName}
              disabled={!tempName.trim()}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              시작하기
            </button>
          </div>
        </div>
      )}

      <div className="bg-blue-600 text-white px-2 py-2 flex-shrink-0 flex justify-end">
        <button
          onClick={() => window.parent.postMessage({ type: 'closeChat' }, '*')}
          className="p-1 hover:bg-white/20 rounded-full transition-colors"
          aria-label="채팅 닫기"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => {
          const isBot = !!msg.agentId;
          const senderName = isBot 
            ? msg.agent?.name || '챗봇'
            : msg.sender?.name || msg.sender?.username || '사용자';
          
          // 🎭 Get perspectives for this message
          const messagePerspectives = msg.id ? perspectivesByMessage[msg.id] : undefined;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isBot ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                  isBot
                    ? 'bg-gray-100 text-gray-900'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {isBot && (
                  <div className="text-xs font-semibold mb-1 opacity-70">
                    {senderName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
                <div className={`text-xs mt-1 ${isBot ? 'text-gray-500' : 'text-blue-100'}`}>
                  {new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>
              
              {/* 🎭 Perspectives 버튼 (에이전트 메시지인 경우에만) */}
              {isBot && messagePerspectives && messagePerspectives.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap max-w-[80%]">
                  {messagePerspectives.map((perspective, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePerspectiveSwitch(perspective)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 shadow-sm"
                      style={{
                        backgroundColor: perspective.color === 'green' ? '#10b981' :
                                       perspective.color === 'red' ? '#ef4444' :
                                       perspective.color === 'yellow' ? '#f59e0b' :
                                       perspective.color === 'blue' ? '#3b82f6' :
                                       '#6b7280',
                        color: 'white'
                      }}
                      data-testid={`perspective-button-${perspective.name}`}
                    >
                      {perspective.name} ({perspective.role})
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        
        {/* 챗봇 응답 대기 중 스피너 */}
        {isWaitingForResponse && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-gray-100">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-sm text-gray-500">답변을 준비하는 중...</span>
              </div>
            </div>
          </div>
        )}
        
        {/* 스크롤 타겟 (자동 스크롤용) */}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder="메시지를 입력하세요"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-600"
            disabled={sendMessageMutation.isPending || !userName}
          />
          <button
            onClick={handleSendMessage}
            disabled={sendMessageMutation.isPending || !message.trim() || !userName}
            className="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {sendMessageMutation.isPending ? "전송중..." : "전송"}
          </button>
        </div>
      </div>
    </div>
  );
}
