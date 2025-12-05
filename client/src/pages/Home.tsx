import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { Settings, Search, ChevronDown, LogOut, User, MessageCircle, Plus, ArrowRight, Activity, Users, Bell, Heart, CreditCard, Sparkles } from "lucide-react";
import { Agent, Conversation } from "@shared/schema";
import AgentList from "@/components/AgentList";
import AgentManagement from "@/components/AgentManagement";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { useLanguage } from "@/contexts/LanguageContext";
import { ThemeSelector } from "@/components/ThemeSelector";
import { useDebounce } from "@/hooks/useDebounce";
import { eventBus, EVENTS } from "@/utils/eventBus";
import { Link, useLocation } from "wouter";
import { performLogout } from "@/lib/logout";
import CardHome from "@/pages/CardHome";

interface User {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  userType?: string;
  role?: string;
}

function Home() {
  const [activeTab, setActiveTab] = useState<"chat" | "management" | "card">("chat");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(80); // 기본값 80px

  const { data: user } = useQuery<User>({
    queryKey: ["/api/user"],
  });

  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    staleTime: 0, // Always consider data stale for immediate updates
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
    refetchOnMount: "always", // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window gets focus
    refetchOnReconnect: true, // Refetch when reconnecting
  });

  // 대화 분석 결과 조회 (운영 탭용)
  const { data: analyticsData } = useQuery<any>({
    queryKey: ["/api/conversation-analytics?periodType=month"],
    enabled: activeTab === "management", // 운영 탭일 때만 조회
  });

  const { data: conversations = [] } = useQuery<(Conversation & { agent: Agent; lastMessage?: any })[]>({
    queryKey: ["/api/conversations"],
    gcTime: 0, // Don't cache - always fetch fresh data to prevent showing hidden conversations
    staleTime: 0, // Always consider data stale to trigger refetch
  });

  // 그룹 채팅 목록 조회
  const { data: groupChats = [] } = useQuery<any[]>({
    queryKey: ["/api/group-chats"],
    staleTime: 0, // 항상 최신 데이터 유지
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // 메시지 프리로딩은 App.tsx에서 글로벌하게 처리됨

  // SSE 연결은 App.tsx의 useSSE hook에서 전역적으로 관리됨

  // Listen for agent update events from IconChangeModal  
  useEffect(() => {
    console.log("TabletLayout: Setting up eventBus listeners...");
    
    const handleAgentUpdate = () => {
      console.log("TabletLayout: Received agent update event, forcing refresh...");
      // Force remove all cached agent data
      queryClient.removeQueries({ queryKey: ["/api/agents"] });
      queryClient.removeQueries({ queryKey: ["/api/conversations"] });
      
      // Force refetch with immediate execution
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ["/api/agents"], type: 'active' });
        queryClient.refetchQueries({ queryKey: ["/api/conversations"], type: 'active' });
      }, 100);
    };

    eventBus.on(EVENTS.FORCE_REFRESH_AGENTS, handleAgentUpdate);
    eventBus.on(EVENTS.AGENT_ICON_CHANGED, handleAgentUpdate);
    
    // Register global window function for direct refresh fallback
    (window as any).forceRefreshAgents = () => {
      console.log("TabletLayout: Global window function called for force refresh");
      handleAgentUpdate();
    };
    
    console.log("TabletLayout: EventBus listeners and window function registered");

    return () => {
      console.log("TabletLayout: Cleaning up eventBus listeners");
      eventBus.off(EVENTS.FORCE_REFRESH_AGENTS, handleAgentUpdate);
      eventBus.off(EVENTS.AGENT_ICON_CHANGED, handleAgentUpdate);
      // Don't delete window function as other components might be using it
    };
  }, [queryClient]);

  const categories = [
    { value: "전체", label: t('home:categories.all') },
    { value: "학교", label: t('home:categories.school') },
    { value: "교수", label: t('home:categories.professor') },
    { value: "학생", label: t('home:categories.student') },
    { value: "그룹", label: t('home:categories.group') },
    { value: "기능형", label: t('home:categories.function') }
  ];

  const filteredAgents = useMemo(() => {
    let filtered = agents;

    // Filter by category
    if (selectedCategory !== "전체") {
      filtered = filtered.filter(agent => agent.category === selectedCategory);
    }

    // Filter by search query using debounced value
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(agent => 
        agent.name.toLowerCase().includes(query) ||
        agent.description.toLowerCase().includes(query)
      );
    }

    // Sort agents by activity
    const agentConversationMap = new Map();
    conversations.forEach(conv => {
      const existing = agentConversationMap.get(conv.agentId);
      if (!existing || (conv.lastMessage && new Date(conv.lastMessage.createdAt) > new Date(existing.lastMessage.createdAt))) {
        agentConversationMap.set(conv.agentId, conv);
      }
    });

    return filtered.sort((a, b) => {
      const aConv = agentConversationMap.get(a.id);
      const bConv = agentConversationMap.get(b.id);
      
      if (aConv && bConv && aConv.lastMessage && bConv.lastMessage) {
        return new Date(bConv.lastMessage.createdAt).getTime() - new Date(aConv.lastMessage.createdAt).getTime();
      } else if (aConv && aConv.lastMessage) {
        return -1;
      } else if (bConv && bConv.lastMessage) {
        return 1;
      } else {
        const categoryOrder: Record<string, number> = { "학교": 0, "교수": 1, "그룹": 2, "학생": 3, "기능형": 4 };
        return (categoryOrder[a.category] ?? 5) - (categoryOrder[b.category] ?? 5);
      }
    });
  }, [agents, conversations, debouncedSearchQuery, selectedCategory]);

  const handleLogout = useCallback(async (e?: React.MouseEvent) => {
    console.log('[HOME] 로그아웃 버튼 클릭됨');
    
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // 드롭다운 닫기
    setSettingsDropdownOpen(false);
    
    console.log('[HOME] performLogout 호출 시작');
    try {
      await performLogout();
      console.log('[HOME] performLogout 완료');
    } catch (error) {
      console.error('[HOME] performLogout 에러:', error);
    }
  }, []);

  // 헤더 높이 동적 측정
  useEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        const height = headerRef.current.offsetHeight;
        setHeaderHeight(height);
      }
    };

    // 초기 측정
    updateHeaderHeight();

    // 리사이즈 이벤트 감지
    window.addEventListener('resize', updateHeaderHeight);
    
    // 탭 변경 시에도 측정 (탭 바 유무로 높이 변경 가능)
    const timer = setTimeout(updateHeaderHeight, 100);

    return () => {
      window.removeEventListener('resize', updateHeaderHeight);
      clearTimeout(timer);
    };
  }, [activeTab, user]); // activeTab과 user 변경 시 재측정

  // 관리자 여부 확인 (TokenGaugeBar 표시 여부와 동일)
  const isAdmin = user?.role === 'master_admin' || user?.role === 'operation_admin' || user?.role === 'agent_admin';

  return (
    <div className="h-screen md:min-h-screen md:w-full bg-white flex flex-col overflow-hidden md:overflow-visible">
      {/* Minimal Flat UI Header */}
      <header ref={headerRef} className={`fixed ${isAdmin ? 'top-12 md:top-10' : 'top-0'} left-0 right-0 z-50 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 md:static md:border-none flex-shrink-0`}>
        <div className="px-4 py-3 md:px-6 md:py-4">
          {/* Header with search and settings */}
          <div className="flex items-center mb-4 md:mb-6 gap-2 md:gap-3">
            {/* Search Bar */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={t('home:searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-10 pr-3 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent korean-text"
              />
            </div>

            {/* Category Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-10 px-3 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-1 korean-text flex-shrink-0">
                  {selectedCategory === "전체" ? t('home:categories.all') :
                   selectedCategory === "학교" ? t('home:categories.school') :
                   selectedCategory === "교수" ? t('home:categories.professor') :
                   selectedCategory === "학생" ? t('home:categories.student') :
                   selectedCategory === "그룹" ? t('home:categories.group') :
                   selectedCategory === "기능형" ? t('home:categories.function') :
                   selectedCategory} 
                  <ChevronDown className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32 z-[99999]" sideOffset={5}>
                {categories.map((category) => (
                  <DropdownMenuItem
                    key={category.value}
                    className="korean-text cursor-pointer"
                    onClick={() => setSelectedCategory(category.value)}
                  >
                    {category.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 그룹 채팅 생성 버튼 - 검은 말풍선 + 흰색 플러스 아이콘 */}
            <div className="relative group flex-shrink-0">
              <Link href="/create-group-chat">
                <button className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center transition-all duration-200 flex-shrink-0 relative shadow-sm hover:shadow-md">
                  {/* 말풍선 모양 */}
                  <div className="relative">
                    {/* 메인 말풍선 타원 영역 */}
                    <div className="w-7 h-5 md:w-8 md:h-6 bg-black hover:bg-gray-800 dark:bg-black dark:hover:bg-gray-800 rounded-full flex items-center justify-center relative transition-colors duration-200">
                      {/* 흰색 + 아이콘 */}
                      <Plus className="w-3 h-3 md:w-4 md:h-4 text-white stroke-[3]" />
                    </div>
                    {/* 말풍선 꼬리 (삼각형) */}
                    <div className="absolute -bottom-1 left-2 md:left-2.5">
                      <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-black group-hover:border-t-gray-800 dark:border-t-black dark:group-hover:border-t-gray-800 transition-colors duration-200"></div>
                    </div>
                  </div>
                </button>
              </Link>
              {/* PC에서 툴팁 */}
              <div className="hidden md:block absolute top-full mt-2 left-1/2 transform -translate-x-1/2 bg-gray-900 dark:bg-gray-700 text-white text-xs px-3 py-2 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50 shadow-lg">
                {t('home:createGroupChatTooltip')}
                <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
              </div>
            </div>
            
            {/* Settings Dropdown */}
            <DropdownMenu open={settingsDropdownOpen} onOpenChange={setSettingsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <button className="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0">
                  <Settings className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent 
                align="end" 
                className="w-48 z-[99999] fixed-dropdown-position" 
                sideOffset={5}
                avoidCollisions={false}
                side="bottom"
                alignOffset={-10}
              >
                <DropdownMenuItem
                  className="korean-text cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setSettingsDropdownOpen(false);
                    setShowAccountModal(true);
                  }}
                >
                  <User className="w-4 h-4 mr-2" />
                  {t('home:accountSettings')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="korean-text cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setSettingsDropdownOpen(false);
                    sessionStorage.setItem('previousPath', location);
                    setLocation('/personalization');
                  }}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  개인화 설정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="korean-text cursor-pointer"
                  onSelect={(e) => {
                    console.log('[DROPDOWN] 로그아웃 메뉴 선택됨');
                    handleLogout();
                  }}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  {t('common.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tab Navigation - Show if user has management privileges or is agent_admin/master_admin */}
          {(user?.role === 'agent_admin' || user?.role === 'master_admin' || user?.userType === 'agent_admin' || user?.userType === 'master_admin') && (
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              <button 
                className={`flex-1 py-3 text-sm font-medium transition-colors relative korean-text ${
                  activeTab === "chat" 
                    ? "text-blue-600 dark:text-blue-500" 
                    : "text-gray-500 dark:text-gray-400"
                }`}
                onClick={() => setActiveTab("chat")}
              >
                {t('home:tabs.chat')}
                {activeTab === "chat" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-500"></div>
                )}
              </button>
              <button 
                className={`flex-1 py-3 text-sm font-medium transition-colors relative korean-text ${
                  activeTab === "management" 
                    ? "text-blue-600 dark:text-blue-500" 
                    : "text-gray-500 dark:text-gray-400"
                }`}
                onClick={() => setActiveTab("management")}
              >
                운영
                {activeTab === "management" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-500"></div>
                )}
              </button>
              <button 
                className={`flex-1 py-3 text-sm font-medium transition-colors relative korean-text ${
                  activeTab === "card" 
                    ? "text-blue-600 dark:text-blue-500" 
                    : "text-gray-500 dark:text-gray-400"
                }`}
                onClick={() => {
                  if (activeTab === "card") {
                    // 이미 카드 탭이 선택된 상태에서 다시 클릭하면 편집 화면으로 이동
                    setLocation("/card-layout-editor");
                  } else {
                    setActiveTab("card");
                  }
                }}
              >
                카드
                {activeTab === "card" && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-500"></div>
                )}
              </button>
            </div>
          )}
          

        </div>
      </header>

      {/* Content */}
      <main 
        className="flex-1 main-content md:pt-0 overflow-y-auto min-h-0"
        style={{ paddingTop: isAdmin ? `${headerHeight + 48}px` : `${headerHeight}px` }}
      >
        {activeTab === "chat" && (
          <div className="agent-list-container">
            {/* 통합 대화방 목록 제목 */}
            <div className="px-4 mb-1 mt-2 md:mt-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 md:text-xl">{t('home:chatRooms')}</h2>
                <Link href="/create-group-chat" className="hidden md:inline-flex text-sm text-blue-500 hover:text-blue-600 font-medium bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 px-3 py-1.5 rounded-lg transition-colors">
                  {t('home:createGroupChat')}
                </Link>
              </div>
              {((Array.isArray(groupChats) && groupChats.length > 0) || (Array.isArray(filteredAgents) && filteredAgents.length > 0)) && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 md:text-base">
                  {Array.isArray(groupChats) && groupChats.length > 0 && t('home:groupChatCount', { count: groupChats.length })}
                  {Array.isArray(groupChats) && groupChats.length > 0 && Array.isArray(filteredAgents) && filteredAgents.length > 0 && ' · '}
                  {Array.isArray(filteredAgents) && filteredAgents.length > 0 && t('home:agentCount', { count: filteredAgents.length })}
                </p>
              )}
            </div>
            <AgentList 
              agents={filteredAgents as any} 
              conversations={conversations as any}
              groupChats={groupChats as any}
              searchQuery={debouncedSearchQuery}
            />
          </div>
        )}
        {activeTab === "management" && (
          <div className="h-full overflow-y-auto">
            <div className="px-4 py-6 space-y-6 max-w-2xl mx-auto">
              {/* 에이전트 관리 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">에이전트 관리</h2>
                <Link href="/agent-management">
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all cursor-pointer flex items-center justify-between shadow-sm hover:shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                        <User className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">에이전트 관리</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">이름, 관계, 언어, 관심 등</p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  </div>
                </Link>
              </div>

              {/* 회원 관리 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">회원 관리</h2>
                <Link href="/master-admin?tab=users">
                  <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all cursor-pointer flex items-center justify-between shadow-sm hover:shadow-md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                        <Users className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">회원 신청 관리</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">가입 신청 승인 및 차단</p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  </div>
                </Link>
              </div>

              {/* 고민 및 질문 분석 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">고민 및 질문 분석</h2>
                <Link href="/conversation-analytics">
                  <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all cursor-pointer shadow-sm hover:shadow-md overflow-hidden">
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                          <Activity className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">고민 및 질문 분석</h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">고민 / 질문 / 연애 / 지역 / 상병 데이터 분석</p>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </div>
                    
                    {/* 최종 분석 정보 표시 */}
                    {analyticsData?.analytics && analyticsData.analytics.length > 0 && (
                      <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 bg-gray-50/50 dark:bg-gray-900/30">
                        {(() => {
                          const analytics = analyticsData.analytics;
                          
                          // 마지막 분석 날짜 찾기
                          const latestAnalysis = analytics.reduce((latest: any, current: any) => {
                            const latestDate = new Date(latest.updatedAt);
                            const currentDate = new Date(current.updatedAt);
                            return currentDate > latestDate ? current : latest;
                          });
                          
                          const analysisDate = new Date(latestAnalysis.updatedAt);
                          const formattedDate = `${analysisDate.getFullYear()}.${String(analysisDate.getMonth() + 1).padStart(2, '0')}.${String(analysisDate.getDate()).padStart(2, '0')}`;
                          
                          // 대화방 수 계산
                          const conversationCount = new Set(analytics.map((a: any) => a.conversationId)).size;
                          
                          // 전체 카테고리 데이터 합산
                          const totalCategories = analytics.reduce((acc: any, item: any) => {
                            Object.entries(item.categoryData).forEach(([key, value]) => {
                              acc[key] = (acc[key] || 0) + (value as number);
                            });
                            return acc;
                          }, {});
                          
                          // 상위 3개 카테고리 찾기
                          const topCategories = Object.entries(totalCategories)
                            .sort(([, a], [, b]) => (b as number) - (a as number))
                            .slice(0, 3)
                            .map(([key]) => key);
                          
                          return (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 dark:text-gray-400">📅 최종 분석</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{formattedDate}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 dark:text-gray-400">💬 분석 대화방</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{conversationCount}개</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 dark:text-gray-400">🔥 주요 카테고리</span>
                                <span className="font-medium text-gray-700 dark:text-gray-300">{topCategories.join(', ')}</span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </Link>
              </div>

              {/* 앱 설정 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">앱 설정</h2>
                <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center">
                      <Bell className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">알림 설정</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">푸시 알림 및 이메일 설정</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">준비중</span>
                </div>
              </div>

              {/* 커뮤니티 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">커뮤니티</h2>
                <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-pink-50 dark:bg-pink-900/20 flex items-center justify-center">
                      <Heart className="w-5 h-5 text-pink-600 dark:text-pink-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">익명 고민 상담</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">교인들의 익명 고민 확인 및 답변</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">준비중</span>
                </div>
              </div>

              {/* 결제 섹션 */}
              <div className="space-y-2">
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">결제</h2>
                <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                      <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">결제 관리</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">헌금 내역 및 결제 수단 관리</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">준비중</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === "card" && (
          <CardHome hideHeader={true} />
        )}
      </main>

      {/* Account Settings Modal */}
      <AccountSettingsModal 
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
      />
    </div>
  );
}

export default Home;