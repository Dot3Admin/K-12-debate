import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import PDFViewer from "./PDFViewer";
import { 
  ChevronLeft, 
  ArrowLeft,
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
  Angry,
  Trash2,

  GraduationCap,
  Code,
  Bot,
  FlaskRound,

  Map,
  Languages,
  Dumbbell,
  Database,
  Lightbulb,
  Calendar,
  Pen,
  Eye,
  EyeOff,
  Brain,
  BrainCircuit,
  Monitor,
  Globe,
  LogOut,
  Image,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { ThemeSelector } from "./ThemeSelector";
import FileUploadModal from "./FileUploadModal";
import PersonaEditModal from "./PersonaEditModal";
import ChatbotSettingsModal from "./ChatbotSettingsModal";
import VisibilitySettingsModal from "./VisibilitySettingsModal";
import IconChangeModal from "./IconChangeModal";

import BasicInfoEditModal from "./BasicInfoEditModal";
import { useIsTablet } from "@/hooks/use-tablet";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Agent, Message, ChatResponse, Conversation } from "@/types/agent";

// Icon mapping for agent icons
const iconMap: Record<string, any> = {
  "fas fa-graduation-cap": GraduationCap,
  "fas fa-code": Code,
  "fas fa-robot": Bot,
  "fas fa-user": User,
  "fas fa-flask": FlaskRound,
  "fas fa-map": Map,
  "fas fa-language": Languages,
  "fas fa-dumbbell": Dumbbell,
  "fas fa-database": Database,
  "fas fa-lightbulb": Lightbulb,
  "fas fa-heart": Heart,
  "fas fa-calendar": Calendar,
  "fas fa-pen": Pen,
  "fas fa-file-alt": FileText,
};

interface ChatInterfaceProps {
  agent: Agent;
  isManagementMode?: boolean;
}

const ChatInterface = forwardRef<any, ChatInterfaceProps>(({ agent, isManagementMode = false }, ref) => {
  const isTablet = useIsTablet();
  const { t, language } = useLanguage();
  const [location, setLocation] = useLocation();
  const [message, setMessage] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);
  const [showPersonaModal, setShowPersonaModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showIconModal, setShowIconModal] = useState(false);
  
  // Debug: Log showIconModal state changes
  useEffect(() => {
    console.log(`ChatInterface: showIconModal state changed to: ${showIconModal}, isManagementMode: ${isManagementMode}, agentId: ${agent.id}`);
  }, [showIconModal, isManagementMode, agent.id]);

  const [showFileListModal, setShowFileListModal] = useState(false);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [showBasicInfoModal, setShowBasicInfoModal] = useState(false);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  
  // 🔙 채팅방 진입 전 위치 저장 (채팅방 내부 이동은 저장하지 않음)
  useEffect(() => {
    // 현재 위치가 채팅방이 아닐 때만 referrer 저장
    if (location && !location.startsWith('/chat/')) {
      sessionStorage.setItem(`chatReferrer_${agent.id}`, location);
    }
  }, []); // 컴포넌트 마운트 시 한 번만 실행

  // 🔙 뒤로가기 핸들러 (채팅방 진입 전 위치로 복귀)
  const handleGoBack = () => {
    const referrer = sessionStorage.getItem(`chatReferrer_${agent.id}`);
    sessionStorage.removeItem(`chatReferrer_${agent.id}`);
    
    if (referrer && referrer !== location) {
      setLocation(referrer);
    } else {
      // referrer가 없으면 카드 홈으로
      setLocation('/');
    }
  };
  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [notificationState, setNotificationState] = useState<"idle" | "waiting_input" | "waiting_approval">("idle");
  const [pendingNotification, setPendingNotification] = useState("");
  const [hasMarkedAsRead, setHasMarkedAsRead] = useState(false);
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<number | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<number, string>>({});
  const [showDocumentPreview, setShowDocumentPreview] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<any>(null);
  const [showPDFViewer, setShowPDFViewer] = useState(false);
  const [selectedPDFDocument, setSelectedPDFDocument] = useState<any>(null);
  const [longPressTimer, setLongPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [showGeneralMenu, setShowGeneralMenu] = useState(false);
  const [showChatHistoryDeleteDialog, setShowChatHistoryDeleteDialog] = useState(false);
  const [showLeaveConversationDialog, setShowLeaveConversationDialog] = useState(false);
  
  // Use ref to immediately prevent conversation creation during leave
  const isLeavingConversationRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch current user information
  const { data: user } = useQuery({
    queryKey: ["/api/user"],
  });
  
  const userRole = (user as any)?.role || 'general';
  const isAdmin = userRole === 'agent_admin' || userRole === 'operation_admin' || userRole === 'master_admin';

  // Fetch reactions for conversation
  const { data: conversationReactions } = useQuery({
    queryKey: [`/api/conversations/${conversation?.id}/reactions`],
    enabled: !!conversation?.id,
  });

  // Update local state when reactions are fetched
  useEffect(() => {
    if (conversationReactions) {
      const reactionMap: Record<number, string> = {};
      Object.entries(conversationReactions).forEach(([messageId, reaction]) => {
        if (reaction) {
          reactionMap[parseInt(messageId)] = (reaction as any).reaction;
        }
      });
      setMessageReactions(reactionMap);
    }
  }, [conversationReactions]);

  // Handle click outside to dismiss reaction UI
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (activeReactionMessageId) {
        const target = event.target as Element;
        // Check if clicked outside of reaction UI
        if (!target.closest('[data-reaction-ui]')) {
          setActiveReactionMessageId(null);
        }
      }
    };

    const handleMouseClick = (event: MouseEvent) => handleClickOutside(event);
    const handleTouchStart = (event: TouchEvent) => handleClickOutside(event);

    if (activeReactionMessageId) {
      document.addEventListener('click', handleMouseClick);
      document.addEventListener('touchstart', handleTouchStart);
    }

    return () => {
      document.removeEventListener('click', handleMouseClick);
      document.removeEventListener('touchstart', handleTouchStart);
    };
  }, [activeReactionMessageId]);

  // Reaction mutations
  const createReactionMutation = useMutation({
    mutationFn: async ({ messageId, reaction }: { messageId: number; reaction: string }) => {
      const response = await fetch(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction }),
      });
      if (!response.ok) throw new Error('Failed to create reaction');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation?.id}/reactions`] });
    },
  });

  const deleteReactionMutation = useMutation({
    mutationFn: async (messageId: number) => {
      const response = await fetch(`/api/messages/${messageId}/reactions`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete reaction');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation?.id}/reactions`] });
    },
  });

  // Delete single message mutation (admin only)
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageInfo: { id: number; conversationId?: number }) => {
      // Bulk delete if id is -1
      if (messageInfo.id === -1) {
        const response = await fetch('/api/messages/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            messageIds: Array.from(selectedMessages),
            conversationId: messageInfo.conversationId 
          }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to delete messages');
        }
        return response.json();
      }
      
      // Single message delete
      const response = await fetch(`/api/messages/${messageInfo.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: messageInfo.conversationId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete message');
      }
      return response.json();
    },
    onSuccess: (data, variables) => {
      const isBulk = variables.id === -1;
      toast({
        title: "메시지 삭제 완료",
        description: isBulk 
          ? `${selectedMessages.size}개의 메시지가 성공적으로 삭제되었습니다.`
          : "메시지가 성공적으로 삭제되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation?.id}/messages`] });
      setMessageToDelete(null);
      setSelectedMessages(new Set());
      setIsEditMode(false);
    },
    onError: (error: Error) => {
      toast({
        title: "메시지 삭제 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete chat history mutation
  const deleteChatHistoryMutation = useMutation({
    mutationFn: async () => {
      if (!conversation?.id) throw new Error('No conversation found');
      const response = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete chat history');
      return response.json();
    },
    onSuccess: () => {
      // Invalidate messages query to refresh the chat
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation?.id}/messages`] });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      
      // Clear optimistic messages
      setOptimisticMessages([]);
      
      // Add friendly restart message
      setTimeout(() => {
        addSystemMessage("채팅 기록이 모두 삭제되었습니다. 새로운 대화를 시작해보세요! 😊");
      }, 500);
      
      toast({ 
        title: "채팅 기록 삭제 완료", 
        description: "모든 대화 기록이 삭제되었습니다." 
      });
    },
  });

  // Leave conversation mutation
  const leaveConversationMutation = useMutation({
    mutationFn: async () => {
      if (!conversation?.id) throw new Error('No conversation found');
      console.log(`[🚪 CLIENT LEAVE] Sending DELETE request for conversation ${conversation.id}`);
      const response = await fetch(`/api/conversations/${conversation.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      console.log(`[🚪 CLIENT LEAVE] Response status: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error(`[🚪 CLIENT LEAVE] ❌ Error:`, errorData);
        throw new Error(errorData.message || 'Failed to leave conversation');
      }
      const result = await response.json();
      console.log(`[🚪 CLIENT LEAVE] ✅ Success:`, result);
      return result;
    },
    onSuccess: async () => {
      // Set ref IMMEDIATELY to prevent any conversation creation
      isLeavingConversationRef.current = true;
      console.log('[🚪 LEAVE] Set isLeavingConversationRef to true');
      
      // Remove all conversation-related caches to prevent showing hidden conversations
      queryClient.removeQueries({ queryKey: ['/api/conversations'] });
      queryClient.removeQueries({ queryKey: ['/api/conversations/management'] });
      
      // Remove individual conversation cache for this agent
      if (agent?.id) {
        queryClient.removeQueries({ queryKey: ['/api/conversations', agent.id] });
        queryClient.removeQueries({ queryKey: ['/api/conversations/management', agent.id] });
      }
      
      // Remove preloading cache to prevent hidden conversations from reappearing
      queryClient.removeQueries({ queryKey: ['/api/preload-recent-chats'] });
      
      toast({ 
        title: "대화방 나가기 완료", 
        description: "대화방에서 나갔습니다." 
      });
      
      // Navigate to conversation list without page reload
      setLocation('/');
      
      // Force refetch after navigation
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['/api/conversations'], type: 'active' });
        queryClient.refetchQueries({ queryKey: ['/api/preload-recent-chats'], type: 'active' });
        // Reset the ref after navigation completes
        isLeavingConversationRef.current = false;
        console.log('[🚪 LEAVE] Reset isLeavingConversationRef to false');
      }, 300);
    },
    onError: (error: Error) => {
      toast({ 
        title: "대화방 나가기 실패", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Handler functions for the new actions
  const handleDeleteChatHistory = () => {
    deleteChatHistoryMutation.mutate();
    setShowChatHistoryDeleteDialog(false);
  };

  const handleLeaveConversation = () => {
    console.log('[🚪 BUTTON CLICK] 대화방 나가기 버튼 클릭됨, conversation:', conversation?.id);
    leaveConversationMutation.mutate();
    setShowLeaveConversationDialog(false);
  };

  // Function to add system message from agent
  const addSystemMessage = (content: string) => {
    const systemMessage: Message = {
      id: -(Date.now() + Math.floor(Math.random() * 10000)), // Negative ID for optimistic messages
      conversationId: conversation?.id || 0,
      content: `🔧 ${content}`, // Add system indicator prefix
      isFromUser: false,
      createdAt: new Date().toISOString(),
    };
    setOptimisticMessages(prev => [...prev, systemMessage]);
  };

  // Expose functions and state to parent component
  useImperativeHandle(ref, () => ({
    setShowPersonaModal,
    setShowIconModal,
    setShowSettingsModal,
    setShowFileModal,
    setShowFileListModal,
    setNotificationState,
    addSystemMessage
  }));

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

  // 메시지 내용 포맷팅 (@멘션, **볼드**, URL 링크 처리)
  const formatMessageContent = (content: string) => {
    // @멘션, **볼드**, URL 패턴을 모두 찾아서 교체
    const replacements: Array<{ 
      start: number; 
      end: number; 
      type: 'mention' | 'bold' | 'url'; 
      agentName?: string;
      text?: string;
      url?: string;
    }> = [];
    
    // @멘션 찾기 (에이전트 이름 사용)
    const mentionText = `@${agent.name}`;
    let index = 0;
    
    while (true) {
      const foundIndex = content.indexOf(mentionText, index);
      if (foundIndex === -1) break;
      
      replacements.push({
        start: foundIndex,
        end: foundIndex + mentionText.length,
        type: 'mention',
        agentName: agent.name
      });
      
      index = foundIndex + mentionText.length;
    }
    
    // **볼드** 패턴 찾기
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let boldMatch;
    while ((boldMatch = boldRegex.exec(content)) !== null) {
      replacements.push({
        start: boldMatch.index,
        end: boldMatch.index + boldMatch[0].length,
        type: 'bold',
        text: boldMatch[1] // ** 사이의 텍스트만
      });
    }
    
    // URL 패턴 찾기 (http://, https://, www. 또는 domain.com 형태)
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(content)) !== null) {
      const originalUrl = urlMatch[0];
      
      // URL 끝의 문장부호 제거 (마침표, 쉼표, 느낌표, 물음표, 콜론, 세미콜론, 괄호, 따옴표, 마크다운 기호)
      const trailingPunctuationRegex = /[.,!?:;)}\]"'*`>]+$/;
      const cleanUrl = originalUrl.replace(trailingPunctuationRegex, '');
      const removedLength = originalUrl.length - cleanUrl.length;
      
      // URL이 http:// 또는 https://로 시작하지 않으면 https:// 추가
      const fullUrl = cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://') ? cleanUrl : `https://${cleanUrl}`;
      
      replacements.push({
        start: urlMatch.index,
        end: urlMatch.index + originalUrl.length - removedLength, // 원본 길이에서 제거된 문장부호 길이 빼기
        type: 'url',
        text: cleanUrl, // 화면에 표시될 텍스트 (문장부호 제거됨)
        url: fullUrl // 실제 링크 URL
      });
    }
    
    // URL 우선 겹침 해소: URL과 겹치는 모든 다른 타입 제거
    const urlReplacements = replacements.filter(r => r.type === 'url');
    const nonUrlReplacements = replacements.filter(r => r.type !== 'url');
    
    // URL과 겹치지 않는 다른 타입들만 유지
    const filteredNonUrls = nonUrlReplacements.filter(nonUrl => {
      return !urlReplacements.some(url => {
        // 겹침 조건: URL과 다른 타입이 겹치는 경우
        return !(nonUrl.end <= url.start || nonUrl.start >= url.end);
      });
    });
    
    // URL + 겹치지 않는 다른 타입들을 결합하고 시작점으로 정렬
    const uniqueReplacements = [...urlReplacements, ...filteredNonUrls]
      .sort((a, b) => a.start - b.start);
    
    if (uniqueReplacements.length === 0) return content;
    
    // JSX 요소 배열 생성
    const parts = [];
    let lastIndex = 0;
    
    uniqueReplacements.forEach((replacement, index) => {
      // 이전 텍스트 추가
      if (replacement.start > lastIndex) {
        parts.push(content.slice(lastIndex, replacement.start));
      }
      
      if (replacement.type === 'mention') {
        // @에이전트이름 추가 (기본 볼드 처리)
        parts.push(
          <strong key={`mention-${index}`}>
            @{replacement.agentName}
          </strong>
        );
      } else if (replacement.type === 'bold') {
        // 볼드 텍스트 추가
        parts.push(
          <strong key={`bold-${index}`}>
            {replacement.text}
          </strong>
        );
      } else if (replacement.type === 'url') {
        // URL 링크 추가 (새 탭에서 열기)
        parts.push(
          <a 
            key={`url-${index}`}
            href={replacement.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          >
            {replacement.text}
          </a>
        );
      }
      
      lastIndex = replacement.end;
    });
    
    // 남은 텍스트 추가
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }
    
    return parts;
  };

  // Reaction handlers
  const handleReactionToggle = (messageId: number) => {
    setActiveReactionMessageId(prev => prev === messageId ? null : messageId);
  };

  const handleReactionSelect = (messageId: number, reaction: string) => {
    const currentReaction = messageReactions[messageId];
    
    if (currentReaction === reaction) {
      // Remove reaction if same reaction is clicked
      deleteReactionMutation.mutate(messageId);
      setMessageReactions(prev => {
        const newReactions = { ...prev };
        delete newReactions[messageId];
        return newReactions;
      });
    } else {
      // Set new reaction
      createReactionMutation.mutate({ messageId, reaction });
      setMessageReactions(prev => ({
        ...prev,
        [messageId]: reaction
      }));
    }
    
    setActiveReactionMessageId(null);
  };

  const reactionOptions = [
    { emoji: '👍', icon: ThumbsUp, label: 'Like' },
    { emoji: '👎', icon: ThumbsDown, label: 'Dislike' }
  ];

  // Long press handlers for mobile and desktop
  const handleLongPressStart = (messageId: number) => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    const timer = setTimeout(() => {
      setActiveReactionMessageId(messageId);
      // Add haptic feedback if available (mobile only)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500); // 500ms for long press
    
    setLongPressTimer(timer);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    // Don't clear activeReactionMessageId here - let it persist until manual dismissal
  };

  const handleLongPressCancel = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    // Don't clear activeReactionMessageId here - let it persist until manual dismissal
  };

  const handleMessageClick = (messageId: number, isFromUser: boolean, isSystem: boolean) => {
    // Disable click-based reaction toggle - only use long press
    return;
  };


  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Document visibility toggle mutation
  const toggleDocumentVisibilityMutation = useMutation({
    mutationFn: async ({ documentId, isVisible }: { documentId: number; isVisible: boolean }) => {
      const response = await apiRequest("PATCH", `/api/documents/${documentId}/visibility`, { 
        isVisible: isVisible 
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/agents/${agent.id}/documents`]
      });
    },
    onError: (error) => {
      toast({
        title: "설정 변경 실패",
        description: "문서 노출 설정을 변경할 수 없습니다.",
        variant: "destructive",
      });
    }
  });

  // Document training toggle mutation
  const toggleDocumentTrainingMutation = useMutation({
    mutationFn: async ({ documentId, isTraining }: { documentId: number; isTraining: boolean }) => {
      const response = await apiRequest("PATCH", `/api/documents/${documentId}/training`, { 
        isUsedForTraining: isTraining 
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/agents/${agent.id}/documents`]
      });
    },
    onError: (error) => {
      toast({
        title: "설정 변경 실패",
        description: "문서 학습 설정을 변경할 수 없습니다.",
        variant: "destructive",
      });
    }
  });

  // Helper function to get document type based on file extension
  const getDocumentType = (filename: string): string => {
    const extension = filename.toLowerCase().split('.').pop();
    switch (extension) {
      case 'pdf':
        return '강의자료';
      case 'doc':
      case 'docx':
        return '정책·규정 문서';
      case 'ppt':
      case 'pptx':
        return '교육과정';
      case 'txt':
        return '매뉴얼';
      default:
        return '기타';
    }
  };

  // Helper function to get document type badge color
  const getDocumentTypeBadgeColor = (type: string): string => {
    switch (type) {
      case '강의자료':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case '정책·규정 문서':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      case '교육과정':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case '매뉴얼':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case '양식':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400';
      case '공지사항':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  // Broadcast notification mutation
  const broadcastMutation = useMutation({
    mutationFn: async ({ agentId, message }: { agentId: number; message: string }) => {
      const response = await apiRequest("POST", `/api/agents/${agentId}/broadcast`, { message });
      return response.json();
    },
    onSuccess: (data, variables) => {
      // Use the message from the mutation variables instead of pendingNotification state
      addSystemMessage(`🔧 알림이 전송되었습니다.\n\n내용: "${variables.message}"\n대상: ${agent.name} 사용자 ${data.totalRecipients}명\n시간: ${new Date().toLocaleString('ko-KR')}`);
      
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
      // Check ref immediately to prevent race conditions
      if (isLeavingConversationRef.current) {
        console.log('[🚪 QUERY BLOCKED] Prevented conversation creation during leave');
        throw new Error('Leaving conversation');
      }
      const endpoint = isManagementMode ? "/api/conversations/management" : "/api/conversations";
      const response = await apiRequest("POST", endpoint, { agentId: agent.id });
      return response.json();
    },
    enabled: !isLeavingConversationRef.current, // Don't fetch when leaving conversation
    gcTime: 0, // Don't cache - always fetch fresh data to prevent showing hidden conversations
    staleTime: 0, // Always consider data stale to trigger refetch
    retry: false, // Don't retry if blocked during leave
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
  // 1:1 대화 메시지 조회 (프리로딩된 캐시 즉시 활용)
  const { data: messagesData = [], isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: [`/api/conversations/${conversation?.id}/messages`],
    enabled: !!conversation?.id,
    initialData: () => {
      // 프리로딩된 캐시 데이터를 즉시 사용
      const cachedData = queryClient.getQueryData([`/api/conversations/${conversation?.id}/messages`]) as Message[] | undefined;
      console.log(`🚀 [PRELOAD DEBUG] Conversation ${conversation?.id} 캐시 확인:`, {
        conversationId: conversation?.id,
        hasCachedData: !!cachedData,
        messageCount: cachedData?.length || 0
      });
      return cachedData;
    },
    staleTime: 1000 * 60 * 2, // 2분간 캐시 유지 (프리로딩 효과 극대화)
    refetchInterval: 15000, // 15초마다 백그라운드에서 새 메시지 확인
    refetchOnMount: false, // 캐시된 데이터 즉시 표시, 백그라운드에서만 업데이트
    refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 재요청 비활성화
  });

  const messages = messagesData;

  // Get agent documents for file list
  const { data: documents = [] } = useQuery<any[]>({
    queryKey: [`/api/agents/${agent.id}/documents`],
    enabled: !!agent.id, // Always enabled when agent ID is available
    refetchOnWindowFocus: true,
    refetchInterval: 3000, // 3초마다 자동 새로고침 (더 빠른 동기화)
    queryFn: async () => {
      const response = await fetch(`/api/agents/${agent.id}/documents`, {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      return response.json();
    }
  });

  // Set conversation when data is available and mark as read (only once)
  useEffect(() => {
    if (conversationData && (!conversation || conversation.id !== conversationData.id)) {
      setConversation(conversationData);
      setHasMarkedAsRead(false);
      
      // Clear optimistic messages when switching conversations
      setOptimisticMessages([]);
      setIsTyping(false);
      setHasInitialScrolled(false);
      
      // Mark conversation as read when opened (only for new conversations with unread messages)
      if (!isManagementMode && conversationData.unreadCount > 0 && !hasMarkedAsRead) {
        setHasMarkedAsRead(true);
        markAsReadMutation.mutate(conversationData.id);
      }
    }
  }, [conversationData?.id, isManagementMode, hasMarkedAsRead]);

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
      }
    };
  }, [longPressTimer]);

  // Initialize textarea height on mount  
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  }, []);

  // Global click handler to dismiss reaction UI
  useEffect(() => {
    const handleGlobalClick = () => {
      setActiveReactionMessageId(null);
    };

    if (activeReactionMessageId !== null) {
      document.addEventListener('click', handleGlobalClick);
    }

    return () => {
      document.removeEventListener('click', handleGlobalClick);
    };
  }, [activeReactionMessageId]);

  // Show welcome message for management mode when conversation is empty
  useEffect(() => {
    if (isManagementMode && messages && messages.length === 0 && conversation?.id) {
      // Add welcome message for management mode
      setTimeout(() => {
        addSystemMessage(`🔧 ${agent.name} 관리자 모드에 오신 것을 환영합니다!

대화를 통해 다음 기능들을 실행할 수 있습니다:

• "페르소나 편집" - 에이전트 성격 및 말투 설정
• "모델 및 응답 설정" - LLM 모델 및 동작 방식 변경  
• "아이콘 변경" - 에이전트 아이콘 및 배경색 커스터마이징
• "문서 업로드" - 지식베이스 확장용 문서 추가
• "문서 관리" - 업로드된 문서 목록 확인 및 관리
• "공개 설정" - 에이전트 공개 범위 및 조직별 접근 권한 확인
• "알림보내기" - 사용자들에게 공지사항 전송
• "성과 분석" - 에이전트 사용 통계 및 분석

원하는 기능을 메시지로 입력하거나, 일반 대화도 가능합니다.`);
      }, 500);
    }
  }, [isManagementMode, messages?.length, conversation?.id, agent.name]);

  // Auto-scroll to bottom when new messages arrive - with better spacing
  const scrollToBottom = () => {
    setTimeout(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ 
          behavior: "smooth",
          block: "end", // 메시지가 화면 하단에 완전히 보이도록
          inline: "nearest"
        });
      }
    }, 100);
  };

  // Auto-mark conversation as read when new messages arrive while user is viewing
  useEffect(() => {
    if (conversation?.id && messages && messages.length > 0) {
      // Get current conversation data from cache
      const conversations = queryClient.getQueryData(["/api/conversations"]) as any[];
      const currentConv = conversations?.find((conv: any) => conv.id === conversation.id);
      
      // Only mark as read if there are unread messages and not already marked for this conversation
      if (currentConv && currentConv.unreadCount > 0 && !hasMarkedAsRead) {
        setHasMarkedAsRead(true);
        markAsReadMutation.mutate(conversation.id);
      }
      
      // Scroll to bottom when new messages arrive
      setTimeout(() => scrollToBottom(), 50);
    }
  }, [messages?.length, conversation?.id, queryClient, markAsReadMutation, hasMarkedAsRead]);

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
        id: -(Date.now() + Math.floor(Math.random() * 10000)), // Negative ID for optimistic messages
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
      
      // Update messages cache more safely
      queryClient.setQueryData([`/api/conversations/${conversation?.id}/messages`], (oldMessages: Message[] = []) => {
        // Create a copy of existing messages
        const existingMessages = [...oldMessages];
        
        // Check if user message already exists (by content and timestamp proximity)
        const userMessageExists = existingMessages.some(msg => 
          msg.isFromUser && 
          msg.content === data.userMessage.content && 
          Math.abs(new Date(msg.createdAt).getTime() - new Date(data.userMessage.createdAt).getTime()) < 10000
        );
        
        // Add user message if it doesn't exist
        if (!userMessageExists) {
          existingMessages.push(data.userMessage);
        }
        
        // Always add AI message (should be unique)
        existingMessages.push(data.aiMessage);
        
        return existingMessages;
      });
      
      // Clear optimistic messages and typing indicator after updating cache
      setOptimisticMessages([]);
      setIsTyping(false);
      
      // Update conversation list cache with new message data and re-sort
      queryClient.setQueryData(["/api/conversations"], (oldData: any[]) => {
        if (!oldData) return oldData;
        const updatedData = oldData.map(conv => 
          conv.id === conversation?.id 
            ? { 
                ...conv, 
                lastMessage: data.aiMessage,
                lastMessageAt: data.aiMessage.createdAt,
                unreadCount: 0 // Always set to 0 since user is actively viewing this conversation
              }
            : conv
        );
        
        // Re-sort conversations by lastMessageAt in descending order
        return updatedData.sort((a, b) => {
          const aTime = new Date(a.lastMessageAt || a.createdAt || 0).getTime();
          const bTime = new Date(b.lastMessageAt || b.createdAt || 0).getTime();
          return bTime - aTime;
        });
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
      resetMessageInput();
      
      // Show approval message
      addSystemMessage(`알림 내용: "${messageContent}"\n\n전송하시겠습니까? (승인/취소)`);
      return;
    }
    
    if (notificationState === "waiting_approval") {
      const lowerMessage = messageContent.toLowerCase();
      if (lowerMessage === "승인" || lowerMessage === "네" || lowerMessage === "yes") {
        // Execute notification - broadcast to all users
        setNotificationState("idle");
        resetMessageInput();
        
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
        resetMessageInput();
        addSystemMessage("알림 전송이 취소되었습니다.");
        setPendingNotification("");
        return;
      } else {
        resetMessageInput();
        addSystemMessage("'승인' 또는 '취소'를 입력해주세요.");
        return;
      }
    }
    
    // Clear message first for immediate UI feedback
    resetMessageInput();
    
    // Normal message sending
    sendMessageMutation.mutate(messageContent);
    
    // Scroll to bottom after sending message
    setTimeout(() => scrollToBottom(), 100);
  };

  // Combine real messages with optimistic messages
  const allMessages = [...(messages || []), ...optimisticMessages];
  
  // Debug logging for message state
  console.log(`[DEBUG] ChatInterface: messages=${messages?.length || 0}, optimistic=${optimisticMessages.length}, all=${allMessages.length}`, {
    messagesLoading,
    conversationId: conversation?.id,
    agentId: agent.id
  });

  // Helper function to reset message input and textarea height
  const resetMessageInput = () => {
    // Reset textarea FIRST before clearing message to prevent height calculation issues
    if (textareaRef.current) {
      textareaRef.current.value = ''; // Clear value directly
      textareaRef.current.style.height = '40px'; // Reset to min-height
    }
    setMessage(""); // Then update React state
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 파일 업로드 핸들러
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', '기타');
      formData.append('description', '');

      if (!conversation?.id) {
        throw new Error('대화를 찾을 수 없습니다.');
      }

      const response = await fetch(`/api/conversations/${conversation.id}/documents`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '업로드 실패');
      }

      const result = await response.json();
      
      // 대화 메시지 목록 강제 새로고침하여 시스템 메시지 표시
      await queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversation.id}/messages`] });
      await queryClient.refetchQueries({ queryKey: [`/api/conversations/${conversation.id}/messages`] });
      queryClient.invalidateQueries({ queryKey: [`/api/agents/${agent.id}/documents`] });
      
    } catch (error) {
      console.error('업로드 오류:', error);
      toast({
        title: "업로드 실패",
        description: error instanceof Error ? error.message : "파일 업로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }

    // 파일 입력 초기화
    if (event.target) {
      event.target.value = '';
    }
  };

  // Only scroll to bottom when initially entering a conversation (one time only)
  const [hasInitialScrolled, setHasInitialScrolled] = useState(false);
  
  useEffect(() => {
    if (conversation?.id && messages && messages.length > 0 && !hasInitialScrolled) {
      // Only scroll once when first entering a conversation - instant positioning without animation
      setTimeout(() => {
        if (messagesEndRef.current && messagesContainerRef.current) {
          // Temporarily disable smooth scrolling for instant positioning
          const originalScrollBehavior = messagesContainerRef.current.style.scrollBehavior;
          messagesContainerRef.current.style.scrollBehavior = 'auto';
          
          // Use scrollTop for instant positioning to the bottom
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
          
          // Restore original scroll behavior for future scrolls
          setTimeout(() => {
            if (messagesContainerRef.current) {
              messagesContainerRef.current.style.scrollBehavior = originalScrollBehavior;
            }
          }, 50);
          
          setHasInitialScrolled(true);
        }
      }, 200);
    }
  }, [conversation?.id, messages, hasInitialScrolled]);

  // Reset scroll flag when conversation changes
  useEffect(() => {
    setHasInitialScrolled(false);
  }, [conversation?.id]);

  // Minimal mobile handling - remove all complex viewport logic
  useEffect(() => {
    if (!isTablet) {
      // Do nothing - let browser handle naturally
    }
  }, [isTablet]);

  // Detect device type for interaction
  const [isTouch, setIsTouch] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<{ 
    id: number; 
    conversationId?: number;
  } | null>(null);
  
  // Edit mode for message management (admin only)
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  
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
    <div className={`h-full bg-white flex flex-col ${isTablet && isAdmin ? 'pt-12 md:pt-10' : ''}`}>
      {/* Header for both mobile and tablet - shown in both general and management modes */}
      <header className={`relative bg-background border-b border-border ${!isTablet ? "fixed top-0 left-0 right-0 z-50" : ""}`}>
        <div className={`${isTablet ? "px-6 py-4" : "px-4 py-3"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {/* Back button - always show for easy navigation */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1"
                  onClick={handleGoBack}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div 
                  className="w-10 h-10 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: agent.backgroundColor }}
                >
                  {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                    <>
                      <img 
                        src={agent.icon} 
                        alt={`${agent.name} icon`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          const fallbackIcon = target.parentElement?.querySelector('.fallback-icon') as HTMLElement;
                          target.style.display = 'none';
                          if (fallbackIcon) {
                            fallbackIcon.style.display = 'block';
                          }
                        }}
                      />
                      {(() => {
                        const IconComponent = iconMap[agent.icon] || User;
                        return <IconComponent className="fallback-icon text-white w-5 h-5" style={{ display: 'none' }} />;
                      })()}
                    </>
                  ) : (
                    (() => {
                      const IconComponent = iconMap[agent.icon] || User;
                      return <IconComponent className="text-white w-5 h-5" />;
                    })()
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-foreground korean-text">{agent.name}</h3>
                  <p className="text-sm text-muted-foreground korean-text">
                    {isManagementMode ? t('agent.managementMode') : t('agent.generalChat')}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {/* Edit mode toggle button for admins */}
                {isAdmin && !isEditMode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-3 py-2 korean-text"
                    onClick={() => setIsEditMode(true)}
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    편집
                  </Button>
                )}
                
                {/* Edit mode actions */}
                {isAdmin && isEditMode && (
                  <>
                    <span className="text-sm text-muted-foreground korean-text">
                      {selectedMessages.size}개 선택
                    </span>
                    {selectedMessages.size > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="px-3 py-2 korean-text"
                        onClick={() => {
                          if (selectedMessages.size > 0) {
                            setMessageToDelete({ 
                              id: -1, // Special value to indicate bulk delete
                              conversationId: conversation?.id 
                            });
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        삭제
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="px-3 py-2 korean-text"
                      onClick={() => {
                        setIsEditMode(false);
                        setSelectedMessages(new Set());
                      }}
                    >
                      완료
                    </Button>
                  </>
                )}
                
                {/* Settings button for general chat mode */}
                {!isManagementMode && !isEditMode && (
                  <div className="relative">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="px-3 py-2 korean-text"
                      onClick={() => setShowGeneralMenu(!showGeneralMenu)}
                    >
                      기능 선택
                    </Button>
                  
                    {/* General Chat Dropdown Menu */}
                    {showGeneralMenu && (
                      <>
                        {/* Invisible overlay to catch outside clicks */}
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowGeneralMenu(false)}
                        />
                        <div className="absolute right-0 top-full mt-2 w-48 bg-background border border-border rounded-xl shadow-lg z-50">
                          <div className="py-2">
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowFileListModal(true);
                                setShowGeneralMenu(false);
                              }}
                            >
                              <Files className="w-4 h-4 mr-2" />
                              {t('files.uploadedFiles')}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowChatHistoryDeleteDialog(true);
                                setShowGeneralMenu(false);
                              }}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {t('chat.deleteHistory')}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 text-destructive hover:text-destructive korean-text"
                              onClick={() => {
                                console.log('[🚪 MENU CLICK] "대화방 나가기" 메뉴 클릭됨');
                                setShowLeaveConversationDialog(true);
                                setShowGeneralMenu(false);
                              }}
                            >
                              <LogOut className="w-4 h-4 mr-2" />
                              대화방 나가기
                            </Button>

                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                
                {isManagementMode && !isEditMode && (
                  <div className="relative">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="px-3 py-2 korean-text"
                      onClick={() => setShowMenu(!showMenu)}
                    >
                      {t('agent.functionsSelect')}
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
                                setShowBasicInfoModal(true);
                                setShowMenu(false);
                                addSystemMessage("기본 정보 편집 창을 열었습니다. 에이전트 이름, 설명, 카테고리 등을 수정할 수 있습니다.");
                              }}
                            >
                              <Bot className="w-4 h-4 mr-2" />
                              {t('agent.basicInfo')}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowPersonaModal(true);
                                setShowMenu(false);
                                addSystemMessage("페르소나 편집 창을 열았습니다. 닉네임, 말투 스타일, 지식 분야, 성격 특성, 금칙어 반응 방식을 수정할 수 있습니다.");
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
                              <Image className="w-4 h-4 mr-2" />
                              {t('agent.iconChange')}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowSettingsModal(true);
                                setShowMenu(false);
                                addSystemMessage("모델 및 응답 설정 창을 열었습니다. LLM 모델과 챗봇 유형을 변경할 수 있습니다.");
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
                              onClick={() => {
                                setShowFileListModal(true);
                                setShowMenu(false);
                                addSystemMessage("문서 관리 창을 열었습니다. 업로드된 문서를 확인하고 삭제할 수 있습니다.");
                              }}
                            >
                              <Files className="w-4 h-4 mr-2" />
                              {t('agent.documentManagement')}
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
                                      const performanceMessage = `📊 ${data.agentName} 성과 분석 (${data.period}) 📑
▶ 주요 지표
- 총 대화 수: ${data.metrics.totalMessages}건
- 활성 사용자 수: ${data.metrics.activeUsers}명
- 업로드된 문서 수: ${data.metrics.documentsCount}개
- 최근 활동 횟수: ${data.metrics.recentActivity}건
- 사용률: ${data.metrics.usagePercentage}%
- 랭킹: ${data.metrics.ranking}위
- 평균 응답 시간: ${data.metrics.avgResponseTime}초

🔍 인사이트
${data.insights.map((insight: string) => `- ${insight}`).join('\n')}

📈 성장 트렌드
- 메시지 증가율: ${data.trends.messageGrowth}
- 사용자 증가율: ${data.trends.userGrowth}
- 참여율: ${data.trends.engagementRate}`;
                                      
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
                              {t('agent.performance')}
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full justify-start px-4 py-2 korean-text"
                              onClick={() => {
                                setShowVisibilityModal(true);
                                setShowMenu(false);
                                addSystemMessage("공개 설정 창을 열었습니다. 에이전트 사용자 그룹과 공개 범위를 설정할 수 있습니다.");
                              }}
                            >
                              <Globe className="w-4 h-4 mr-2" />
                              공개 설정
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
      {/* Chat Messages */}
      <div 
        ref={messagesContainerRef}
        className={`flex-1 overflow-y-auto p-4 space-y-2 ${!isTablet ? 'pt-20 pb-32' : ''} max-w-4xl mx-auto w-full`}
        style={{ minHeight: 0 }}
      >
          {messagesLoading ? (
            <div className="flex justify-center items-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : allMessages.length === 0 ? (
            <div className="flex justify-start">
              <div className="bg-gray-200 rounded-2xl px-4 py-2 text-gray-900">
                <p className="whitespace-pre-wrap">
                  {t('chat.agentGreeting', { name: agent.name })}
                </p>
              </div>
            </div>
          ) : (
            allMessages.map((msg, index) => {
                const isSystem = !msg.isFromUser && isSystemMessage(msg.content);
                const showReactionOptions = activeReactionMessageId === msg.id;
                const messageReaction = messageReactions[msg.id];
                
                // Generate unique key to prevent React key conflicts
                const uniqueKey = msg.id ? `msg-${msg.id}-${index}` : `optimistic-${index}-${Date.now()}-${Math.random()}`;
                
                return (
                  <div key={uniqueKey} className="message-row overflow-visible">
                    <div 
                      className={`relative w-full flex ${msg.isFromUser ? 'flex-row-reverse items-end' : 'flex-row items-start'} gap-2 overflow-visible`}
                    >
                        {/* Checkbox for edit mode */}
                        {isEditMode && isAdmin && msg.id && !isSystem && (
                          <input
                            type="checkbox"
                            checked={selectedMessages.has(msg.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newSelected = new Set(selectedMessages);
                              if (e.target.checked) {
                                newSelected.add(msg.id);
                              } else {
                                newSelected.delete(msg.id);
                              }
                              setSelectedMessages(newSelected);
                            }}
                            className="mt-2 w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer flex-shrink-0"
                          />
                        )}
                        
                        <div className="flex flex-col overflow-visible" style={{ maxWidth: '100%' }}>
                          {/* Chatbot name and time header for AI messages */}
                          {!msg.isFromUser && !isSystem && (
                            <div className="flex items-center gap-2 mb-1">
                              <div className="text-xs font-medium text-muted-foreground korean-text">
                                {agent.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false
                                })}
                              </div>
                            </div>
                          )}

                        <div
                          className={`${
                            msg.isFromUser
                              ? "minimal-message user"
                              : isSystem
                                ? "minimal-message system-message"
                                : "minimal-message assistant"
                          } text-sm md:text-base leading-relaxed korean-text relative`}
                          onClick={(e) => {
                            // Prevent click from dismissing reaction UI if it's active for this message
                            if (!msg.isFromUser && !isSystem && activeReactionMessageId === msg.id) {
                              e.stopPropagation();
                            }
                            handleMessageClick(msg.id, msg.isFromUser, isSystem);
                          }}
                          onTouchStart={() => {
                            if (!msg.isFromUser && !isSystem) {
                              handleLongPressStart(msg.id);
                            }
                          }}
                          onTouchEnd={handleLongPressEnd}
                          onTouchMove={handleLongPressCancel}
                          onMouseDown={() => {
                            if (!msg.isFromUser && !isSystem) {
                              handleLongPressStart(msg.id);
                            }
                          }}
                          onMouseUp={handleLongPressEnd}
                          onMouseLeave={handleLongPressCancel}
                        >
                          {isSystem && typeof msg.content === 'string' && msg.content.includes('• "') ? (
                            // 특별한 bullet point 포맷을 위한 시스템 메시지 처리
                            (() => {
                              const parts = msg.content.split('\n\n');
                              return (
                                <>
                                  {parts.map((part, idx) => {
                                    if (part.includes('• "')) {
                                      // Bullet points 섹션
                                      return (
                                        <div key={idx} className="bullet-points whitespace-pre-wrap">
                                          {part}
                                        </div>
                                      );
                                    } else {
                                      // 일반 텍스트 섹션
                                      return (
                                        <div key={idx} className="whitespace-pre-wrap">
                                          {formatMessageContent(part)}
                                          {idx < parts.length - 1 && '\n\n'}
                                        </div>
                                      );
                                    }
                                  })}
                                </>
                              );
                            })()
                          ) : (
                            <div className="whitespace-pre-wrap">
                              {typeof msg.content === 'string' ? formatMessageContent(msg.content) : JSON.stringify(msg.content)}
                            </div>
                          )}
                        </div>

                        {/* Time info and reactions below message bubble - only for user messages and system messages */}
                        {!isSystem && msg.isFromUser && (
                          <div 
                            className={`flex items-center gap-2 mt-1 ${msg.isFromUser ? 'justify-end' : 'justify-start'} relative overflow-visible`}
                            onClick={(e) => {
                              // Prevent click from dismissing reaction UI if it's active for this message
                              if (!msg.isFromUser && activeReactionMessageId === msg.id) {
                                e.stopPropagation();
                              }
                            }}>
                            <div className="text-xs text-muted-foreground">
                              {new Date(msg.createdAt).toLocaleTimeString('ko-KR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false
                              })}
                            </div>
                            {/* Delete button for admins */}
                            {isAdmin && msg.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMessageToDelete({ 
                                    id: msg.id, 
                                    conversationId: conversation?.id 
                                  });
                                }}
                                className="text-red-500 hover:text-red-700 transition-colors"
                                title="메시지 삭제"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}

                        {/* Reactions for AI messages - positioned below message bubble */}
                        {!msg.isFromUser && !isSystem && (
                          <div 
                            className="flex items-center gap-2 mt-1 justify-start relative overflow-visible"
                            onClick={(e) => {
                              // Prevent click from dismissing reaction UI if it's active for this message
                              if (activeReactionMessageId === msg.id) {
                                e.stopPropagation();
                              }
                            }}>
                            
                            {/* Reaction display for AI messages - positioned absolutely */}
                            {messageReactions[msg.id] && (
                              <div 
                                className="absolute left-full top-0 text-sm"
                                style={{ 
                                  marginLeft: '8px',
                                  zIndex: 100
                                }}>
                                {messageReactions[msg.id]}
                              </div>
                            )}

                            {/* Reaction Options - positioned absolutely with proper overflow handling */}
                            {activeReactionMessageId === msg.id && (
                              <div 
                                className="absolute left-full top-1/2 -translate-y-1/2 flex gap-1 bg-background border border-border rounded-full shadow-lg px-1 py-1 animate-in fade-in-0 zoom-in-95 duration-150"
                                data-reaction-ui
                                style={{ 
                                  marginLeft: '8px',
                                  zIndex: 10000,
                                  position: 'absolute'
                                }}
                                onClick={(e) => e.stopPropagation()}>
                                {reactionOptions.map((option) => (
                                  <button
                                    key={option.emoji}
                                    className="w-6 h-6 rounded-full bg-muted hover:bg-muted/80 transition-colors flex items-center justify-center"
                                    data-reaction-ui
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
                        )}
                      </div>
                    </div>
                  </div>
                );
            })
          )}
              
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-200 rounded-2xl px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Message Input */}
      <div className={`bg-white border-t border-gray-200 flex-shrink-0 ${!isTablet ? 'fixed bottom-0 left-0 right-0 z-40' : ''}`}>
        <div className="p-4">
          <div className="flex items-center gap-2">
            {/* + 버튼 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 w-10 h-10 p-0"
              title="문서 업로드"
            >
              <Plus className="w-4 h-4" />
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.docx,.doc"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                placeholder={t('chat.inputPlaceholder')}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  // Auto-resize on change
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={handleKeyDown}
                className="pr-10 min-h-[40px] max-h-[120px] resize-none flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                disabled={sendMessageMutation.isPending}
                rows={1}
                style={{
                  height: '40px',
                  minHeight: '40px',
                  maxHeight: '120px'
                }}
              />
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!message.trim() || sendMessageMutation.isPending}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-3"
            >
              <Send className="w-4 h-4" />
            </button>
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

      {/* File List Modal */}
      {showFileListModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]" onClick={() => setShowFileListModal(false)}>
          <div className="bg-background border border-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col shadow-lg" onClick={(e) => e.stopPropagation()}>
            {/* Fixed Header */}
            <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0 bg-background rounded-t-xl">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-black dark:text-white" />
                <h3 className="text-lg font-semibold korean-text">업로드된 파일</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFileListModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6">
            
            {Array.isArray(documents) && documents.length > 0 ? (
              <div className="space-y-3">
                {documents.filter((doc: any) => {
                  // 관리자가 아닌 일반 사용자에게는 숨김 처리된 문서를 보이지 않음
                  if (userRole !== 'master_admin' && userRole !== 'agent_admin') {
                    return doc.isVisibleToUsers === true;
                  }
                  // 관리자에게는 모든 문서 표시
                  return true;
                }).map((doc: any) => (
                  <div
                    key={doc.id}
                    className="w-full p-4 bg-muted rounded-lg border border-border"
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className="flex items-start space-x-3 flex-1 min-w-0">
                        <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium korean-text break-words flex-1">
                              {doc.originalName || doc.filename}
                            </p>
                            <Badge 
                              className={`text-xs px-2 py-1 rounded-full ${getDocumentTypeBadgeColor(getDocumentType(doc.originalName || doc.filename))}`}
                            >
                              {getDocumentType(doc.originalName || doc.filename)}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-2">
                            <span>
                              크기: {doc.size ? (doc.size / (1024 * 1024)).toFixed(2) + ' MB' : '알 수 없음'}
                            </span>
                            <span>•</span>
                            <span>
                              업로드: {new Date(doc.createdAt).toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                          {/* 관리자 모드에서만 토글 설정 표시 */}
                          {isManagementMode && (
                            <div className="flex items-center gap-4 mt-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`p-1 h-auto ${doc.isVisibleToUsers !== false ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
                                  onClick={() => {
                                    toggleDocumentVisibilityMutation.mutate({
                                      documentId: doc.id,
                                      isVisible: doc.isVisibleToUsers === false
                                    });
                                  }}
                                  title={doc.isVisibleToUsers !== false ? "사용자에게 노출됨 (클릭하여 숨김)" : "사용자에게 숨김 (클릭하여 노출)"}
                                >
                                  {doc.isVisibleToUsers !== false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {doc.isVisibleToUsers !== false ? "노출" : "비노출"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={`p-1 h-auto ${doc.isUsedForTraining !== false ? 'text-blue-600 hover:text-blue-700' : 'text-gray-400 hover:text-gray-600'}`}
                                  onClick={() => {
                                    toggleDocumentTrainingMutation.mutate({
                                      documentId: doc.id,
                                      isTraining: doc.isUsedForTraining === false
                                    });
                                  }}
                                  title={doc.isUsedForTraining !== false ? "학습에 사용됨 (클릭하여 제외)" : "학습에서 제외됨 (클릭하여 포함)"}
                                >
                                  {doc.isUsedForTraining !== false ? <BrainCircuit className="w-4 h-4" /> : <Brain className="w-4 h-4" />}
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  {doc.isUsedForTraining !== false ? "학습" : "미학습"}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 flex-shrink-0 ml-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2 hover:bg-green-100 dark:hover:bg-green-900/20"
                          onClick={async () => {
                            // Check if it's a PDF file
                            if (doc.mimeType === 'application/pdf') {
                              setSelectedPDFDocument(doc);
                              setShowPDFViewer(true);
                            } else {
                              // For non-PDF files, use the original preview
                              try {
                                const response = await fetch(`/api/documents/${doc.id}/content`, {
                                  credentials: 'include'
                                });
                                if (response.ok) {
                                  const docContent = await response.json();
                                  setSelectedDocument(docContent);
                                  setShowDocumentPreview(true);
                                } else {
                                  toast({
                                    title: "미리보기 실패",
                                    description: "문서 내용을 불러올 수 없습니다.",
                                    variant: "destructive",
                                  });
                                }
                              } catch (error) {
                                toast({
                                  title: "오류 발생",
                                  description: "문서 내용 조회 중 오류가 발생했습니다.",
                                  variant: "destructive",
                                });
                              }
                            }
                          }}
                          title="문서 내용 미리보기"
                        >
                          <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-2 hover:bg-blue-100 dark:hover:bg-blue-900/20"
                          onClick={() => {
                            // Download file
                            const link = document.createElement('a');
                            link.href = `/api/documents/${doc.id}/download`;
                            link.download = doc.originalName || doc.filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          title="파일 다운로드"
                        >
                          <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </Button>
                        {isManagementMode && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-2 hover:bg-red-100 dark:hover:bg-red-900/20"
                            onClick={async () => {
                              if (confirm('이 문서를 삭제하시겠습니까?')) {
                                try {
                                  const response = await fetch(`/api/documents/${doc.id}`, {
                                    method: 'DELETE',
                                    credentials: 'include'
                                  });
                                  
                                  if (response.ok) {
                                    toast({
                                      title: "문서 삭제 완료",
                                      description: "문서가 성공적으로 삭제되었습니다.",
                                    });
                                    // Force refresh the documents list
                                    await queryClient.invalidateQueries({
                                      queryKey: [`/api/agents/${agent.id}/documents`]
                                    });
                                    // Also force refetch immediately
                                    await queryClient.refetchQueries({
                                      queryKey: [`/api/agents/${agent.id}/documents`]
                                    });
                                  } else {
                                    throw new Error('삭제 실패');
                                  }
                                } catch (error) {
                                  toast({
                                    title: "삭제 실패",
                                    description: "문서 삭제 중 오류가 발생했습니다.",
                                    variant: "destructive",
                                  });
                                }
                              }
                            }}
                            title="문서 삭제"
                          >
                            <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                          </Button>
                        )}
                      </div>
                    </div>
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
        </div>
      )}
      {/* Document Content Preview Modal */}
      {showDocumentPreview && selectedDocument && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[9999]" onClick={() => { setShowDocumentPreview(false); setSelectedDocument(null); }}>
          <div className="bg-background rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold korean-text break-words">
                  {selectedDocument.originalName}
                </h2>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                  <span>크기: {selectedDocument.size ? (selectedDocument.size / (1024 * 1024)).toFixed(2) + ' MB' : '알 수 없음'}</span>
                  <span>•</span>
                  <span>업로드: {new Date(selectedDocument.createdAt).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</span>
                  <span>•</span>
                  <span>업로드자: {selectedDocument.uploadedBy}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="p-2 ml-4"
                onClick={() => {
                  setShowDocumentPreview(false);
                  setSelectedDocument(null);
                }}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-hidden p-6">
              <div className="h-full overflow-y-auto">
                {selectedDocument.content ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <pre className="whitespace-pre-wrap korean-text text-sm leading-relaxed bg-muted/30 p-4 rounded-lg border">
                      {selectedDocument.content}
                    </pre>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground korean-text text-lg mb-2">내용을 표시할 수 없습니다</p>
                    <p className="text-muted-foreground korean-text text-sm">
                      이 문서에서 텍스트를 추출할 수 없거나 지원되지 않는 형식입니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
              <Button
                variant="outline"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = `/api/documents/${selectedDocument.id}/download`;
                  link.download = selectedDocument.originalName;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="korean-text"
              >
                <Download className="w-4 h-4 mr-2" />
                파일 다운로드
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setShowDocumentPreview(false);
                  setSelectedDocument(null);
                }}
                className="korean-text"
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* PDF Viewer Modal */}
      {showPDFViewer && selectedPDFDocument && (
        <PDFViewer
          documentId={selectedPDFDocument.id}
          documentName={selectedPDFDocument.originalName || selectedPDFDocument.filename}
          onClose={() => {
            setShowPDFViewer(false);
            setSelectedPDFDocument(null);
          }}
          onContentExtracted={(content) => {
            // Handle extracted content if needed
            console.log('Extracted content:', content);
          }}
        />
      )}
      {/* Chat History Delete Confirmation Dialog */}
      {showChatHistoryDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowChatHistoryDeleteDialog(false)}>
          <div className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-medium text-foreground mb-4 korean-text">채팅 기록 삭제</h3>
              <p className="text-muted-foreground mb-6 korean-text text-center">현재 에이전트와의 모든 대화 기록이 삭제됩니다. 
              삭제된 대화내용은 다시 복구할 수 없습니다. 
              에이전트와의 대화 내용을 삭제하시겠습니까?</p>
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowChatHistoryDeleteDialog(false)}
                  className="korean-text"
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteChatHistory}
                  disabled={deleteChatHistoryMutation.isPending}
                  className="korean-text"
                >
                  {deleteChatHistoryMutation.isPending ? "삭제 중..." : "삭제"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Leave Conversation Confirmation Dialog */}
      {showLeaveConversationDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLeaveConversationDialog(false)}>
          <div className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-medium text-foreground mb-4 korean-text">대화방 나가기</h3>
              <p className="text-muted-foreground mb-6 korean-text text-center">
                이 대화방에서 나가시겠습니까?
                <br /><br />
                대화방을 나가면 대화 목록에서 사라지지만, 대화 내용은 보관됩니다.
                <br />
                다시 대화를 시작하면 이전 대화 기록을 볼 수 있습니다.
              </p>
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowLeaveConversationDialog(false)}
                  className="korean-text"
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleLeaveConversation}
                  disabled={leaveConversationMutation.isPending}
                  className="korean-text"
                >
                  {leaveConversationMutation.isPending ? "나가는 중..." : "나가기"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Message Confirmation Dialog */}
      {messageToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setMessageToDelete(null)}>
          <div className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-medium text-foreground mb-4 korean-text">메시지 삭제</h3>
              <p className="text-muted-foreground mb-6 korean-text text-center">
                이 메시지를 삭제하시겠습니까?
                <br /><br />
                삭제된 메시지는 복구할 수 없습니다.
              </p>
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setMessageToDelete(null)}
                  className="korean-text"
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMessageMutation.mutate(messageToDelete!)}
                  disabled={deleteMessageMutation.isPending}
                  className="korean-text"
                >
                  {deleteMessageMutation.isPending ? "삭제 중..." : "삭제"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <FileUploadModal
        isOpen={showFileModal}
        onClose={() => setShowFileModal(false)}
        agent={agent}
      />
      <PersonaEditModal
        isOpen={showPersonaModal}
        onClose={() => setShowPersonaModal(false)}
        agent={agent}
      />
      <ChatbotSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        agent={agent}
      />
      {showIconModal && (
        <IconChangeModal
          isOpen={showIconModal}
          onClose={() => {
            console.log("ChatInterface: IconChangeModal onClose called, setting showIconModal to false");
            setShowIconModal(false);
          }}
          agent={agent}
          onSuccess={addSystemMessage}
        />
      )}
      <VisibilitySettingsModal
        isOpen={showVisibilityModal}
        onClose={() => setShowVisibilityModal(false)}
        agent={agent}
      />
      <BasicInfoEditModal
        isOpen={showBasicInfoModal}
        onClose={() => setShowBasicInfoModal(false)}
        agent={agent}
        onSuccess={addSystemMessage}
        onCancel={addSystemMessage}
      />
    </div>
  );
});

export default ChatInterface;