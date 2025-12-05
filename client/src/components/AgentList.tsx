import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ko, enUS, ja } from "date-fns/locale";
import { GraduationCap, Code, Bot, User, Users, FlaskRound, Map, Languages, Dumbbell, Database, Lightbulb, Heart, Calendar, Pen, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { debounce } from "@/utils/performance";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import type { Agent, Conversation } from "@/types/agent";

interface AgentListProps {
  agents: Agent[];
  conversations: Conversation[];
  groupChats?: any[];
  searchQuery?: string;
}

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

const backgroundColorMap: Record<string, string> = {
  "bg-slate-800": "bg-slate-800",
  "bg-primary": "bg-primary",
  "bg-orange-500": "bg-orange-500",
  "bg-gray-600": "bg-gray-600",
  "bg-blue-500": "bg-blue-500",
  "bg-green-500": "bg-green-500",
  "bg-purple-500": "bg-purple-500",
  "bg-yellow-500": "bg-yellow-500",
  "bg-pink-500": "bg-pink-500",
  "bg-indigo-500": "bg-indigo-500",
  "bg-teal-500": "bg-teal-500",
  "bg-red-500": "bg-red-500",
};

function getCategoryBadgeStyle(category: string) {
  switch (category) {
    case "학교":
      return "category-badge school";
    case "교수":
      return "category-badge professor";
    case "학생":
      return "category-badge student";
    case "그룹":
      return "category-badge group";
    case "기능형":
      return "category-badge feature";
    default:
      return "category-badge school";
  }
}

export default function AgentList({ agents, conversations, groupChats = [], searchQuery = "" }: AgentListProps) {
  const [location, setLocation] = useLocation();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [isInstantiating, setIsInstantiating] = useState<number | null>(null);
  
  const getConversationForAgent = useMemo(() => {
    return (agentId: number) => conversations.find(conv => conv.agentId === agentId);
  }, [conversations]);

  const getTimeAgo = useMemo(() => {
    return (date: string) => {
      try {
        const messageDate = new Date(date);
        const dateFnsLocale = language === 'ko' ? ko : language === 'jp' ? ja : enUS;
        
        return formatDistanceToNow(messageDate, {
          addSuffix: true,
          locale: dateFnsLocale
        });
      } catch {
        return t('chat:time.recent');
      }
    };
  }, [language, t]);

  // Category priority order: 학교, 교수, 그룹, 학생, 기능
  const getCategoryPriority = useMemo(() => {
    return (category: string) => {
      switch (category) {
        case "학교": return 1;
        case "교수": return 2;
        case "그룹": return 3;
        case "학생": return 4;
        case "기능형": return 5;
        default: return 6;
      }
    };
  }, []);

  // 템플릿 방 클릭 핸들러
  const handleTemplateClick = async (e: React.MouseEvent, templateId: number) => {
    e.preventDefault();
    setIsInstantiating(templateId);

    try {
      const response = await fetch(`/api/group-chats/templates/${templateId}/instantiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to instantiate template');
      }

      const data = await response.json();
      
      if (data.isNew) {
        toast({
          title: "채팅방이 생성되었습니다",
          description: "템플릿으로부터 새 채팅방을 만들었습니다."
        });
      }
      
      setLocation(`/group-chat/${data.id}`);
    } catch (error) {
      console.error('Template instantiation error:', error);
      toast({
        title: "오류 발생",
        description: "템플릿 채팅방을 만드는데 실패했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsInstantiating(null);
    }
  };

  // 통합 대화방 목록: 그룹 채팅 + 개별 대화를 최근 활동 순으로 정렬
  const sortedCombinedChats = useMemo(() => {
    const allChats: Array<{
      type: 'group' | 'individual';
      id: number;
      title: string;
      lastMessageAt?: string;
      agent?: any;
      groupChat?: any;
    }> = [];

    // 그룹 채팅 추가
    groupChats.forEach(groupChat => {
      allChats.push({
        type: 'group',
        id: groupChat.id,
        title: groupChat.title,
        lastMessageAt: groupChat.lastMessageAt,
        groupChat
      });
    });

    // 개별 에이전트 대화 추가
    agents.forEach(agent => {
      const conversation = getConversationForAgent(agent.id);
      allChats.push({
        type: 'individual',
        id: agent.id,
        title: agent.name,
        lastMessageAt: conversation?.lastMessageAt,
        agent
      });
    });

    // 검색 필터링 적용
    let filteredChats = allChats;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredChats = allChats.filter(chat => {
        if (chat.type === 'group') {
          // 그룹 채팅: 제목과 마지막 메시지 내용 검색
          return chat.title.toLowerCase().includes(query) || 
                 (chat.groupChat?.lastMessage && chat.groupChat.lastMessage.toLowerCase().includes(query));
        } else {
          // 개별 에이전트: 이름과 설명 검색
          return chat.title.toLowerCase().includes(query) || 
                 (chat.agent?.description && chat.agent.description.toLowerCase().includes(query));
        }
      });
    }

    // 최근 활동 순으로 정렬
    return filteredChats.sort((a, b) => {
      const hasRecentA = a.lastMessageAt;
      const hasRecentB = b.lastMessageAt;
      
      if (hasRecentA && hasRecentB) {
        // 둘 다 메시지가 있으면 최근 메시지 시간 기준으로 정렬
        const timeA = new Date(a.lastMessageAt!).getTime();
        const timeB = new Date(b.lastMessageAt!).getTime();
        return timeB - timeA;
      } else if (hasRecentA && !hasRecentB) {
        // A만 메시지가 있으면 A가 위로
        return -1;
      } else if (!hasRecentA && hasRecentB) {
        // B만 메시지가 있으면 B가 위로
        return 1;
      } else {
        // 둘 다 메시지가 없으면 타입별 정렬 (그룹 > 개별)
        if (a.type === 'group' && b.type === 'individual') return -1;
        if (a.type === 'individual' && b.type === 'group') return 1;
        
        // 같은 타입이면 카테고리 우선순위 또는 제목 알파벳순
        if (a.type === 'individual' && b.type === 'individual') {
          const categoryA = a.agent?.category || '';
          const categoryB = b.agent?.category || '';
          const priorityDiff = getCategoryPriority(categoryA) - getCategoryPriority(categoryB);
          return priorityDiff !== 0 ? priorityDiff : a.title.localeCompare(b.title);
        }
        
        return a.title.localeCompare(b.title);
      }
    });
  }, [agents, groupChats, conversations, getConversationForAgent, getCategoryPriority, searchQuery]);

  return (
    <div className="space-y-0.5 px-4">
      {/* 통합 대화방 목록 - 최근 활동 순 정렬 */}
      <div className="space-y-0.5">
        {sortedCombinedChats.map((chat) => {
          if (chat.type === 'group') {
            // 그룹 채팅 렌더링
            const isTemplate = chat.groupChat?.sharingMode === 'template';
            const isLoading = isInstantiating === chat.id;
            
            return (
              <Link 
                key={`group-${chat.id}`} 
                href={`/group-chat/${chat.id}`} 
                className="block w-full"
                onClick={isTemplate ? (e) => handleTemplateClick(e, chat.id) : undefined}
              >
                <div className={`p-1.5 md:p-2 rounded-lg transition-all duration-200 cursor-pointer  mb-1 last:mb-0 ${
                  location === `/group-chat/${chat.id}`
                    ? 'bg-blue-200 dark:bg-blue-700' 
                    : 'bg-white dark:bg-gray-900 hover:bg-blue-100 dark:hover:bg-blue-800'
                } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 md:w-12 md:h-12 shadow-sm">
                      <Users className="text-white w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate korean-text">
                            {chat.title}
                          </h3>
                          {isTemplate && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                              템플릿
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-sm truncate korean-text flex-1 text-gray-600 dark:text-gray-400">
                          {isTemplate 
                            ? t('chat:interface.clickToCreateFromTemplate') || '클릭하여 나만의 방 만들기'
                            : (chat.groupChat?.lastMessage?.content || t('chat:interface.startNewConversation'))
                          }
                        </p>
                        {chat.lastMessageAt && !isTemplate && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                            {getTimeAgo(chat.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          } else {
            // 개별 에이전트 렌더링
            const agent = chat.agent;
            const conversation = getConversationForAgent(agent.id);
            const IconComponent = iconMap[agent.icon] || User;
            const bgColor = backgroundColorMap[agent.backgroundColor] || "bg-gray-600";
            
            const isActive = location === `/chat/${agent.id}`;
            
            return (
              <Link key={agent.id} href={`/chat/${agent.id}`} className="block w-full">
                <div className={`p-1.5 md:p-2 rounded-lg transition-all duration-200 cursor-pointer  mb-1 last:mb-0 ${
                  isActive 
                    ? 'bg-blue-200 dark:bg-blue-700' 
                    : 'bg-white dark:bg-gray-900 hover:bg-blue-100 dark:hover:bg-blue-800'
                }`}>
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 ${bgColor} rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden md:w-12 md:h-12 shadow-sm`}>
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
                          <IconComponent className="fallback-icon text-white w-5 h-5 md:w-6 md:h-6" style={{ display: 'none' }} />
                        </>
                      ) : (
                        <IconComponent className="text-white w-5 h-5 md:w-6 md:h-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-2">
                          <h3 className={`font-medium truncate korean-text text-sm md:text-base ${
                            isActive ? 'text-blue-900 dark:text-blue-100' : 'text-gray-900 dark:text-gray-100'
                          }`}>
                            {agent.name}
                          </h3>
                          {agent.category !== '그룹' && (
                            <span className={`${getCategoryBadgeStyle(agent.category)} text-xs px-2 py-0.5 rounded-md`}>
                              {t(`agent:category.${agent.category === '학교' ? 'school' : agent.category === '교수' ? 'professor' : agent.category === '학생' ? 'student' : agent.category === '그룹' ? 'group' : 'function'}`)}
                            </span>
                          )}
                        </div>
                        {conversation?.lastMessageAt && (
                          <span className={`text-xs korean-text flex-shrink-0 ${
                            isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            {getTimeAgo(conversation.lastMessageAt)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className={`text-sm truncate korean-text flex-1 ${
                          isActive ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'
                        }`}>
                          {conversation?.lastMessage?.content || agent.description}
                        </p>
                        {conversation && conversation.unreadCount > 0 && (
                          <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[18px] h-[18px] flex items-center justify-center ml-2 flex-shrink-0 shadow-lg border-2 border-white dark:border-gray-800">
                            {conversation.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          }
        })}
      </div>
    </div>
  );
}
