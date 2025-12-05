import { useState, useRef, useEffect, useMemo, useCallback, startTransition, memo } from "react";
import { flushSync } from "react-dom";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { getBubbleColorForUser } from "@/lib/bubbleColorUtils";
import { 
  ChevronLeft, 
  Send, 
  Menu,
  Users,
  Settings,
  AtSign,
  UserPlus,
  Bot,
  Trash2,
  X,
  LogOut,
  User,
  GraduationCap,
  Code,
  FlaskRound,
  Map as MapIcon,
  Languages,
  Dumbbell,
  Database,
  Lightbulb,
  Heart,
  Calendar,
  Pen,
  FileText,
  Plus,
  Sparkles,
  Copy,
  Check,
  Edit
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RELATIONSHIP_TYPES, RelationshipType, LANGUAGE_OPTIONS, type LanguageOption, LANGUAGE_LABELS } from "@shared/schema";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiRequest } from "@/lib/queryClient";
import { EmotionAvatar, EmotionBadge, extractCharacterNameFromMessage, type AvatarEmotionType } from "@/components/EmotionAvatar";
import { Link } from "wouter";
import { useIsTablet } from "@/hooks/use-tablet";
import type { 
  GroupChatWithDetails, 
  GroupChatMessage, 
  GroupChatAgent 
} from "@/types/agent";

// ---- stable helpers (컴포넌트 밖) ----
type Msg = GroupChatMessage;

// ⚡ formatMessageTime (컴포넌트 외부로 이동 - 의존성 없음)
const formatMessageTime = (dateString: string) => {
  const messageDate = new Date(dateString);
  const now = new Date();
  
  // 시간 표시 (오전/오후 형식)
  const timeStr = messageDate.toLocaleTimeString('ko-KR', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  // 같은 날인지 확인
  const isSameDay = messageDate.toDateString() === now.toDateString();
  if (isSameDay) {
    return timeStr; // 같은 날: "오후 11:20"
  }
  
  // 같은 달인지 확인
  const isSameMonth = messageDate.getMonth() === now.getMonth() && 
                      messageDate.getFullYear() === now.getFullYear();
  if (isSameMonth) {
    const day = messageDate.getDate();
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][messageDate.getDay()];
    return `${day}일 (${weekday}) ${timeStr}`; // 같은 달: "15일 (월) 오후 11:20"
  }
  
  // 같은 년도인지 확인
  const isSameYear = messageDate.getFullYear() === now.getFullYear();
  if (isSameYear) {
    const month = messageDate.getMonth() + 1;
    const day = messageDate.getDate();
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][messageDate.getDay()];
    return `${month}월 ${day}일 (${weekday}) ${timeStr}`; // 같은 년도: "12월 31일 (일) 오후 11:20"
  }
  
  // 다른 년도
  const year = messageDate.getFullYear();
  const month = messageDate.getMonth() + 1;
  const day = messageDate.getDate();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][messageDate.getDay()];
  return `${year}년 ${month}월 ${day}일 (${weekday}) ${timeStr}`; // 이전 년도: "2024년 12월 31일 (일) 오후 11:20"
};

// ⚡ formatTimestamp (컴포넌트 외부로 이동 - 의존성 없음)
const formatTimestamp = (dateString: string) => {
  const messageDate = new Date(dateString);
  const day = messageDate.getDate();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][messageDate.getDay()];
  const ampm = messageDate.getHours() < 12 ? '오전' : '오후';
  return `${day}일 (${weekday}) ${ampm}`;
};

const isTempId = (id: number | string) => {
  // 숫자 변환이 안 되면 임시로 간주
  const n = typeof id === 'string' ? Number(id) : id;
  if (!Number.isFinite(n)) return true;
  return n >= 1_000_000_000_000; // 1e12 이상이면 임시(Date.now() 충돌 방지)
};

// 충돌을 줄이기 위해 내용은 해시로
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// 🎯 강력한 messageKey 시스템 (레거시 키 완전 제거)
const makeMessageKey = (m: Msg) => {
  // 🚀 서버에서 제공하는 표준 messageKey 우선 사용 (중복 문제 해결)
  if ((m as any).messageKey) {
    return (m as any).messageKey; // 서버 키는 이미 완전한 형태임
  }
  
  // 사용자 메시지: 고유 ID 기반
  if (isUserMessage(m as GroupChatMessage)) {
    return `user_${m.id}`;
  }
  
  // 챗봇 메시지: 표준 키 강제 생성
  if (m.agentId) {
    const turnIndex = m.replyOrder || 0;
    const userTurnId = (m as any).userTurnId;
    
    if (userTurnId) {
      // 서버 표준과 동일한 형식으로 생성
      return `${m.groupChatId}:${userTurnId}:${m.agentId}:${turnIndex}`;
    }
    
    // 🚨 userTurnId가 없는 챗봇 메시지는 강제로 에이전트_ID 형태로 생성
    return `agent_${m.agentId}_${m.id}`;
  }
  
  // 🚨 완전 폴백: 메시지 ID만으로 처리
  return `msg_${m.id}`;
};

// 🛠️ Step 2: messageKey 기반 merge 시스템 (append-only → upsert)
const mergeMessages = (existing: Msg[], newMessages: Msg[]): Msg[] => {
  const messageMap = new Map<string, Msg>();
  const keyOrder: string[] = [];

  // 기존 메시지 먼저 추가
  for (const msg of existing || []) {
    const key = makeMessageKey(msg);
    if (!messageMap.has(key)) {
      keyOrder.push(key);
    }
    messageMap.set(key, msg);
  }

  // 새 메시지 upsert (동일 key면 최신으로 교체)
  for (const msg of newMessages || []) {
    const key = makeMessageKey(msg);
    if (!messageMap.has(key)) {
      keyOrder.push(key); // 새로운 메시지면 순서에 추가
    }
    messageMap.set(key, msg); // 기존 메시지면 교체, 새 메시지면 추가
  }

  // 순서 보존하며 최종 배열 구성
  const mergedMessages: Msg[] = [];
  for (const key of keyOrder) {
    const msg = messageMap.get(key);
    if (msg) mergedMessages.push(msg);
  }
  
  return mergedMessages;
};

// 사용자 메시지 판별 함수
const isUserMessage = (msg: GroupChatMessage) => 
  msg.senderId && !msg.agentId;

/**
 * 🎯 messageKey + turnId 기반 이중 중복 제거 시스템
 * - 사용자 메시지: ID 기반 고유성 보장
 * - 챗봇 메시지: messageKey (userTurnId + agentId + turnIndex) 기반
 * - 💡 추가: turnId 레벨 dedup (사용자 제안)
 * - upsert 방식: 동일 messageKey면 최신으로 교체, 없으면 추가
 * - 원본 순서 보존: 첫 출현 순서 기준
 */
const normalizeMessages = (raw: Msg[]): Msg[] => {
  if (!raw?.length) {
    return [];
  }
  
  // 🚀 강력한 중복 제거: ID 기반 단순화
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const uniqueMessages: Msg[] = [];

  for (const m of raw) {
    const messageKey = makeMessageKey(m);
    const idKey = String(m.id);
    
    // ID나 키가 이미 존재하는지 확인
    if (seenIds.has(idKey) || seenKeys.has(messageKey)) {
      continue;
    }
    
    // 새로운 메시지 추가
    seenIds.add(idKey);
    seenKeys.add(messageKey);
    uniqueMessages.push(m);
  }
  
  return uniqueMessages;
};

// 📝 splitType 기반 에이전트 이름 표시 여부 결정
function shouldShowAgentName(
  currentMsg: GroupChatMessage,
  previousMsg: GroupChatMessage | undefined,
  isMyMessage: (msg: GroupChatMessage) => boolean,
  isAgentMessage: (msg: GroupChatMessage) => boolean
): boolean {
  // 사용자 메시지는 항상 이름 표시
  if (!isAgentMessage(currentMsg)) return true;
  
  // splitType='length'이고 이전 메시지가 같은 에이전트일 때만 이름 숨김
  if (currentMsg.splitType === 'length' && 
      previousMsg?.agentId === currentMsg.agentId) {
    return false;
  }
  
  // 그 외 모든 경우 (paragraph/topic/undefined legacy, 또는 다른 에이전트의 length) 이름 표시
  return true;
}

// ⚡ Perspective 인터페이스
interface Perspective {
  name: string;
  role: string;
  stance: string;
  sentiment: string;
  supportive_indices: number[];
  color: string;
}

// ⚡ 성능 최적화: 메시지 컴포넌트 메모이제이션 (타이핑 시 리렌더링 방지)
interface ChatMessageProps {
  msg: GroupChatMessage;
  prevMsg?: GroupChatMessage; // 이전 메시지 (splitType 기반 이름 표시 판단용)
  groupChatId: string;
  currentUserId: string | undefined;
  findAgentNameById: (id: number) => string | null;
  formatMessageTime: (dateString: string) => string;
  formatTimestamp: (dateString: string) => string;
  isAgentMessage: (msg: GroupChatMessage) => boolean;
  isMyMessage: (msg: GroupChatMessage) => boolean;
  getBubbleColorForUser: (chatId: string, userId: string) => string;
  isEditMode?: boolean;
  isAdmin?: boolean;
  selectedMessages?: Set<number>;
  onToggleMessage?: (id: number) => void;
  onSourceClick?: (message: GroupChatMessage, sourceIndices: number[] | null) => void;
  perspectives?: Perspective[];
  onPerspectiveSwitch?: (perspective: Perspective) => void;
}

const ChatMessage = memo<ChatMessageProps>(({ msg, prevMsg, groupChatId, currentUserId, findAgentNameById, formatMessageTime, formatTimestamp, isAgentMessage, isMyMessage, getBubbleColorForUser, isEditMode, isAdmin, selectedMessages, onToggleMessage, onSourceClick, perspectives, onPerspectiveSwitch }) => {
  const messageKey = makeMessageKey(msg);
  const isFromAgent = !!msg.agentId;
  const uniqueKey = isFromAgent ? messageKey : String(msg.id);
  
  // 시스템 메시지 확인
  const isSystemMessage = !msg.senderId && !msg.agentId;
  
  if (isSystemMessage) {
    const content = String(msg.content);
    
    // 대화방 생성 메시지
    if (content.includes('생성되었습니다')) {
      const titleMatch = content.match(/"([^"]+)"/);
      const title = titleMatch ? titleMatch[1] : '';
      
      return (
        <div key={msg.id} className="system-notification-emoji">
          <div className="system-notification-emoji-text">
            <div style={{ textAlign: 'center', lineHeight: '1.6' }}>
              <div>🎉 "{title}" 대화방이 생성되었습니다!</div>
              <div>👥 참여자들과 함께 즐거운 대화를 나누어보세요.</div>
              <div>챗봇들에게 @를 붙여서 질문하거나, 자유롭게 대화를 시작할 수 있습니다.</div>
            </div>
          </div>
        </div>
      );
    }
    
    // 참여/추가 메시지
    if (content.includes('참여했습니다') || content.includes('추가되었습니다') || content.includes('제거되었습니다') || content.includes('나갔습니다')) {
      return (
        <div key={msg.id}>
          <div className="timestamp">
            <span className="timestamp-text">{formatTimestamp(msg.createdAt)}</span>
          </div>
          <div className="system-notification">
            <div className="system-notification-text">
              {content}
            </div>
          </div>
        </div>
      );
    }
    
    // 일반 시스템 메시지
    return (
      <div key={msg.id} className="system-notification">
        <div className="system-notification-text">
          {content}
        </div>
      </div>
    );
  }

  // 일반 메시지 렌더링
  const isContinuation = (msg as any).isContinuation || false;
  const isSystem = isSystemMessage;
  const showCheckbox = isEditMode && isAdmin && msg.id && !isSystem;
  
  // 출처 존재 여부 확인
  const hasSources = !!(msg.sources && (msg.sources as any).chunks && (msg.sources as any).chunks.length > 0);
  
  return (
    <>
    <div
      key={uniqueKey}
      className={`flex gap-2 ${
        isContinuation 
          ? 'mb-[4px]'
          : isAgentMessage(msg) 
            ? 'mb-[24px]' 
            : 'mb-[30px]'
      }`}
    >
      {/* Checkbox for edit mode (always on the left) */}
      {showCheckbox && (
        <div className="flex-shrink-0">
          <Checkbox
            checked={selectedMessages?.has(msg.id)}
            onCheckedChange={() => onToggleMessage?.(msg.id!)}
            className="mt-6 h-5 w-5 border-2 border-gray-400 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
          />
        </div>
      )}
      
      {/* Message content container */}
      <div className={`flex gap-2 flex-1 ${isMyMessage(msg) ? 'flex-row-reverse' : 'flex-row'}`}>
      
      <div className={`flex flex-col ${isMyMessage(msg) ? 'items-end' : 'items-start'} flex-1`}>
      {/* 발신자 이름 (splitType 기반) */}
      {!isMyMessage(msg) && shouldShowAgentName(msg, prevMsg, isMyMessage, isAgentMessage) ? (
        <div className={`${
          isContinuation 
            ? 'text-[10px] font-normal text-gray-400 dark:text-gray-500 px-3 mb-[2px]'
            : `text-[11px] font-medium text-gray-500 dark:text-gray-400 px-3 ${isAgentMessage(msg) ? 'mb-[6px]' : 'mb-0.5'}`
        }`}>
          {isAgentMessage(msg) 
            ? (msg.agent?.name || 
               (msg as any).agentName || 
               (msg.agentId ? findAgentNameById(msg.agentId) : null) ||
               msg.sender?.name || 
               msg.sender?.username ||
               "알 수 없는 챗봇")
            : (msg.sender?.name || msg.sender?.username)}
        </div>
      ) : !isMyMessage(msg) && !shouldShowAgentName(msg, prevMsg, isMyMessage, isAgentMessage) ? (
        <div className="h-[13px] mb-[6px]" aria-hidden data-testid="spacer-agent-name" />
      ) : null}
      
      {/* 메시지 말풍선과 시간 */}
      <div className={`flex items-end ${isMyMessage(msg) ? 'gap-2.5' : 'gap-1.5'}`}>
        {/* 🎭 에이전트 메시지: 감정 아바타 표시 */}
        {isAgentMessage(msg) && !isContinuation && (() => {
          const characterName = extractCharacterNameFromMessage(msg.content);
          return (
            <EmotionAvatar
              agentId={msg.agentId ?? 0}
              characterName={characterName || undefined}
              emotion={(msg as any).emotion as AvatarEmotionType}
              size="sm"
              className="mb-0.5"
            />
          );
        })()}
        
        {/* 사용자 메시지: 시간을 왼쪽에 */}
        {isMyMessage(msg) && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {formatMessageTime(msg.createdAt)}
          </div>
        )}
        
        {/* 메시지 내용 */}
        <div
          className={`${
            isMyMessage(msg)
              ? 'minimal-message user'
              : isAgentMessage(msg)
              ? 'minimal-message assistant'
              : 'minimal-message other-user-colored'
          } ${!isMyMessage(msg) ? 'cursor-pointer' : ''} select-none`}
          style={
            !isMyMessage(msg) && !isAgentMessage(msg) && msg.senderId
              ? {
                  backgroundColor: getBubbleColorForUser(`group-${groupChatId}`, msg.senderId),
                  color: '#FFFFFF'
                }
              : undefined
          }
          onClick={!isMyMessage(msg) ? (e) => {
            if (showCheckbox && onToggleMessage && msg.id) {
              onToggleMessage(msg.id);
              return;
            }
            
            e.stopPropagation();
            onSourceClick?.(msg, null);
          } : undefined}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({node, ...props}) => (
                <div className="table-scroll-container">
                  <table className="markdown-table" {...props} />
                </div>
              ),
              th: ({node, ...props}) => (
                <th className="markdown-table-header" {...props} />
              ),
              td: ({node, ...props}) => (
                <td className="markdown-table-cell" {...props} />
              ),
              p: ({node, ...props}) => (
                <p className="whitespace-pre-wrap" {...props} />
              ),
              strong: ({node, ...props}) => (
                <span {...props} />
              ),
              em: ({node, ...props}) => (
                <span {...props} />
              )
            }}
          >
            {String(msg.content)}
          </ReactMarkdown>
        </div>
        
        {/* 다른 사람 메시지: 시간을 오른쪽에 */}
        {!isMyMessage(msg) && !isAgentMessage(msg) && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {formatMessageTime(msg.createdAt)}
          </div>
        )}
      </div>
      
      {/* 🎭 관점 전환 버튼 (에이전트 메시지에만 표시) */}
      {isAgentMessage(msg) && perspectives && perspectives.length > 0 && !isContinuation && (
        <div className="px-3 mt-2 flex flex-wrap gap-2" data-testid={`perspectives-${msg.id}`}>
          {perspectives.map((p, idx) => (
            <Button
              key={idx}
              size="sm"
              variant="outline"
              className={`h-7 text-xs border-2`}
              style={{
                borderColor: p.color,
                color: p.color,
                backgroundColor: `${p.color}10`
              }}
              onClick={() => onPerspectiveSwitch?.(p)}
              data-testid={`perspective-btn-${idx}`}
            >
              {p.name} ({p.role})
            </Button>
          ))}
        </div>
      )}
      
      {/* 출처 없는 에이전트 메시지에 면책 문구 표시 */}
      {isAgentMessage(msg) && !hasSources && !isContinuation && (
        <div 
          className="text-[9px] text-gray-400 dark:text-gray-500 px-3 mt-1 leading-tight"
          data-testid={`disclaimer-${msg.id}`}
        >
          이 응답은 실제 인물의 발언이 아닙니다. AI가 해당 인물의 스타일을 참고해 만든 시뮬레이션입니다.
        </div>
      )}
      </div>
      </div>
    </div>
    </>
  );
});

ChatMessage.displayName = 'ChatMessage';

// Icon mapping for agent icons
const iconMap: Record<string, any> = {
  "fas fa-graduation-cap": GraduationCap,
  "fas fa-code": Code,
  "fas fa-robot": Bot,
  "fas fa-user": User,
  "fas fa-flask": FlaskRound,
  "fas fa-map": MapIcon,
  "fas fa-language": Languages,
  "fas fa-dumbbell": Dumbbell,
  "fas fa-database": Database,
  "fas fa-lightbulb": Lightbulb,
  "fas fa-heart": Heart,
  "fas fa-calendar": Calendar,
  "fas fa-pen": Pen,
  "fas fa-file-alt": FileText,
};

interface MentionSuggestion {
  id: number;
  name: string;
  icon: string;
  backgroundColor: string;
  selected?: boolean;
  order?: number;
}

interface CharacterSuggestion {
  id?: string;
  name: string;
  category?: string;
  description: string;
  personality: string;
  speechStyle: string;
  expertise: string;
  background: string;
  icon: string;
  color: string;
  tags?: string[];
  isVariation?: boolean; // 바리에이션 캐릭터인지 표시
  baseCharacter?: string; // 기본 캐릭터 이름 (바리에이션인 경우)
  recommendedAt?: number; // 추천된 시각 (타임스탬프)
}

interface GroupChatProps {
  groupChatId?: string;
}

export default function GroupChat({ groupChatId: propsGroupChatId }: GroupChatProps = {}) {
  const paramsResult = useParams<{ groupChatId: string }>();
  const groupChatId = propsGroupChatId || paramsResult.groupChatId;
  
  // ✅ hooks를 조건부 리턴 이전에 실행 (React hooks 규칙 준수)
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isTablet = useIsTablet();
  const [location, setLocation] = useLocation();

  // ✅ groupChatId 유효성 플래그 계산
  const isValidGroupChatId = !!(groupChatId && groupChatId !== 'undefined' && groupChatId !== 'null');

  // 🔙 채팅방 진입 전 위치 저장 (채팅방 내부 이동은 저장하지 않음)
  useEffect(() => {
    // 현재 위치가 채팅방이 아닐 때만 referrer 저장
    if (location && !location.startsWith('/group-chat/')) {
      sessionStorage.setItem(`groupChatReferrer_${groupChatId}`, location);
    }
  }, []); // 컴포넌트 마운트 시 한 번만 실행

  // 🔙 뒤로가기 핸들러 (채팅방 진입 전 위치로 복귀)
  const handleGoBack = useCallback(() => {
    const referrer = sessionStorage.getItem(`groupChatReferrer_${groupChatId}`);
    sessionStorage.removeItem(`groupChatReferrer_${groupChatId}`);
    
    if (referrer && referrer !== location) {
      setLocation(referrer);
    } else {
      // referrer가 없으면 카드 홈으로
      setLocation('/');
    }
  }, [groupChatId, location, setLocation]);

  // groupChatId가 없으면 홈으로 리다이렉트 (hooks 이후에 실행)
  useEffect(() => {
    if (!isValidGroupChatId) {
      console.warn('[GroupChat] Invalid groupChatId:', groupChatId, '- redirecting to home');
      setLocation('/');
    }
  }, [isValidGroupChatId, groupChatId, setLocation]);

  const [message, setMessage] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const messageRef = useRef("");
  const [showMentionList, setShowMentionList] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<MentionSuggestion[]>([]);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0); // 키보드 내비게이션용
  
  // Edit mode for message management (admin only)
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<number>>(new Set());
  const [messageToDelete, setMessageToDelete] = useState<{ 
    id: number; 
    groupChatId?: number;
  } | null>(null);
  
  // ⚡ 성능 최적화: 모든 핸들러 메모이제이션
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // 타이핑 시작
    isTypingRef.current = true;
    
    // 이전 타이머 클리어
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // 500ms 후 타이핑 종료로 간주
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
    }, 500);
  }, []);
  
  // ⚡ onInput 핸들러 메모이제이션 (textarea 높이 자동 조절)
  const handleTextareaInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 100) + 'px';
  }, []);
  
  // ⚡ placeholder 메모이제이션
  const inputPlaceholder = useMemo(() => {
    if (selectedAgents.length > 0) return "";
    
    const isAdmin = user?.role === 'master_admin' || user?.role === 'agent_admin' || user?.role === 'operation_admin';
    return isAdmin 
      ? "메시지를 입력하세요... (@로 에이전트 멘션, # 캐릭터 추천)"
      : "메시지를 입력하세요... (@로 에이전트 멘션)";
  }, [selectedAgents.length, user?.role]);
  const [isSendingDisabled, setIsSendingDisabled] = useState(false);
  const [isGroupChatBusy, setIsGroupChatBusy] = useState(false);
  const [typingBotInfo, setTypingBotInfo] = useState<{name: string, icon: string, backgroundColor: string} | null>(null);
  const [isAnyBotTyping, setIsAnyBotTyping] = useState(false);
  const [shouldEndTyping, setShouldEndTyping] = useState(false); // typing_end 대기 플래그
  const [waitingForBotMessageId, setWaitingForBotMessageId] = useState<number | null>(null); // 대기 중인 봇 메시지 ID
  
  interface StreamingState {
    partialContent: string;
    agentId: number;
    agentName: string;
    agentIcon: string;
    agentColor: string;
    userTurnId: number;
  }
  const [streamingByTurn, setStreamingByTurn] = useState<Record<string, StreamingState>>({});
  
  const typingStartBotCountRef = useRef<number>(0); // typing_start 시점의 봇 메시지 개수
  const messagesRef = useRef<GroupChatMessage[]>([]); // 최신 messages를 ref에 저장 (closure 방지)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 30초 전송 타임아웃
  const questionMessageIdRef = useRef<number | null>(null); // 답변 대기 중인 질문 메시지 ID
  const noAnswerTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 답변 없는 질문 삭제 타이머
  const lastBotResponseTimeRef = useRef<number | null>(null); // 마지막 봇 답변 시간
  const responseIntervalTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 멀티 에이전트 답변 간격 타이머

  // 🎭 Perspectives 상태 관리
  const [perspectivesByMessage, setPerspectivesByMessage] = useState<Record<number, Perspective[]>>({});
  const [loadingPerspectives, setLoadingPerspectives] = useState(false);
  
  // 🎭 Perspectives API 호출 함수
  const fetchPerspectives = useCallback(async (topic: string, question: string, messageId: number) => {
    if (!groupChatId || loadingPerspectives) return;
    
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
        setPerspectivesByMessage(prev => ({
          ...prev,
          [messageId]: data.perspectives
        }));
        console.log(`[🎭 PERSPECTIVES] Fetched ${data.perspectives.length} perspectives for message ${messageId}`);
      }
    } catch (error) {
      console.error('[❌ PERSPECTIVES] Failed to fetch:', error);
      toast({
        title: "관점 로드 실패",
        description: "관점 정보를 가져올 수 없습니다.",
        variant: "destructive"
      });
    } finally {
      setLoadingPerspectives(false);
    }
  }, [groupChatId, loadingPerspectives, toast]);
  
  // 🎭 Perspective 전환 핸들러
  const handlePerspectiveSwitch = useCallback(async (perspective: Perspective, messageId: number, originalQuestion: string) => {
    toast({
      title: `${perspective.name} 관점으로 전환`,
      description: `${perspective.role} 입장에서 답변을 재생성합니다.`
    });
    
    // TODO: 유리한 기사만 사용하여 답변 재생성
    console.log('[🎭 PERSPECTIVE SWITCH]', {
      perspective,
      messageId,
      supportive_indices: perspective.supportive_indices
    });
  }, [toast]);
  
  // 모달 상태 관리
  const [showChatSettingsModal, setShowChatSettingsModal] = useState(false);
  
  // 🎭 관계 매트릭스 상태 관리
  const [showRelationshipMatrixModal, setShowRelationshipMatrixModal] = useState(false);
  const [isGeneratingMatrix, setIsGeneratingMatrix] = useState(false);
  const [relationshipMatrix, setRelationshipMatrix] = useState<any[] | null>(null);
  const [hasMatrix, setHasMatrix] = useState(false);
  
  // 🚀 Task 2: 통합된 useState/useRef 하이브리드 큐 시스템
  interface QueueState {
    isProcessing: boolean;
    revealInProgress: boolean;
    activeTimeouts: Set<ReturnType<typeof setTimeout>>;
    currentScenarioId: string | null;
  }
  
  // 🔄 Task 3: 재시도 큐 시스템 인터페이스
  interface RetryRequest {
    id: string;
    originalData: any;
    retryCount: number;
    maxRetries: number;
    lastError: Error | null;
    nextRetryAt: number;
  }
  
  interface RetryQueueState {
    pendingRetries: Map<string, RetryRequest>;
    activeRetries: Set<string>;
    retryTimeouts: Set<ReturnType<typeof setTimeout>>;
  }
  
  const [queueState, setQueueState] = useState<QueueState>({
    isProcessing: false,
    revealInProgress: false,
    activeTimeouts: new Set(),
    currentScenarioId: null
  });
  
  // 🧹 Task 12: Enhanced Queue Reset with Proper Timer Cleanup
  const queueStateRef = useRef<QueueState>(queueState);
  
  // 🚫 Phase 2 REDESIGN: 캐시 reconciliation 시스템 (임시↔서버 매칭용)
  const [tempToServerMap, setTempToServerMap] = useState<Map<number, number>>(new Map());
  const tempToServerMapRef = useRef<Map<number, number>>(new Map());

  // 🚫 Phase 2: 클라이언트 중복차단 시스템 (Critical)
  const [renderedMessageIds, setRenderedMessageIds] = useState<Set<number>>(new Set());
  const renderedMessageIdsRef = useRef<Set<number>>(new Set());
  
  // 📰 Sources Dialog State (centralized)
  const [sourcesDialogState, setSourcesDialogState] = useState<{
    isOpen: boolean;
    messageId: number | null;
    messageContent: string | null;
    isSearching: boolean;
    fetchedSources: Array<{ title: string; url: string; snippet?: string }> | null;
    selectedSourceIndices: number[] | null;
    precomputedSources: GroupChatMessage['sources'] | null;
  }>({
    isOpen: false,
    messageId: null,
    messageContent: null,
    isSearching: false,
    fetchedSources: null,
    selectedSourceIndices: null,
    precomputedSources: null,
  });
  
  // Keep refs in sync
  useEffect(() => {
    queueStateRef.current = queueState;
    tempToServerMapRef.current = tempToServerMap;
    renderedMessageIdsRef.current = renderedMessageIds;
  }, [queueState, tempToServerMap, renderedMessageIds]);

  // 그룹 채팅 정보 조회
  const { data: groupChat, isLoading, isError, error } = useQuery<GroupChatWithDetails>({
    queryKey: [`/api/group-chats/${groupChatId}`],
    enabled: isValidGroupChatId,
  });

  // ✅ 프리로딩된 캐시 우선 활용하여 빠른 로딩 제공
  const messagesQueryKey = [`/api/group-chats/${groupChatId}/messages`];
  
  const { data: rawMessages = [] } = useQuery<GroupChatMessage[]>({
    queryKey: messagesQueryKey,
    enabled: isValidGroupChatId,
    staleTime: 30 * 1000, // 30초간 캐시 유지 (프리로딩된 데이터 활용)
    refetchOnMount: false, // 캐시된 데이터 먼저 표시
    refetchOnWindowFocus: false, // 윈도우 포커스 시 자동 재요청 비활성화
    refetchInterval: false, // 자동 새로고침 비활성화
  });

  // ✅ 순수 계산 기반 메시지 정규화 (normalizeMessages 사용)
  
  const messages = useMemo(() => {
    // 🔑 messageKey 기반 upsert로 중복/누락 완벽 방지
    const list = mergeMessages([], rawMessages || []);
    
    return list;
  }, [rawMessages, groupChatId]);
  
  // ⚡ 스트리밍 메시지를 주입한 최종 렌더링용 메시지 목록
  // 🎬 Step 43: 사용자 메시지(senderId 있음) 다음에 스트리밍 메시지 주입
  const renderedMessages = useMemo(() => {
    const result: (GroupChatMessage | any)[] = [];
    
    for (const msg of messages) {
      result.push(msg);
      
      // 🎬 Step 43: 사용자 메시지 판별 (senderId가 있고 agentId가 없는 메시지)
      const isUserMessage = msg.senderId && !msg.agentId;
      
      if (isUserMessage) {
        const streamingEntries = Object.entries(streamingByTurn).filter(
          ([key, _]) => key.startsWith(`${groupChatId}:${msg.id}:`)
        );
        
        for (const [key, streamingState] of streamingEntries) {
          // 🎬 Step 43: 스트리밍 중인 메시지 렌더링 (타이핑 효과)
          const streamingMsg: any = {
            id: `stream-${key}`,
            groupChatId: parseInt(groupChatId || '0'),
            agentId: streamingState.agentId === -1 ? null : streamingState.agentId, // -1은 앵커용
            userId: null,
            content: streamingState.partialContent,
            role: 'assistant',
            createdAt: new Date().toISOString(),
            agentName: streamingState.agentName,
            agentIcon: streamingState.agentIcon,
            backgroundColor: streamingState.agentColor,
            isStreaming: true
          };
          result.push(streamingMsg);
        }
      }
    }
    
    return result;
  }, [messages, streamingByTurn, groupChatId]);

  // messages를 ref에 저장하여 최신 상태 유지 (closure 방지)
  useEffect(() => {
    messagesRef.current = messages;
    
    // 📊 진단 로그: 프론트엔드 메시지 수신
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      console.log('=== 📊 프론트엔드 수신 메시지 (마지막) ===');
      console.log(`전체 메시지 개수: ${messages.length}`);
      console.log(`마지막 메시지 ID: ${lastMsg.id}`);
      console.log(`마지막 메시지 길이: ${lastMsg.content?.length || 0}자`);
      console.log(`줄바꿈 개수: ${(lastMsg.content?.match(/\n/g) || []).length}`);
      console.log(`표 포함: ${lastMsg.content?.includes('|') || false}`);
      if (lastMsg.content && lastMsg.content.length > 0) {
        console.log('=== 처음 300자 (이스케이프) ===');
        console.log(JSON.stringify(lastMsg.content.substring(0, 300)));
      }
    }
  }, [messages]);
  
  // 🎬 Step 43 Fix: 스트리밍 정리는 `agentStreamingComplete` 이벤트에만 의존
  // (length 비교 기반 정리 로직 제거 - 백엔드에서 명시적으로 완료 신호 발송)
  // `handleStreamingComplete`가 streamingByTurn에서 항목을 제거함
  
  // 🎭 자동 perspectives 로드 (데모용 - 첫 번째 에이전트 답변에 대해)
  useEffect(() => {
    if (!groupChatId || messages.length === 0) return;
    
    // 마지막 2개 메시지 확인 (사용자 질문 + 에이전트 답변)
    if (messages.length >= 2) {
      const lastMsg = messages[messages.length - 1];
      const prevMsg = messages[messages.length - 2];
      
      // 에이전트 메시지이고, 이전 메시지가 사용자 메시지이며, 아직 perspectives가 없는 경우
      if (
        lastMsg.agentId && 
        prevMsg.senderId && 
        !prevMsg.agentId &&
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
  }, [messages, groupChatId, perspectivesByMessage, loadingPerspectives, fetchPerspectives]);

  // ✅ normalizeMessages가 모든 중복 처리 및 임시↔서버 매핑을 순수 계산으로 처리
  
  const resetMessageQueue = useCallback(() => {
    console.log('[🧹 큐 초기화] 현재 활성 타이머:', queueStateRef.current.activeTimeouts.size);
    // 기존 타이머들 정리 (stale capture 방지)
    queueStateRef.current.activeTimeouts.forEach(timeout => {
      clearTimeout(timeout);
      console.log('[⏱️ 타이머 제거] ID:', timeout);
    });
    
    setQueueState({
      isProcessing: false,
      revealInProgress: false,
      activeTimeouts: new Set(),
      currentScenarioId: null
    });
    
    // 🚫 Phase 2 REDESIGN: reconciliation 맵 정리
    setTempToServerMap(new Map());
    console.log('[🧹 중복 방지] tempToServerMap 정리 완료');
    
    // 🚫 Phase 2: 클라이언트 중복차단 ID 정리
    setRenderedMessageIds(new Set());
    console.log('[🧹 클라이언트 중복차단] renderedMessageIds 정리 완료');
    
    // ✅ normalizeMessages가 모든 중복 처리를 순수 계산으로 처리하므로 상태 정리 불필요
    console.log('[🧹 순수 계산] normalizeMessages로 인한 자동 중복 처리 활성화');
  }, [groupChatId]); // 🔥 긴급 수정: 채팅방 변경 시마다 초기화

  // 🎬 Task 7: Scenario Management Functions
  const startScenario = useCallback((scenarioData: any) => {
    if (scenarioInProgressRef.current) {
      console.warn('[🚫 중복 차단] 이미 시나리오 실행 중 → 무시');
      return;
    }
    console.log('[▶️ 시나리오 시작] ID:', scenarioData?.scenarioId || 'unknown', ', 턴 수:', scenarioData?.turns?.length || 0);
    scenarioInProgressRef.current = true;
    resetMessageQueue();
    if (scenarioData?.turns) {
      displayTurnsSequentially(scenarioData.turns);
    }
  }, [resetMessageQueue]);

  const endScenario = useCallback(() => {
    console.log('[✅ 시나리오 종료] 락 해제 및 정리');
    scenarioInProgressRef.current = false;
    localStorage.removeItem(`scenario_${groupChatId}`);
  }, [groupChatId]);
  
  // ✅ normalizeMessages로 인한 순수 계산 - 기존 Phase 2 상태 불필요
  // (tempToServerMap, renderedMessageIds 상태 제거됨)
  
  // 🔄 Task 3: 재시도 큐 상태
  const [retryQueueState, setRetryQueueState] = useState<RetryQueueState>({
    pendingRetries: new Map(),
    activeRetries: new Set(),
    retryTimeouts: new Set()
  });
  const retryQueueStateRef = useRef<RetryQueueState>(retryQueueState);
  
  // 🔄 자동 동기화: state가 변경되면 ref도 자동 업데이트  
  useEffect(() => {
    retryQueueStateRef.current = retryQueueState;
  }, [retryQueueState]);
  
  // 🔄 Task 3: 재시도 매니저 (지수 백오프)
  const retryManager = useMemo(() => ({
    // 지수 백오프 계산 (1s, 2s, 4s with jitter)
    calculateBackoffDelay: (retryCount: number): number => {
      const baseDelay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      const jitter = Math.random() * 500; // 0-500ms 지터
      return baseDelay + jitter;
    },
    
    // 재시도 요청 추가
    addRetryRequest: async (requestId: string, originalData: any, error: Error) => {
      const currentState = retryQueueStateRef.current;
      const existingRequest = currentState.pendingRetries.get(requestId);
      
      if (existingRequest && existingRequest.retryCount >= 3) {
        console.log(`[🔄 재시도 한계] ${requestId} - 최대 재시도 횟수 초과`);
        return false; // 최대 재시도 횟수 초과
      }
      
      const retryCount = existingRequest ? existingRequest.retryCount + 1 : 1;
      const delay = retryManager.calculateBackoffDelay(retryCount - 1);
      
      const retryRequest: RetryRequest = {
        id: requestId,
        originalData,
        retryCount,
        maxRetries: 3,
        lastError: error,
        nextRetryAt: Date.now() + delay
      };
      
      console.log(`[🔄 재시도 등록] ${requestId} - ${retryCount}번째 시도 (${delay.toFixed(0)}ms 후)`);
      
      setRetryQueueState(prev => {
        const newPendingRetries = new Map(Array.from(prev.pendingRetries.entries()));
        newPendingRetries.set(requestId, retryRequest);
        return {
          ...prev,
          pendingRetries: newPendingRetries
        };
      });
      
      // 지연 후 재시도 실행
      const retryTimeout = setTimeout(() => {
        retryManager.executeRetry(requestId);
      }, delay);
      
      setRetryQueueState(prev => {
        const newRetryTimeouts = new Set(Array.from(prev.retryTimeouts));
        newRetryTimeouts.add(retryTimeout);
        return {
          ...prev,
          retryTimeouts: newRetryTimeouts
        };
      });
      
      return true;
    },
    
    // 재시도 실행
    executeRetry: async (requestId: string) => {
      const currentState = retryQueueStateRef.current;
      const retryRequest = currentState.pendingRetries.get(requestId);
      
      if (!retryRequest) {
        console.warn(`[🔄 재시도 실행] ${requestId} - 요청을 찾을 수 없음`);
        return;
      }
      
      console.log(`[🔄 재시도 실행] ${requestId} - ${retryRequest.retryCount}번째 시도 시작`);
      
      // 활성 재시도로 표시
      setRetryQueueState(prev => {
        const newActiveRetries = new Set(Array.from(prev.activeRetries));
        newActiveRetries.add(requestId);
        return {
          ...prev,
          activeRetries: newActiveRetries
        };
      });
      
      try {
        // 원본 API 호출 재실행
        const response = await fetch(`/api/group-chats/${groupChatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryRequest.originalData),
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        console.log(`[✅ 재시도 성공] ${requestId} - 응답 수신 완료`);
        
        // 성공 시 재시도 큐에서 제거
        retryManager.removeRetryRequest(requestId);
        
        // 성공한 응답 처리 (시나리오 데이터만 저장, 순차 연출은 나중에 처리)
        if (result?.scenarioTurns?.length > 0) {
          const scenarioData = {
            turns: result.scenarioTurns,
            timestamp: Date.now()
          };
          localStorage.setItem(`scenario_${groupChatId}`, JSON.stringify(scenarioData));
          console.log(`[💾 재시도 성공 후 시나리오 저장] ${result.scenarioTurns.length}개 턴`);
          
          // 성공 시 순차 연출은 컴포넌트 레벨에서 처리하도록 이벤트 발생
          window.dispatchEvent(new CustomEvent('retrySuccess', {
            detail: { scenarioTurns: result.scenarioTurns, groupChatId }
          }));
        }
        
        // ✅ SSE가 모든 메시지를 추가하므로 invalidate 불필요
        console.log(`[✅ 재시도 성공] SSE가 실시간 업데이트 처리 - invalidate 생략`);
        
      } catch (error) {
        console.error(`[❌ 재시도 실패] ${requestId} - ${retryRequest.retryCount}번째 시도:`, error);
        
        // 재시도 횟수가 남아있으면 다시 큐에 추가
        if (retryRequest.retryCount < retryRequest.maxRetries) {
          await retryManager.addRetryRequest(requestId, retryRequest.originalData, error as Error);
        } else {
          console.error(`[💀 최종 실패] ${requestId} - 모든 재시도 실패`);
          retryManager.removeRetryRequest(requestId);
          
          // 최종 실패 토스트
          toast({
            title: "메시지 전송 최종 실패",
            description: `3회 재시도 후에도 전송에 실패했습니다.`,
            variant: "destructive",
          });
        }
      } finally {
        // 활성 재시도에서 제거
        setRetryQueueState(prev => ({
          ...prev,
          activeRetries: new Set(Array.from(prev.activeRetries).filter(id => id !== requestId))
        }));
      }
    },
    
    // 재시도 요청 제거
    removeRetryRequest: (requestId: string) => {
      setRetryQueueState(prev => {
        const newPendingRetries = new Map(Array.from(prev.pendingRetries.entries()));
        newPendingRetries.delete(requestId);
        return {
          ...prev,
          pendingRetries: newPendingRetries
        };
      });
      console.log(`[🗑️ 재시도 제거] ${requestId} - 큐에서 제거 완료`);
    },
    
    // 모든 재시도 정리
    clearAllRetries: () => {
      const currentTimeouts = retryQueueStateRef.current.retryTimeouts;
      Array.from(currentTimeouts).forEach(timeout => clearTimeout(timeout));
      
      setRetryQueueState({
        pendingRetries: new Map(),
        activeRetries: new Set(),
        retryTimeouts: new Set()
      });
      console.log(`[🧹 재시도 정리] 모든 재시도 큐 정리 완료`);
    },
    
    // 재시도 상태 조회
    getRetryStatus: () => ({
      pendingCount: retryQueueStateRef.current.pendingRetries.size,
      activeCount: retryQueueStateRef.current.activeRetries.size,
      isRetrying: retryQueueStateRef.current.activeRetries.size > 0
    })
    
  }), [groupChatId, queryClient, toast]);
  
  // 🎯 통합된 큐 관리 헬퍼들
  const queueManager = useMemo(() => ({
    // 큐 시작
    startProcessing: (scenarioId?: string) => {
      setQueueState(prev => ({
        ...prev,
        isProcessing: true,
        revealInProgress: true,
        currentScenarioId: scenarioId || null
      }));
      console.log(`[🚀 큐 시작] 시나리오: ${scenarioId || 'unknown'}`);
    },
    
    // 큐 중단 (모든 타이머 정리)
    stopProcessing: () => {
      const currentTimeouts = queueStateRef.current.activeTimeouts;
      Array.from(currentTimeouts).forEach(timeout => clearTimeout(timeout));
      
      setQueueState({
        isProcessing: false,
        revealInProgress: false,
        activeTimeouts: new Set(),
        currentScenarioId: null
      });
      console.log(`[🛑 큐 중단] ${currentTimeouts.size}개 타이머 정리 완료`);
    },
    
    // 타이머 등록 (자동 추적)
    addTimeout: (timeout: ReturnType<typeof setTimeout>) => {
      setQueueState(prev => {
        const newTimeouts = new Set(Array.from(prev.activeTimeouts));
        newTimeouts.add(timeout);
        return {
          ...prev,
          activeTimeouts: newTimeouts
        };
      });
    },
    
    // 타이머 제거
    removeTimeout: (timeout: ReturnType<typeof setTimeout>) => {
      clearTimeout(timeout);
      setQueueState(prev => {
        const newTimeouts = new Set(prev.activeTimeouts);
        newTimeouts.delete(timeout);
        return {
          ...prev,
          activeTimeouts: newTimeouts
        };
      });
    },
    
    // 현재 처리 중인지 체크 (즉시 반영)
    isCurrentlyProcessing: () => queueStateRef.current.isProcessing,
    
    // 현재 시나리오 ID 체크
    getCurrentScenarioId: () => queueStateRef.current.currentScenarioId
    
  }), []);
  
  // 🧹 컴포넌트 언마운트 시 자동 정리 (Task 2 + Task 3)
  useEffect(() => {
    return () => {
      console.log(`[🧹 UNMOUNT 정리] 컴포넌트 해제 시 큐 시스템 및 재시도 큐 정리`);
      queueManager.stopProcessing();
      retryManager.clearAllRetries();
    };
  }, [queueManager, retryManager]);
  
  // ✅ normalizeMessages가 groupChatId 변경 시에도 순수 계산으로 자동 처리
  // 별도 상태 리셋 불필요
  
  
  const [newChatTitle, setNewChatTitle] = useState("");
  const [newLanguageLevel, setNewLanguageLevel] = useState<number | null>(null); // 언어 레벨 상태 추가 (null = 미적용)
  const [newGptModel, setNewGptModel] = useState<string>("gpt-4o-mini"); // GPT 모델 상태 추가
  const [newGptTemperature, setNewGptTemperature] = useState<number>(1.0); // Temperature 상태 추가

  // 🔥 Task 4: Advanced Conversation Flow States
  const [turnCount, setTurnCount] = useState(0);
  const [discussionHeat, setDiscussionHeat] = useState(0); // 0-10 scale
  
  // 🚫 클라이언트 중복 메시지 방지 시스템
  const [lastSentMessage, setLastSentMessage] = useState<{content: string, timestamp: number} | null>(null);
  const CLIENT_DUPLICATE_WINDOW_MS = 5000; // 5초 중복 방지
  const [conversationMilestone, setConversationMilestone] = useState<string | null>(null);

  // 캐릭터 추천 관련 상태
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [isLoadingCharacters, setIsLoadingCharacters] = useState(false);
  const [isLoadingMoreCharacters, setIsLoadingMoreCharacters] = useState(false);
  const [isLoadingVariations, setIsLoadingVariations] = useState(false);
  const [suggestedCharacters, setSuggestedCharacters] = useState<CharacterSuggestion[]>([]);
  const [characterTopic, setCharacterTopic] = useState("");
  const [characterRelationships, setCharacterRelationships] = useState<Record<number, RelationshipType>>({});
  const [characterLanguages, setCharacterLanguages] = useState<Record<number, LanguageOption>>({});
  const [characterDebateIntensities, setCharacterDebateIntensities] = useState<Record<number, number>>({});
  const [lastRecommendationTime, setLastRecommendationTime] = useState<number | null>(null);
  
  // 복수 캐릭터 선택 관련 상태
  const [selectedCharacters, setSelectedCharacters] = useState<{character: any, index: number}[]>([]);
  const [isAddingMultipleCharacters, setIsAddingMultipleCharacters] = useState(false);
  const [expandedCharacterIndices, setExpandedCharacterIndices] = useState<Set<number>>(new Set());

  // groupChatId가 변경될 때 캐릭터 추천 모달 닫기
  useEffect(() => {
    if (showCharacterModal) {
      console.log('[캐릭터 추천 모달] 채팅방 변경 감지 - 모달 닫기');
      setShowCharacterModal(false);
      setSuggestedCharacters([]);
      setSelectedCharacters([]);
      setExpandedCharacterIndices(new Set());
    }
  }, [groupChatId]);
  
  // 🎬 Step 43: 누적 텍스트 스트리밍 (백엔드에서 딜레이 처리)
  // 백엔드에서 청크마다 누적된 전체 텍스트를 보내므로, 프론트엔드는 단순히 교체만 함
  // 타이핑 효과는 백엔드의 delayMs로 구현됨
  
  // ⚡ agentStreaming 이벤트 리스너 (누적 방식 + 단조 증가 보장)
  useEffect(() => {
    // 🎬 Step 43 Fix: agentId 정규화 - null을 -1로 변환 (백엔드와 일치)
    const normalizeAgentId = (agentId: number | null | undefined): number => {
      return agentId ?? -1;
    };
    
    const handleAgentStreaming = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { groupChatId: eventGroupChatId, userTurnId, agentId: rawAgentId, partialContent, agentName, agentIcon, agentColor } = customEvent.detail;
      
      if (eventGroupChatId !== parseInt(groupChatId || '0')) return;
      
      // 🎬 Step 43 Fix: agentId 정규화
      const agentId = normalizeAgentId(rawAgentId);
      const key = `${eventGroupChatId}:${userTurnId}:${agentId}`;
      
      // 🎬 Step 43 Fix: 단조 증가 보장 - 더 짧은 청크는 무시 (같은 길이는 허용)
      setStreamingByTurn(prev => {
        const currentLength = prev[key]?.partialContent?.length || 0;
        
        // 새 청크가 기존보다 짧으면 무시 (순서 문제 방지)
        // 같은 길이는 허용 (마지막 청크 중복 문제 방지)
        if (partialContent.length < currentLength) {
          return prev;  // 상태 변경 없음
        }
        
        return {
          ...prev,
          [key]: {
            partialContent,  // 누적된 전체 텍스트
            agentId,
            agentName,
            agentIcon,
            agentColor,
            userTurnId
          }
        };
      });
      
      // 디버그 로그 (매 청크마다 출력하면 스팸이 되므로 간략화)
      if (partialContent.length <= 10 || partialContent.length % 50 === 0) {
        console.log(`[🎬 STREAM] ${agentName}: ${partialContent.length}자`);
      }
    };
    
    // 🎬 Step 43 Fix: 스트리밍 완료 이벤트 처리 (streamingByTurn 정리)
    const handleStreamingComplete = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { groupChatId: eventGroupChatId, userTurnId, agentId: rawAgentId, agentName, finalLength } = customEvent.detail;
      
      if (eventGroupChatId !== parseInt(groupChatId || '0')) return;
      
      // 🎬 Step 43 Fix: agentId 정규화 (스트리밍과 동일하게)
      const agentId = normalizeAgentId(rawAgentId);
      const key = `${eventGroupChatId}:${userTurnId}:${agentId}`;
      
      console.log(`[🎬 STREAM COMPLETE] ${agentName} 정리 (${finalLength}자) - key: ${key}`);
      
      // 해당 스트리밍 상태 제거 (메시지가 브로드캐스트되면 대체됨)
      setStreamingByTurn(prev => {
        const { [key]: removed, ...rest } = prev;
        return rest;
      });
    };
    
    window.addEventListener('agentStreaming', handleAgentStreaming);
    window.addEventListener('agentStreamingComplete', handleStreamingComplete);
    
    return () => {
      window.removeEventListener('agentStreaming', handleAgentStreaming);
      window.removeEventListener('agentStreamingComplete', handleStreamingComplete);
    };
  }, [groupChatId]);
  
  // 🚀 "생각 중" 인디케이터 상태 (사용자 요청 기능)
  const [thinkingIndicators, setThinkingIndicators] = useState<Array<{
    id: string;
    agentName: string;
    order: number;
  }>>([]);
  
  // ⏱️ 메시지 큐 시스템 (1초 지연) - ID만 관리
  const [displayedIds, setDisplayedIds] = useState<Set<number>>(new Set());
  const [messageQueue, setMessageQueue] = useState<number[]>([]); // ID만 큐에 저장
  const queueTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // ref → state 변경
  const previousMessagesRef = useRef<GroupChatMessage[]>([]);

  // messages가 변경되면 새로운 메시지 ID를 큐에 추가
  useEffect(() => {
    if (messages.length === 0) {
      console.log('[⏱️ 메시지 초기화] messages가 비어있음');
      setDisplayedIds(new Set());
      setMessageQueue([]);
      setIsInitialLoad(true);
      previousMessagesRef.current = [];
      return;
    }

    console.log(`[⏱️ 메시지 변경 감지] 총 ${messages.length}개 메시지, 초기로딩=${isInitialLoad}`);

    // 🚀 초기 로딩: 모든 메시지 ID 즉시 표시
    if (isInitialLoad) {
      console.log(`[⏱️ 초기 로딩] ${messages.length}개 메시지 즉시 표시`);
      setDisplayedIds(new Set(messages.map(m => m.id)));
      previousMessagesRef.current = messages;
      setIsInitialLoad(false);
      return;
    }

    // 이전 메시지 ID 세트
    const previousIds = new Set(previousMessagesRef.current.map(m => m.id));
    console.log(`[⏱️ 비교] 이전 메시지 ${previousIds.size}개, 현재 메시지 ${messages.length}개`);
    
    // 새로운 메시지 ID만 필터링
    const newMessageIds = messages.filter(msg => !previousIds.has(msg.id)).map(m => m.id);
    console.log(`[⏱️ 필터링] 새 메시지 ${newMessageIds.length}개 발견: [${newMessageIds.join(', ')}]`);
    
    if (newMessageIds.length > 0) {
      console.log(`[⏱️ 큐 추가] ${newMessageIds.length}개 새 메시지 ID를 큐에 추가`);
      
      setMessageQueue(prev => {
        const updated = [...prev, ...newMessageIds];
        console.log(`[⏱️ 큐 상태] 큐에 ${updated.length}개 메시지 대기 중`);
        return updated;
      });
      previousMessagesRef.current = messages;
    } else {
      console.log('[⏱️ 스킵] 새 메시지 없음');
    }
  }, [messages, isInitialLoad]);

  // 그룹 채팅방 변경 시 초기화
  useEffect(() => {
    setIsInitialLoad(true);
    setDisplayedIds(new Set());
    setMessageQueue([]);
  }, [groupChatId]);

  // 큐 처리: 모든 메시지 1초 간격으로 표시
  useEffect(() => {
    // 큐가 비어있으면 타이머 정리
    if (messageQueue.length === 0) {
      if (queueTimerRef.current) {
        clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
      return;
    }

    // 이미 타이머가 실행 중이면 아무것도 하지 않음 (중복 방지)
    if (queueTimerRef.current) {
      return;
    }

    // 모든 메시지 1초 간격
    const delay = 1000;

    // 새 타이머 시작
    queueTimerRef.current = setTimeout(() => {
      const nextId = messageQueue[0];
      const msg = messages.find(m => m.id === nextId);
      console.log(`[⏱️ 큐 처리] 메시지 ID ${nextId} 표시 (1초 후): ${msg?.content?.substring(0, 30)}...`);
      
      setDisplayedIds(prev => new Set(Array.from(prev).concat(nextId)));
      setMessageQueue(prev => prev.slice(1));
      
      // 타이머 완료, ref 초기화
      queueTimerRef.current = null;
    }, delay);
  }, [messageQueue, messages]); // messageQueue와 messages 감시

  // 🔧 typing_end 처리: 점진적 파싱 지원 (메시지 도착 여부와 무관하게 즉시 제거)
  useEffect(() => {
    if (!shouldEndTyping) return;
    
    console.log(`[🔍 typing_end 수신] 점진적 파싱 완료 - typing indicator 즉시 제거`);
    
    // 🚀 큐에 남은 메시지가 있으면 모두 즉시 표시
    if (messageQueue.length > 0) {
      console.log(`[⚡ 큐 플러시] typing_end 수신 - 큐에 남은 ${messageQueue.length}개 메시지 즉시 표시`);
      setDisplayedIds(prev => {
        const newSet = new Set(Array.from(prev));
        messageQueue.forEach(id => newSet.add(id));
        return newSet;
      });
      setMessageQueue([]);
      
      // 타이머 정리
      if (queueTimerRef.current) {
        clearTimeout(queueTimerRef.current);
        queueTimerRef.current = null;
      }
    }
    
    // 🎬 Step 43: typing_end 처리 (누적 방식에서는 큐 플러시 불필요)
    const typingEndTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        // 타이머 클리어
        if (sendTimeoutRef.current) {
          clearTimeout(sendTimeoutRef.current);
          sendTimeoutRef.current = null;
        }
        setIsAnyBotTyping(false);
        setIsGroupChatBusy(false);
        setTypingBotInfo(null);
        
        // ✅ 스트리밍 상태 초기화 (중복 방지)
        setStreamingByTurn({});
        console.log(`[🧹 스트리밍 정리] typing_end 수신 - streamingByTurn 초기화`);
        setIsSendingDisabled(false);
        setShouldEndTyping(false);
        setWaitingForBotMessageId(null);
      });
    }, 200);
    
    return () => clearTimeout(typingEndTimer);
  }, [shouldEndTyping]);

  // ⏱️ 봇 답변 감지 및 타임아웃 처리
  useEffect(() => {
    if (!questionMessageIdRef.current) return;
    
    // 봇 메시지가 있는지 확인
    const botMessages = messages.filter(msg => msg.agentId && msg.id > questionMessageIdRef.current!);
    
    if (botMessages.length > 0) {
      console.log(`[⏱️ 봇 답변 감지] ${botMessages.length}개 답변 도착`);
      
      // 첫 답변이 왔으므로 "답변 없는 질문 삭제" 타이머 취소
      if (noAnswerTimeoutRef.current) {
        clearTimeout(noAnswerTimeoutRef.current);
        noAnswerTimeoutRef.current = null;
        console.log('[⏱️ 답변 감지] 질문 삭제 타이머 취소');
      }
      
      // 마지막 봇 답변 시간 업데이트
      const now = Date.now();
      lastBotResponseTimeRef.current = now;
      
      // 멀티 에이전트 답변 간격 타임아웃 설정
      // (첫 답변 이후 30초 동안 다음 답변이 없으면 대기 포기)
      // 이전 타이머 클리어
      if (responseIntervalTimeoutRef.current) {
        clearTimeout(responseIntervalTimeoutRef.current);
      }
      
      // 30초 답변 간격 타이머 시작 (첫 답변 이후부터)
      responseIntervalTimeoutRef.current = setTimeout(() => {
        console.log('[⏱️ 30초 답변 간격 타임아웃] 다음 답변 대기 포기');
        questionMessageIdRef.current = null;
        setIsSendingDisabled(false);
        setIsGroupChatBusy(false);
        setIsAnyBotTyping(false);
        setTypingBotInfo(null);
      }, 30000);
      
      console.log('[⏱️ 답변 간격 타이머 시작] 다음 답변 30초 대기');
    }
  }, [messages]);

  // ⏱️ 타이머 cleanup (컴포넌트 unmount 시)
  useEffect(() => {
    return () => {
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
        sendTimeoutRef.current = null;
      }
      if (noAnswerTimeoutRef.current) {
        clearTimeout(noAnswerTimeoutRef.current);
        noAnswerTimeoutRef.current = null;
      }
      if (responseIntervalTimeoutRef.current) {
        clearTimeout(responseIntervalTimeoutRef.current);
        responseIntervalTimeoutRef.current = null;
      }
    };
  }, []);

  // ✅ Phase 2 단일 처리: uniqueMessages는 displayedIds에 포함된 renderedMessages만 표시 (스트리밍 포함)
  const uniqueMessages = useMemo(() => {
    // 초기 로딩 시에는 모든 메시지 표시 (displayedIds 업데이트 전)
    if (isInitialLoad && renderedMessages.length > 0) {
      console.log(`[✅ Phase 2 초기] ${renderedMessages.length}개 메시지 즉시 표시 (스트리밍 포함)`);
      // 이전 대화 요약 메시지 필터링 (시스템 메시지 중 요약만 제외)
      return renderedMessages.filter(msg => {
        const isSystemMessage = !msg.senderId && !msg.agentId;
        const isSummaryMessage = isSystemMessage && msg.content && typeof msg.content === 'string' && msg.content.includes('이전 대화 요약');
        return !isSummaryMessage;
      });
    }
    
    const filtered = renderedMessages.filter(msg => {
      if (msg.isStreaming) return true;
      
      if (!displayedIds.has(msg.id)) return false;
      
      // 이전 대화 요약 메시지 필터링 (시스템 메시지 중 요약만 제외)
      const isSystemMessage = !msg.senderId && !msg.agentId;
      const isSummaryMessage = isSystemMessage && msg.content && typeof msg.content === 'string' && msg.content.includes('이전 대화 요약');
      return !isSummaryMessage;
    });
    console.log(`[✅ Phase 2 완료] ${filtered.length}개 메시지 최종 처리 (총 ${renderedMessages.length}개 중, 스트리밍 포함)`);
    return filtered;
  }, [renderedMessages, displayedIds, isInitialLoad]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasInitialScroll = useRef(false);
  
  // 🔒 Task 5: Scenario Lock System
  const scenarioInProgressRef = useRef(false);

  // messageRef와 message state 동기화
  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  // 🎯 Task 4: Real-time Discussion Metrics
  useEffect(() => {
    if (messages.length > 0) {
      const currentTurns = messages.filter(msg => msg.agentId || msg.agent).length;
      setTurnCount(currentTurns);
      
      // 토론 열기 계산 (최근 10분간 메시지 빈도 기반)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const recentMessages = messages.filter(msg => 
        new Date(msg.createdAt) > tenMinutesAgo
      );
      const heat = Math.min(10, Math.floor(recentMessages.length / 2));
      setDiscussionHeat(heat);
      
      // 마일스톤 체크
      if (currentTurns === 6) {
        setConversationMilestone('🎯 6턴 달성! 본격적인 토론이 시작됩니다');
        setTimeout(() => setConversationMilestone(null), 5000);
      } else if (currentTurns === 10) {
        setConversationMilestone('🔥 10턴 돌파! 열띤 토론이 진행 중입니다');
        setTimeout(() => setConversationMilestone(null), 5000);
      } else if (currentTurns === 15) {
        setConversationMilestone('⭐ 15턴 초과! 심화 토론 단계입니다');
        setTimeout(() => setConversationMilestone(null), 5000);
      }
    }
  }, [messages]);

  // 채팅방 설정 모달이 열릴 때마다 현재 값으로 초기화
  useEffect(() => {
    if (showChatSettingsModal && groupChat) {
      setNewChatTitle(groupChat.title || "");
      setNewLanguageLevel(groupChat.languageLevel ?? null); // null 허용 (미적용 상태)
      setNewGptModel(groupChat.model || "gpt-4o-mini");
      setNewGptTemperature(groupChat.temperature !== undefined ? groupChat.temperature : 1.0);
    }
  }, [showChatSettingsModal, groupChat]);

  // 🎯 텍스트 길이 기반 자연스러운 딜레이 계산 (사용자 제안)
  const calculateNaturalDelay = useCallback((prevText: string, currentText: string): number => {
    const baseDelay = 250; // 최소 텀 (ms)
    const prevFactor = Math.min(prevText.length * 15, 1500); // 이전 대사 길이에 비례
    const currentFactor = Math.min(currentText.length * 10, 1000); // 현재 대사 길이에 비례  
    const randomFactor = Math.random() * 300; // 0~300ms 랜덤 요소
    const calculatedDelay = baseDelay + prevFactor + currentFactor + randomFactor;
    
    console.log(`[⏰ 딜레이 계산] 이전:${prevText.length}자(${prevFactor}ms) + 현재:${currentText.length}자(${currentFactor}ms) + 랜덤:${randomFactor.toFixed(0)}ms = ${calculatedDelay.toFixed(0)}ms`);
    return calculatedDelay;
  }, []);

  // 🎭 순차 출력 구현 (Task 2: 새로운 큐 시스템 사용)
  const displayTurnsSequentially = useCallback(async (turns: Array<{
    agentId: number;
    agentName: string;
    content: string;
    order: number;
  }>) => {
    // 🚨 중복 실행 방지 체크 (새로운 큐 매니저 사용)
    if (queueManager.isCurrentlyProcessing()) {
      console.log(`[⚠️ 중복 실행 차단] 이미 순차 연출이 진행 중입니다`);
      return;
    }
    
    console.log(`[🎭 텍스트 길이 기반 순차 연출] ${turns.length}명의 캐릭터가 자연스러운 템포로 등장`);
    
    // 🚨 순차 연출 시작: 새로운 큐 매니저로 시작
    const scenarioId = `scenario_${Date.now()}_${groupChatId}`;
    queueManager.startProcessing(scenarioId);
    console.log(`[🚨 순차 연출 시작] 큐 매니저로 통합 관리 시작`);
    
    let prevText = ""; // 이전 대사 추적용
    let cumulativeDelay = 0; // 누적 딜레이
    
    for (let idx = 0; idx < turns.length; idx++) {
      const turn = turns[idx];
      
      // 🎯 텍스트 길이 기반 딜레이 계산
      let naturalDelay: number;
      if (idx === 0) {
        // 첫 캐릭터: 기본 2-4초 (조기 출력 효과)
        naturalDelay = 2000 + Math.random() * 2000;
        cumulativeDelay = naturalDelay;
      } else {
        // 나머지: 이전 대사와 현재 대사 길이 고려
        const textBasedDelay = calculateNaturalDelay(prevText, turn.content);
        cumulativeDelay += textBasedDelay;
        naturalDelay = cumulativeDelay;
      }
      
      // 💭 "생각 중" 인디케이터 비활성화 - 일반 타이핑 인디케이터만 사용
      const thinkingId = `thinking-${turn.agentId}-${turn.order}-${Date.now()}`;
      
      // const thinkingTimeout = setTimeout(() => {
      //   console.log(`[💭 생각 중] ${turn.agentName} 생각 중... (${turn.content.length}자 대사)`);
      //   setThinkingIndicators(prev => [...prev, {
      //     id: thinkingId,
      //     agentName: turn.agentName,
      //     order: turn.order
      //   }]);
      //   
      //   // 🚨 안전장치: 10초 후 자동 제거
      //   const cleanupTimeout = setTimeout(() => {
      //     setThinkingIndicators(prev => 
      //       prev.filter(indicator => indicator.id !== thinkingId)
      //     );
      //   }, 10000);
      //   
      //   // 안전장치 타이머도 추적 (새로운 큐 매니저 사용)
      //   queueManager.addTimeout(cleanupTimeout);
      // }, thinkingDelay);
      // 
      // // 생각 중 타이머 추적 (새로운 큐 매니저 사용)
      // queueManager.addTimeout(thinkingTimeout);
      
      const messageTimeout = setTimeout(() => {
        console.log(`[🎭 자연스러운 등장] ${turn.agentName} (${naturalDelay.toFixed(0)}ms 후, ${turn.content.length}자)`);
        
        // 💭 인디케이터 제거 비활성화 (더 이상 추가하지 않음)
        // setThinkingIndicators(prev => 
        //   prev.filter(indicator => indicator.id !== thinkingId)
        // );
        
        // 🎯 핵심 수정: 개별 턴을 캐시에 직접 추가하여 진정한 순차 연출
        const messagesQueryKey = [`/api/group-chats/${groupChatId}/messages`];
        const currentMessages = queryClient.getQueryData(messagesQueryKey) as any[] || [];
        
        // 새 메시지 객체 생성 (서버에서 저장된 형태와 동일하게)
        const tempMessageId = Date.now() + idx; // 임시 ID
        
        // 🚫 Phase 2 제거: 중복 방지는 useMemo uniqueMessages에서만 처리
        
        const newMessage = {
          id: tempMessageId,
          groupChatId: Number(groupChatId),
          content: turn.content,
          senderId: undefined as string | undefined, // TypeScript 호환성 수정
          agentId: turn.agentId,
          agentName: turn.agentName,
          createdAt: new Date().toISOString(),
          isBot: true,
          reactions: [],
          userTurnId: undefined as string | undefined, // 누락된 필드 추가
          replyOrder: undefined as number | undefined, // 누락된 필드 추가
          targetAgentIds: undefined as number[] | undefined // 누락된 필드 추가
        };
        
        // 🔄 Step 2: merge 방식으로 임시 메시지 추가 (중복 방지)
        queryClient.setQueryData(messagesQueryKey, (oldMessages: Msg[]) => mergeMessages(oldMessages, [newMessage]));
        console.log(`[🎯 캐시 직접 추가] ${turn.agentName} 메시지 개별 추가 완료 (임시 ID: ${tempMessageId})`);
        
        // ✅ normalizeMessages가 모든 fingerprint 기반 매칭을 순수 계산으로 처리
        
        console.log('[➖ 큐 제거] 남은 메시지:', turns.length - idx - 1);
      }, naturalDelay);
      
      // 메시지 타이머도 추적 (새로운 큐 매니저 사용)
      queueManager.addTimeout(messageTimeout);
      
      // 🔄 다음 턴을 위해 이전 텍스트 업데이트
      prevText = turn.content;
    }
    
    // 🔄 마지막에 서버와 동기화 (모든 턴이 완료된 후)
    // 마지막 턴의 누적 딜레이를 사용 (중복 계산 방지)
    const lastDelay = cumulativeDelay;
    
    const finalTimeout = setTimeout(() => {
      console.log(`[🔄 최종 동기화] 모든 턴 완료 후 서버와 동기화`);
      // 🚨 순차 연출 완료: 새로운 큐 매니저로 정리
      queueManager.stopProcessing();
      console.log(`[🚨 순차 연출 완료] 큐 매니저로 통합 정리 완료`);
      
      // ✅ 이제 안전하게 localStorage 시나리오 데이터 정리
      localStorage.removeItem(`scenario_${groupChatId}`);
      console.log(`[🧹 최종 정리] localStorage 시나리오 데이터 삭제 완료`);
      
      // 🎬 Task 7: Call endScenario to properly clean up
      endScenario();
      
      // ✅ 모든 업데이트는 SSE로 처리됨 - invalidate 불필요
      console.log(`[✅ 순차 연출 완료] SSE가 모든 메시지를 실시간 추가했으므로 invalidate 생략`);
    }, lastDelay + 1000); // 마지막 턴 후 1초 뒤
    
    // 최종 타이머도 관리 목록에 추가 (새로운 큐 매니저 사용)
    queueManager.addTimeout(finalTimeout);
    
    // 🔟 Task 10: Enhanced Debugging Logging
    console.log(`[🎭 텍스트 길이 기반 연출] ${turns.length}명의 자연스러운 UI 타이머 설정 완료`);
    console.log('[➕ 큐 추가] 전체', turns.length, '개 메시지 큐에 추가됨');
  }, [groupChatId, queryClient, calculateNaturalDelay, queueManager]);

  // 🔄 Task 3: 재시도 성공 이벤트 리스너 (displayTurnsSequentially 선언 이후에 배치)
  useEffect(() => {
    const handleRetrySuccess = (event: CustomEvent) => {
      const { scenarioTurns, groupChatId: eventGroupChatId } = event.detail;
      
      // 현재 그룹 채팅에 해당하는 경우에만 처리
      if (Number(eventGroupChatId) === Number(groupChatId)) {
        console.log(`[✅ 재시도 성공 이벤트] ${scenarioTurns.length}개 턴 순차 연출 시작`);
        
        if (!queueManager.isCurrentlyProcessing()) {
          displayTurnsSequentially(scenarioTurns);
        }
      }
    };
    
    window.addEventListener('retrySuccess', handleRetrySuccess as EventListener);
    
    return () => {
      window.removeEventListener('retrySuccess', handleRetrySuccess as EventListener);
    };
  }, [groupChatId, queueManager, displayTurnsSequentially]);

  // 메시지 전송 뮤테이션
  const sendMessageMutation = useMutation({
    mutationFn: async (data: {
      content: string;
      targetAgentIds?: number[];
      replyOrder?: number;
    }) => {
      setIsSendingDisabled(true);
      
      // ⏱️ 30초 타임아웃 설정 (응답 신호가 없으면 자동 활성화)
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
      }
      sendTimeoutRef.current = setTimeout(() => {
        console.log('[⏱️ 30초 타임아웃] 응답 신호 없음, 전송 버튼 강제 활성화');
        setIsSendingDisabled(false);
        setIsGroupChatBusy(false);
        setIsAnyBotTyping(false);
        setTypingBotInfo(null);
      }, 30000);
      
      // 🚨 새 질문 시작: 이전 시나리오 데이터 정리
      localStorage.removeItem(`scenario_${groupChatId}`);
      console.log(`[🧹 데이터 정리] 이전 시나리오 데이터 삭제 완료`);
      
      const response = await fetch(`/api/group-chats/${groupChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to send message');
      }
      return response.json();
    },
    onMutate: async (variables) => {
      // 즉시 UI 업데이트를 위한 optimistic update
      await queryClient.cancelQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });

      const previousMessages = queryClient.getQueryData([`/api/group-chats/${groupChatId}/messages`]);

      // 사용자 메시지를 즉시 추가 (모든 경우에 대해)
      const optimisticUserMessage = {
        id: Date.now(), // 임시 ID
        groupChatId: Number(groupChatId),
        content: variables.content,
        senderId: user?.id || '', // 사용자 메시지는 senderId 있음
        senderName: user?.firstName || '사용자',
        createdAt: new Date().toISOString(),
        targetAgentIds: variables.targetAgentIds || undefined,
        replyOrder: variables.replyOrder || undefined,
        agentId: undefined as number | undefined, // AI 메시지가 아니므로 undefined
        userTurnId: undefined as string | undefined,
        reactions: [] as any[]
      };

      // 🔄 Step 2: merge 방식으로 사용자 메시지 낙관적 업데이트
      queryClient.setQueryData(
        [`/api/group-chats/${groupChatId}/messages`],
        (oldMessages: any) => mergeMessages(oldMessages, [optimisticUserMessage])
      );

      return { previousMessages };
    },
    onSuccess: (response) => {
      console.log(`[✅ POST SUCCESS] 메시지 전송 성공, scenarioTurns:`, response?.scenarioTurns?.length);
      
      // ⏱️ 질문 메시지 ID 저장 및 30초 답변 대기 타이머 시작
      if (response?.userMessage?.id) {
        questionMessageIdRef.current = response.userMessage.id;
        lastBotResponseTimeRef.current = null; // 리셋
        
        // 이전 타이머 클리어
        if (noAnswerTimeoutRef.current) {
          clearTimeout(noAnswerTimeoutRef.current);
        }
        if (responseIntervalTimeoutRef.current) {
          clearTimeout(responseIntervalTimeoutRef.current);
        }
        
        // 30초 후에도 답변이 없으면 질문 삭제
        noAnswerTimeoutRef.current = setTimeout(async () => {
          if (questionMessageIdRef.current) {
            console.log('[⏱️ 30초 타임아웃] 답변 없음 - 질문 메시지 삭제');
            
            // 서버에서 질문 메시지 삭제
            try {
              const response = await fetch(`/api/group-chats/${groupChatId}/messages/${questionMessageIdRef.current}`, {
                method: 'DELETE',
                credentials: 'include',
              });
              
              if (response.ok) {
                console.log('[✅ 질문 삭제 성공]');
              }
            } catch (error) {
              console.error('[❌ 질문 삭제 실패]:', error);
            }
            
            questionMessageIdRef.current = null;
            setIsSendingDisabled(false);
            setIsGroupChatBusy(false);
            setIsAnyBotTyping(false);
            setTypingBotInfo(null);
          }
        }, 30000);
        
        console.log('[⏱️ 답변 대기 타이머 시작] 질문 ID:', response.userMessage.id);
      }
      
      // 🎭 서버 응답이 새로운 한번 호출 시스템인지 확인
      if (response?.scenarioTurns?.length > 0) {
        // 🎯 시나리오 데이터를 localStorage에 저장 (SSE에서 확인용)
        const scenarioData = {
          turns: response.scenarioTurns,
          timestamp: Date.now()
        };
        localStorage.setItem(`scenario_${groupChatId}`, JSON.stringify(scenarioData));
        console.log(`[💾 시나리오 저장] localStorage에 ${response.scenarioTurns.length}개 턴 저장 완료`);
        
        // 🚨 SSE 활성화 시 API 순차 연출 건너뛰기 (중복 방지)
        console.log(`[🔍 API 중복 체크] isProcessing = ${queueManager.isCurrentlyProcessing()}`);
        if (queueManager.isCurrentlyProcessing()) {
          console.log(`[⚠️ API 중복 차단] SSE 순차 연출이 이미 진행 중이므로 API 연출 건너뛰기`);
          
          // ✅ SSE가 메시지를 추가하므로 invalidateQueries 불필요
          console.log(`[✅ SSE 처리] 메시지 재조회 생략 - SSE가 실시간 업데이트`);
          queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
          return;
        }
        
        // 새로운 시스템: 전체 대화를 한번에 받아서 순차 연출
        console.log(`[🎭 API 순차 연출] ${response.scenarioTurns.length}명의 대화를 순차 표시`);
        displayTurnsSequentially(response.scenarioTurns);
        
        // ⚠️ localStorage 정리는 순차 연출 완료 후에 실행됨 (displayTurnsSequentially 내부에서)
        
        // ✅ 모든 업데이트는 SSE로 처리 - invalidate 불필요
        console.log(`[✅ SSE만 사용] 채팅 목록은 chat_list_update SSE 이벤트로 자동 갱신`);
      } else {
        // 기존 시스템: 개별 메시지들을 서버에서 받음
        console.log(`[🔄 기존 시스템] 서버에서 개별 메시지 처리`);
        
        // ✅ 모든 업데이트는 SSE로 처리 - invalidate 불필요
        console.log(`[✅ SSE만 사용] 채팅 목록은 chat_list_update SSE 이벤트로 자동 갱신`);
      }
      
      // 커서를 입력창으로 돌리기
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    },
    onError: async (err, variables, context: any) => {
      // 🔄 Task 3: 재시도 큐 시스템 통합
      const requestId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`[❌ 메시지 전송 실패] 재시도 큐에 추가 시도: ${err.message}`);
      
      // 재시도 시스템에 요청 추가
      const retryAdded = await retryManager.addRetryRequest(requestId, variables, err as Error);
      
      if (retryAdded) {
        // 재시도가 예약됨 - UI는 낙관적 업데이트 유지
        toast({
          title: "메시지 전송 재시도 중",
          description: "전송에 실패했지만 자동으로 재시도합니다.",
          variant: "default",
        });
        console.log(`[🔄 재시도 예약] 요청 ID: ${requestId}`);
      } else {
        // 재시도 한계 초과 - UI 되돌리기
        if (context?.previousMessages) {
          queryClient.setQueryData([`/api/group-chats/${groupChatId}/messages`], context.previousMessages);
        }
        toast({
          title: "메시지 전송 최종 실패",
          description: "여러 번 재시도했지만 전송에 실패했습니다.",
          variant: "destructive",
        });
        console.log(`[💀 재시도 포기] 최대 재시도 횟수 초과`);
      }
    },
    onSettled: () => {
      // 타이머 클리어
      if (sendTimeoutRef.current) {
        clearTimeout(sendTimeoutRef.current);
        sendTimeoutRef.current = null;
      }
      setIsSendingDisabled(false);
    },
  });

  // Delete message mutation (admin only)
  const deleteMessageMutation = useMutation({
    mutationFn: async (messageInfo: { id: number; groupChatId?: number }) => {
      // Bulk delete if id is -1
      if (messageInfo.id === -1) {
        const response = await fetch('/api/messages/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            messageIds: Array.from(selectedMessages),
            groupChatId: messageInfo.groupChatId 
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
        body: JSON.stringify({ groupChatId: messageInfo.groupChatId }),
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
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });
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

  // 캐릭터 추천 뮤테이션
  const suggestCharactersMutation = useMutation({
    mutationFn: async (topic: string) => {
      setIsLoadingCharacters(true);
      const response = await fetch(`/api/suggest-characters?lang=${language}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error: any = new Error('Failed to suggest characters');
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    onSuccess: (data) => {
      const currentTime = Date.now();
      const charactersWithTimestamp = data.characters.map((char: CharacterSuggestion) => ({
        ...char,
        recommendedAt: currentTime
      }));
      setSuggestedCharacters(charactersWithTimestamp);
      setLastRecommendationTime(currentTime);
      // 새로운 검색이므로 선택/확장 상태 초기화
      setSelectedCharacters([]);
      setExpandedCharacterIndices(new Set());
      setIsLoadingCharacters(false);
      console.log('[캐릭터 추천] 성공:', data.characters.length, '개 캐릭터');
    },
    onError: (error: any) => {
      setIsLoadingCharacters(false);
      setShowCharacterModal(false); // 에러 시 모달 닫기
      console.error('[캐릭터 추천] 오류:', error);
      
      // 403 에러 특별 처리
      if (error.status === 403) {
        toast({
          title: "권한이 없습니다",
          description: "캐릭터 추천 기능은 관리자만 사용할 수 있습니다.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "캐릭터 추천 실패",
          description: "캐릭터 추천 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    },
  });

  // 추가 캐릭터 추천 뮤테이션 (같은 주제로 6명 더 추천)
  const suggestMoreCharactersMutation = useMutation({
    mutationFn: async (topic: string) => {
      setIsLoadingMoreCharacters(true);
      const response = await fetch(`/api/suggest-characters/more?topic=${encodeURIComponent(topic)}&lang=${language}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        const error: any = new Error('Failed to suggest more characters');
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    onSuccess: (data) => {
      const currentTime = Date.now();
      const newCharactersCount = data.characters.length;
      const charactersWithTimestamp = data.characters.map((char: CharacterSuggestion) => ({
        ...char,
        recommendedAt: currentTime
      }));
      
      // 기존 캐릭터 목록의 위에 새 캐릭터들을 추가
      setSuggestedCharacters(prev => [...charactersWithTimestamp, ...prev]);
      setLastRecommendationTime(currentTime);
      
      // 기존 선택/확장 상태의 인덱스를 조정 (새 캐릭터 개수만큼 증가)
      setExpandedCharacterIndices(prev => {
        const newSet = new Set<number>();
        prev.forEach(index => newSet.add(index + newCharactersCount));
        return newSet;
      });
      
      setSelectedCharacters(prev => 
        prev.map(item => ({
          ...item,
          index: item.index + newCharactersCount
        }))
      );
      
      setIsLoadingMoreCharacters(false);
      console.log('[추가 캐릭터 추천] 성공:', data.characters.length, '개 캐릭터 추가');
    },
    onError: (error: any) => {
      setIsLoadingMoreCharacters(false);
      console.error('[추가 캐릭터 추천] 오류:', error);
      
      // 403 에러 특별 처리
      if (error.status === 403) {
        toast({
          title: "권한이 없습니다",
          description: "캐릭터 추천 기능은 관리자만 사용할 수 있습니다.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "추가 캐릭터 추천 실패",
          description: "추가 캐릭터 추천 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    },
  });

  // 같은 카테고리 캐릭터 추천 뮤테이션
  const suggestSameCategoryMutation = useMutation({
    mutationFn: async ({ characterId, topic }: { characterId: string, topic?: string }) => {
      const response = await fetch('/api/suggest-characters/same-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, topic, lang: language }),
        credentials: 'include',
      });
      if (!response.ok) {
        const error: any = new Error('Failed to suggest same category characters');
        error.status = response.status;
        throw error;
      }
      return response.json();
    },
    onSuccess: (data) => {
      const currentTime = Date.now();
      const charactersWithTimestamp = data.characters.map((char: CharacterSuggestion) => ({
        ...char,
        recommendedAt: currentTime
      }));
      
      // 기존 캐릭터 목록의 위에 새 캐릭터들을 추가
      setSuggestedCharacters(prev => [...charactersWithTimestamp, ...prev]);
      setLastRecommendationTime(currentTime);
      console.log('[같은 카테고리 추천] 성공:', data.characters.length, '개 캐릭터 추가 (카테고리:', data.baseCharacter.category, ')');
      toast({
        title: "같은 카테고리 추천 완료",
        description: `${data.baseCharacter.category} 카테고리의 캐릭터 ${data.characters.length}명을 추천했습니다.`,
      });
    },
    onError: (error: any) => {
      console.error('[같은 카테고리 추천] 오류:', error);
      
      // 403 에러 특별 처리
      if (error.status === 403) {
        toast({
          title: "권한이 없습니다",
          description: "캐릭터 추천 기능은 관리자만 사용할 수 있습니다.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "같은 카테고리 추천 실패",
          description: "같은 카테고리 캐릭터 추천 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    },
  });

  // 대화방 나가기 뮤테이션
  const leaveGroupChatMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/group-chats/${groupChatId}/members/${user?.id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to leave group chat');
      return response.json();
    },
    onSuccess: (data) => {
      if (data.deleted) {
        toast({
          title: t('chat:settings.deleted'),
          description: t('chat:settings.deletedDesc'),
        });
      } else {
        toast({
          title: t('chat:settings.leaveSuccess'),
          description: t('chat:settings.leaveSuccessDesc'),
        });
      }
      // 그룹 채팅 목록에서 해당 채팅 제거 (부드러운 UI 업데이트)
      queryClient.setQueryData(["/api/group-chats"], (oldData: any) => {
        if (!oldData) return [];
        return oldData.filter((chat: any) => chat.id !== parseInt(groupChatId));
      });
      // 부드러운 네비게이션으로 홈 이동
      setLocation('/');
    },
    onError: () => {
      toast({
        title: t('chat:settings.leaveFailed'),
        description: t('chat:settings.leaveFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 채팅방 제목 변경 뮤테이션
  const updateTitleMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update chat title');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // 제목 업데이트 성공
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      
      toast({
        title: "제목 변경 완료",
        description: `채팅방 제목이 "${data.title}"로 변경되었습니다.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "제목 변경 실패",
        description: error.message || "채팅방 제목 변경 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 🎭 관계 매트릭스 생성 뮤테이션
  const generateMatrixMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/group-chats/${groupChatId}/generate-relationship-matrix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate relationship matrix');
      }
      return response.json();
    },
    onMutate: () => {
      setIsGeneratingMatrix(true);
    },
    onSuccess: (data) => {
      setRelationshipMatrix(data.matrix);
      setHasMatrix(true);
      setIsGeneratingMatrix(false);
      
      // 🔄 캐시 무효화 및 즉시 업데이트
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`] });
      queryClient.setQueryData([`/api/group-chats/${groupChatId}/relationship-matrix`], {
        hasMatrix: true,
        matrix: data.matrix,
        matrixGeneratedAt: new Date().toISOString()
      });
      
      // 🎭 성공 시에만 세션 키 설정 (자동 생성 방지)
      const sessionKey = `auto_generated_matrix_${groupChatId}`;
      sessionStorage.setItem(sessionKey, 'true');
      
      // 🎭 생성 후 자동으로 매트릭스 보기 모달 열기
      setShowRelationshipMatrixModal(true);
      
      toast({
        title: t('chat:chatSettings.matrixGenerateSuccess'),
        description: data.message || t('chat:chatSettings.matrixGenerateSuccessDesc'),
      });
    },
    onError: (error: any) => {
      setIsGeneratingMatrix(false);
      
      // 🎭 실패 시 세션 키 제거 (재시도 가능하도록)
      const sessionKey = `auto_generated_matrix_${groupChatId}`;
      sessionStorage.removeItem(sessionKey);
      
      toast({
        title: t('chat:chatSettings.matrixGenerateFailed'),
        description: error.message || t('chat:chatSettings.matrixGenerateFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 🎭 관계 매트릭스 조회 쿼리
  const { data: matrixData } = useQuery({
    queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`],
    enabled: isValidGroupChatId,
  });

  // 매트릭스 데이터 effect로 상태 업데이트
  useEffect(() => {
    if (matrixData) {
      if ((matrixData as any)?.hasMatrix) {
        setRelationshipMatrix((matrixData as any).matrix);
        setHasMatrix(true);
      } else {
        setRelationshipMatrix(null);
        setHasMatrix(false);
      }
    } else {
      setRelationshipMatrix(null);
      setHasMatrix(false);
    }
  }, [matrixData]);

  // 🎭 대화방 입장 시 관계 매트릭스 자동 생성 로직
  useEffect(() => {
    // groupChat과 matrixData가 모두 로딩되었는지 확인
    if (!groupChat || !groupChat.agents || matrixData === undefined) {
      console.log('[🎭 자동 생성] 데이터 로딩 중 - 대기');
      return;
    }

    // 챗봇이 2개 미만인 경우 매트릭스 생성 불필요
    if (groupChat.agents.length < 2) {
      console.log(`[🎭 자동 생성] 챗봇 수 부족 - ${groupChat.agents.length}개 < 2개`);
      return;
    }

    // 이미 매트릭스가 존재하는 경우 생성 불필요 (서버 데이터 기준 - 레이스 없음)
    if ((matrixData as any)?.hasMatrix) {
      console.log('[🎭 자동 생성] 이미 매트릭스 존재 - 스킧');
      return;
    }

    // 현재 생성 중인 경우 중복 방지
    if (isGeneratingMatrix || generateMatrixMutation.isPending) {
      console.log('[🎭 자동 생성] 이미 생성 중 - 스킧');
      return;
    }

    // 세션당 한 번만 자동 생성하도록 제한 (빈번한 자동 생성 방지)
    const sessionKey = `auto_generated_matrix_${groupChatId}`;
    const alreadyGenerated = sessionStorage.getItem(sessionKey);
    if (alreadyGenerated) {
      console.log('[🎭 자동 생성] 이미 세션에서 생성됨 - 스킧');
      return;
    }

    // 자동 생성 시작
    console.log(`[🎭 자동 생성] 관계 매트릭스 자동 생성 시작 - 챗봇 ${groupChat.agents.length}개`);
    generateMatrixMutation.mutate();

  }, [
    groupChatId,
    groupChat?.agents?.length ?? 0,
    (matrixData as any)?.hasMatrix,
    isGeneratingMatrix,
    generateMatrixMutation.isPending
  ]);

  // 🎭 관계 매트릭스 삭제 뮤테이션
  const deleteMatrixMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/group-chats/${groupChatId}/relationship-matrix`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete relationship matrix');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setRelationshipMatrix(null);
      setHasMatrix(false);
      toast({
        title: t('chat:chatSettings.matrixDeleteSuccess'),
        description: data.message || t('chat:chatSettings.matrixDeleteSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`] });
    },
    onError: (error: any) => {
      toast({
        title: t('chat:chatSettings.matrixDeleteFailed'),
        description: error.message || t('chat:chatSettings.matrixDeleteFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 언어 레벨 변경 뮤테이션
  const updateLanguageLevelMutation = useMutation({
    mutationFn: async (newLevel: number | null) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/language-level`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languageLevel: newLevel }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update language level');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // 언어 레벨 업데이트 성공
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      
      const levelNames = {
        1: "초급 (Beginner)",
        2: "기초 (Elementary)", 
        3: "중급 (Intermediate)",
        4: "고급 (Advanced)",
        5: "전문가 (Expert)"
      };
      
      toast({
        title: t('chat:chatSettings.languageLevelChangeSuccess'),
        description: t('chat:chatSettings.languageLevelChangeSuccessDesc'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('chat:chatSettings.languageLevelChangeFailed'),
        description: error.message || t('chat:chatSettings.languageLevelChangeFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // AI 설정 변경 뮤테이션
  const updateAISettingsMutation = useMutation({
    mutationFn: async ({ model, temperature }: { model: string; temperature: number }) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/ai-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature }),
        credentials: 'include',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update AI settings');
      }
      return response.json();
    },
    onSuccess: (data) => {
      // AI 설정 업데이트 성공
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      
      toast({
        title: "AI 설정 변경 완료",
        description: `모델: ${data.model}, Temperature: ${data.temperature}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "AI 설정 변경 실패",
        description: error.message || "AI 설정 변경에 실패했습니다",
        variant: "destructive",
      });
    },
  });

  // 🎯 글로벌 SSE 이벤트 리스너 (중복 SSE 연결 제거)
  useEffect(() => {
    if (!groupChatId) return;

    const handleGroupChatStatus = (event: CustomEvent) => {
      const data = event.detail;
      
      // 현재 그룹 채팅과 관련된 이벤트만 처리
      if (data.groupChatId !== parseInt(groupChatId)) return;
      
      // 🔒 시나리오 실행 중이지만 백그라운드 메시지 완료 시에는 typing_end 허용
      // 백그라운드 완료 후 발송되는 typing_end는 허용해야 함
      if (scenarioInProgressRef.current && data.status === 'typing_end') {
        console.log('[🎯 시나리오 중 typing_end] 백그라운드 완료 후 발송 - 처리 진행');
        // typing_end는 처리하되, 시나리오 완료 확인
        const savedScenario = localStorage.getItem(`scenario_${groupChatId}`);
        if (!savedScenario) {
          console.log('[✅ 시나리오 자동 종료] localStorage에 시나리오 없음');
          scenarioInProgressRef.current = false;
        }
      }
      
      if (data.status === 'typing_start') {
        console.log('🎯 [CUSTOM EVENT] typing_start 이벤트 수신');
        
        // messagesRef로 최신 봇 메시지 개수 저장 (closure 방지)
        const currentBotCount = messagesRef.current.filter(m => m.agentId).length;
        typingStartBotCountRef.current = currentBotCount;
        console.log(`[📊 typing_start] 현재 봇 메시지 ${currentBotCount}개 (ref 사용)`);
        
        flushSync(() => {
          if (data.botInfo) {
            setTypingBotInfo({
              name: data.botInfo.name,
              icon: data.botInfo.icon || '🤖',
              backgroundColor: data.botInfo.backgroundColor || '#6B7280'
            });
            setIsAnyBotTyping(true);
            setIsGroupChatBusy(true);
          }
        });
      } else if (data.status === 'typing_end') {
        console.log('🎯 [CUSTOM EVENT] typing_end 이벤트 수신 - 플래그 설정');
        
        // 플래그만 설정, useEffect에서 최신 state로 처리
        setShouldEndTyping(true);
        
        // 🔒 시나리오 시스템 처리 (typing indicator 끄기와는 독립적)
        const savedScenario = localStorage.getItem(`scenario_${groupChatId}`);
        
        // ⚠️ 시나리오 진행 중이 아닌 경우에만 시나리오 로직 실행
        if (!scenarioInProgressRef.current) {
          const scenarioData = JSON.parse(savedScenario || 'null');
          if (scenarioData?.turns && scenarioData.turns.length > 1) {
            startScenario(scenarioData);
            queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
            return;
          }

          // 🚨 순차 연출 중이면 메시지 업데이트 차단
          const currentScenario = JSON.parse(localStorage.getItem(`scenario_${groupChatId}`) || 'null');
          if (queueState.revealInProgress || queueManager.isCurrentlyProcessing() || (currentScenario?.turns && currentScenario.turns.length > 1)) {
            console.log('🎭 순차 연출 중 - 메시지 fetch 차단됨');
            return;
          }
          
          console.log('🔄 챗봇 응답 완료 - 글로벌 SSE에서 실시간 처리됨');
        } else {
          console.log('[⚠️ 시나리오 진행 중] 시나리오 로직 스킵 (typing_end는 처리됨)');
        }
        // ✅ 글로벌 SSE에서 즉시 캐시 업데이트하므로 중복 invalidation 제거
      }
    };

    const handleGroupChatDeleted = (event: CustomEvent) => {
      const data = event.detail;
      
      if (data.groupChatId === parseInt(groupChatId)) {
        console.log('현재 그룹 채팅이 삭제되었습니다. 홈으로 이동합니다.');
        queryClient.setQueryData(["/api/group-chats"], (oldData: any) => {
          if (!oldData) return [];
          return oldData.filter((chat: any) => chat.id !== data.groupChatId);
        });
        toast({
          title: "채팅방이 삭제되었습니다",
          description: "방장에 의해 이 채팅방이 삭제되었습니다.",
          variant: "destructive",
        });
        setLocation('/');
      }
    };

    // 커스텀 이벤트 리스너 등록
    window.addEventListener('groupChatStatus', handleGroupChatStatus as EventListener);
    window.addEventListener('groupChatDeleted', handleGroupChatDeleted as EventListener);

    return () => {
      window.removeEventListener('groupChatStatus', handleGroupChatStatus as EventListener);
      window.removeEventListener('groupChatDeleted', handleGroupChatDeleted as EventListener);
    };
  }, [groupChatId, setLocation, toast, queryClient]);

  // 초기 스크롤: 컨테이너가 마운트되자마자 동기적으로 맨 아래로 스크롤  
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    messagesContainerRef.current = node;
    
    if (node && !hasInitialScroll.current && groupChat && messages.length > 0) {
      // 동기적으로 즉시 맨 아래로 스크롤 (페인트 전)
      node.scrollTop = node.scrollHeight;
      hasInitialScroll.current = true;
    }
  }, [groupChat, messages.length]);

  // 그룹 채팅이 변경될 때 초기 스크롤 플래그 리셋
  useEffect(() => {
    hasInitialScroll.current = false;
  }, [groupChatId]);

  // @ 멘션 처리 (최적화: useMemo로 계산 후 상태 업데이트만)
  const mentionState = useMemo(() => {
    const lastAtIndex = message.lastIndexOf('@');
    if (lastAtIndex === -1) {
      return { show: false, query: '', index: 0 };
    }
    
    if (lastAtIndex === message.length - 1) {
      return { show: true, query: '', index: 0 };
    }
    
    const query = message.slice(lastAtIndex + 1);
    if (!query.includes(' ')) {
      return { show: true, query, index: 0 };
    }
    
    return { show: false, query: '', index: 0 };
  }, [message]);

  // 상태 업데이트만 useEffect에서 처리
  useEffect(() => {
    setShowMentionList(mentionState.show);
    setMentionQuery(mentionState.query);
    setMentionSelectedIndex(mentionState.index);
  }, [mentionState]);

  // 🎯 통합 스크롤 로직 - displayedIds 변경 시에만 스크롤
  const prevDisplayedSizeRef = useRef(0);
  const prevTypingStateRef = useRef(false);
  
  const scrollToBottom = useCallback(() => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      // 부드럽지 않게 즉시 스크롤 (지터 방지)
      container.scrollTop = container.scrollHeight;
    }
  }, []);
  
  // displayedIds가 증가할 때만 스크롤 (실제로 메시지가 화면에 표시될 때)
  useEffect(() => {
    if (!hasInitialScroll.current) return;
    
    if (displayedIds.size > prevDisplayedSizeRef.current) {
      // requestAnimationFrame으로 렌더링 후 스크롤
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    
    prevDisplayedSizeRef.current = displayedIds.size;
  }, [displayedIds.size, scrollToBottom]);
  
  // 타이핑 인디케이터 표시 시에만 스크롤 (사라질 때는 스크롤 안함)
  useEffect(() => {
    if (!hasInitialScroll.current) return;
    
    // 타이핑이 시작될 때만 스크롤 (false → true)
    if (isAnyBotTyping && !prevTypingStateRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    
    // 현재 타이핑 상태 저장
    prevTypingStateRef.current = isAnyBotTyping;
  }, [isAnyBotTyping, scrollToBottom]);

  // 입력창에서 @멘션을 볼드체로 표시하는 함수
  const formatInputContent = (content: string) => {
    if (!content) return '';
    
    // 실제 에이전트 이름들 가져오기
    const agentNames = groupChat?.agents.map(a => a.agent?.name).filter(Boolean) || [];
    
    // @멘션 찾아서 볼드체로 변환
    let formattedContent = content;
    
    // @모두 처리
    const allMentionRegex = new RegExp(`(@모두)`, 'g');
    formattedContent = formattedContent.replace(allMentionRegex, `<strong>$1</strong>`);
    
    // 개별 에이전트 @멘션 처리
    agentNames.forEach(agentName => {
      const mentionText = `@${agentName}`;
      const mentionRegex = new RegExp(`(${mentionText})`, 'g');
      formattedContent = formattedContent.replace(mentionRegex, `<strong>$1</strong>`);
    });
    
    return formattedContent;
  };

  // 파일 선택 및 업로드 처리
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('documentType', '기타');
        formData.append('description', '');

        const response = await fetch(`/api/group-chats/${groupChatId}/documents`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || '업로드 실패');
        }

        const result = await response.json();
        
        // 그룹 채팅 메시지 목록 강제 새로고침하여 시스템 메시지 표시
        await queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });
        await queryClient.refetchQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });
        queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/documents`] });
        queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
        
      } catch (error) {
        console.error('업로드 오류:', error);
        toast({
          title: "오류",
          description: `${file.name} 파일 업로드에 실패했습니다.`,
          variant: "destructive",
        });
      }
    }

    // 파일 입력 필드 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // IME composition 핸들러들
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  // 키보드 내비게이션 핸들러 
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionList) {
      const availableOptions = filteredMentionOptions;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setMentionSelectedIndex(prev => 
            prev < availableOptions.length - 1 ? prev + 1 : 0
          );
          break;
        
        case 'ArrowUp':
          e.preventDefault();
          setMentionSelectedIndex(prev => 
            prev > 0 ? prev - 1 : availableOptions.length - 1
          );
          break;
        
        case 'Enter':
          e.preventDefault();
          const selectedOption = availableOptions[mentionSelectedIndex];
          if (selectedOption) {
            handleMentionSelect(selectedOption);
            // 선택 후 입력창으로 포커스 복귀
            setTimeout(() => {
              inputRef.current?.focus();
            }, 0);
          }
          break;
        
        case 'Escape':
          e.preventDefault();
          setShowMentionList(false);
          break;
      }
      return;
    }

    // @ 멘션이 아닐 때는 기존 Enter 처리
    if (e.key === 'Enter' && !e.shiftKey) {
      // IME 조합 중이면 전송하지 않음
      if (isComposing || e.nativeEvent.isComposing) {
        return;
      }
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ⚡ 필터링된 멘션 옵션 메모이제이션 (530개 agents 필터링 최적화)
  const filteredMentionOptions = useMemo((): (GroupChatAgent | 'all')[] => {
    const options: (GroupChatAgent | 'all')[] = ['all']; // '모두'를 맨 처음에
    
    if (groupChat?.agents) {
      const filteredAgents = groupChat.agents.filter(a => 
        a.agent?.name && 
        a.agent.name.toLowerCase().includes(mentionQuery.toLowerCase())
      );
      options.push(...filteredAgents);
    }
    
    return options;
  }, [groupChat?.agents, mentionQuery]);

  const handleMentionSelect = (agent: GroupChatAgent | 'all') => {
    if (agent === 'all') {
      // '@모두' 선택 시 기존 선택 모두 제거하고 @모두만 설정
      const allSuggestion: MentionSuggestion = {
        id: -1,  // 특별한 ID로 -1 사용
        name: '모두',
        icon: '👥',
        backgroundColor: '#6366f1',
      };
      
      console.log('[클라이언트] @모두 선택 - 기존 선택 초기화');
      
      const newMessage = message.replace(/@[^@\s]*$/, '');
      setMessage(newMessage);
      setSelectedAgents([allSuggestion]); // @모두는 단독 사용
      setShowMentionList(false);
      return;
    }
    
    const suggestion: MentionSuggestion = {
      id: agent.agentId,  // GroupChatAgent의 agentId 사용
      name: agent.agent?.name || '',
      icon: agent.agent?.icon || '',
      backgroundColor: agent.agent?.backgroundColor || '#666',
    };
    
    console.log('[클라이언트] 에이전트 선택:', { agentId: agent.agentId, name: agent.agent?.name });

    // ✅ 복수 선택: 기존 배열에 추가
    setSelectedAgents(prev => {
      // @모두가 이미 선택되어 있으면 제거하고 개별 에이전트만 추가
      const withoutAll = prev.filter(a => a.id !== -1);
      
      // 중복 선택 방지
      if (withoutAll.some(a => a.id === suggestion.id)) {
        console.log('[클라이언트] 이미 선택된 에이전트 - 무시');
        return prev;
      }
      
      console.log('[클라이언트] 에이전트 추가:', suggestion.name);
      return [...withoutAll, suggestion];
    });
    
    // 에이전트 선택 후 입력창에서는 @멘션 제거
    const newMessage = message.replace(/@[^@\s]*$/, '');
    setMessage(newMessage);
    setShowMentionList(false);
  };

  // V 버튼: 같은 카테고리에서 6명 추천 (중복 제외)
  const handleCreateVariation = async (baseCharacter: CharacterSuggestion) => {
    try {
      console.log('[V 버튼 - 같은 카테고리] 기본 캐릭터:', baseCharacter);
      
      setIsLoadingVariations(true);
      
      // 추천 이력: 이미 추천된 캐릭터 이름들 수집
      const recommendedNames = suggestedCharacters.map(c => c.name);
      
      // 채팅방 참여자: 현재 대화에 참여 중인 에이전트 이름들 수집
      const participantNames = groupChat?.agents?.map((gca: any) => gca.agent?.name || '').filter((n: string) => n) || [];
      
      // 모든 제외 대상 통합
      const excludeNames = Array.from(new Set([...recommendedNames, ...participantNames]));
      
      console.log(`[V 버튼] 제외 대상: ${excludeNames.length}명 (추천: ${recommendedNames.length}, 참여자: ${participantNames.length})`);
      
      const response = await fetch('/api/suggest-character-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          baseCharacter,
          excludeNames // 제외할 캐릭터 이름 목록 추가
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to generate character variations');
      }

      const result = await response.json();
      console.log('[V 버튼] 성공:', result.variations.length, '개 캐릭터');
      
      const currentTime = Date.now();
      const variationsWithTimestamp = result.variations.map((char: CharacterSuggestion) => ({
        ...char,
        recommendedAt: currentTime
      }));
      
      const newCharactersCount = variationsWithTimestamp.length;

      // 새 캐릭터들을 기존 목록 위에 추가
      setSuggestedCharacters(prev => [...variationsWithTimestamp, ...prev]);
      setLastRecommendationTime(currentTime);
      
      // 기존 선택/확장 상태의 인덱스를 조정 (새 캐릭터 개수만큼 증가)
      setExpandedCharacterIndices(prev => {
        const newSet = new Set<number>();
        prev.forEach(index => newSet.add(index + newCharactersCount));
        return newSet;
      });
      
      setSelectedCharacters(prev => 
        prev.map(item => ({
          ...item,
          index: item.index + newCharactersCount
        }))
      );
      
      setIsLoadingVariations(false);
      
      toast({
        title: "같은 카테고리 추천 완료",
        description: `${baseCharacter.name}와 같은 카테고리에서 ${result.variations.length}명을 추천했습니다.`,
      });

    } catch (error) {
      setIsLoadingVariations(false);
      console.error('[V 버튼] 오류:', error);
      toast({
        title: "캐릭터 추천 실패",
        description: "같은 카테고리 캐릭터 추천 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  // 캐릭터 복수 선택 토글 핸들러
  const handleToggleCharacterSelection = (character: any, index: number) => {
    setSelectedCharacters(prev => {
      const isAlreadySelected = prev.some(item => item.index === index);
      
      if (isAlreadySelected) {
        // 이미 선택된 캐릭터면 제거
        return prev.filter(item => item.index !== index);
      } else {
        // 새로 선택하면 추가
        return [...prev, { character, index }];
      }
    });
  };

  // 전체 캐릭터 선택/해제 핸들러
  const handleToggleAllCharacters = () => {
    if (selectedCharacters.length === suggestedCharacters.length) {
      // 모두 선택된 상태면 전체 해제
      setSelectedCharacters([]);
    } else {
      // 일부만 선택되었거나 아무것도 선택되지 않았으면 전체 선택
      const allCharacters = suggestedCharacters.map((character, index) => ({ character, index }));
      setSelectedCharacters(allCharacters);
    }
  };

  // 복수 캐릭터 일괄 추가 핸들러
  const handleBulkAddCharacters = async () => {
    if (selectedCharacters.length === 0) return;

    setIsAddingMultipleCharacters(true);
    const successfullyAdded: string[] = [];
    const failedToAdd: string[] = [];

    try {
      // 각 선택된 캐릭터를 순차적으로 추가
      for (const { character, index } of selectedCharacters) {
        try {
          const relationship = characterRelationships[index] || "companion";
          const languagePreference = characterLanguages[index] || "question_language";
          const debateIntensity = characterDebateIntensities[index] ?? 0.5;
          const response = await fetch(`/api/group-chats/${groupChatId}/character-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character, characterId: character.id, relationship, languagePreference, debateIntensity }),
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error('Failed to add character agent');
          }

          successfullyAdded.push(character.name);
        } catch (error) {
          console.error(`[일괄 추가] ${character.name} 추가 실패:`, error);
          failedToAdd.push(character.name);
        }
      }

      // 결과에 따른 토스트 메시지 표시
      if (successfullyAdded.length > 0) {
        toast({
          title: "캐릭터 추가 완료",
          description: `${successfullyAdded.length}명의 캐릭터가 채팅방에 추가되었습니다: ${successfullyAdded.join(', ')}`,
        });
      }

      if (failedToAdd.length > 0) {
        toast({
          title: "일부 캐릭터 추가 실패",
          description: `${failedToAdd.length}명의 캐릭터 추가에 실패했습니다: ${failedToAdd.join(', ')}`,
          variant: "destructive",
        });
      }

      // 성공적으로 추가된 캐릭터가 있으면 모달 닫기 및 데이터 새로고침
      if (successfullyAdded.length > 0) {
        setShowCharacterModal(false);
        setSuggestedCharacters([]);
        setCharacterTopic('');
        setCharacterRelationships({});
        setCharacterLanguages({});
        setCharacterDebateIntensities({});
        setSelectedCharacters([]);
        
        // 그룹 채팅 정보를 강제로 새로 가져오기
        await queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
        await queryClient.refetchQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      }

    } catch (error) {
      console.error('[일괄 추가] 전체 오류:', error);
      toast({
        title: "캐릭터 추가 실패",
        description: "캐릭터를 채팅방에 추가하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsAddingMultipleCharacters(false);
    }
  };

  // 캐릭터 선택 핸들러 (기존 개별 추가용 - 호환성 유지)
  const handleSelectCharacter = async (character: any, relationship: RelationshipType = "companion") => {
    try {
      console.log('[캐릭터 선택] 선택된 캐릭터:', character, '관계:', relationship);
      
      // 캐릭터를 에이전트로 변환하여 그룹 채팅에 추가
      const response = await fetch(`/api/group-chats/${groupChatId}/character-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character, characterId: character.id, relationship }),
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to add character agent');
      }

      const result = await response.json();
      console.log('[캐릭터 선택] 에이전트 추가 성공:', result);

      // 성공 토스트 표시
      toast({
        title: "캐릭터 추가 완료",
        description: `${character.name}이(가) 채팅방에 추가되었습니다.`,
      });

      // 성공 시 모달 닫기
      setShowCharacterModal(false);
      setSuggestedCharacters([]);
      setCharacterTopic('');
      setCharacterRelationships({});
      
      console.log('[캐릭터 선택] 데이터 강제 리프레시 시작');
      
      // 그룹 채팅 정보를 강제로 새로 가져오기
      await queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      await queryClient.refetchQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      
      console.log('[캐릭터 선택] 데이터 리프레시 완료');
      
    } catch (error) {
      console.error('[캐릭터 선택] 오류:', error);
      toast({
        title: "캐릭터 추가 실패",
        description: "캐릭터를 채팅방에 추가하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  // 📰 Sources Dialog Handler
  const handleSourceClick = useCallback(async (message: GroupChatMessage, sourceIndices: number[] | null = null) => {
    if (!message.id) return;
    
    // 기존 출처가 있는 경우
    if (message.sources && message.sources.chunks && message.sources.chunks.length > 0) {
      console.log('[✅ 기존 출처 팝업 열기]', message.sources.chunks.length, '개 출처');
      setSourcesDialogState({
        isOpen: true,
        messageId: message.id,
        messageContent: null,
        isSearching: false,
        fetchedSources: null,
        selectedSourceIndices: sourceIndices,
        precomputedSources: message.sources,
      });
      return;
    }
    
    // 원본 질문 찾기 (현재 메시지 이전의 사용자 메시지)
    const messageIndex = messages.findIndex(m => m.id === message.id);
    let userMessage = '';
    if (messageIndex > 0) {
      // 역순으로 탐색해서 첫 번째 사용자 메시지 찾기
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].senderId) {
          userMessage = messages[i].content;
          break;
        }
      }
    }
    
    // 실시간 검색 시작
    console.log('[🔍 실시간 출처 검색 시작]', {
      agentName: message.agent?.name,
      userMessage: userMessage.slice(0, 50),
      answerContent: message.content.slice(0, 50)
    });
    setSourcesDialogState({
      isOpen: true,
      messageId: message.id,
      messageContent: message.content.slice(0, 100),
      isSearching: true,
      fetchedSources: null,
      selectedSourceIndices: null,
      precomputedSources: null,
    });
    
    try {
      const response = await fetch(`/api/messages/${message.id}/search-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupChatId,
          agentName: message.agent?.name || '',
          userMessage,
          answerContent: message.content
        })
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to search sources');
      }
      
      if (data.success) {
        console.log('[✅ 검색 완료]', data.sources?.length || 0, '개 출처 발견');
        setSourcesDialogState(prev => ({
          ...prev,
          isSearching: false,
          fetchedSources: data.sources || [],
          messageContent: data.messageContent || prev.messageContent,
        }));
        
        if (!data.sources || data.sources.length === 0) {
          toast({
            title: "검색 결과 없음",
            description: "관련 출처를 찾지 못했습니다.",
            variant: "default"
          });
        }
      } else {
        throw new Error(data.message || 'Search failed');
      }
    } catch (error: any) {
      console.error('[❌ 검색 실패]', error);
      setSourcesDialogState(prev => ({
        ...prev,
        isSearching: false,
        fetchedSources: [],
      }));
      toast({
        title: "검색 실패",
        description: error.message || "출처 검색 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  }, [groupChatId, toast]);

  // 📰 Dialog Close Handler
  const handleDialogClose = useCallback(() => {
    setSourcesDialogState({
      isOpen: false,
      messageId: null,
      messageContent: null,
      isSearching: false,
      fetchedSources: null,
      selectedSourceIndices: null,
      precomputedSources: null,
    });
  }, []);

  const handleSendMessage = () => {
    if ((!messageRef.current.trim() && selectedAgents.length === 0) || isSendingDisabled) return;

    const messageContent = messageRef.current.trim();
    
    // 🚫 클라이언트 사이드 중복 메시지 방지
    if (lastSentMessage && 
        lastSentMessage.content === messageContent && 
        Date.now() - lastSentMessage.timestamp < CLIENT_DUPLICATE_WINDOW_MS) {
      console.log('[🚫 CLIENT BLOCKED] 중복 메시지 차단:', messageContent.slice(0, 30));
      toast({
        title: "대기 중인 메시지입니다",
        description: "잔시만 기다리신 후 다시 시도해 주세요.",
        variant: "destructive"
      });
      return;
    }

    // # 접두사 감지 - 캐릭터 추천 시스템 (권한 있는 사용자만)
    // 일반 사용자는 "#주제" 형태로 일반 메시지로 전송됨
    const canUseCharacterRecommendation = user && (user.role === 'master_admin' || user.role === 'agent_admin');
    if (messageContent.startsWith('#') && canUseCharacterRecommendation) {
      const topic = messageContent.substring(1).trim();
      if (topic.length === 0) {
        toast({
          title: "주제를 입력해주세요",
          description: "# 뒤에 대화하고 싶은 주제를 입력해주세요.",
          variant: "destructive",
        });
        return;
      }

      console.log('[캐릭터 추천] 주제:', topic);
      
      // 모달을 먼저 열고 상태를 설정
      setShowCharacterModal(true);
      setCharacterTopic(topic);
      setSuggestedCharacters([]);
      setSelectedCharacters([]);
      setExpandedCharacterIndices(new Set());
      setMessage("");  // 입력창 클리어
      
      // ✅ textarea height도 리셋
      if (inputRef.current) {
        inputRef.current.style.height = '20px';
      }
      
      // 캐릭터 추천 API 호출
      suggestCharactersMutation.mutate(topic);
      return;
    }

    let targetAgentIds: number[] = [];
    let replyOrder: number | undefined;
    let messageToSend = messageRef.current;

    // @ 멘션 처리
    if (selectedAgents.length > 0) {
      // @모두 선택 확인
      if (selectedAgents.some(agent => agent.id === -1)) {
        targetAgentIds = [-1];  // 특별한 -1 값으로 모든 에이전트 응답 표시
        console.log('[클라이언트] @모두 선택 - 모든 에이전트 응답');
      } else {
        targetAgentIds = selectedAgents.map(agent => agent.id).filter(id => id !== -1);
        console.log('[클라이언트] 선택된 에이전트 ID들:', targetAgentIds);
      }
      
      // 메시지 앞에 @멘션 추가
      const mentionPrefix = selectedAgents.map(agent => `@${agent.name}`).join(' ');
      messageToSend = mentionPrefix + (messageRef.current.trim() ? ` ${messageRef.current}` : '');
      
      if (selectedAgents.some(agent => agent.order)) {
        replyOrder = Math.min(...selectedAgents.map(agent => agent.order || 999));
      }
    } else if (messageRef.current.trim().startsWith('@')) {
      // @로 시작하지만 selectedAgents가 없는 경우 - 직접 입력된 @멘션 파싱
      console.log('[클라이언트] @멘션 직접 입력 파싱 시도:', messageRef.current);
      
      // "@모두" 체크
      if (messageRef.current.includes('@모두')) {
        targetAgentIds = [-1];
        console.log('[클라이언트] @모두 직접 입력 감지 - 모든 에이전트 응답');
      } else {
        // 특정 에이전트 이름 파싱
        const mentionedAgentIds: number[] = [];
        
        // groupChat.agents가 없으면 빈 배열로 폴백 (서버에서 AI 자동 선택)
        if (!groupChat?.agents || groupChat.agents.length === 0) {
          targetAgentIds = [];
          console.log('[클라이언트] @멘션 파싱 실패 - groupChat.agents 없음, 서버 AI 자동 선택 모드');
        } else {
          // 모든 가능한 에이전트 이름으로 매칭 시도
          groupChat.agents.forEach(groupAgent => {
            const agent = groupAgent.agent;
            if (agent && agent.name && messageRef.current.includes(`@${agent.name}`)) {
              mentionedAgentIds.push(agent.id);
              console.log('[클라이언트] 특정 에이전트 파싱 성공:', agent.name, agent.id);
            }
          });
          
          if (mentionedAgentIds.length > 0) {
            targetAgentIds = mentionedAgentIds;
            console.log('[클라이언트] 직접 입력으로 파싱된 에이전트 ID들:', targetAgentIds);
          } else {
            // 특정 에이전트를 찾지 못한 경우, 질문과 관련된 에이전트들이 응답하도록 함
            targetAgentIds = [];
            console.log('[클라이언트] @멘션이지만 특정 에이전트 미발견 - 관련 에이전트들이 응답');
          }
        }
      }
    }

    // 메시지 전송 전에 즉시 입력창 클리어
    setMessage("");
    setSelectedAgents([]);
    setShowMentionList(false);
    
    // ✅ textarea height 즉시 리셋 (중요!)
    if (inputRef.current) {
      inputRef.current.value = ''; // DOM 값도 직접 클리어
      inputRef.current.style.height = '20px'; // minHeight로 리셋
    }

    // 🎯 중복 방지를 위한 마지막 전송 메시지 기록
    setLastSentMessage({ content: messageToSend, timestamp: Date.now() });

    sendMessageMutation.mutate({
      content: messageToSend,
      targetAgentIds: targetAgentIds.length > 0 ? targetAgentIds : undefined,
      replyOrder,
    });
  };

  // ⚡ 필터링된 agents 메모이제이션 (530개 필터링 최적화)
  const filteredAgents = useMemo(() => {
    if (!groupChat?.agents) return [];
    return groupChat.agents.filter(agent => 
      agent.agent?.name.toLowerCase().includes(mentionQuery.toLowerCase())
    );
  }, [groupChat?.agents, mentionQuery]);


  // 메시지 내용 포맷팅 (@ 멘션과 **볼드** 처리)
  const formatMessageContent = (content: string) => {
    // 실제 에이전트 이름들 가져오기
    const agentNames = groupChat?.agents?.map(a => a.agent?.name).filter(Boolean) || [];
    
    // **볼드** 패턴과 @멘션을 모두 찾아서 교체
    const replacements: Array<{ 
      start: number; 
      end: number; 
      type: 'mention' | 'bold'; 
      agentName?: string;
      text?: string;
    }> = [];
    
    // @모두 멘션 찾기
    const allMentionText = '@모두';
    let index = 0;
    while (true) {
      const foundIndex = content.indexOf(allMentionText, index);
      if (foundIndex === -1) break;
      
      replacements.push({
        start: foundIndex,
        end: foundIndex + allMentionText.length,
        type: 'mention',
        text: '@모두'
      });
      
      index = foundIndex + allMentionText.length;
    }
    
    // @멘션 찾기
    agentNames.forEach(agentName => {
      const mentionText = `@${agentName}`;
      let index = 0;
      
      while (true) {
        const foundIndex = content.indexOf(mentionText, index);
        if (foundIndex === -1) break;
        
        replacements.push({
          start: foundIndex,
          end: foundIndex + mentionText.length,
          type: 'mention',
          agentName
        });
        
        index = foundIndex + mentionText.length;
      }
    });
    
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
    
    // 중복 제거 및 정렬 (겹치는 항목 제거)
    const uniqueReplacements = replacements
      .sort((a, b) => a.start - b.start)
      .filter((item, index, arr) => 
        index === 0 || item.start >= arr[index - 1].end
      );
    
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
        // @에이전트이름 또는 @모두 추가 (Regular 굵기, 75% 불투명도)
        parts.push(
          <span key={`mention-${index}`} style={{ fontWeight: 'normal', opacity: 0.75 }}>
            {replacement.text || `@${replacement.agentName}`}
          </span>
        );
      } else if (replacement.type === 'bold') {
        // 볼드 텍스트 추가
        parts.push(
          <strong key={`bold-${index}`}>
            {replacement.text}
          </strong>
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

  // ⚡ useCallback: isMyMessage (user 의존)
  const isMyMessage = useCallback((msg: GroupChatMessage) => {
    // 타입 불일치 방지를 위해 문자열로 변환하여 비교
    const result = String(msg.senderId) === String(user?.id);
    return result;
  }, [user?.id]);

  // ⚡ useCallback: isAgentMessage (의존성 없음)
  const isAgentMessage = useCallback((msg: GroupChatMessage): boolean => {
    const hasAgentId = msg.agentId != null && msg.agentId !== undefined;
    const hasAgent = msg.agent != null && msg.agent !== undefined;
    const hasAgentName = (msg as any).agentName != null && (msg as any).agentName !== undefined;
    
    return hasAgentId || hasAgent || hasAgentName;
  }, []);

  // ⚡ useCallback: findAgentNameById (groupChat.agents 의존)
  const findAgentNameById = useCallback((agentId: number): string => {
    const agent = groupChat?.agents.find(a => a.agent?.id === agentId || (a as any).agentId === agentId);
    return agent?.agent?.name || `에이전트 ${agentId}`;
  }, [groupChat?.agents]);

  // 캐릭터 추천 페이지 표시
  if (showCharacterModal) {
    return (
      <div className="h-screen bg-white flex flex-col">
        {/* 헤더 */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setShowCharacterModal(false)}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold">캐릭터 추천 - "{characterTopic}"</h1>
              <p className="text-sm text-gray-500">
                주제와 관련된 다양한 캐릭터들과 대화해보세요
              </p>
            </div>
          </div>
        </div>

        {/* 콘텐츠 영역 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* More Characters 버튼 */}
          {!isLoadingCharacters && suggestedCharacters.length > 0 && (
            <div className="flex justify-center mb-6">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => suggestMoreCharactersMutation.mutate(characterTopic)}
                disabled={isLoadingMoreCharacters || isLoadingVariations}
                className="px-6 py-2 border-dashed border-gray-300 hover:border-primary hover:bg-primary/5 transition-all"
              >
                {isLoadingMoreCharacters ? (
                  <>
                    <div className="w-4 h-4 border border-primary border-t-transparent rounded-full animate-spin mr-2" />
                    추가 캐릭터 생성 중...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="font-medium">More Characters</span>
                  </>
                )}
              </Button>
            </div>
          )}
          
          {/* 선택된 캐릭터들 표시 */}
          {selectedCharacters.length > 0 && (
            <div className="mb-6 space-y-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-3">
                  선택된 캐릭터 ({selectedCharacters.length}명)
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedCharacters.map(({ character, index }) => (
                    <div 
                      key={index}
                      className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full text-xs flex items-center gap-2 shadow-sm"
                    >
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: character.color }}
                      />
                      <span className="text-gray-700 dark:text-gray-300">{character.name}</span>
                      <button
                        onClick={() => handleToggleCharacterSelection(character, index)}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-1"
                        data-testid={`button-remove-${index}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* 일괄 추가 버튼 */}
              <Button
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 border-0"
                size="lg"
                onClick={handleBulkAddCharacters}
                disabled={isAddingMultipleCharacters}
                data-testid="button-add-selected-characters"
              >
                {isAddingMultipleCharacters ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-3" />
                    <span className="text-base">{t('chat:character.addingSelected')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5 mr-3" />
                    <span className="text-base font-bold">{t('chat:character.addSelected', { count: selectedCharacters.length })}</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {/* 캐릭터 목록 */}
          {isLoadingCharacters ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center max-w-md">
                <div className="relative mb-8">
                  <div className="w-16 h-16 border-4 border-blue-100 rounded-full mx-auto"></div>
                  <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin absolute top-0 left-1/2 transform -translate-x-1/2"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl">🎭</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-gray-800">{t('chat:character.generating')}</h3>
                  <p className="text-sm text-gray-600 animate-pulse">
                    {t('chat:character.generatingMessage')}
                  </p>
                </div>
                <div className="mt-6 flex justify-center space-x-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
                <p className="text-xs text-gray-500 mt-4">{t('chat:character.estimatedTime')}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 relative">
              {isLoadingVariations && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 rounded-lg flex items-center justify-center">
                  <div className="text-center max-w-md">
                    <div className="relative mb-8">
                      <div className="w-16 h-16 border-4 border-purple-100 rounded-full mx-auto"></div>
                      <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin absolute top-0 left-1/2 transform -translate-x-1/2"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl">✨</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold text-gray-800">{t('chat:character.variationGenerating')}</h3>
                      <p className="text-sm text-gray-600 animate-pulse">
                        {t('chat:character.variationDescription')}
                      </p>
                    </div>
                    <div className="mt-6 flex justify-center space-x-2">
                      <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-4">{t('chat:character.estimatedTime')}</p>
                  </div>
                </div>
              )}
              
              {suggestedCharacters.map((character, index) => {
                const isSelected = selectedCharacters.some(item => item.index === index);
                const isExpanded = expandedCharacterIndices.has(index);
                return (
                  <Card 
                    key={index} 
                    className={`hover:shadow-md transition-all group relative cursor-pointer ${
                      isExpanded 
                        ? 'bg-orange-50 dark:bg-orange-900/20' 
                        : 'bg-gray-50 dark:bg-gray-800'
                    }`}
                    onClick={() => {
                      if (isExpanded) {
                        // 확장된 캐릭터 클릭 -> 축소 + 선택 해제
                        setExpandedCharacterIndices(prev => {
                          const newSet = new Set(prev);
                          newSet.delete(index);
                          return newSet;
                        });
                        if (isSelected) {
                          handleToggleCharacterSelection(character, index);
                        }
                      } else {
                        // 확장되지 않은 캐릭터 클릭 -> 확장 + 선택
                        setExpandedCharacterIndices(prev => new Set(prev).add(index));
                        if (!isSelected) {
                          handleToggleCharacterSelection(character, index);
                        }
                      }
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="relative">
                          <div 
                            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                            style={{ backgroundColor: character.color }}
                          >
                            {character.icon}
                          </div>
                          {character.isVariation && (
                            <div className="absolute -bottom-1 -right-1 bg-purple-100 text-purple-700 text-xs px-1.5 py-0.5 rounded-full border border-purple-200 z-20 shadow-sm">
                              <span className="text-xs font-semibold">V</span>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                                {character.name}
                              </h3>
                              {character.recommendedAt === lastRecommendationTime && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                                  NEW
                                </span>
                              )}
                            </div>
                            <div className="relative z-30">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!isLoadingVariations) {
                                    console.log('[V 버튼] 바리에이션 생성 시작:', character.name);
                                    handleCreateVariation(character);
                                  }
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                disabled={isLoadingVariations}
                                className="w-8 h-8 bg-gray-400 hover:bg-gray-500 text-white rounded-md flex items-center justify-center transition-all shadow-sm flex-shrink-0 relative z-30"
                                title={t('chat:character.createVariation')}
                                aria-label={t('chat:character.createVariationAria', { name: character.name })}
                                data-testid={`button-variation-${index}`}
                              >
                              {isLoadingVariations ? (
                                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <span className="text-sm font-bold">V</span>
                              )}
                              </button>
                            </div>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {character.description}
                          </p>
                        </div>
                      </div>
                    
                      {isExpanded && (
                        <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                          {(character.expertise || character.personality || character.speechStyle) && (
                            <div className="space-y-2 text-xs">
                              {character.expertise && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('chat:character.expertise')}:</span>
                                  <span className="text-gray-600 dark:text-gray-400 ml-1">{character.expertise}</span>
                                </div>
                              )}
                              {character.personality && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('chat:character.personality')}:</span>
                                  <span className="text-gray-600 dark:text-gray-400 ml-1">{character.personality}</span>
                                </div>
                              )}
                              {character.speechStyle && (
                                <div>
                                  <span className="font-medium text-gray-700 dark:text-gray-300">{t('chat:chatSettings.tone')}:</span>
                                  <span className="text-gray-600 dark:text-gray-400 ml-1">{character.speechStyle}</span>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {character.background && (
                            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {character.background}
                              </p>
                            </div>
                          )}
                          
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <div>
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                                나와의 관계 설정
                              </label>
                              <Select 
                                value={characterRelationships[index] || "assistant"} 
                                onValueChange={(value: RelationshipType) => {
                                  setCharacterRelationships(prev => ({
                                    ...prev,
                                    [index]: value
                                  }));
                                }}
                              >
                                <SelectTrigger className="w-full bg-white dark:bg-gray-800">
                                  <SelectValue placeholder={t('chat:character.relationshipPlaceholder')}>
                                    {t(`chat:relationshipTypes.${characterRelationships[index] || "assistant"}`)}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {RELATIONSHIP_TYPES.map((relationship) => (
                                    <SelectItem key={relationship} value={relationship}>
                                      {t(`chat:relationshipTypes.${relationship}`)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                                사용 언어 설정
                              </label>
                              <Select 
                                value={characterLanguages[index] || "question_language"} 
                                onValueChange={(value: LanguageOption) => {
                                  setCharacterLanguages(prev => ({
                                    ...prev,
                                    [index]: value
                                  }));
                                }}
                              >
                                <SelectTrigger className="w-full bg-white dark:bg-gray-800">
                                  <SelectValue placeholder={t('chat:character.languagePlaceholder')} />
                                </SelectTrigger>
                                <SelectContent>
                                  {LANGUAGE_OPTIONS.map((option) => (
                                    <SelectItem key={option} value={option}>
                                      {LANGUAGE_LABELS[option]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {/* 🎯 토론 강도 슬라이더 */}
                          <div className="pt-3">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                토론 강도
                              </label>
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {((characterDebateIntensities[index] ?? 0.5) * 100).toFixed(0)}%
                              </span>
                            </div>
                            <Slider
                              value={[(characterDebateIntensities[index] ?? 0.5) * 100]}
                              onValueChange={(values) => {
                                setCharacterDebateIntensities(prev => ({
                                  ...prev,
                                  [index]: values[0] / 100
                                }));
                              }}
                              min={0}
                              max={100}
                              step={10}
                              className="w-full"
                            />
                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                              <span>부드러움</span>
                              <span>강함</span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              {(characterDebateIntensities[index] ?? 0.5) <= 0.3 
                                ? "캐릭터 본성 우선 (따뜻하고 친근하게)" 
                                : (characterDebateIntensities[index] ?? 0.5) >= 0.7 
                                ? "관계 톤 우선 (도전적이고 날카롭게)" 
                                : "균형잡힌 톤 (본성과 관계의 조화)"}
                            </p>
                          </div>
                        </div>
                      )}
                    
                  </CardContent>
                </Card>
                );
              })}
            </div>
          )}
          
          {!isLoadingCharacters && suggestedCharacters.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🤔</div>
              <p className="text-gray-600">{t('chat:character.noResults')}</p>
              <p className="text-sm text-gray-500 mt-2">{t('chat:character.tryAnotherTopic')}</p>
            </div>
          )}
          
          {isLoadingMoreCharacters && !isLoadingCharacters && (
            <div className="text-center mt-6">
              <p className="text-sm text-gray-600 animate-pulse">
                {t('chat:character.searchingForTopic', { topic: characterTopic })}
              </p>
              <div className="flex justify-center space-x-2 mt-3">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
              <p className="text-xs text-gray-500 mt-3">{t('chat:character.pleaseWait')}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ✅ 조건부 렌더링 (모든 hooks 실행 후)
  if (!isValidGroupChatId) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (isError || !groupChat) {
    const errorMessage = error instanceof Error 
      ? (error as any)?.message || error.message 
      : '채팅방을 불러올 수 없습니다.';
    
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold mb-2">접근 제한</h2>
          <p className="text-muted-foreground mb-4">{errorMessage}</p>
          <button
            onClick={() => setLocation('/')}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // 관리자 여부 확인 (TokenGaugeBar 표시 여부와 동일)
  const isAdmin = user?.role === 'master_admin' || user?.role === 'operation_admin' || user?.role === 'agent_admin';
  
  return (
    <div className={`h-screen bg-white flex flex-col ${isAdmin ? 'pt-12 md:pt-10' : ''}`}>
      {/* 헤더 */}
      <div className={`bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0 ${!isTablet ? `fixed ${isAdmin ? 'top-12 md:top-10' : 'top-0'} left-0 right-0 z-40` : ""}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={handleGoBack}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="flex flex-col">
              <h1 className="text-lg font-semibold">{groupChat.title}</h1>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <Users className="w-4 h-4" />
                <span>{groupChat.members.length}명</span>
                <span>•</span>
                <span>에이전트 {groupChat.agents.length}개</span>
                
                {/* Task 4: Real-time Conversation Status */}
                {turnCount >= 6 && (
                  <>
                    <span>•</span>
                    <div className={`turn-counter ${turnCount >= 10 ? 'milestone' : ''}`}>
                      🎯 {turnCount}턴
                    </div>
                  </>
                )}
                
                {discussionHeat > 3 && (
                  <>
                    <span>•</span>
                    <div className={`conversation-status ${discussionHeat > 6 ? 'heated' : 'multi-turn'}`}>
                      {discussionHeat > 6 ? '🔥' : '💬'} 
                      {discussionHeat > 6 ? '열띤 토론' : '활발한 대화'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 컴팩트 언어 레벨 드롭다운 - 관리자 전용 */}
            {user && (user.role === 'master_admin' || user.role === 'agent_admin') && (
              <Select 
                value={groupChat?.languageLevel === null ? "none" : (groupChat?.languageLevel ?? 3).toString()} 
                onValueChange={(value) => {
                  const level = value === "none" ? null : parseInt(value);
                  updateLanguageLevelMutation.mutate(level);
                }}
              >
                <SelectTrigger className="w-16 h-8 text-xs" data-testid="header-language-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="px-3 py-2 text-sm font-medium text-muted-foreground border-b" data-testid="text-language-level-title">
                      언어 레벨
                    </SelectLabel>
                    <SelectItem value="none">미적용</SelectItem>
                    <SelectItem value="1">1단계</SelectItem>
                    <SelectItem value="2">2단계</SelectItem>
                    <SelectItem value="3">3단계</SelectItem>
                    <SelectItem value="4">4단계</SelectItem>
                    <SelectItem value="5">5단계</SelectItem>
                    <SelectItem value="6">6단계</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
            
            {/* Edit mode toggle button for admins */}
            {isAdmin && !isEditMode && (
              <Button
                variant="ghost"
                size="sm"
                className="px-3 py-2"
                onClick={() => setIsEditMode(true)}
              >
                <Edit className="w-4 h-4 mr-1" />
                편집
              </Button>
            )}
            
            {/* Edit mode actions */}
            {isAdmin && isEditMode && (
              <>
                <span className="text-sm text-muted-foreground">
                  {selectedMessages.size}개 선택
                </span>
                {selectedMessages.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="px-3 py-2"
                    onClick={() => {
                      if (selectedMessages.size > 0) {
                        setMessageToDelete({ 
                          id: -1,
                          groupChatId: Number(groupChatId)
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
                  className="px-3 py-2"
                  onClick={() => {
                    setIsEditMode(false);
                    setSelectedMessages(new Set());
                  }}
                >
                  완료
                </Button>
              </>
            )}
            
            {/* 햄버거 메뉴 - 운영자 계정에만 표시 */}
            {isAdmin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-chat-menu">
                    <Menu className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setLocation(`/group-chat/${groupChatId}/agents`)}>
                  <Bot className="mr-2 h-4 w-4" />
                  {t('chat:settings.agentManage')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLocation(`/group-chat/${groupChatId}/members`)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {t('chat:settings.userManage')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => {
                  setLocation(`/group-chat/${groupChatId}/settings`);
                }}>
                  <Settings className="mr-2 h-4 w-4" />
                  {user && (user.role === 'master_admin' || user.role === 'agent_admin') 
                    ? t('chat:settings.manage') 
                    : '대화방 제목 변경'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* 모든 사용자가 나가기 가능 */}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{t('chat:settings.leave')}</span>
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('chat:settings.leaveConfirmTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('chat:settings.leaveConfirmDesc')}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="focus:ring-0 focus:ring-offset-0">{t('chat:settings.cancel')}</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => leaveGroupChatMutation.mutate()}
                      >
                        {t('chat:settings.confirm')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* 메시지 영역 - 입력 영역 위까지만 스크롤 */}
      <div 
        ref={setContainerRef} 
        className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full" 
        style={{ 
          minHeight: 0,
          paddingTop: !isTablet ? '80px' : '16px',
          paddingLeft: '16px',
          paddingRight: '16px',
          paddingBottom: !isTablet ? '120px' : '16px'
        }}
      >
        {/* ⚡ 메모이제이션된 메시지 컴포넌트 사용 (타이핑 시 리렌더링 차단) */}
        {uniqueMessages.map((msg, index) => {
          const messageKey = makeMessageKey(msg);
          const isFromAgent = !!msg.agentId;
          const uniqueKey = isFromAgent ? messageKey : String(msg.id);
          const prevMsg = index > 0 ? uniqueMessages[index - 1] : undefined;
          
          return (
            <ChatMessage
              key={uniqueKey}
              msg={msg}
              prevMsg={prevMsg}
              groupChatId={groupChatId!}
              currentUserId={user?.id}
              findAgentNameById={findAgentNameById}
              formatMessageTime={formatMessageTime}
              formatTimestamp={formatTimestamp}
              isAgentMessage={isAgentMessage}
              isMyMessage={isMyMessage}
              getBubbleColorForUser={getBubbleColorForUser}
              isEditMode={isEditMode}
              isAdmin={isAdmin}
              selectedMessages={selectedMessages}
              onToggleMessage={(id) => {
                const newSelected = new Set(selectedMessages);
                if (newSelected.has(id)) {
                  newSelected.delete(id);
                } else {
                  newSelected.add(id);
                }
                setSelectedMessages(newSelected);
              }}
              onSourceClick={handleSourceClick}
              perspectives={msg.id ? perspectivesByMessage[msg.id] : undefined}
              onPerspectiveSwitch={(perspective) => {
                if (msg.id) {
                  handlePerspectiveSwitch(perspective, msg.id, msg.content);
                }
              }}
            />
          );
        })}

        {/* 타이핑 인디케이터 - Apple Messages 스타일 */}
        {isAnyBotTyping && (
          <div className="flex flex-col items-start mb-[24px]">
            {/* 봇 이름 표시 */}
            {typingBotInfo && (
              <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-[6px] px-3">
                {typingBotInfo.name}
              </div>
            )}
            
            {/* 타이핑 스피너 */}
            <div className="minimal-message assistant">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-500 dark:bg-gray-400 rounded-full animate-pulse"></div>
                <div className="w-2 h-2 bg-gray-500 dark:bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                <div className="w-2 h-2 bg-gray-500 dark:bg-gray-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        {/* 🚫 Thinking Indicators 비활성화 - 일반 타이핑 인디케이터만 사용 */}
        
        <div ref={messagesEndRef} />
      </div>

      {/* 입력 프레임 컨테이너 */}
      <div className={`bg-white border-t border-gray-200 flex-shrink-0 ${!isTablet ? 'fixed bottom-0 left-0 right-0 z-40' : ''}`}>
        {/* 멘션 제안 목록 */}
        {showMentionList && (
          <div className="border-b border-gray-200 bg-white max-h-44 overflow-y-auto">
            {filteredMentionOptions.map((option, index) => {
              const isSelected = index === mentionSelectedIndex;
              
              if (option === 'all') {
                return (
                  <div
                    key="all"
                    className={`flex items-center justify-between p-1.5 cursor-pointer border-b border-gray-100 ${
                      isSelected ? 'bg-blue-100' : 'bg-blue-50 hover:bg-gray-50'
                    }`}
                    onClick={() => handleMentionSelect('all')}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
                        style={{ backgroundColor: '#6366f1' }}
                      >
                        👥
                      </div>
                      <span className={`font-medium ${isSelected ? 'text-blue-800' : 'text-blue-700'}`}>
                        모두
                      </span>
                    </div>
                  </div>
                );
              } else {
                const agent = option as GroupChatAgent;
                return (
                  <div
                    key={agent.id}
                    className={`flex items-center p-1.5 cursor-pointer border-b border-gray-100 ${
                      isSelected ? 'bg-blue-100' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => handleMentionSelect(agent)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
                        style={{ backgroundColor: agent.agent?.backgroundColor }}
                      >
                        🤖
                      </div>
                      <span className={`font-medium ${isSelected ? 'text-blue-800' : 'text-gray-900'}`}>
                        {agent.agent?.name}
                      </span>
                    </div>
                  </div>
                );
              }
            })}
          </div>
        )}


        {/* 입력 영역 */}
        <div className="p-4">
          <div className="flex items-center gap-2">
            {/* + 버튼 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 w-10 h-10 p-0"
              title={t('chat:input.uploadDocument')}
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
              {/* Custom input area with @mention tags */}
              <div className="border border-gray-300 rounded-lg min-h-[40px] max-h-[120px] overflow-y-auto focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 p-2 bg-white">
                <div className="flex flex-wrap items-center gap-1">
                  {/* Selected agent tags */}
                  {selectedAgents.map((agent) => (
                    <span 
                      key={agent.id}
                      className="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-700 font-medium text-sm flex-shrink-0"
                    >
                      @{agent.name}
                      <button
                        onClick={() => {
                          setSelectedAgents(prev => prev.filter(a => a.id !== agent.id));
                        }}
                        className="ml-1 text-blue-500 hover:text-blue-700 w-3 h-3 flex items-center justify-center rounded-full hover:bg-blue-100"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  
                  {/* Actual input field */}
                  <div className="flex-1 min-w-0">
                    <textarea
                      ref={inputRef}
                      placeholder={inputPlaceholder}
                      value={message}
                      onChange={handleMessageChange}
                      onKeyDown={handleKeyDown}
                      onCompositionStart={handleCompositionStart}
                      onCompositionEnd={handleCompositionEnd}
                      onInput={handleTextareaInput}
                      className="w-full border-none outline-none resize-none bg-transparent"
                      rows={1}
                      style={{
                        minHeight: '20px'
                      }}
                    />
                  </div>
                </div>
              </div>
              
              {message.includes('@') && (
                <AtSign className="absolute right-3 top-3 text-gray-400 w-4 h-4 pointer-events-none" />
              )}
            </div>
            <Button
              onClick={handleSendMessage}
              disabled={!message.trim() || isSendingDisabled || sendMessageMutation.isPending || isGroupChatBusy}
              size="sm"
              className={isGroupChatBusy ? "opacity-50" : ""}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 채팅방 설정 모달 */}
      <Dialog open={showChatSettingsModal} onOpenChange={setShowChatSettingsModal}>
        <DialogContent className="sm:max-w-[425px] p-0">
          {/* 커스텀 헤더 */}
          <div className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center mb-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowChatSettingsModal(false)}
                className="mr-2 -ml-2"
                data-testid="button-back-settings"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h2 className="text-xl font-semibold text-gray-900">
                {t('chat:chatSettings.title')}
              </h2>
            </div>
            <p className="text-sm text-gray-600 ml-10">
              {t('chat:chatSettings.description')}
            </p>
          </div>
          
          <div className="space-y-6 px-6 py-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-2">
                {t('chat:chatSettings.chatTitle')}
              </label>
              <input
                type="text"
                value={newChatTitle}
                onChange={(e) => setNewChatTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newChatTitle.trim() && !updateTitleMutation.isPending) {
                    e.preventDefault();
                    updateTitleMutation.mutate(newChatTitle.trim());
                  }
                }}
                placeholder={groupChat?.title || t('chat:chatSettings.chatTitlePlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                maxLength={100}
                data-testid="input-chat-title"
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('chat:chatSettings.characterCount', {count: newChatTitle.length})}
              </p>
            </div>

            {/* 언어 레벨 설정 - 관리자 전용 */}
            {user && (user.role === 'master_admin' || user.role === 'agent_admin') && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  {t('chat:chatSettings.languageLevel')}
                </label>
                <Select 
                  value={newLanguageLevel === null ? "none" : newLanguageLevel.toString()} 
                  onValueChange={(value) => setNewLanguageLevel(value === "none" ? null : parseInt(value))}
                >
                  <SelectTrigger className="w-full" data-testid="select-language-level">
                    <SelectValue placeholder={t('chat:input.languageLevelPlaceholder')}>
                      {newLanguageLevel === null ? "미적용" : 
                       newLanguageLevel === 1 ? "1단계 - 단어 하나" :
                       newLanguageLevel === 2 ? "2단계 - 주어 + 동사" :
                       newLanguageLevel === 3 ? "3단계 - 간단한 두 문장" :
                       newLanguageLevel === 4 ? "4단계 - 기본 연결 표현" :
                       newLanguageLevel === 5 ? "5단계 - 이유 표현과 조건문" :
                       newLanguageLevel === 6 ? "6단계 - 완전 자유 표현" : ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">미적용</span>
                        <span className="text-xs text-gray-500">AI가 자유롭게 응답 (제약 없음)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="1">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">1단계 - 단어 하나</span>
                        <span className="text-xs text-gray-500">예: "좋아", "네", "안녕"</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="2">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">2단계 - 주어 + 동사</span>
                        <span className="text-xs text-gray-500">예: "나 좋아", "날씨 좋아"</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="3">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">3단계 - 간단한 두 문장</span>
                        <span className="text-xs text-gray-500">예: "날씨 좋아. 나 기뻐."</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="4">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">4단계 - 기본 연결 표현</span>
                        <span className="text-xs text-gray-500">예: "돈 벌고 투자해", "-고", "-아서/-어서" 사용</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="5">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">5단계 - 이유 표현과 조건문</span>
                        <span className="text-xs text-gray-500">예: "돈 벌어서 투자해", "만약 기회 있으면 해볼래"</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="6">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">6단계 - 완전 자유 표현</span>
                        <span className="text-xs text-gray-500">제한 없는 자연스러운 표현</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-2">
                  {t('chat:chatSettings.languageLevelDesc')}
                </p>
              </div>
            )}

            {/* 🤖 AI 설정 섹션 */}
            <div className="border-t pt-6">
              <label className="text-sm font-medium text-gray-700 block mb-3">
                AI 설정
              </label>
              
              {/* GPT 모델 선택 */}
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  GPT 모델
                </label>
                <Select value={newGptModel} onValueChange={(value) => setNewGptModel(value)}>
                  <SelectTrigger className="w-full" data-testid="select-gpt-model">
                    <SelectValue placeholder="모델 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">GPT-4o</span>
                        <span className="text-xs text-gray-500">가장 정확한 응답 (느림, 비용 높음)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="gpt-4o-mini">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">GPT-4o-mini</span>
                        <span className="text-xs text-gray-500">빠른 응답 (기본값, 적당한 정확도)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="gpt-4-turbo">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">GPT-4-turbo</span>
                        <span className="text-xs text-gray-500">빠른 GPT-4</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="gpt-4">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">GPT-4</span>
                        <span className="text-xs text-gray-500">고품질 응답</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="gpt-3.5-turbo">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">GPT-3.5-turbo</span>
                        <span className="text-xs text-gray-500">가장 빠름 (낮은 정확도)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="o1-preview">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">o1-preview</span>
                        <span className="text-xs text-gray-500">최신 reasoning 모델 (매우 느림)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="o1-mini">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">o1-mini</span>
                        <span className="text-xs text-gray-500">빠른 reasoning 모델</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-2">
                  정확도가 중요하면 gpt-4o, 속도가 중요하면 gpt-4o-mini를 선택하세요
                </p>
              </div>

              {/* Temperature 슬라이더 */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  Temperature: {newGptTemperature.toFixed(2)}
                </label>
                <Slider
                  value={[newGptTemperature]}
                  onValueChange={(values) => setNewGptTemperature(values[0])}
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full"
                  data-testid="slider-temperature"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>0.0 (정확)</span>
                  <span>1.0 (균형)</span>
                  <span>2.0 (창의적)</span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  0.0-0.3: 사실 기반 응답, 0.7-1.0: 균형잡힌 응답, 1.5-2.0: 창의적 응답
                </p>
              </div>
            </div>

            {/* 🌐 임베드 코드 섹션 - embed visibility인 경우만 표시 */}
            {groupChat && (groupChat as any).embedCode && (
              <div className="border-t pt-6">
                <label className="text-sm font-medium text-gray-700 block mb-3">
                  웹 페이지 임베드
                </label>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    아래 HTML 코드를 복사하여 웹 페이지에 붙여넣으면 이 채팅방을 임베드할 수 있습니다.
                  </p>
                  
                  {/* 임베드 코드 표시 */}
                  <div className="relative">
                    <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 font-mono text-sm text-gray-800 overflow-x-auto">
                      {`<iframe src="${window.location.origin}/embed/${groupChat.embedCode}" width="100%" height="600px" frameborder="0"></iframe>`}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="absolute top-2 right-2"
                      onClick={() => {
                        const embedCode = `<iframe src="${window.location.origin}/embed/${groupChat.embedCode}" width="100%" height="600px" frameborder="0"></iframe>`;
                        navigator.clipboard.writeText(embedCode);
                        toast({ 
                          title: "복사 완료!", 
                          description: "임베드 코드가 클립보드에 복사되었습니다."
                        });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* 도메인 화이트리스트 정보 */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-blue-900 mb-1">
                      허용된 도메인
                    </p>
                    {groupChat.allowedDomains && groupChat.allowedDomains.length > 0 ? (
                      <ul className="text-sm text-blue-800 space-y-1">
                        {groupChat.allowedDomains.map((domain, idx) => (
                          <li key={idx} className="flex items-center">
                            <Check className="h-3 w-3 mr-2" />
                            {domain}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-blue-800">
                        모든 웹사이트에서 임베드 가능
                      </p>
                    )}
                  </div>
                  
                  <p className="text-xs text-gray-500">
                    💡 팁: iframe의 width와 height를 조정하여 원하는 크기로 표시할 수 있습니다.
                  </p>
                </div>
              </div>
            )}

            {/* 🎭 관계 매트릭스 관리 섹션 */}
            {groupChat && groupChat.agents.length >= 2 && (
              <div className="border-t pt-6">
                <label className="text-sm font-medium text-gray-700 block mb-3">
                  {t('chat:chatSettings.relationshipMatrix')}
                </label>
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {t('chat:chatSettings.relationshipMatrixDesc')}
                  </p>
                  
                  {hasMatrix ? (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                        <span className="text-sm text-green-700">{t('chat:chatSettings.matrixExists')}</span>
                      </div>
                      <div className="flex space-x-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setShowRelationshipMatrixModal(true)}
                          data-testid="button-view-matrix"
                        >
                          <Heart className="mr-2 h-4 w-4" />
                          {t('chat:chatSettings.matrixView')}
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => generateMatrixMutation.mutate()}
                          disabled={generateMatrixMutation.isPending || isGeneratingMatrix}
                          data-testid="button-regenerate-matrix"
                        >
                          {(generateMatrixMutation.isPending || isGeneratingMatrix) ? t('chat:chatSettings.matrixGenerating') : t('chat:chatSettings.matrixRegenerate')}
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => deleteMatrixMutation.mutate()}
                          disabled={deleteMatrixMutation.isPending || isGeneratingMatrix}
                          data-testid="button-delete-matrix"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('chat:chatSettings.matrixDelete')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <div className="h-2 w-2 bg-gray-400 rounded-full"></div>
                        <span className="text-sm text-gray-600">{t('chat:chatSettings.matrixNone')}</span>
                      </div>
                      <Button 
                        size="sm" 
                        onClick={() => generateMatrixMutation.mutate()}
                        disabled={generateMatrixMutation.isPending || isGeneratingMatrix}
                        data-testid="button-generate-matrix"
                      >
                        <Heart className="mr-2 h-4 w-4" />
                        {(generateMatrixMutation.isPending || isGeneratingMatrix) ? t('chat:chatSettings.matrixGenerating') : t('chat:chatSettings.matrixGenerate')}
                      </Button>
                    </div>
                  )}
                  
                  <p className="text-xs text-gray-500">
                    {t('chat:chatSettings.matrixAutoReset')}
                  </p>
                </div>
              </div>
            )}
            
            {/* 관계 매트릭스가 2개 미만일 때 안내 */}
            {groupChat && groupChat.agents.length < 2 && (
              <div className="border-t pt-6">
                <label className="text-sm font-medium text-gray-700 block mb-3">
                  {t('chat:chatSettings.relationshipMatrix')}
                </label>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-800">
                    {t('chat:chatSettings.matrixMinRequired')}
                  </p>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-100">
            <Button 
              variant="outline" 
              onClick={() => {
                setShowChatSettingsModal(false);
              }}
              data-testid="button-cancel-settings"
            >
              {t('chat:chatSettings.cancel')}
            </Button>
            <Button 
              onClick={async () => {
                const titleChanged = newChatTitle.trim() && newChatTitle.trim() !== (groupChat?.title || "");
                const canChangeLanguageLevel = user && (user.role === 'master_admin' || user.role === 'agent_admin');
                const levelChanged = canChangeLanguageLevel && newLanguageLevel !== (groupChat?.languageLevel ?? null);
                const modelChanged = newGptModel !== (groupChat?.model || "gpt-4o-mini");
                const temperatureChanged = newGptTemperature !== (groupChat?.temperature !== undefined ? groupChat.temperature : 1.0);
                const aiSettingsChanged = modelChanged || temperatureChanged;
                
                if (!titleChanged && !levelChanged && !aiSettingsChanged) return;

                try {
                  const promises = [];
                  
                  // 제목이 실제로 변경된 경우에만 제목 업데이트
                  if (titleChanged) {
                    promises.push(updateTitleMutation.mutateAsync(newChatTitle.trim()));
                  }
                  
                  // 언어 레벨이 실제로 변경된 경우에만 언어 레벨 업데이트 (관리자만)
                  if (levelChanged) {
                    promises.push(updateLanguageLevelMutation.mutateAsync(newLanguageLevel));
                  }
                  
                  // AI 설정이 실제로 변경된 경우에만 AI 설정 업데이트
                  if (aiSettingsChanged) {
                    promises.push(updateAISettingsMutation.mutateAsync({ 
                      model: newGptModel, 
                      temperature: newGptTemperature 
                    }));
                  }
                  
                  // 변경된 것들만 병렬 처리
                  await Promise.all(promises);

                  // 성공 시 모달 닫기 (useEffect가 상태를 초기화함)
                  setShowChatSettingsModal(false);
                } catch (error) {
                  // 에러는 각 mutation에서 처리됨
                }
              }}
              disabled={
                (!newChatTitle.trim() || newChatTitle.trim() === (groupChat?.title || "")) && 
                newLanguageLevel === (groupChat?.languageLevel ?? null) &&
                newGptModel === (groupChat?.model || "gpt-4o-mini") &&
                newGptTemperature === (groupChat?.temperature !== undefined ? groupChat.temperature : 1.0) ||
                updateTitleMutation.isPending || 
                updateLanguageLevelMutation.isPending ||
                updateAISettingsMutation.isPending
              }
              data-testid="button-save-settings"
            >
              {(updateTitleMutation.isPending || updateLanguageLevelMutation.isPending || updateAISettingsMutation.isPending) ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  {t('chat:chatSettings.saving')}
                </>
              ) : (
                t('chat:chatSettings.save')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 🎭 관계 매트릭스 보기 모달 */}
      <Dialog open={showRelationshipMatrixModal} onOpenChange={setShowRelationshipMatrixModal}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-900 flex items-center">
              <Heart className="mr-2 h-5 w-5" />
              {t('chat:chatSettings.matrixModalTitle')}
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              {t('chat:chatSettings.matrixModalDesc')}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {relationshipMatrix && relationshipMatrix.length > 0 ? (
              <div className="space-y-3">
                {relationshipMatrix.map((relationship, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-3 border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">{relationship.from}</span>
                        <span className="text-gray-500">→</span>
                        <span className="font-medium text-gray-900">{relationship.to}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm">
                        <span className="font-medium text-gray-700">{t('chat:chatSettings.relationship')}:</span>
                        <span className="ml-2 text-gray-600">{relationship.relation}</span>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-gray-700">{t('chat:chatSettings.tone')}:</span>
                        <span className="ml-2 text-gray-600">{relationship.tone}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Heart className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">{t('chat:chatSettings.matrixNone')}</p>
                <Button 
                  className="mt-3" 
                  onClick={() => {
                    setShowRelationshipMatrixModal(false);
                    generateMatrixMutation.mutate();
                  }}
                  data-testid="button-generate-from-modal"
                >
                  {t('chat:chatSettings.matrixGenerate')}
                </Button>
              </div>
            )}
          </div>
          
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
            <Button 
              variant="outline" 
              onClick={() => setShowRelationshipMatrixModal(false)}
              data-testid="button-close-matrix-modal"
            >
              {t('chat:chatSettings.close')}
            </Button>
            {relationshipMatrix && relationshipMatrix.length > 0 && (
              <Button 
                onClick={() => {
                  setShowRelationshipMatrixModal(false);
                  generateMatrixMutation.mutate();
                }}
                disabled={generateMatrixMutation.isPending}
                data-testid="button-regenerate-from-modal"
              >
                <Heart className="mr-2 h-4 w-4" />
                {t('chat:chatSettings.matrixRegenerate')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 🎭 관계 매트릭스 로딩 모달 */}
      <Dialog open={isGeneratingMatrix} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-900 flex items-center justify-center">
              <Heart className="mr-2 h-5 w-5 animate-pulse" />
              {t('chat:chatSettings.matrixGenerating')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6 py-6">
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
            
            <div className="text-center space-y-2">
              <p className="text-gray-700 font-medium">
                AI가 챗봇들 간의 관계를 분석하고 있습니다...
              </p>
              <p className="text-sm text-gray-500">
                이 과정은 10-20초 정도 소요될 수 있습니다.
              </p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-blue-800">
                  더 자연스러운 대화를 위해 관계를 생성하는 중입니다.
                </span>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Message Confirmation Dialog */}
      {messageToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setMessageToDelete(null)}>
          <div className="bg-background border border-border rounded-xl shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="text-lg font-medium text-foreground mb-4">메시지 삭제</h3>
              <p className="text-muted-foreground mb-6 text-center">
                {messageToDelete.id === -1 
                  ? `선택한 ${selectedMessages.size}개의 메시지를 삭제하시겠습니까?`
                  : "이 메시지를 삭제하시겠습니까?"}
                <br /><br />
                삭제된 메시지는 복구할 수 없습니다.
              </p>
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => setMessageToDelete(null)}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMessageMutation.mutate(messageToDelete!)}
                  disabled={deleteMessageMutation.isPending}
                >
                  {deleteMessageMutation.isPending ? "삭제 중..." : "삭제"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sources Dialog */}
      <Dialog open={sourcesDialogState.isOpen} onOpenChange={(open) => !open && handleDialogClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>📰 출처 {sourcesDialogState.isSearching && <span className="text-sm text-gray-500">(검색 중...)</span>}</DialogTitle>
            <DialogDescription>
              {sourcesDialogState.isSearching 
                ? "Google에서 관련 출처를 검색하고 있습니다..."
                : (sourcesDialogState.fetchedSources !== null
                  ? (sourcesDialogState.fetchedSources.length > 0 
                    ? "Google 검색으로 찾은 관련 출처입니다."
                    : "관련 출처를 찾지 못했습니다.")
                  : (sourcesDialogState.selectedSourceIndices 
                    ? "이 텍스트는 다음 출처를 참고했습니다."
                    : "이 응답은 다음 출처를 참고했습니다."))}
            </DialogDescription>
            {sourcesDialogState.messageContent && (
              <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm text-gray-600 dark:text-gray-400 border-l-2 border-blue-500">
                <div className="font-medium text-xs text-gray-500 dark:text-gray-500 mb-1">검색한 메시지:</div>
                "{sourcesDialogState.messageContent}..."
              </div>
            )}
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {sourcesDialogState.isSearching ? (
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : sourcesDialogState.fetchedSources !== null ? (
              sourcesDialogState.fetchedSources.length > 0 ? (
                sourcesDialogState.fetchedSources.map((source, index) => (
                  <div
                    key={index}
                    className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    data-testid={`source-item-${index}`}
                  >
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                      {source.title}
                    </div>
                    {source.snippet && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                        {source.snippet}
                      </div>
                    )}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                      data-testid={`source-link-${index}`}
                    >
                      {source.url}
                    </a>
                  </div>
                ))
              ) : (
                /* 검색했지만 출처를 못 찾았을 때만 면책 문구 표시 */
                <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">⚠️</div>
                    <div className="flex-1">
                      <h4 className="font-medium text-yellow-900 dark:text-yellow-200 mb-2">
                        AI 시뮬레이션 응답
                      </h4>
                      <p className="text-sm text-yellow-800 dark:text-yellow-300 leading-relaxed">
                        이 응답은 실제 인물의 발언이 아닙니다.<br />
                        AI가 해당 인물의 스타일을 참고해 만든 시뮬레이션입니다.
                      </p>
                    </div>
                  </div>
                </div>
              )
            ) : (
              /* 기존 출처(precomputed sources) 표시 */
              (sourcesDialogState.selectedSourceIndices 
                ? sourcesDialogState.selectedSourceIndices.map(i => sourcesDialogState.precomputedSources?.chunks?.[i]).filter((s): s is NonNullable<typeof s> => Boolean(s))
                : sourcesDialogState.precomputedSources?.chunks || []
              ).map((source, index) => (
                <div
                  key={index}
                  className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  data-testid={`source-item-${index}`}
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                    {source.title}
                  </div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                    data-testid={`source-link-${index}`}
                  >
                    {source.url}
                  </a>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}