import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link, useParams } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import AgentList from "@/components/AgentList";
import ChatInterface from "@/components/ChatInterface";
import AgentManagement from "@/pages/AgentManagement";
import GroupChat from "@/pages/GroupChat";
import CreateGroupChat from "@/pages/CreateGroupChat";
import ChatSettings from "@/pages/ChatSettings";
import UserManagement from "@/pages/UserManagement";
import PersonalizationSettings from "@/pages/PersonalizationSettings";
import ConversationAnalytics from "@/pages/ConversationAnalytics";
import CardHome from "@/pages/CardHome";
import CardLayoutEditor from "@/pages/CardLayoutEditor";
import BoardPostDetail from "@/pages/BoardPostDetail";
import BoardPostForm from "@/pages/BoardPostForm";
import BoardDetail from "@/pages/BoardDetail";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { performLogout } from "@/lib/logout";

import { LanguageSelector } from "@/components/LanguageSelector";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { useLanguage } from "@/contexts/LanguageContext";
import IconChangeModal from "@/components/IconChangeModal";
import MasterAdmin from "@/pages/MasterAdmin";
import { Search, ChevronDown, LogOut, Settings, GraduationCap, Code, Bot, User, FlaskRound, Map, Languages, Dumbbell, Database, Lightbulb, Heart, Calendar, Pen, FileText, Files, Edit, Bell, BarChart3, MessageCircle, Plus, Users, CreditCard, Activity, FolderPlus, ArrowLeft, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useMutation } from "@tanstack/react-query";
import type { Agent, Conversation } from "@/types/agent";
import { eventBus, EVENTS } from "@/utils/eventBus";

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
  "bg-gray-600": "bg-gray-600",
  "bg-red-600": "bg-red-600",
  "bg-orange-600": "bg-orange-600",
  "bg-amber-600": "bg-amber-600",
  "bg-yellow-600": "bg-yellow-600",
  "bg-lime-600": "bg-lime-600",
  "bg-green-600": "bg-green-600",
  "bg-emerald-600": "bg-emerald-600",
  "bg-teal-600": "bg-teal-600",
  "bg-cyan-600": "bg-cyan-600",
  "bg-sky-600": "bg-sky-600",
  "bg-blue-600": "bg-blue-600",
  "bg-indigo-600": "bg-indigo-600",
  "bg-violet-600": "bg-violet-600",
  "bg-purple-600": "bg-purple-600",
  "bg-fuchsia-600": "bg-fuchsia-600",
  "bg-pink-600": "bg-pink-600",
  "bg-rose-600": "bg-rose-600",
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

function TabletLayout() {
  const [location, navigate] = useLocation();
  const params = useParams<{ agentId?: string; groupChatId?: string }>();
  const [activeTab, setActiveTab] = useState<"chat" | "management" | "card">("card");
  const [selectedManagementMenu, setSelectedManagementMenu] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [isCardEditMode, setIsCardEditMode] = useState(false);
  const [cardEditTrigger, setCardEditTrigger] = useState<'folder' | 'card' | 'save' | null>(null);
  const [currentCardFolderId, setCurrentCardFolderId] = useState<number | null>(null);
  const [showCreateGroupChat, setShowCreateGroupChat] = useState(false);
  const [pendingCardForChat, setPendingCardForChat] = useState<{ chatRoomId: number; chatRoomTitle: string } | null>(null);
  const { t} = useLanguage();
  const { toast } = useToast();

  const { data: user } = useQuery<any>({ queryKey: ["/api/user"] });
  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: managedAgents = [], isLoading: managedAgentsLoading } = useQuery<Agent[]>({ 
    queryKey: ["/api/agents/managed"],
    enabled: activeTab === "management"
  });
  const { data: conversations = [] } = useQuery<(Conversation & { agent: Agent; lastMessage?: any })[]>({ queryKey: ["/api/conversations"] });
  const { data: groupChats = [] } = useQuery<any[]>({ queryKey: ["/api/group-chats"] });
  
  // 그룹 채팅방 조회 기록 조회 (firstViewedAt 체크용)
  const { data: groupChatViews = [] } = useQuery<Array<{ groupChatId: number; firstViewedAt: string }>>({
    queryKey: ["/api/group-chat-views"],
    enabled: !!user,
  });

  // Use different agent lists based on active tab
  const activeAgents = activeTab === "management" ? managedAgents : agents;
  
  // 그룹 채팅방이 새로운지 확인하는 헬퍼 함수
  const isGroupChatNew = (groupChatId: number): boolean => {
    const view = groupChatViews.find(v => v.groupChatId === groupChatId);
    return !view || !view.firstViewedAt;
  };
  
  // Filter agents based on search and category
  const filteredAgents = activeAgents.filter((agent: Agent) => {
    const matchesSearch = searchQuery === "" || 
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === "전체" || agent.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Combined and sorted chats (groups + individual)
  const sortedCombinedChats = useMemo(() => {
    const allChats: Array<{
      type: 'group' | 'individual';
      id: number;
      title: string;
      lastMessageAt?: string;
      agent?: any;
      groupChat?: any;
    }> = [];

    // Add group chats (always show regardless of tab)
    groupChats.forEach((groupChat: any) => {
      allChats.push({
        type: 'group',
        id: groupChat.id,
        title: groupChat.title,
        lastMessageAt: groupChat.lastMessageAt,
        groupChat
      });
    });

    // Add individual agent conversations
    filteredAgents.forEach(agent => {
      const conversation = conversations.find(conv => conv.agentId === agent.id);
      allChats.push({
        type: 'individual',
        id: agent.id,
        title: agent.name,
        lastMessageAt: conversation?.lastMessageAt,
        agent
      });
    });

    // Sort by recent activity
    return allChats.sort((a, b) => {
      const hasRecentA = a.lastMessageAt;
      const hasRecentB = b.lastMessageAt;
      
      if (hasRecentA && hasRecentB) {
        const timeA = new Date(a.lastMessageAt!).getTime();
        const timeB = new Date(b.lastMessageAt!).getTime();
        return timeB - timeA;
      } else if (hasRecentA && !hasRecentB) {
        return -1;
      } else if (!hasRecentA && hasRecentB) {
        return 1;
      } else {
        if (a.type === 'group' && b.type === 'individual') return -1;
        if (a.type === 'individual' && b.type === 'group') return 1;
        return a.title.localeCompare(b.title);
      }
    });
  }, [filteredAgents, groupChats, conversations, activeTab]);

  // Listen for folder edit events
  useEffect(() => {
    const handleEditCardFolder = (folderId: number | null) => {
      console.log('[TabletLayout] EDIT_CARD_FOLDER 이벤트 받음, folderId:', folderId);
      setCurrentCardFolderId(folderId);
      setIsCardEditMode(true);
      setActiveTab("card");
    };

    console.log('[TabletLayout] EDIT_CARD_FOLDER 리스너 등록');
    eventBus.on(EVENTS.EDIT_CARD_FOLDER, handleEditCardFolder);
    return () => {
      console.log('[TabletLayout] EDIT_CARD_FOLDER 리스너 해제');
      eventBus.off(EVENTS.EDIT_CARD_FOLDER, handleEditCardFolder);
    };
  }, []);

  // 편집 모드 종료 핸들러
  const exitCardEditMode = () => {
    setIsCardEditMode(false);
    setCurrentCardFolderId(null);
  };

  const categories = [
    { value: "전체", label: t('home.categories.all') },
    { value: "학교", label: t('home.categories.school') },
    { value: "교수", label: t('home.categories.professor') },
    { value: "학생", label: t('home.categories.student') },
    { value: "그룹", label: t('home.categories.group') },
    { value: "기능형", label: t('home.categories.function') },
  ];

  const handleLogout = useCallback(async () => {
    console.log('[TABLET] 로그아웃 버튼 클릭됨');
    try {
      await performLogout();
      console.log('[TABLET] performLogout 완료');
    } catch (error) {
      console.error('[TABLET] performLogout 에러:', error);
    }
  }, []);

  // URL에서 agentId 추출
  useEffect(() => {
    // 운영 메뉴 관련 라우트 (activeTab을 변경하지 않음)
    const managementRoutes = [
      '/conversation-analytics',
      '/agent-management',
      '/user-management',
      '/master-admin',
      '/personalization',
    ];
    
    // 운영 메뉴 관련 라우트는 activeTab을 변경하지 않음
    if (managementRoutes.includes(location)) {
      return;
    }
    
    if (location.startsWith("/chat/") || location.startsWith("/management/") || location.startsWith("/group-chat/")) {
      const parts = location.split("/");
      const agentId = parseInt(parts[2]);
      if (!isNaN(agentId)) {
        setSelectedAgentId(agentId);
        if (location.startsWith("/management/")) {
          setActiveTab("management");
        } else if (activeTab !== "card") {
          // 카드 탭에서 채팅방으로 이동하는 경우 카드 탭 유지
          setActiveTab("chat");
        }
      }
    } else {
      setSelectedAgentId(null);
      if (location === "/management") {
        setActiveTab("management");
      } else if (location === "/") {
        // 홈 경로는 카드 탭으로 (이미 설정되어 있을 것)
        // activeTab을 변경하지 않음
      } else if (activeTab !== "card") {
        setActiveTab("chat");
      }
    }
  }, [location, activeTab]);

  // 카드 홈에서 운영 탭 메뉴 클릭 이벤트 처리
  useEffect(() => {
    const handleNavigateToManagement = (data: { menu: string; route: string }) => {
      // 카드 탭에서 클릭한 경우 activeTab은 변경하지 않음
      // 단지 selectedManagementMenu만 설정하여 오른쪽 패널에 표시
      setSelectedManagementMenu(data.menu);
      navigate(data.route);
    };

    eventBus.on(EVENTS.NAVIGATE_TO_MANAGEMENT, handleNavigateToManagement);

    return () => {
      eventBus.off(EVENTS.NAVIGATE_TO_MANAGEMENT, handleNavigateToManagement);
    };
  }, [navigate]);

  const selectedAgent = selectedAgentId ? activeAgents.find(agent => agent.id === selectedAgentId) : null;

  const handleAgentSelect = (agentId: number) => {
    console.log('[TabletLayout] handleAgentSelect called with agentId:', agentId, 'activeTab:', activeTab);
    setSelectedAgentId(agentId);
    const path = activeTab === "management" ? `/management/${agentId}` : `/chat/${agentId}`;
    console.log('[TabletLayout] Navigating to:', path);
    navigate(path);
  };

  if (agentsLoading || (activeTab === "management" && managedAgentsLoading)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center korean-text">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const isAdmin = user?.role === 'master_admin' || user?.role === 'operation_admin' || user?.role === 'agent_admin';

  return (
    <div className="h-screen bg-background">
      <PanelGroup direction="horizontal">
        {/* Left Panel - Agent List */}
        <Panel defaultSize={45} minSize={45} maxSize={45}>
          <div className={`h-full border-r border-border bg-muted/50 flex flex-col ${isAdmin ? 'pt-12 md:pt-10' : ''}`}>
            <div className="p-4 border-b border-border">
              {/* 카드편집 모드일 때 헤더 표시 */}
              {activeTab === "card" && isCardEditMode && (
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    편집
                  </h1>
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setShowCreateGroupChat(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      채팅방
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => navigate('/boards/new')}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      게시판
                    </Button>
                    <Button size="sm" variant="outline" onClick={exitCardEditMode}>
                      취소
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => setCardEditTrigger('save')}
                    >
                      저장
                    </Button>
                    <Button size="sm" onClick={exitCardEditMode}>
                      완료
                    </Button>
                  </div>
                </div>
              )}
              
              {/* 카드편집 모드가 아닐 때만 검색 영역 표시 */}
              {!(activeTab === "card" && isCardEditMode) && (
                <div className="flex items-center gap-2 mb-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      type="text"
                      placeholder={t('home.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-muted border-none korean-text h-11 w-full pl-10 pr-3"
                    />
                  </div>
                
                {/* Category Filter */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-11 px-4 text-sm korean-text flex-shrink-0">
                      {selectedCategory === "전체" ? t('home.categories.all') :
                       selectedCategory === "학교" ? t('home.categories.school') :
                       selectedCategory === "교수" ? t('home.categories.professor') :
                       selectedCategory === "학생" ? t('home.categories.student') :
                       selectedCategory === "그룹" ? t('home.categories.group') :
                       selectedCategory === "기능형" ? t('home.categories.function') :
                       selectedCategory} <ChevronDown className="ml-1 w-3 h-3" />
                    </Button>
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
                
                {/* Group Chat Creation Button */}
                <Link href="/create-group-chat">
                  <Button
                    size="sm"
                    className="w-11 h-11 p-0 bg-black hover:bg-gray-800 rounded-full flex-shrink-0"
                  >
                    <Plus className="w-4 h-4 text-white" />
                  </Button>
                </Link>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="korean-text h-11 px-4 flex-shrink-0">
                      <Settings className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 z-[99999]" sideOffset={5}>
                    <DropdownMenuItem
                      className="korean-text cursor-pointer"
                      onClick={() => setShowAccountModal(true)}
                    >
                      <User className="mr-2 h-4 w-4" />
                      {t('home.accountSettings')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="korean-text cursor-pointer"
                      onClick={() => {
                        sessionStorage.setItem('previousPath', location);
                        navigate('/personalization');
                      }}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      개인화 설정
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="korean-text cursor-pointer"
                      onSelect={(e) => {
                        console.log('[TABLET-DROPDOWN] 로그아웃 메뉴 선택됨');
                        handleLogout();
                      }}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      {t('common.logout')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              )}
              
              {/* 카드편집 모드가 아닐 때만 탭 표시 */}
              {(user?.role === 'agent_admin' || user?.role === 'master_admin') && !(activeTab === "card" && isCardEditMode) && (
                <div className="apple-nav-tabs">
                  <div 
                    className={`apple-nav-tab ${activeTab === "chat" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("chat");
                      navigate("/");
                    }}
                  >
                    {t('agent.chat')}
                  </div>
                  <div 
                    className={`apple-nav-tab ${activeTab === "management" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("management");
                      setSelectedManagementMenu(null);
                      navigate("/management");
                    }}
                  >
                    운영
                  </div>
                  <div 
                    className={`apple-nav-tab ${activeTab === "card" ? "active" : ""}`}
                    onClick={() => {
                      if (activeTab === "card") {
                        if (isCardEditMode) {
                          exitCardEditMode();
                        } else {
                          setIsCardEditMode(true);
                        }
                      } else {
                        setActiveTab("card");
                        exitCardEditMode();
                        navigate("/");
                      }
                    }}
                  >
                    {activeTab === "card" && isCardEditMode ? "카드편집" : "카드"}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {activeTab === "card" ? (
                // Card Home or Edit mode in left panel
                isCardEditMode ? (
                  <CardLayoutEditor 
                    isDesktopMode={true}
                    onExitEdit={exitCardEditMode}
                    trigger={cardEditTrigger}
                    onTriggerComplete={() => setCardEditTrigger(null)}
                    initialFolderId={currentCardFolderId}
                    pendingCardForChat={pendingCardForChat}
                    onPendingCardProcessed={() => setPendingCardForChat(null)}
                  />
                ) : (
                  <CardHome 
                    isDesktopMode={true}
                    externalFolderId={currentCardFolderId}
                    onFolderChange={(folderId) => setCurrentCardFolderId(folderId)}
                    onBack={() => {
                      // 데스크탑 모드에서 폴더 뒤로가기: 상위 폴더로 이동
                      console.log('[TabletLayout] 폴더 뒤로가기:', currentCardFolderId);
                      setCurrentCardFolderId(null);
                    }}
                  />
                )
              ) : activeTab === "management" ? (
                // Management menu list in left panel
                <div className="p-3 space-y-2">
                  {/* 에이전트 관리 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 font-medium">에이전트 관리</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedManagementMenu('agents')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <User className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">에이전트 관리</div>
                      <div className="text-sm text-muted-foreground korean-text">이름, 관계, 언어, 관계 등</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* 회원 관리 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 pt-2 font-medium">회원 관리</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors relative"
                    onClick={() => setSelectedManagementMenu('users')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <Users className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">회원 신청 관리</div>
                      <div className="text-sm text-muted-foreground korean-text">가입 신청 승인 및 차단</div>
                    </div>
                    <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[18px] h-[18px] flex items-center justify-center flex-shrink-0 mr-2">3</span>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* 고민 및 질문 분석 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 pt-2 font-medium">고민 및 질문 분석</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedManagementMenu('analytics')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <Activity className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">고민 및 질문 분석</div>
                      <div className="text-sm text-muted-foreground korean-text">고민 / 질문 / 연애 / 지역 / 상병 데이터 분석</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* 앱 설정 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 pt-2 font-medium">앱 설정</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedManagementMenu('notifications')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <Bell className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">알림 설정</div>
                      <div className="text-sm text-muted-foreground korean-text">푸시 알림 및 이메일 설정</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* 커뮤니티 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 pt-2 font-medium">커뮤니티</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedManagementMenu('community')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <MessageCircle className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">익명 고민 상담</div>
                      <div className="text-sm text-muted-foreground korean-text">교인들의 익명 고민 확인 및 답변</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* 결제 섹션 */}
                  <div className="text-xs text-gray-500 dark:text-gray-400 px-2 pb-1 pt-2 font-medium">결제</div>
                  <div 
                    className="flex items-start p-3 rounded-2xl bg-card hover:bg-blue-100 dark:hover:bg-blue-800 cursor-pointer transition-colors"
                    onClick={() => setSelectedManagementMenu('payments')}
                  >
                    <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 mr-3">
                      <CreditCard className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground korean-text">결제 관리</div>
                      <div className="text-sm text-muted-foreground korean-text">헌금 내역 및 결제 수단 관리</div>
                    </div>
                    <svg className="w-5 h-5 text-gray-400 flex-shrink-0 ml-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              ) : (
                // Chat list in left panel
                <div className="p-3 space-y-1.5">
                {sortedCombinedChats.map((chat) => {
                    if (chat.type === 'group') {
                      // Group chat rendering
                      // Extract groupChatId from location
                      const match = location.match(/^\/group-chat\/(\d+)/);
                      const currentGroupChatId = match ? parseInt(match[1]) : null;
                      const isSelectedGroup = currentGroupChatId === chat.id;
                      
                      return (
                        <Link key={`group-${chat.id}`} href={`/group-chat/${chat.id}`} className="block w-full">
                          <div className={`relative rounded-2xl p-2.5 transition-all cursor-pointer min-h-[60px] ${
                            isSelectedGroup 
                              ? 'bg-blue-200 dark:bg-blue-700' 
                              : 'bg-card hover:bg-blue-100 dark:hover:bg-blue-800'
                          }`}>
                            <div className="flex items-center space-x-3">
                              <div className="w-11 h-11 bg-purple-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                                <Users className="text-white w-6 h-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center space-x-2">
                                    <h3 className="font-medium text-foreground truncate korean-text chat-list-title">
                                      {chat.title}
                                    </h3>
                                    {isGroupChatNew(chat.id) && (
                                      <span className="px-2 py-0.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-xs font-bold shadow-lg" style={{ borderRadius: '4px' }}>
                                        NEW
                                      </span>
                                    )}
                                  </div>
                                  {chat.lastMessageAt && (
                                    <span className="text-xs text-muted-foreground korean-text">
                                      {formatDistanceToNow(new Date(chat.lastMessageAt), { 
                                        addSuffix: true, 
                                        locale: ko 
                                      })}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between space-x-2">
                                  <p className="text-sm text-muted-foreground truncate korean-text chat-list-preview flex-1">
                                    {chat.groupChat?.lastMessage || "새로운 대화를 시작해보세요"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    } else {
                      // Individual agent rendering
                      const agent = chat.agent;
                      const conversation = conversations.find(conv => conv.agentId === agent.id);
                      const isSelected = selectedAgentId === agent.id;
                    
                      return (
                        <div
                          key={agent.id}
                          onClick={() => handleAgentSelect(agent.id)}
                          className={`relative bg-card rounded-2xl p-2.5 transition-all cursor-pointer  min-h-[60px] ${
                            isSelected ? 'bg-blue-200 dark:bg-blue-700' : 'hover:bg-blue-100 dark:hover:bg-blue-800'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div 
                              className={`w-11 h-11 ${backgroundColorMap[agent.backgroundColor] || "bg-gray-600"} rounded-2xl flex items-center justify-center flex-shrink-0 overflow-hidden`}
                            >
                              {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                                <img 
                                  src={agent.icon} 
                                  alt={`${agent.name} icon`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : (
                                (() => {
                                  const IconComponent = iconMap[agent.icon] || User;
                                  return <IconComponent className="text-white w-6 h-6" />;
                                })()
                              )}
                              {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) && (
                                (() => {
                                  const IconComponent = iconMap[agent.icon] || User;
                                  return <IconComponent className="text-white w-6 h-6 hidden" />;
                                })()
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center space-x-2">
                                  <h3 className="font-medium text-foreground truncate korean-text chat-list-title">
                                    {agent.name}
                                  </h3>
                                  <span className={getCategoryBadgeStyle(agent.category)}>
                                    {agent.category}
                                  </span>
                                </div>
                                {conversation?.lastMessageAt && (
                                  <span className="text-xs text-muted-foreground korean-text">
                                    {formatDistanceToNow(new Date(conversation.lastMessageAt), { 
                                      addSuffix: true, 
                                      locale: ko 
                                    })}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center justify-between space-x-2">
                                <p className="text-sm text-muted-foreground truncate korean-text chat-list-preview flex-1">
                                  {conversation?.lastMessage?.content || agent.description}
                                </p>
                                {conversation && conversation.unreadCount > 0 && (
                                  <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 min-w-[18px] h-[18px] flex items-center justify-center ml-2 flex-shrink-0 shadow-lg border-2 border-white dark:border-gray-800">{conversation.unreadCount}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
          </div>
        </Panel>
        
        <PanelResizeHandle className="w-2 bg-border hover:bg-border/80 transition-colors cursor-col-resize flex items-center justify-center group">
          <div className="w-0.5 h-6 bg-border/60 group-hover:bg-border transition-colors rounded-full"></div>
        </PanelResizeHandle>
        
        {/* Right Panel - Chat Interface */}
        <Panel defaultSize={55} minSize={55} maxSize={55}>
          <div className="h-full bg-white">
            {(() => {
              // Show CreateGroupChat in right panel if triggered from card editor
              if (showCreateGroupChat && isCardEditMode) {
                return <CreateGroupChat 
                  onBack={() => setShowCreateGroupChat(false)}
                  onCreateWithCard={(chatRoomId) => {
                    // 채팅방 정보 조회
                    fetch(`/api/group-chats/${chatRoomId}`)
                      .then(res => res.json())
                      .then(chatRoom => {
                        setShowCreateGroupChat(false);
                        setPendingCardForChat({
                          chatRoomId: chatRoomId,
                          chatRoomTitle: chatRoom.title || '새 채팅방'
                        });
                      })
                      .catch(err => {
                        console.error('Failed to fetch chat room:', err);
                        setShowCreateGroupChat(false);
                        setPendingCardForChat({
                          chatRoomId: chatRoomId,
                          chatRoomTitle: '새 채팅방'
                        });
                      });
                  }}
                />;
              }
              // More specific routes first
              if (location === "/conversation-analytics") {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><ConversationAnalytics /></div>;
              }
              if (location === "/personalization") {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><PersonalizationSettings /></div>;
              }
              if (location === "/create-group-chat") {
                return <CreateGroupChat />;
              }
              if (location === "/agent-management") {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><AgentManagement isOperationsMode={true} /></div>;
              }
              // Board routes (check these before other routes)
              if (location.match(/\/boards\/posts\/\d+\/edit$/)) {
                const match = location.match(/\/boards\/posts\/(\d+)\/edit$/);
                const postId = match ? match[1] : undefined;
                return <BoardPostForm />;
              }
              if (location.match(/\/boards\/posts\/\d+$/)) {
                const match = location.match(/\/boards\/posts\/(\d+)$/);
                const postId = match ? match[1] : undefined;
                return <BoardPostDetail />;
              }
              if (location.match(/\/boards\/\d+$/)) {
                const match = location.match(/\/boards\/(\d+)$/);
                const boardId = match ? match[1] : undefined;
                return <BoardDetail />;
              }
              // Group chat sub-routes (check these before main group chat route)
              if (location.match(/\/group-chat\/\d+\/agents$/)) {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><AgentManagement /></div>;
              }
              if (location.match(/\/group-chat\/\d+\/settings$/)) {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><ChatSettings /></div>;
              }
              if (location.match(/\/group-chat\/\d+\/members$/)) {
                return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><UserManagement /></div>;
              }
              // Main group chat route
              if (location.match(/\/group-chat\/\d+$/)) {
                const match = location.match(/\/group-chat\/(\d+)$/);
                const groupChatId = match ? match[1] : undefined;
                return <GroupChat groupChatId={groupChatId} />;
              }
              // Management menu selected - show management page (regardless of activeTab)
              if (selectedManagementMenu) {
                if (selectedManagementMenu === 'agents') {
                  return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><AgentManagement isOperationsMode={true} /></div>;
                } else if (selectedManagementMenu === 'analytics') {
                  return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><ConversationAnalytics /></div>;
                } else {
                  return <div className={`h-full ${isAdmin ? 'pt-12 md:pt-10' : ''}`}><MasterAdmin initialTab={selectedManagementMenu} /></div>;
                }
              }
              if (selectedAgent) {
                return activeTab === "chat" ? (
                  <ChatInterface agent={selectedAgent} isManagementMode={false} />
                ) : (
                  <ChatInterface agent={selectedAgent} isManagementMode={true} />
                );
              }
              // Management tab - show placeholder when no menu selected
              if (activeTab === "management") {
                return (
                  <div className="flex items-center justify-center h-full bg-white dark:bg-gray-900">
                    <div className="text-center korean-text max-w-md mx-auto px-4">
                      <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Settings className="text-white w-10 h-10" />
                      </div>
                      <h3 className="text-xl font-medium text-foreground mb-3">
                        관리 메뉴를 선택하세요
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        왼쪽에서 관리하고 싶은 메뉴를 선택하면<br />
                        상세 내용이 이곳에 표시됩니다.
                      </p>
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center korean-text max-w-md mx-auto">
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Settings className="text-white w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-medium text-foreground mb-3 text-center">
                      {t('home.selectAgent')}
                    </h3>
                    <p className="text-muted-foreground text-center leading-relaxed">
                      {t('home.selectAgentDesc')}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        </Panel>
      </PanelGroup>

      <AccountSettingsModal 
        isOpen={showAccountModal} 
        onClose={() => setShowAccountModal(false)} 
      />
    </div>
  );
}

export default TabletLayout;