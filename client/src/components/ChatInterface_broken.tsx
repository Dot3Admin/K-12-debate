import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  ChevronLeft, 
  Paperclip, 
  Menu, 
  Send, 
  Edit, 
  Upload, 
  Settings, 
  Ban, 
  FileText, 
  BarChart3,
  X,
  User,
  Bell,
  Files,
  Download,
  Smile,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Laugh,
  Angry
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { ThemeSelector } from "./ThemeSelector";
import FileUploadModal from "./FileUploadModal";
import PersonaEditModal from "./PersonaEditModal";
import ChatbotSettingsModal from "./ChatbotSettingsModal";
import IconChangeModal from "./IconChangeModal";
import { useIsTablet } from "@/hooks/use-tablet";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Agent, Message, ChatResponse, Conversation } from "@/types/agent";

interface ChatInterfaceProps {
  agent: Agent;
  isManagementMode?: boolean;
}

export default function ChatInterface({ agent, isManagementMode = false }: ChatInterfaceProps) {
  const isTablet = useIsTablet();
  const { t, language } = useLanguage();
  const [message, setMessage] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showIconModal, setShowIconModal] = useState(false);
  const [showFileListModal, setShowFileListModal] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [notificationState, setNotificationState] = useState<"idle" | "waiting_input" | "waiting_approval">("idle");
  const [pendingNotification, setPendingNotification] = useState("");
  const [hasMarkedAsRead, setHasMarkedAsRead] = useState(false);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<number | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<number, string>>({});

  // Function to add system message from agent
  const addSystemMessage = (content: string) => {
    const systemMessage: Message = {
      id: Date.now(),
      conversationId: conversation?.id || 0,
      content: `🔧 ${content}`, // Add system indicator prefix
      isFromUser: false,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages(prev => [...prev, systemMessage]);
  };

  // Function to check if a message is a system message
  const isSystemMessage = (content: string): boolean => {
    // System prefix indicators
    if (content.startsWith('🔧') || content.startsWith('⚙️') || content.startsWith('📋')) {
      return true;
    }
    
    // Notification keywords
    const notificationKeywords = [
      '업로드되었습니다', '전송되었습니다', '완료되었습니다', '편집 창을 열었습니다',
      '설정 창을 열었습니다', '알림 내용을', '성과 분석', '관리자 모드', '명령어:',
      '새로운 문서', '새로운 기능이', '추가 되었습니다', '결과입니다', '브로드캐스트',
      '세 결과', 'Document upload notification'
    ];
    
    // Check for notification keywords
    for (const keyword of notificationKeywords) {
      if (content.includes(keyword)) {
        return true;
      }
    }
    
    // System icons
    const systemIcons = ['📊', '📈', '🔍', '⚙️', '🔧', '📋', '✅', '⚠️', '📄'];
    for (const icon of systemIcons) {
      if (content.includes(icon)) {
        return true;
      }
    }
    
    // Short system messages (likely notifications)
    if (content.length < 100) {
      const systemPatterns = [
        /입니다\.?$/,     // ends with "입니다"
        /됩니다\.?$/,     // ends with "됩니다"
        /했습니다\.?$/,   // ends with "했습니다"
        /있습니다\.?$/,   // ends with "있습니다"
        /B\d+/,          // contains B followed by numbers
        /결과/,          // contains "결과"
        /알림/,          // contains "알림"
        /기능/,          // contains "기능"
        /추가/,          // contains "추가"
        /변경/,          // contains "변경"
        /설정/           // contains "설정"
      ];
      
      for (const pattern of systemPatterns) {
        if (pattern.test(content)) {
          return true;
        }
      }
    }
    
    return false;
  };

  // Reaction handlers
  const handleReactionToggle = (messageId: number) => {
    setActiveReactionMessageId(prev => prev === messageId ? null : messageId);
  };

  const handleReactionSelect = (messageId: number, reaction: string) => {
    setMessageReactions(prev => ({
      ...prev,
      [messageId]: reaction
    }));
    setActiveReactionMessageId(null);
  };

  const reactionOptions = [
    { emoji: '👍', icon: ThumbsUp, label: 'Like' },
    { emoji: '👎', icon: ThumbsDown, label: 'Dislike' }
  ];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Broadcast notification mutation
  const broadcastMutation = useMutation({
    mutationFn: async ({ agentId, message }: { agentId: number; message: string }) => {
      const response = await apiRequest("POST", `/api/agents/${agentId}/broadcast`, { message });
      return response.json();
    },
    onSuccess: (data) => {
      addSystemMessage(`알림이 전송되었습니다.\n\n내용: "${pendingNotification}"\n대상: ${agent.name} 사용자 ${data.totalRecipients}명\n시간: ${new Date().toLocaleString('ko-KR')}`);
      
      // Immediately invalidate conversations cache to show new notifications
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations"]
      });
    },
    onError: () => {
      addSystemMessage("알림 전송에 실패했습니다.");
    }
  });

  // Get or create conversation based on mode
  const { data: conversationData } = useQuery<Conversation>({
    queryKey: [`/api/conversations${isManagementMode ? '/management' : ''}`, agent.id],
    queryFn: async () => {
      const endpoint = isManagementMode ? "/api/conversations/management" : "/api/conversations";
      const response = await apiRequest("POST", endpoint, { agentId: agent.id });
      return response.json();
    },
  });

  // Mark conversation as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/read`);
      return response.json();
    },
    onSuccess: () => {
      // Update conversation list cache directly without invalidation to prevent loops
      queryClient.setQueryData(["/api/conversations"], (oldData: any[]) => {
        if (!oldData) return oldData;
        return oldData.map(conv => 
          conv.id === conversation?.id 
            ? { ...conv, unreadCount: 0 }
            : conv
        );
      });
    }
  });

  // Get messages for the conversation
  const { data: messagesData = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: [`/api/conversations/${conversation?.id}/messages`],
    enabled: !!conversation?.id,
  });

  const messages = messagesData;

  // Get agent documents for file list
  const { data: documents = [] } = useQuery<any[]>({
    queryKey: [`/api/agents/${agent.id}/documents`],
    enabled: showFileListModal
  });

  // Set conversation when data is available and mark as read (only once)
  useEffect(() => {
    if (conversationData && (!conversation || conversation.id !== conversationData.id)) {
      setConversation(conversationData);
      setHasMarkedAsRead(false);
      
      // Mark conversation as read when opened (only for new conversations with unread messages)
      if (!isManagementMode && conversationData.unreadCount > 0 && !hasMarkedAsRead) {
        setHasMarkedAsRead(true);
        markAsReadMutation.mutate(conversationData.id);
      }
    }
  }, [conversationData?.id, isManagementMode, hasMarkedAsRead]);

  // Show welcome message for management mode when conversation is empty
  useEffect(() => {
    if (isManagementMode && messages && messages.length === 0 && conversation?.id) {
      // Add welcome message for management mode
      setTimeout(() => {
        addSystemMessage(`🔧 ${agent.name} 관리자 모드에 오신 것을 환영합니다!

대화를 통해 다음 기능들을 실행할 수 있습니다:

• "페르소나" - 에이전트 성격 및 말투 설정
• "챗봇 설정" - LLM 모델 및 동작 방식 변경  
• "문서 업로드" - 지식베이스 확장용 문서 추가
• "알림보내기" - 사용자들에게 공지사항 전송
• "성과 분석" - 에이전트 사용 통계 및 분석
• "도움말" - 명령어 목록 다시 보기

원하는 기능을 메시지로 입력하거나, 일반 대화도 가능합니다.`);
      }, 500);
    }
  }, [isManagementMode, messages?.length, conversation?.id, agent.name]);

  // Auto-mark conversation as read when new messages arrive while user is viewing
  useEffect(() => {
    if (conversation?.id && messages && messages.length > 0) {
      // Get current conversation data from cache
      const conversations = queryClient.getQueryData(["/api/conversations"]) as any[];
      const currentConv = conversations?.find((conv: any) => conv.id === conversation.id);
      
      // Only mark as read if there are unread messages
      if (currentConv && currentConv.unreadCount > 0) {
        markAsReadMutation.mutate(conversation.id);
      }
    }
  }, [messages?.length, conversation?.id, queryClient, markAsReadMutation]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!conversation?.id) {
        throw new Error("No conversation found");
      }
      
      const response = await apiRequest("POST", `/api/conversations/${conversation.id}/messages`, {
        content,
        isFromUser: true,
        userLanguage: language,
      });
      return response.json();
    },
    onMutate: async (content: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [`/api/conversations/${conversation?.id}/messages`]
      });

      // Create optimistic user message
      const optimisticUserMessage: Message = {
        id: Date.now(), // temporary ID
        conversationId: conversation?.id || 0,
        content,
        isFromUser: true,
        createdAt: new Date().toISOString(),
      };

      // Add optimistic user message immediately
      setOptimisticMessages(prev => [...prev, optimisticUserMessage]);
      setIsTyping(true); // Show typing indicator for AI response
      setMessage(""); // Clear input immediately
    },
    onSuccess: (data: ChatResponse) => {
      // Clear optimistic messages and typing indicator
      setOptimisticMessages([]);
      setIsTyping(false);
      
      // Handle trigger actions from AI response
      if ((data as any).aiMessage?.triggerAction) {
        setTimeout(() => {
          switch ((data as any).aiMessage.triggerAction) {
            case "openPersonaModal":
              setShowPersonaModal(true);
              break;
            case "openSettingsModal":
              setShowSettingsModal(true);
              break;
            case "openFileModal":
              setShowFileModal(true);
              break;
            case "startNotification":
              setNotificationState("waiting_input");
              break;
          }
        }, 500);
      }
      
      // Invalidate messages to refresh with real data
      queryClient.invalidateQueries({
        queryKey: [`/api/conversations/${conversation?.id}/messages`]
      });
      
      // Update conversation list cache with new message data
      queryClient.setQueryData(["/api/conversations"], (oldData: any[]) => {
        if (!oldData) return oldData;
        return oldData.map(conv => 
          conv.id === conversation?.id 
            ? { 
                ...conv, 
                lastMessage: data.aiMessage,
                lastMessageAt: data.aiMessage.createdAt,
                unreadCount: 0 // Always set to 0 since user is actively viewing this conversation
              }
            : conv
        );
      });
    },
    onError: (error: Error) => {
      // Clear optimistic messages and typing indicator on error
      setOptimisticMessages([]);
      setIsTyping(false);
      
      if (isUnauthorizedError(error)) {
        toast({
          title: "인증 오류",
          description: "다시 로그인해주세요.",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/auth";
        }, 500);
      } else {
        toast({
          title: "메시지 전송 실패",
          description: error.message,
          variant: "destructive",
        });
      }
    },
  });

  const handleSendMessage = () => {
    if (!message.trim() || sendMessageMutation.isPending) return;
    
    const messageContent = message.trim();
    
    // In management mode, let the AI handle commands and trigger modals based on AI response
    // No special command handling here - let everything go through normal message flow

    // Handle notification workflow
    if (notificationState === "waiting_input") {
      setPendingNotification(messageContent);
      setNotificationState("waiting_approval");
      setMessage("");
      
      // Show approval message
      addSystemMessage(`알림 내용: "${messageContent}"\n\n전송하시겠습니까? (승인/취소)`);
      return;
    }
    
    if (notificationState === "waiting_approval") {
      const lowerMessage = messageContent.toLowerCase();
      if (lowerMessage === "승인" || lowerMessage === "네" || lowerMessage === "yes") {
        // Execute notification - broadcast to all users
        setNotificationState("idle");
        setMessage("");
        
        // Execute broadcast using mutation
        broadcastMutation.mutate({
          agentId: agent.id,
          message: pendingNotification
        });
        
        setPendingNotification("");
        return;
      } else if (lowerMessage === "취소" || lowerMessage === "아니오" || lowerMessage === "no") {
        // Cancel notification
        setNotificationState("idle");
        setMessage("");
        addSystemMessage("알림 전송이 취소되었습니다.");
        setPendingNotification("");
        return;
      } else {
        setMessage("");
        addSystemMessage("'승인' 또는 '취소'를 입력해주세요.");
        return;
      }
    }
    
    // Normal message sending
    sendMessageMutation.mutate(messageContent);
  };

  // Combine real messages with optimistic messages
  const allMessages = [...(messages || []), ...optimisticMessages];

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Auto scroll to bottom when new messages arrive or typing state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages, isTyping]);

  // Immediately scroll to bottom when messages are first loaded (without animation)
  useEffect(() => {
    if (messages.length > 0) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [messages.length]);

  // Also scroll to bottom when conversation changes
  useEffect(() => {
    if (conversation?.id && messages.length > 0) {
      // Force immediate scroll to bottom when entering a chat room
      requestAnimationFrame(() => {
        const messagesContainer = document.querySelector('.chat-interface-messages');
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }
  }, [conversation?.id, messages.length]);

  // Minimal mobile handling - remove all complex viewport logic
  useEffect(() => {
    if (!isTablet) {
      // Do nothing - let browser handle naturally
    }
  }, [isTablet]);

  // Detect device type for interaction
  const [isTouch, setIsTouch] = useState(false);
  
  useEffect(() => {
    const checkTouch = () => {
      setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    checkTouch();
    window.addEventListener('touchstart', checkTouch, { once: true });
    return () => window.removeEventListener('touchstart', checkTouch);
  }, []);

  // Click outside to close reaction popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.reaction-popup') && !target.closest('.message-content')) {
        setActiveReactionMessageId(null);
      }
    };

    if (activeReactionMessageId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [activeReactionMessageId]);

  // Skip loading state and show welcome message immediately if no messages exist yet
  // This prevents the loading spinner flash before welcome message appears

  return (
    <div className={`${!isTablet ? "chat-page-container" : "chat-interface-container"} flex flex-col h-full bg-transparent overflow-hidden`}>
      {/* Chat Header - Mobile version with back button */}
      {!isTablet && (
        <header className={`chat-interface-header mobile-chat-header md:static md:bg-transparent md:shadow-none`}>
        <div className="px-4 py-3 md:px-6 md:py-4 md:border-b md:border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 md:space-x-4">
              <Link href={isManagementMode ? "/management" : "/"}>
                <Button variant="ghost" size="sm" className="p-2 md:p-3">
                  <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
                </Button>
              </Link>
              <div 
                className="w-10 h-10 rounded-2xl flex items-center justify-center overflow-hidden md:w-12 md:h-12"
                style={{ backgroundColor: agent.backgroundColor }}
              >
                {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                  <img 
                    src={agent.icon} 
                    alt={`${agent.name} icon`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      console.log(`Failed to load custom icon: ${agent.icon}`);
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : (
                  <User className="text-white w-5 h-5" />
                )}
                {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) && (
                  <User className="text-white w-5 h-5 hidden" />
                )}
              </div>
              <div>
                <h3 className="font-medium text-foreground korean-text md:text-lg">{agent.name}</h3>
              </div>
            </div>
            <div className="flex items-center space-x-2 md:space-x-3">
              {/* Files Button - Only visible in general mode */}
              {!isManagementMode && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="p-2 md:p-3"
                  onClick={() => setShowFileListModal(true)}
                >
                  <Files className="w-4 h-4" />
                </Button>
              )}
              
              {isManagementMode && (
                <>
                  <div className="relative">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="px-3 py-2 korean-text"
                      onClick={() => setShowMenu(!showMenu)}
                    >
                      기능선택
                    </Button>
                  
                    {/* Dropdown Menu */}
                    {showMenu && (
                      <>
                        {/* Invisible overlay to catch outside clicks */}
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowMenu(false)}
                        />
                        <div className="absolute right-0 top-full mt-2 w-48 bg-background border border-border rounded-xl shadow-lg z-50">
                          <div className="py-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={() => {
                              setShowPersonaModal(true);
                              setShowMenu(false);
                              addSystemMessage("페르소나 편집 창을 열었습니다. 닉네임, 말투 스타일, 지식 분야, 성격 특성, 금칙어 반응 방식을 수정할 수 있습니다.");
                            }}
                          >
                            <User className="w-4 h-4 mr-2" />
                            {t('agent.persona')}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={() => {
                              setShowIconModal(true);
                              setShowMenu(false);
                              addSystemMessage("아이콘 변경 창을 열었습니다. 에이전트의 아이콘과 배경색을 변경할 수 있습니다.");
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" />
                            {t('agent.iconChange')}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={() => {
                              setShowSettingsModal(true);
                              setShowMenu(false);
                              addSystemMessage("챗봇 설정 창을 열었습니다. LLM 모델과 챗봇 유형을 변경할 수 있습니다.");
                            }}
                          >
                            <Settings className="w-4 h-4 mr-2" />
                            {t('agent.settings')}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={() => {
                              setShowMenu(false);
                              setNotificationState("waiting_input");
                              addSystemMessage("알림 내용을 입력하세요. 모든 사용자에게 전송됩니다.");
                            }}
                          >
                            <Bell className="w-4 h-4 mr-2" />
                            {t('agent.notification')}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={() => {
                              setShowFileModal(true);
                              setShowMenu(false);
                              addSystemMessage("문서 업로드 창을 열었습니다. TXT, DOC, DOCX, PPT, PPTX 형식의 문서를 업로드하여 에이전트의 지식베이스를 확장할 수 있습니다.");
                            }}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            {t('agent.upload')}
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-start px-4 py-2 korean-text"
                            onClick={async () => {
                              setShowMenu(false);
                              addSystemMessage("에이전트 성과 분석을 실행합니다...");
                              
                              try {
                                const response = await fetch(`/api/agents/${agent.id}/performance`, {
                                  credentials: 'include'
                                });
                                
                                if (response.ok) {
                                  const data = await response.json();
                                  const performanceMessage = `📊 ${data.agentName} 성과 분석 (${data.period})

📈 주요 지표:

• 총 메시지 수: ${data.metrics.totalMessages}개

• 활성 사용자: ${data.metrics.activeUsers}명

• 업로드 문서: ${data.metrics.documentsCount}개

• 최근 활동: ${data.metrics.recentActivity}건

• 응답률: ${data.metrics.responseRate}

• 평균 응답시간: ${data.metrics.avgResponseTime}

• 만족도: ${data.metrics.satisfaction}

📊 성장 추세:

• 메시지 증가율: ${data.trends.messageGrowth}

• 사용자 증가율: ${data.trends.userGrowth}

• 참여율: ${data.trends.engagementRate}`;
                                  
                                  addSystemMessage(performanceMessage);
                                } else {
                                  addSystemMessage("성과 분석 데이터를 불러오는데 실패했습니다.");
                                }
                              } catch (error) {
                                addSystemMessage("성과 분석 중 오류가 발생했습니다.");
                              }
                            }}
                          >
                            <BarChart3 className="w-4 h-4 mr-2" />
                            {t('agent.performance')}
                          </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
              
            </div>
          </div>
        </div>
        </header>
      )}

      {/* Tablet Header - Simplified version without back button */}
      {isTablet && (
        <header className="relative bg-background border-b border-border">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div 
                  className="w-10 h-10 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: agent.backgroundColor }}
                >
                  {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                    <img 
                      src={agent.icon} 
                      alt={`${agent.name} icon`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        console.log(`Failed to load custom icon: ${agent.icon}`);
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        target.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : (
                    <User className="text-white w-5 h-5" />
                  )}
                  {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) && (
                    <User className="text-white w-5 h-5 hidden" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-foreground korean-text">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground korean-text">
                    {isManagementMode ? "관리자 모드" : "일반 대화"}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {/* Files Button - Only visible in general mode */}
                {!isManagementMode && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="p-2"
                    onClick={() => setShowFileListModal(true)}
                  >
                    <Files className="w-4 h-4" />
                  </Button>
                )}
                
                {isManagementMode && (
                  <div className="relative">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="px-3 py-2 korean-text"
                      onClick={() => setShowMenu(!showMenu)}
                    >
                      기능선택
                    </Button>
                  
                    {/* Dropdown Menu */}
                    {showMenu && (
                      <>
                        {/* Invisible overlay to catch outside clicks */}
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowMenu(false)}
                        />
                        <div className="absolute right-0 top-full mt-2 w-48 bg-background border border-border rounded-xl shadow-lg z-50">
                          <div className="py-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowPersonaModal(true);
                                setShowMenu(false);
                                addSystemMessage("페르소나 편집 창을 열었습니다. 닉네임, 말투 스타일, 지식 분야, 성격 특성, 금칙어 반응 방식을 수정할 수 있습니다.");
                              }}
                            >
                              <User className="w-4 h-4 mr-2" />
                              페르소나 변경
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowIconModal(true);
                                setShowMenu(false);
                                addSystemMessage("아이콘 변경 창을 열었습니다. 에이전트의 아이콘과 배경색을 변경할 수 있습니다.");
                              }}
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              아이콘 변경
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowSettingsModal(true);
                                setShowMenu(false);
                                addSystemMessage("챗봇 설정 창을 열었습니다. LLM 모델과 챗봇 유형을 변경할 수 있습니다.");
                              }}
                            >
                              <Settings className="w-4 h-4 mr-2" />
                              챗봇 설정
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowMenu(false);
                                setNotificationState("waiting_input");
                                addSystemMessage("알림 내용을 입력하세요. 모든 사용자에게 전송됩니다.");
                              }}
                            >
                              <Bell className="w-4 h-4 mr-2" />
                              알림보내기
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowFileModal(true);
                                setShowMenu(false);
                                addSystemMessage("문서 업로드 창을 열었습니다. TXT, DOC, DOCX, PPT, PPTX 형식의 문서를 업로드하여 에이전트의 지식베이스를 확장할 수 있습니다.");
                              }}
                            >
                              <FileText className="w-4 h-4 mr-2" />
                              문서 업로드
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={async () => {
                                setShowMenu(false);
                                addSystemMessage("에이전트 성과 분석을 실행합니다...");
                                
                                // Execute performance analysis
                                setTimeout(async () => {
                                  try {
                                    const response = await fetch(`/api/agents/${agent.id}/performance`, {
                                      credentials: 'include'
                                    });
                                    
                                    if (response.ok) {
                                      const data = await response.json();
                                      const performanceMessage = `📊 ${data.agentName} 성과 분석 (${data.period})

📈 주요 지표:

• 총 대화 수: ${data.metrics.totalMessages}개
• 활성 사용자: ${data.metrics.activeUsers}명  
• 업로드된 문서: ${data.metrics.documentsCount}개
• 최근 활동: ${data.metrics.recentActivity}건
• 사용률: ${data.metrics.usagePercentage}%
• 랭킹: ${data.metrics.ranking}위
• 평균 응답시간: ${data.metrics.avgResponseTime}초

${data.insights && data.insights.length > 0 ? '\n🔍 인사이트:\n' + data.insights.map((insight: string) => `• ${insight}`).join('\n') : ''}

📊 성장 트렌드:
• 메시지 증가율: ${data.trends.messageGrowth}
• 사용자 증가율: ${data.trends.userGrowth}  
• 참여율: ${data.trends.engagementRate}`;
                                      
                                      addSystemMessage(performanceMessage);
                                    } else {
                                      addSystemMessage("성과 분석 데이터를 가져오는데 실패했습니다. 다시 시도해주세요.");
                                    }
                                  } catch (error) {
                                    addSystemMessage("성과 분석 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
                                  }
                                }, 1000);
                              }}
                            >
                              <BarChart3 className="w-4 h-4 mr-2" />
                              성과 분석
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
      )}

      {/* Chat Messages */}
      <div 
        className={`chat-interface-messages ${!isTablet ? "mobile-messages-container" : "flex-1"} px-4 space-y-4 overflow-y-auto chat-scroll chat-messages md:px-6 md:space-y-5`}
        style={{ 
          paddingTop: isTablet ? '1rem' : '0', 
          paddingBottom: isTablet ? '1rem' : '0'
        }}
      >
        {allMessages.length === 0 ? (
          <div 
            className="text-center px-4 md:pt-12 md:pb-16"
            style={{
              paddingTop: isTablet ? '3rem' : '40px',
              paddingBottom: isTablet ? '3rem' : '40px',
              marginTop: isTablet ? '0' : '20px'
            }}
          >
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 md:w-20 md:h-20 md:mb-6">
              <User className="text-white w-8 h-8 md:w-10 md:h-10" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2 korean-text md:text-xl md:mb-3">
              {agent.name}과 대화하세요
            </h3>
            <p className="text-muted-foreground text-sm korean-text md:text-base">
              궁금한 것이 있으면 언제든지 물어보세요.
            </p>
          </div>
        ) : (
          <>
            {allMessages.map((msg) => {
              const isSystem = !msg.isFromUser && isSystemMessage(msg.content);
              const showReactionOptions = activeReactionMessageId === msg.id;
              const messageReaction = messageReactions[msg.id];
              
              return (
                <div key={msg.id} className={`flex ${msg.isFromUser ? "justify-end" : "justify-start"} group`}>
                  <div className="flex items-center gap-1">
                    <div
                      className={`message-content max-w-[75%] px-4 py-3 rounded-2xl korean-text md:max-w-[80%] md:px-5 md:py-4 ${
                        msg.isFromUser
                          ? "bg-primary text-primary-foreground"
                          : isSystem
                            ? "system-message"
                            : "bg-muted text-muted-foreground"
                      }`}
                      onMouseEnter={() => {
                        if (!msg.isFromUser && !isSystem) {
                          setActiveReactionMessageId(msg.id);
                        }
                      }}
                      onMouseLeave={() => {
                        if (!msg.isFromUser && !isSystem) {
                          setTimeout(() => setActiveReactionMessageId(null), 200);
                        }
                      }}
                      onClick={() => {
                        if (!msg.isFromUser && !isSystem) {
                          console.log('Message clicked, toggling reactions for message:', msg.id);
                          handleReactionToggle(msg.id);
                        }
                      }}
                    >
                      <p className="text-sm leading-relaxed md:text-base md:leading-relaxed">{msg.content}</p>
                      
                      {/* Message Reaction Display - Mobile: below message */}
                      {messageReaction && (
                        <div className="mt-2 flex justify-start md:hidden">
                          <span className="text-lg bg-background/80 rounded-full px-2 py-1 border border-border">
                            {messageReaction}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* PC: Reaction buttons right next to message */}
                    {!msg.isFromUser && !isSystem && (
                      <>
                        {/* Message Reaction Display - PC: next to message */}
                        {messageReaction && (
                          <div className="hidden md:flex">
                            <span className="text-lg bg-background/80 rounded-full px-2 py-1 border border-border">
                              {messageReaction}
                            </span>
                          </div>
                        )}
                        
                        {/* Reaction Options - PC: right next to message */}
                        {showReactionOptions && (
                          <div 
                            className="hidden md:flex gap-1 bg-background border border-border rounded-full shadow-lg px-1 py-1 animate-in fade-in-0 zoom-in-95 duration-150 z-50"
                            onMouseEnter={() => setActiveReactionMessageId(msg.id)}
                            onMouseLeave={() => setActiveReactionMessageId(null)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {reactionOptions.map((option) => (
                              <button
                                key={option.emoji}
                                className="w-6 h-6 rounded-full bg-muted hover:bg-muted/80 transition-colors flex items-center justify-center"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReactionSelect(msg.id, option.emoji);
                                }}
                                title={option.label}
                              >
                                {option.emoji === '👍' ? (
                                  <ThumbsUp className="w-3 h-3 text-muted-foreground" />
                                ) : (
                                  <ThumbsDown className="w-3 h-3 text-muted-foreground" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Mobile: Reaction Options below message */}
                    {showReactionOptions && !msg.isFromUser && !isSystem && (
                      <div className="md:hidden absolute top-full left-0 mt-2 flex gap-1 bg-background border border-border rounded-full shadow-lg px-1 py-1 animate-in fade-in-0 zoom-in-95 duration-150 z-50">
                        {reactionOptions.map((option) => (
                          <button
                            key={option.emoji}
                            className="w-6 h-6 rounded-full bg-muted hover:bg-muted/80 transition-colors flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReactionSelect(msg.id, option.emoji);
                            }}
                            title={option.label}
                          >
                            {option.emoji === '👍' ? (
                              <ThumbsUp className="w-3 h-3 text-muted-foreground" />
                            ) : (
                              <ThumbsDown className="w-3 h-3 text-muted-foreground" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex justify-start">
                <div className="max-w-[75%] px-4 py-3 rounded-2xl bg-muted text-muted-foreground">
                  <div className="flex items-center space-x-1">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    <span className="text-xs text-gray-500 ml-2">{t('chat.typing')}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>



      {/* Message Input */}
      <div className={`${isTablet ? "chat-input-area flex-shrink-0" : "fixed-chat-input"} px-4 py-4 border-t border-border bg-card md:px-6 md:py-5`}>
        <div className="flex items-center space-x-3 md:space-x-4">
          <div className="flex-1 relative">
            <Input
              type="text"
              placeholder={t('chat.inputPlaceholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pr-12 korean-text md:h-12 md:text-base md:pr-14"
              disabled={sendMessageMutation.isPending}
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 md:p-3 md:right-3"
              onClick={handleSendMessage}
              disabled={!message.trim() || sendMessageMutation.isPending}
            >
              <Send className="w-4 h-4 md:w-5 md:h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* File Upload Modal */}
      {showFileModal && (
        <FileUploadModal
          agent={agent}
          isOpen={showFileModal}
          onClose={() => setShowFileModal(false)}
          onSuccess={addSystemMessage}
        />
      )}

      {/* Persona Edit Modal */}
      {showPersonaModal && (
        <PersonaEditModal
          agent={agent}
          isOpen={showPersonaModal}
          onClose={() => setShowPersonaModal(false)}
          onSuccess={addSystemMessage}
          onCancel={addSystemMessage}
        />
      )}

      {/* Chatbot Settings Modal */}
      {showSettingsModal && (
        <ChatbotSettingsModal
          agent={agent}
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          onSuccess={addSystemMessage}
          onCancel={addSystemMessage}
        />
      )}

      {/* Icon Change Modal */}
      {showIconModal && (
        <IconChangeModal
          agent={agent}
          isOpen={showIconModal}
          onClose={() => setShowIconModal(false)}
          onSuccess={addSystemMessage}
        />
      )}

      {/* File List Modal */}
      {showFileListModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowFileListModal(false)}>
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold korean-text">업로드된 파일</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFileListModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            {Array.isArray(documents) && documents.length > 0 ? (
              <div className="space-y-3">
                {documents.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium korean-text truncate">
                          {doc.originalName || doc.filename}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(doc.createdAt).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-2 flex-shrink-0"
                      onClick={() => {
                        // Download file
                        const link = document.createElement('a');
                        link.href = `/uploads/${doc.filename}`;
                        link.download = doc.filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground korean-text">업로드된 파일이 없습니다</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}