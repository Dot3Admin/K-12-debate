import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { 
  ArrowLeft, Plus, Settings, MessageCircle, Folder, Link as LinkIcon,
  Home, Bell, Star, Heart, Mail, Phone, Calendar, Camera, Image, Music,
  Video, Book, FileText, Code, Database, Cloud, Lock, User, UserPlus,
  Clock, Check, Download, Upload, Share2, Users, MessageSquare, Search, ChevronDown, LogOut, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { CardItem, CardFolder } from "@shared/schema";
import { eventBus, EVENTS } from "@/utils/eventBus";
import BoardCard from "@/components/BoardCard";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { apiRequest } from "@/lib/queryClient";
import { performLogout } from "@/lib/logout";

interface CardHomeProps {
  isEditMode?: boolean;
  isDesktopMode?: boolean;
  externalFolderId?: number | null;
  onFolderChange?: (folderId: number | null) => void;
  onBack?: () => void;
  hideHeader?: boolean;
}

// 아이콘 이름을 아이콘 컴포넌트로 매핑
const ICON_MAP: Record<string, any> = {
  MessageCircle, Folder, Link: LinkIcon, Home, Settings, Bell, Star, Heart,
  Mail, Phone, Calendar, Camera, Image, Music, Video, Book, FileText,
  Code, Database, Cloud, Lock, User, UserPlus, Clock, Check, Download,
  Upload, Share2, Users, MessageSquare
};

export default function CardHome({ 
  isEditMode = false, 
  isDesktopMode = false,
  externalFolderId,
  onFolderChange,
  onBack,
  hideHeader = false
}: CardHomeProps) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // 🔄 데스크탑 모드에서는 externalFolderId를 사용, 아니면 URL에서 읽음
  const [internalFolderId, setInternalFolderId] = useState<number | null>(() => {
    if (isDesktopMode && externalFolderId !== undefined) {
      return externalFolderId;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const urlFolderId = searchParams.get('folderId');
    return urlFolderId ? parseInt(urlFolderId, 10) : null;
  });
  
  // 데스크탑 모드일 때는 외부 folderId를, 아니면 내부 state를 사용
  const currentFolderId = isDesktopMode && externalFolderId !== undefined ? externalFolderId : internalFolderId;
  
  const [folderHistory, setFolderHistory] = useState<Array<{ id: number | null; title: string }>>([
    { id: null, title: "홈" }
  ]);
  const isNavigatingRef = useRef(false);
  const lastCardClickRef = useRef<{ cardId: number; timestamp: number } | null>(null);
  
  // 모바일 헤더 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [showAccountModal, setShowAccountModal] = useState(false);
  
  // 🔄 window popstate 이벤트 (뒤로가기/앞으로가기) 감지하여 folderId 업데이트 (모바일 모드만)
  useEffect(() => {
    if (isDesktopMode) return; // 데스크탑 모드에서는 URL 기반 네비게이션 사용 안 함
    
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const urlFolderId = searchParams.get('folderId');
      const newFolderId = urlFolderId ? parseInt(urlFolderId, 10) : null;
      console.log('[popstate] folderId 업데이트:', newFolderId);
      setInternalFolderId(newFolderId);
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isDesktopMode]);
  
  // 🔄 폴더 변경 시 폴더 히스토리 업데이트
  useEffect(() => {
    console.log(`[URL 감지] location=${location}, folderId=${currentFolderId}`);
    
    if (currentFolderId === null) {
      setFolderHistory([{ id: null, title: "홈" }]);
    } else {
      // 폴더 제목은 currentFolder 데이터에서 가져옴
      setFolderHistory([{ id: null, title: "홈" }, { id: currentFolderId, title: "폴더" }]);
    }
  }, [location, currentFolderId]);

  // 현재 사용자 정보
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"] });

  // 현재 보고 있는 카드 조회 (홈 또는 폴더 내부)
  const { data: cards = [], isLoading } = useQuery<(CardItem & { unreadCount?: number; recentMessages?: any[] })[]>({
    queryKey: currentFolderId 
      ? [`/api/card-layout/cards/folder/${currentFolderId}`]
      : ["/api/card-layout/cards/home"],
  });

  // 사용자의 카드 조회 기록 (NEW 뱃지 판별용)
  const { data: cardViews = [] } = useQuery<Array<{ id: number; userId: string; cardItemId: number; firstViewedAt: Date }>>({
    queryKey: ["/api/card-layout/card-views"],
  });

  // 폴더 정보 조회 (폴더 내부일 때)
  const { data: currentFolder } = useQuery<CardFolder>({
    queryKey: currentFolderId ? [`/api/card-layout/folders/${currentFolderId}`] : [],
    enabled: currentFolderId !== null,
  });

  // 그룹 채팅 및 1:1 대화 목록 (채팅 타입 구분용)
  const { data: groupChats = [] } = useQuery<any[]>({
    queryKey: ["/api/group-chats"],
  });

  const { data: conversations = [] } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
  });

  // 로그아웃
  const handleLogout = useCallback(async () => {
    console.log('[CARDHOME] 로그아웃 버튼 클릭됨');
    try {
      await performLogout();
      console.log('[CARDHOME] performLogout 완료');
    } catch (error) {
      console.error('[CARDHOME] performLogout 에러:', error);
    }
  }, []);

  // 뒤로가기 핸들러
  const handleBack = useCallback(() => {
    if (isNavigatingRef.current) {
      console.log('[뒤로가기] 이미 실행 중 - 무시');
      return;
    }
    
    isNavigatingRef.current = true;
    console.log('[뒤로가기] 실행', { isDesktopMode, currentFolderId });
    
    if (isDesktopMode && onBack) {
      // 데스크탑 모드: 콜백 함수 호출
      onBack();
    } else {
      // 모바일 모드: 브라우저 히스토리 뒤로가기
      window.history.back();
    }
    
    // 500ms 후 플래그 초기화
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 500);
  }, [isDesktopMode, onBack, currentFolderId]);

  // 카드가 NEW인지 확인하는 함수
  const isCardNew = (card: CardItem): boolean => {
    // 폴더 타입은 folderId로 체크, 나머지는 card.id로 체크
    const checkId = card.type === 'folder' && card.folderId ? card.folderId : card.id;
    const isNew = !cardViews.some(view => view.cardItemId === checkId);
    console.log(`[NEW 체크] 카드 ${card.id} (타입: ${card.type}, 체크ID: ${checkId}): ${isNew}, cardViews 개수: ${cardViews.length}`);
    return isNew;
  };

  const handleCardClick = async (card: CardItem, e: React.MouseEvent) => {
    // 편집 모드에서는 아무 것도 하지 않음
    if (isEditMode) return;

    // 🚨 중복 클릭 방지 (300ms 내 같은 카드 재클릭 무시)
    const now = Date.now();
    if (lastCardClickRef.current && 
        lastCardClickRef.current.cardId === card.id && 
        now - lastCardClickRef.current.timestamp < 300) {
      console.log(`[카드 클릭 무시] 중복 클릭 감지 (${now - lastCardClickRef.current.timestamp}ms 이내)`);
      return;
    }
    lastCardClickRef.current = { cardId: card.id, timestamp: now };

    console.log(`[카드 클릭] ID: ${card.id}, 타입: ${card.type}, NEW: ${isCardNew(card)}`);

    // 💡 카드를 "읽음" 상태로 표시 (NEW 뱃지 제거용)
    if (isCardNew(card)) {
      // 폴더 타입은 folderId로, 나머지는 card.id로 저장
      const viewCardId = card.type === 'folder' && card.folderId ? card.folderId : card.id;
      console.log(`[NEW 처리 시작] 카드 ${card.id} (체크ID: ${viewCardId})`);
      
      // 1. 먼저 캐시를 즉시 업데이트 (화면 즉시 반영)
      queryClient.setQueryData(
        ["/api/card-layout/card-views"],
        (old: any[] = []) => {
          const newViews = [
            ...old,
            {
              id: Date.now(),
              userId: user?.id || "",
              cardItemId: viewCardId,
              firstViewedAt: new Date(),
            },
          ];
          console.log(`[캐시 업데이트] 카드 ${card.id} (체크ID: ${viewCardId}) 추가, 총 ${newViews.length}개`);
          return newViews;
        }
      );

      // 2. 서버에 기록 (백그라운드, await 제거)
      fetch(`/api/card-layout/cards/${card.id}/view`, {
        method: "POST",
        credentials: "include",
      }).then(() => {
        console.log(`[서버 기록 완료] 카드 ${card.id}`);
        // 3. 서버 기록 완료 후 재동기화
        queryClient.refetchQueries({ queryKey: ["/api/card-layout/card-views"] });
      }).catch((error) => {
        console.error("[카드 조회 기록 실패]", error);
        // 실패 시 롤백
        queryClient.invalidateQueries({ queryKey: ["/api/card-layout/card-views"] });
      });
    }

    // 채팅방 카드는 바로 진입
    if (card.type === "chat" && card.chatRoomId) {
      // chatRoomId가 그룹 채팅인지 1:1 대화인지 확인
      const groupChat = groupChats.find((gc: any) => gc.id === card.chatRoomId);
      const conversation = conversations.find((conv: any) => conv.id === card.chatRoomId);
      
      if (groupChat) {
        setLocation(`/group-chat/${card.chatRoomId}`);
      } else if (conversation) {
        // 1:1 대화는 /chat/:agentId 경로 사용
        setLocation(`/chat/${conversation.agentId}`);
      } else {
        // 채팅방을 찾을 수 없는 경우 (데이터 불일치)
        console.error(`채팅방 ID ${card.chatRoomId}를 찾을 수 없습니다.`);
      }
      return;
    }

    // 폴더 카드는 진입
    if (card.type === "folder" && card.folderId) {
      console.log(`[폴더 진입] ID=${card.folderId}, 제목=${card.title}, 데스크탑=${isDesktopMode}`);
      
      if (isDesktopMode && onFolderChange) {
        // 데스크탑 모드: 콜백 함수로 폴더 변경
        onFolderChange(card.folderId);
      } else {
        // 모바일 모드: URL 쿼리 파라미터로 폴더 진입 (히스토리 기반 뒤로가기 지원)
        setLocation(`/?folderId=${card.folderId}`);
        // 🚀 즉시 currentFolderId 업데이트 (wouter의 location은 pathname만 반환하므로)
        setInternalFolderId(card.folderId);
      }
    } else if (card.type === "link") {
      // 링크(shortcut) - 일반 라우트 또는 채팅방으로 이동
      if (card.targetRoute) {
        // 운영 탭 관련 라우트인지 확인
        const managementRoutes: { [key: string]: string } = {
          '/conversation-analytics': 'analytics',
          '/agent-management': 'agents',
          '/user-management': 'users',
          '/master-admin': 'master',
          '/personalization': 'personalization',
        };

        const managementMenu = managementRoutes[card.targetRoute];
        
        if (managementMenu && isDesktopMode) {
          // 데스크탑 모드: eventBus로 TabletLayout에 알림
          eventBus.emit(EVENTS.NAVIGATE_TO_MANAGEMENT, { 
            menu: managementMenu,
            route: card.targetRoute 
          });
        } else {
          // 모바일 모드 또는 일반 라우트: 직접 이동
          setLocation(card.targetRoute);
        }
      } else if (card.targetChatRoomId) {
        // targetChatRoomId가 그룹 채팅인지 1:1 대화인지 확인
        const groupChat = groupChats.find((gc: any) => gc.id === card.targetChatRoomId);
        const conversation = conversations.find((conv: any) => conv.id === card.targetChatRoomId);
        
        if (groupChat) {
          setLocation(`/group-chat/${card.targetChatRoomId}`);
        } else if (conversation) {
          // 1:1 대화는 /chat/:agentId 경로 사용
          setLocation(`/chat/${conversation.agentId}`);
        } else {
          console.error(`채팅방 ID ${card.targetChatRoomId}를 찾을 수 없습니다.`);
        }
      }
    }
  };

  const getGridItemStyle = (card: CardItem) => {
    return {
      gridColumn: `${(card.positionX || 0) + 1} / span ${card.gridSizeX || 1}`,
      gridRow: `${(card.positionY || 0) + 1} / span ${card.gridSizeY || 1}`,
    };
  };

  const getCardTypeLabel = (type: string) => {
    switch (type) {
      case "chat":
        return "채팅방";
      case "folder":
        return "폴더";
      case "link":
        return "바로가기";
      default:
        return "";
    }
  };

  const getCardIcon = (card: CardItem) => {
    // 주의: 이 함수는 Lucide 아이콘 컴포넌트만 반환합니다
    // customIcon (PNG 업로드)은 렌더링 로직에서 우선 처리됩니다
    // 우선순위: customIcon (렌더링에서 처리) > icon (이 함수) > 기본 타입 아이콘 (이 함수)
    
    if (card.icon && ICON_MAP[card.icon]) {
      return ICON_MAP[card.icon];
    }
    
    // 기본 타입별 아이콘
    switch (card.type) {
      case "chat":
        return MessageCircle;
      case "folder":
        return Folder;
      case "link":
        return LinkIcon;
      default:
        return MessageCircle;
    }
  };

  const getCardTypeColor = (type: string) => {
    switch (type) {
      case "chat":
        return "bg-blue-500 dark:bg-blue-600";
      case "folder":
        return "bg-orange-500 dark:bg-orange-600";
      case "link":
        return "bg-green-500 dark:bg-green-600";
      default:
        return "bg-gray-500 dark:bg-gray-600";
    }
  };

  const getCardBackground = (card: CardItem) => {
    if (card.image) {
      return "bg-white dark:bg-gray-800";
    }
    if (card.color) {
      // HEX 색상인 경우 인라인 스타일로 처리하기 위해 클래스 반환하지 않음
      if (card.color.startsWith('#')) {
        return "";
      }
      // Tailwind 클래스인 경우
      return card.color;
    }
    return getCardTypeColor(card.type);
  };

  const getCardBackgroundStyle = (card: CardItem) => {
    if (card.color && card.color.startsWith('#')) {
      return { backgroundColor: card.color };
    }
    return {};
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center ${isDesktopMode ? "h-full" : "min-h-screen"}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // 관리자 여부 확인 (TokenGaugeBar 표시 여부와 동일)
  const isAdmin = user?.role === 'master_admin' || user?.role === 'operation_admin' || user?.role === 'agent_admin';
  
  return (
    <div className={`${isDesktopMode ? "h-full" : "min-h-screen"} bg-gray-50 dark:bg-gray-900 ${!isDesktopMode && isAdmin ? 'pt-12 md:pt-10' : ''}`}>
      {/* 모바일 모드에서는 항상 헤더 표시, 데스크탑 모드에서는 폴더 내부일 때만 */}
      {!isDesktopMode && !hideHeader && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                type="text"
                placeholder="채팅방 키워드 또는 에이전트 이름을 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-100 dark:bg-gray-700 border-none h-11 w-full pl-10 pr-3"
              />
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-11 px-4 text-sm flex-shrink-0">
                  {selectedCategory} <ChevronDown className="ml-1 w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => setSelectedCategory("전체")}>
                  전체
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCategory("학교")}>
                  학교
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCategory("교수")}>
                  교수
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCategory("학생")}>
                  학생
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCategory("그룹")}>
                  그룹
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCategory("기능형")}>
                  기능형
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            
            {/* + 버튼은 관리자만 표시 */}
            {user?.userType !== 'student' && (
              <Button
                size="sm"
                className="w-11 h-11 p-0 bg-black hover:bg-gray-800 rounded-full flex-shrink-0"
                onClick={() => setLocation('/card-layout-editor')}
              >
                <Plus className="w-4 h-4 text-white" />
              </Button>
            )}
            
            {/* 설정 드롭다운 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-11 px-4 flex-shrink-0">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setShowAccountModal(true)}
                >
                  <User className="mr-2 h-4 w-4" />
                  계정 설정
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => {
                    sessionStorage.setItem('previousPath', location);
                    setLocation('/personalization');
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  개인화 설정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={(e) => {
                    console.log('[CARDHOME-DROPDOWN] 로그아웃 메뉴 선택됨');
                    handleLogout();
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      
      {/* 데스크탑 모드에서 폴더 내부일 때만 헤더 표시 */}
      {isDesktopMode && currentFolderId !== null && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                뒤로
              </Button>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {currentFolder?.title || "카드 홈"}
              </h1>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                console.log('[CardHome] 편집 버튼 클릭, folderId:', currentFolderId, 'isDesktopMode:', isDesktopMode);
                eventBus.emit(EVENTS.EDIT_CARD_FOLDER, currentFolderId);
              }}
              className="flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              편집
            </Button>
          </div>
        </div>
      )}

      {/* 카드 그리드 */}
      <div className={`${isDesktopMode ? "p-3" : "max-w-7xl mx-auto px-4 py-4"}`}>
        {cards.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              표시할 카드가 없습니다.
            </p>
            {isEditMode && (
              <Button className="mt-4" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                카드 추가
              </Button>
            )}
          </div>
        ) : (
          <div 
            className="grid"
            style={{
              gridTemplateColumns: "repeat(4, 1fr)",
              gridTemplateRows: "repeat(20, 70px)",
              gap: "10px",
            }}
          >
            {cards.map((card) => {
              // 카드 크기 계산
              const cardWidth = card.gridSizeX || 1;
              const cardHeight = card.gridSizeY || 1;
              // 작은 카드 (1×1, 1×2, 2×1, 2×2): 메시지 숫자 뱃지만
              const isSmallCard = cardWidth <= 2 && cardHeight <= 2;
              // 세로로 긴 카드 (1×3, 1×4, 2×3, 2×4): 제목 + 메시지만 (2행 제한)
              const isTallCard = cardHeight >= 3 && cardWidth <= 2;
              
              // 게시판 타입 카드는 BoardCard 컴포넌트 렌더링
              if (card.type === "board") {
                return (
                  <div
                    key={card.id}
                    style={{
                      ...getGridItemStyle(card),
                      borderRadius: '4px',
                    }}
                  >
                    <BoardCard 
                      width={cardWidth} 
                      height={cardHeight} 
                      title={card.title}
                      targetRoute={card.targetRoute || undefined}
                    />
                  </div>
                );
              }
              
              return (
              <div
                key={card.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCardClick(card, e);
                }}
                className={`
                  relative group overflow-hidden
                  ${!isEditMode ? "hover:brightness-110 cursor-pointer active:brightness-95" : ""}
                  ${getCardBackground(card)}
                `}
                style={{
                  ...getGridItemStyle(card),
                  ...getCardBackgroundStyle(card),
                  borderRadius: '4px',
                }}
              >
                {/* 배경 이미지 */}
                {card.image && (
                  <div className="h-full w-full overflow-hidden absolute inset-0">
                    <img
                      src={card.image}
                      alt={card.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* NEW 뱃지 - 좌상단 고정 */}
                {isCardNew(card) && (
                  <div className="absolute top-3 left-3 flex items-center justify-center px-2 py-1 bg-gradient-to-r from-yellow-400 to-orange-500 text-white live-tile-label font-bold shadow-lg z-10" style={{ borderRadius: '4px' }}>
                    NEW
                  </div>
                )}

                {/* 읽지 않은 메시지 배지 - 우상단 고정 (채팅 카드만) */}
                {card.type === "chat" && card.unreadCount && card.unreadCount > 0 && (
                  <div className="absolute top-3 right-3 flex items-center justify-center min-w-[24px] h-[24px] px-1.5 bg-red-500 text-white live-tile-label font-bold z-10" style={{ borderRadius: '12px' }}>
                    {card.unreadCount > 99 ? '99+' : card.unreadCount}
                  </div>
                )}

                {/* 1x1 카드: 아이콘 중앙 + 제목 하단 */}
                {card.gridSizeX === 1 && card.gridSizeY === 1 ? (
                  <div className={`absolute inset-0 flex flex-col items-center justify-center p-3 ${card.image ? "bg-black/40" : ""}`}>
                    {/* 중앙 아이콘 */}
                    <div className="flex-1 flex items-center justify-center">
                      {card.customIcon ? (
                        <img src={card.customIcon} alt="icon" className="w-10 h-10 object-contain" />
                      ) : (() => {
                        const IconComponent = getCardIcon(card);
                        return <IconComponent className="w-10 h-10 text-white" strokeWidth={1.5} />;
                      })()}
                    </div>
                    {/* 하단 제목 */}
                    <div className="text-white text-center w-full">
                      <h3 className="live-tile-subtitle line-clamp-1 truncate">{card.title}</h3>
                    </div>
                  </div>
                ) : (
                  /* 일반 크기 카드: 제목 + 최근 메시지 또는 설명 */
                  <div className={`absolute inset-0 flex flex-col p-3 pb-4 ${card.image ? "bg-black/40" : ""}`}>
                    <div className="flex-1 flex flex-col justify-between text-white min-h-0 overflow-hidden">
                      <h3 className="live-tile-title mb-1 line-clamp-1 truncate flex-shrink-0">{card.title}</h3>
                      {/* 채팅방 카드: 세로 크기에 따라 여러 메시지 표시, 그 외: 설명 표시 */}
                      {card.type === "chat" ? (
                        card.recentMessages && card.recentMessages.length > 0 ? (
                          <div className="flex flex-col gap-1 overflow-hidden">
                            {(() => {
                              // 세로 크기에 따라 표시할 메시지 개수 결정
                              const maxMessages = cardHeight >= 4 ? 4 : cardHeight >= 3 ? 3 : cardHeight >= 2 ? 2 : 1;
                              const messagesToShow = card.recentMessages.slice(0, maxMessages);
                              
                              return messagesToShow.map((msg: any, idx: number) => (
                                <p key={idx} className="live-tile-subtitle text-white/80 line-clamp-1 truncate">
                                  {msg.content}
                                </p>
                              ));
                            })()}
                          </div>
                        ) : null
                      ) : (
                        card.description && (
                          <p className="live-tile-subtitle text-white/80 line-clamp-1 truncate">
                            {card.description}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* 편집 모드 표시 */}
                {isEditMode && (
                  <div className="absolute top-2 right-2 z-10">
                    <Button size="sm" variant="secondary" className="opacity-80">
                      편집
                    </Button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 계정 설정 모달 */}
      <AccountSettingsModal 
        isOpen={showAccountModal} 
        onClose={() => setShowAccountModal(false)} 
      />
    </div>
  );
}
