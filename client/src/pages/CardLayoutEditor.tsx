import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
  closestCenter,
} from "@dnd-kit/core";
import { 
  ArrowLeft, Plus, Save, Trash2, Edit2, FolderPlus, Link, Search, MessageSquare, Users,
  MessageCircle, Folder, Home, Settings, Bell, Star, Heart, Mail, Phone, Calendar,
  Camera, Image, Music, Video, Book, FileText, Code, Database, Cloud, Lock,
  User, UserPlus, Clock, Check, X, ChevronRight, Download, Upload, Share2,
  LucideIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CardItem, CardFolder } from "@shared/schema";
import { ImageLayoutEditor } from "@/components/ImageLayoutEditor";

// 그리드 상수
const GRID_COLS = 4;
const GRID_ROWS = 20; // 충분한 세로 공간 (80칸)

// 아이콘 목록 정의
const AVAILABLE_ICONS: { name: string; icon: LucideIcon; label: string }[] = [
  { name: "MessageCircle", icon: MessageCircle, label: "메시지" },
  { name: "Folder", icon: Folder, label: "폴더" },
  { name: "Home", icon: Home, label: "홈" },
  { name: "Settings", icon: Settings, label: "설정" },
  { name: "Bell", icon: Bell, label: "알림" },
  { name: "Star", icon: Star, label: "별" },
  { name: "Heart", icon: Heart, label: "하트" },
  { name: "Mail", icon: Mail, label: "메일" },
  { name: "Phone", icon: Phone, label: "전화" },
  { name: "Calendar", icon: Calendar, label: "캘린더" },
  { name: "Camera", icon: Camera, label: "카메라" },
  { name: "Image", icon: Image, label: "이미지" },
  { name: "Music", icon: Music, label: "음악" },
  { name: "Video", icon: Video, label: "비디오" },
  { name: "Book", icon: Book, label: "책" },
  { name: "FileText", icon: FileText, label: "문서" },
  { name: "Code", icon: Code, label: "코드" },
  { name: "Database", icon: Database, label: "데이터베이스" },
  { name: "Cloud", icon: Cloud, label: "클라우드" },
  { name: "Lock", icon: Lock, label: "잠금" },
  { name: "User", icon: User, label: "사용자" },
  { name: "UserPlus", icon: UserPlus, label: "사용자 추가" },
  { name: "Clock", icon: Clock, label: "시계" },
  { name: "Check", icon: Check, label: "체크" },
  { name: "Download", icon: Download, label: "다운로드" },
  { name: "Upload", icon: Upload, label: "업로드" },
  { name: "Share2", icon: Share2, label: "공유" },
  { name: "Link", icon: Link, label: "링크" },
  { name: "Users", icon: Users, label: "그룹" },
  { name: "MessageSquare", icon: MessageSquare, label: "채팅" },
];

// 공통 유틸리티 함수
const getCardTypeLabel = (type: string) => {
  switch (type) {
    case "chat":
      return "채팅방";
    case "folder":
      return "폴더";
    case "link":
      return "바로가기";
    case "board":
      return "게시판";
    default:
      return "";
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
    case "board":
      return "bg-purple-500 dark:bg-purple-600";
    default:
      return "bg-gray-500 dark:bg-gray-600";
  }
};

const getCardBackground = (card: { image?: string | null; color?: string | null; type: string }) => {
  if (card.image) {
    return "bg-white dark:bg-gray-800";
  }
  if (card.color) {
    return card.color;
  }
  return getCardTypeColor(card.type);
};

// 충돌 감지: 두 카드가 겹치는지 확인
const isOverlapping = (
  card1: { x: number; y: number; w: number; h: number },
  card2: { x: number; y: number; w: number; h: number }
): boolean => {
  return !(
    card1.x + card1.w <= card2.x ||
    card2.x + card2.w <= card1.x ||
    card1.y + card1.h <= card2.y ||
    card2.y + card2.h <= card1.y
  );
};

// 가장 상단의 빈자리 찾기 (주어진 크기에 맞는)
const findFirstAvailablePosition = (
  width: number,
  height: number,
  cards: CardItem[]
): { x: number; y: number } | null => {
  // 위에서 아래로, 왼쪽에서 오른쪽으로 탐색
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (isCellAvailable(x, y, width, height, cards)) {
        return { x, y };
      }
    }
  }
  return null; // 빈자리 없음
};

// 그리드 셀이 비어있는지 확인
const isCellAvailable = (
  x: number,
  y: number,
  width: number,
  height: number,
  cards: CardItem[],
  excludeCardId?: number
): boolean => {
  // 그리드 범위 체크
  if (x < 0 || y < 0 || x + width > GRID_COLS || y + height > GRID_ROWS) {
    return false;
  }

  const newCard = { x, y, w: width, h: height };

  // 다른 카드와 충돌하는지 확인
  for (const card of cards) {
    if (excludeCardId && card.id === excludeCardId) continue;

    const existingCard = {
      x: card.positionX || 0,
      y: card.positionY || 0,
      w: card.gridSizeX || 1,
      h: card.gridSizeY || 1,
    };

    if (isOverlapping(newCard, existingCard)) {
      return false;
    }
  }

  return true;
};

interface GridCellProps {
  x: number;
  y: number;
  isAvailable: boolean;
  onClick?: (x: number, y: number) => void;
  dragOverPosition: { x: number; y: number } | null;
  draggedCardSize: { width: number; height: number } | null;
  isValidDrop: boolean;
}

function GridCell({ x, y, isAvailable, onClick, dragOverPosition, draggedCardSize, isValidDrop }: GridCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${x}-${y}`,
    data: { x, y },
  });

  const [pointerDownPos, setPointerDownPos] = useState<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    // 빈 셀에서만 포인터 다운 위치 기록
    if (isAvailable) {
      setPointerDownPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // 빈 셀이고 onClick 핸들러가 있을 때만 실행
    if (isAvailable && onClick && pointerDownPos) {
      // 드래그 거리 계산
      const deltaX = Math.abs(e.clientX - pointerDownPos.x);
      const deltaY = Math.abs(e.clientY - pointerDownPos.y);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // 드래그 임계값: 5px 이하면 클릭으로 간주
      const DRAG_THRESHOLD = 5;

      if (distance <= DRAG_THRESHOLD) {
        onClick(x, y);
      }
    }

    // 포인터 다운 위치 초기화
    setPointerDownPos(null);
  };

  const handlePointerCancel = () => {
    // 터치 디바이스에서 포인터가 취소될 때 (스크롤 시작 등) 상태 초기화
    setPointerDownPos(null);
  };

  // 드래그 중인 카드가 차지할 영역에 포함되는지 확인
  const isInDragArea = dragOverPosition && draggedCardSize && 
    x >= dragOverPosition.x && 
    x < dragOverPosition.x + draggedCardSize.width &&
    y >= dragOverPosition.y && 
    y < dragOverPosition.y + draggedCardSize.height;

  // 배경색과 border 스타일 결정
  let cellStyle = "";
  if (isInDragArea) {
    // 드래그 영역에 포함된 셀
    if (isValidDrop) {
      cellStyle = "bg-blue-100 border-blue-500 border-2";
    } else {
      cellStyle = "bg-red-100 border-red-500 border-2";
    }
  } else if (isAvailable) {
    cellStyle = isOver
      ? "bg-green-200 border-green-500"
      : "bg-green-50 border-green-300 cursor-pointer hover:bg-green-100";
  } else {
    cellStyle = "bg-gray-50 border-gray-200";
  }

  return (
    <div
      ref={setNodeRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={`border border-dashed ${cellStyle}`}
      style={{
        gridColumn: x + 1,
        gridRow: y + 1,
        minHeight: "140px",
      }}
    />
  );
}

interface DraggableCardProps {
  card: CardItem;
  onEdit: (card: CardItem) => void;
  onResize: (cardId: number, gridSizeX: number, gridSizeY: number) => void;
  cellSize: { width: number; height: number };
}

function DraggableCard({ card, onEdit, onResize, cellSize }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: card,
  });
  
  // 폴더 카드는 droppable로도 동작
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: card.id,
    disabled: card.type !== 'folder' || !card.folderId,
  });
  
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [tempSize, setTempSize] = useState({ width: card.gridSizeX || 1, height: card.gridSizeY || 1 });

  // 두 ref를 병합
  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: `${(card.positionX || 0) + 1} / span ${isResizing ? tempSize.width : (card.gridSizeX || 1)}`,
    gridRow: `${(card.positionY || 0) + 1} / span ${isResizing ? tempSize.height : (card.gridSizeY || 1)}`,
    transition: isResizing ? 'none' : 'all 0.2s ease',
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 터치 또는 마우스 이벤트에서 좌표 추출
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    setIsResizing(true);
    setResizeStart({
      x: clientX,
      y: clientY,
      width: card.gridSizeX || 1,
      height: card.gridSizeY || 1,
    });
    setTempSize({ width: card.gridSizeX || 1, height: card.gridSizeY || 1 });
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      // 터치 또는 마우스 이벤트에서 좌표 추출
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      const deltaX = clientX - resizeStart.x;
      const deltaY = clientY - resizeStart.y;
      
      // 그리드 단위로 변환 (동적 셀 크기 + gap 고려)
      const gap = 10;
      const cellWidthWithGap = cellSize.width + gap;
      const cellHeightWithGap = cellSize.height + gap;
      
      const newWidth = Math.max(1, Math.min(4, Math.round(resizeStart.width + deltaX / cellWidthWithGap)));
      const newHeight = Math.max(1, Math.min(4, Math.round(resizeStart.height + deltaY / cellHeightWithGap)));
      
      // 임시 크기만 업데이트 (실시간 시각적 피드백)
      setTempSize({ width: newWidth, height: newHeight });
    };

    const handleEnd = () => {
      setIsResizing(false);
      
      // 리사이즈 완료 시 서버에 저장
      if (tempSize.width !== card.gridSizeX || tempSize.height !== card.gridSizeY) {
        onResize(card.id, tempSize.width, tempSize.height);
      }
    };

    // 마우스 및 터치 이벤트 모두 처리
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isResizing, resizeStart, card.id, card.gridSizeX, card.gridSizeY, tempSize, onResize, cellSize]);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderRadius: '4px',
      }}
      className={`
        relative group overflow-hidden
        transition-all duration-150
        border-2 border-dashed
        ${isOver && card.type === 'folder' ? 'border-green-500 border-4 ring-4 ring-green-200' : 'border-blue-400'}
        ${getCardBackground(card)}
      `}
      {...attributes}
    >
      {/* 카드 이미지 */}
      {card.image && (
        <div className="h-full w-full overflow-hidden opacity-60">
          <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
        </div>
      )}

      {/* 드래그 핸들 영역 - 카드 정보 오버레이 */}
      <div 
        className={`absolute inset-0 flex flex-col justify-between p-3 cursor-move ${card.image ? "bg-black/40" : ""}`}
        {...listeners}
      >
        <div className="flex items-center justify-between pointer-events-none">
          <span className="live-tile-label text-white/90 bg-black/20 px-2 py-0.5 backdrop-blur-sm" style={{ borderRadius: '2px' }}>
            {getCardTypeLabel(card.type)}
          </span>
          <span className="live-tile-label text-white/90 bg-blue-500/30 px-2 py-0.5 backdrop-blur-sm" style={{ borderRadius: '2px' }}>
            {card.gridSizeX}×{card.gridSizeY}
          </span>
        </div>
        <div className="text-white pointer-events-none">
          <h3 className="live-tile-title mb-1 line-clamp-2">{card.title}</h3>
          {card.description && (
            <p className="live-tile-subtitle text-white/80 line-clamp-2">{card.description}</p>
          )}
        </div>
      </div>

      {/* 편집 버튼 */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(card);
          }}
        >
          <Edit2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 리사이즈 핸들 */}
      <div
        className={`
          absolute bottom-0 right-0 w-6 h-6
          bg-blue-500 rounded-tl-lg cursor-nwse-resize
          opacity-0 group-hover:opacity-100 transition-opacity z-20
          flex items-center justify-center
          select-none touch-none
          ${isResizing ? 'opacity-100' : ''}
        `}
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
        style={{ userSelect: 'none', touchAction: 'none' }}
      >
        <div className="w-3 h-3 border-r-2 border-b-2 border-white pointer-events-none"></div>
      </div>
    </div>
  );
}

interface CardLayoutEditorProps {
  isDesktopMode?: boolean;
  onExitEdit?: () => void;
  trigger?: 'folder' | 'card' | 'save' | null;
  onTriggerComplete?: () => void;
  initialFolderId?: number | null;
  pendingCardForChat?: { chatRoomId: number; chatRoomTitle: string } | null;
  onPendingCardProcessed?: () => void;
}

export default function CardLayoutEditor({ 
  isDesktopMode = false, 
  onExitEdit,
  trigger,
  onTriggerComplete,
  initialFolderId = null,
  pendingCardForChat = null,
  onPendingCardProcessed
}: CardLayoutEditorProps = {}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // URL query string에서 파라미터 읽기 (모바일)
  const urlParams = new URLSearchParams(window.location.search);
  const folderIdFromUrl = urlParams.get('folderId');
  const pendingChatIdFromUrl = urlParams.get('pendingChatId');
  const pendingChatTitleFromUrl = urlParams.get('pendingChatTitle');
  const createBoardCard = urlParams.get('createBoardCard') === 'true';
  const boardId = urlParams.get('boardId');
  const boardTitle = urlParams.get('boardTitle');
  const effectiveInitialFolderId = folderIdFromUrl ? parseInt(folderIdFromUrl, 10) : initialFolderId;
  
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(effectiveInitialFolderId);
  const [folderHistory, setFolderHistory] = useState<Array<{ id: number | null; title: string }>>([
    { id: null, title: "홈" },
  ]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [chatRoomSelectDialogOpen, setChatRoomSelectDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CardItem | null>(null);
  const [chatRoomSearchQuery, setChatRoomSearchQuery] = useState("");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isCreatingNewCard, setIsCreatingNewCard] = useState(false); // 빈 셀 클릭으로 새 카드 생성 중
  

  // 폼 상태
  const [cardForm, setCardForm] = useState({
    title: "",
    description: "",
    type: "chat" as "chat" | "folder" | "link" | "board",
    gridSizeX: 1,
    gridSizeY: 1,
    chatRoomId: null as number | null,
    folderId: null as number | null,
    targetChatRoomId: null as number | null,
    targetRoute: "" as string,
    parentFolderId: null as number | null,
    image: "",
    originalImage: "" as string, // 원본 이미지 URL (크롭 전)
    imageTransform: null as { x: number; y: number; scale: number; rotation?: number } | null, // 이미지 변환 정보
    color: "" as string,
    icon: "" as string,
    customIcon: "" as string,
  });
  
  // 이미지 레이아웃 편집 모달 상태
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);

  const [folderForm, setFolderForm] = useState({
    title: "",
    description: "",
  });

  const sensors = useSensors(
    useSensor(PointerSensor)
  );

  // 현재 보고 있는 카드 조회
  const { data: cards = [], isLoading } = useQuery<CardItem[]>({
    queryKey: currentFolderId
      ? [`/api/card-layout/cards/folder/${currentFolderId}`]
      : ["/api/card-layout/cards/home"],
  });

  // 폴더 목록 조회 (링크 카드 생성 시 필요)
  const { data: folders = [] } = useQuery<CardFolder[]>({
    queryKey: ["/api/card-layout/folders"],
  });

  // 1:1 대화방 목록 조회
  const { data: conversations = [] } = useQuery<any[]>({
    queryKey: ["/api/conversations"],
  });

  // 그룹 채팅 목록 조회
  const { data: groupChats = [] } = useQuery<any[]>({
    queryKey: ["/api/group-chats"],
  });

  // 에이전트 목록 조회 (1:1 대화방 이름 표시용)
  const { data: agents = [] } = useQuery<any[]>({
    queryKey: ["/api/agents"],
  });

  // 카드 생성/수정 mutation
  const saveCardMutation = useMutation({
    mutationFn: async (card: Partial<CardItem>) => {
      const url = card.id ? `/api/card-layout/cards/${card.id}` : "/api/card-layout/cards";
      const method = card.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
      });
      if (!res.ok) throw new Error("Failed to save card");
      return res.json();
    },
    onSuccess: (createdCard) => {
      // 현재 보고 있는 폴더/홈 화면의 캐시 무효화
      const queryKey = currentFolderId 
        ? [`/api/card-layout/cards/folder/${currentFolderId}`]
        : ["/api/card-layout/cards/home"];
      queryClient.invalidateQueries({ queryKey });
      
      // 빈 셀 클릭으로 새 카드 생성 중이면 편집 모드로 전환
      if (isCreatingNewCard) {
        setEditingCard(createdCard);
        setCardForm({
          type: createdCard.type,
          title: createdCard.title,
          description: createdCard.description || "",
          image: createdCard.image || "",
          originalImage: createdCard.originalImage || "",
          imageTransform: createdCard.imageTransform || null,
          chatRoomId: createdCard.chatRoomId || null,
          folderId: createdCard.folderId || null,
          targetChatRoomId: createdCard.targetChatRoomId || null,
          targetRoute: createdCard.targetRoute || "",
          parentFolderId: createdCard.parentFolderId || null,
          gridSizeX: createdCard.gridSizeX || 1,
          gridSizeY: createdCard.gridSizeY || 1,
          color: createdCard.color || "",
          icon: createdCard.icon || "",
          customIcon: createdCard.customIcon || "",
        });
        setEditDialogOpen(true);
        setIsCreatingNewCard(false); // 플래그 리셋
      } else {
        // 일반 저장일 때는 다이얼로그 닫기
        setEditDialogOpen(false);
        resetCardForm();
      }
    },
    onError: (error) => {
      // 에러 발생 시 플래그 리셋 및 사용자 알림
      setIsCreatingNewCard(false);
      alert("카드 저장 중 오류가 발생했습니다. 다시 시도해주세요.");
      console.error("Card save error:", error);
    },
  });

  // 카드 삭제 mutation
  const deleteCardMutation = useMutation({
    mutationFn: async (cardId: number) => {
      const res = await fetch(`/api/card-layout/cards/${cardId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete card");
    },
    onSuccess: () => {
      // 현재 보고 있는 폴더/홈 화면의 캐시 무효화
      const queryKey = currentFolderId 
        ? [`/api/card-layout/cards/folder/${currentFolderId}`]
        : ["/api/card-layout/cards/home"];
      queryClient.invalidateQueries({ queryKey });
    },
  });


  // 폴더 생성 mutation
  const createFolderMutation = useMutation({
    mutationFn: async (folder: { title: string; description?: string }) => {
      const res = await fetch("/api/card-layout/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(folder),
      });
      if (!res.ok) throw new Error("Failed to create folder");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/card-layout/folders"] });
      setFolderDialogOpen(false);
      resetFolderForm();
    },
  });

  // 카드 크기 변경 mutation (Optimistic Update)
  const resizeCardMutation = useMutation({
    mutationFn: async ({ id, gridSizeX, gridSizeY }: { id: number; gridSizeX: number; gridSizeY: number }) => {
      const res = await fetch(`/api/card-layout/cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gridSizeX, gridSizeY }),
      });
      if (!res.ok) throw new Error("Failed to resize card");
      return res.json();
    },
    onMutate: async ({ id, gridSizeX, gridSizeY }) => {
      const queryKey = currentFolderId 
        ? [`/api/card-layout/cards/folder/${currentFolderId}`]
        : ["/api/card-layout/cards/home"];
      
      await queryClient.cancelQueries({ queryKey });
      
      const previousCards = queryClient.getQueryData<CardItem[]>(queryKey);
      
      // Optimistic Update
      if (previousCards) {
        const updatedCards = previousCards.map(card => 
          card.id === id ? { ...card, gridSizeX, gridSizeY } : card
        );
        queryClient.setQueryData(queryKey, updatedCards);
      }
      
      return { previousCards, queryKey };
    },
    onError: (err, variables, context) => {
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      }
    },
  });

  // 카드 위치 변경 mutation (Optimistic Update)
  const updateCardPositionMutation = useMutation({
    mutationFn: async ({ id, positionX, positionY }: { id: number; positionX: number; positionY: number }) => {
      const res = await fetch(`/api/card-layout/cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionX, positionY }),
      });
      if (!res.ok) throw new Error("Failed to update card position");
      return res.json();
    },
    onMutate: async ({ id, positionX, positionY }) => {
      const queryKey = currentFolderId 
        ? [`/api/card-layout/cards/folder/${currentFolderId}`]
        : ["/api/card-layout/cards/home"];
      
      await queryClient.cancelQueries({ queryKey });
      
      const previousCards = queryClient.getQueryData<CardItem[]>(queryKey);
      
      // Optimistic Update
      if (previousCards) {
        const updatedCards = previousCards.map(card => 
          card.id === id ? { ...card, positionX, positionY } : card
        );
        queryClient.setQueryData(queryKey, updatedCards);
      }
      
      return { previousCards, queryKey };
    },
    onError: (err, variables, context) => {
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      }
    },
  });

  const [dragOverCell, setDragOverCell] = useState<{ x: number; y: number } | null>(null);
  const [isValidDrop, setIsValidDrop] = useState<boolean>(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState({ width: 0, height: 70 });

  // 그리드 셀 크기 계산
  useEffect(() => {
    const updateCellSize = () => {
      if (gridRef.current) {
        const gridWidth = gridRef.current.offsetWidth;
        const gap = 10;
        const cellWidth = (gridWidth - gap * (GRID_COLS - 1)) / GRID_COLS;
        setCellSize({ width: cellWidth, height: 70 });
      }
    };

    updateCellSize();
    window.addEventListener('resize', updateCellSize);
    return () => window.removeEventListener('resize', updateCellSize);
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    
    if (over && over.id.toString().startsWith('cell-')) {
      const cellData = over.data.current as { x: number; y: number };
      setDragOverCell(cellData);
      
      // 드래그 중인 카드 찾기
      const draggedCard = cards.find(c => c.id === active.id);
      if (draggedCard) {
        // 배치 가능 여부 확인
        const canPlace = isCellAvailable(
          cellData.x,
          cellData.y,
          draggedCard.gridSizeX || 1,
          draggedCard.gridSizeY || 1,
          cards,
          draggedCard.id
        );
        setIsValidDrop(canPlace);
      }
    } else {
      setDragOverCell(null);
      setIsValidDrop(true);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    console.log('🎯 handleDragEnd called:', { 
      activeId: active.id, 
      overId: over?.id,
      overIdString: over?.id.toString()
    });
    
    setActiveId(null);
    setDragOverCell(null);
    setIsValidDrop(true);

    if (!over) {
      console.log('❌ No over target');
      return;
    }

    const draggedCard = cards.find(c => c.id === active.id);
    if (!draggedCard) {
      console.log('❌ Dragged card not found:', active.id);
      return;
    }

    console.log('✅ Dragged card:', draggedCard);

    // 폴더 카드 위에 드롭한 경우
    if (!over.id.toString().startsWith('cell-')) {
      console.log('🎯 Dropped on card, not cell');
      const targetCard = cards.find(c => c.id === over.id);
      console.log('🎯 Target card:', targetCard);
      
      // 폴더 카드를 다른 폴더로 이동하려는 경우 막기 (중첩 폴더 미지원)
      if (draggedCard.type === 'folder') {
        alert('폴더는 다른 폴더 안에 넣을 수 없습니다.');
        return;
      }
      
      if (targetCard && targetCard.type === 'folder' && targetCard.folderId) {
        console.log('✅ Moving to folder:', targetCard.folderId);
        // 드래그한 카드를 폴더로 이동
        try {
          const res = await fetch(`/api/card-layout/cards/${draggedCard.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              parentFolderId: targetCard.folderId,
            }),
          });

          if (res.ok) {
            console.log('✅ Card moved successfully');
            // 현재 폴더의 캐시 무효화 (카드가 사라짐)
            const queryKey = currentFolderId 
              ? [`/api/card-layout/cards/folder/${currentFolderId}`]
              : ["/api/card-layout/cards/home"];
            queryClient.invalidateQueries({ queryKey });
            
            // 타겟 폴더의 캐시도 무효화
            queryClient.invalidateQueries({ 
              queryKey: [`/api/card-layout/cards/folder/${targetCard.folderId}`] 
            });
          } else {
            console.error('❌ Failed to move card:', await res.text());
          }
        } catch (error) {
          console.error('❌ 카드 이동 실패:', error);
        }
      } else {
        console.log('❌ Target is not a valid folder card');
      }
      return;
    }

    // 빈 셀에 드롭한 경우 (기존 로직)
    if (over.id.toString().startsWith('cell-')) {
      const cellData = over.data.current as { x: number; y: number };
      
      const canPlace = isCellAvailable(
        cellData.x,
        cellData.y,
        draggedCard.gridSizeX || 1,
        draggedCard.gridSizeY || 1,
        cards,
        draggedCard.id
      );

      if (canPlace) {
        // 위치 업데이트 mutation 호출
        updateCardPositionMutation.mutate({
          id: draggedCard.id,
          positionX: cellData.x,
          positionY: cellData.y,
        });
      }
    }
  };

  const handleBack = () => {
    if (folderHistory.length > 1) {
      const newHistory = folderHistory.slice(0, -1);
      setFolderHistory(newHistory);
      setCurrentFolderId(newHistory[newHistory.length - 1].id);
    }
  };

  const handleEditCard = (card: CardItem) => {
    setEditingCard(card);
    setCardForm({
      title: card.title,
      description: card.description || "",
      type: card.type as "chat" | "folder" | "link",
      gridSizeX: card.gridSizeX,
      gridSizeY: card.gridSizeY,
      chatRoomId: card.chatRoomId,
      folderId: card.folderId,
      targetChatRoomId: card.targetChatRoomId,
      targetRoute: card.targetRoute || "",
      parentFolderId: card.parentFolderId,
      image: card.image || "",
      originalImage: card.originalImage || "",
      imageTransform: card.imageTransform || null,
      color: card.color || "",
      icon: card.icon || "",
      customIcon: card.customIcon || "",
    });
    setEditDialogOpen(true);
  };

  const handleDeleteCard = (cardId: number) => {
    if (confirm("정말로 이 카드를 삭제하시겠습니까?")) {
      deleteCardMutation.mutate(cardId);
    }
  };

  const handleCardResize = (cardId: number, gridSizeX: number, gridSizeY: number) => {
    // 리사이즈하려는 카드 찾기
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // 충돌 감지: 새 크기로 리사이즈했을 때 다른 카드와 겹치는지 확인
    const canResize = isCellAvailable(
      card.positionX || 0,
      card.positionY || 0,
      gridSizeX,
      gridSizeY,
      cards,
      cardId
    );

    if (canResize) {
      resizeCardMutation.mutate({ id: cardId, gridSizeX, gridSizeY });
    } else {
      // 리사이즈 불가능 - 다른 카드와 겹침
      alert("이 크기로 변경할 수 없습니다. 다른 카드와 겹칩니다.");
    }
  };

  const handleCellClick = (x: number, y: number) => {
    // 빈 셀 클릭 시 해당 위치에 1x1 새 카드 생성
    const newCard: Partial<CardItem> = {
      type: "chat",
      title: "새 카드",
      description: "",
      image: null,
      positionX: x,
      positionY: y,
      gridSizeX: 1,
      gridSizeY: 1,
      parentFolderId: currentFolderId,
    };

    // 플래그 설정: 새 카드 생성 중
    setIsCreatingNewCard(true);
    
    // 카드 생성 (onSuccess는 saveCardMutation에서 처리)
    saveCardMutation.mutate(newCard);
  };

  // 이미지 레이아웃 편집 완료 후 처리
  const handleCropComplete = async (
    croppedImageBlob: Blob,
    transform: { x: number; y: number; scale: number }
  ) => {
    try {
      // 크롭된 이미지를 서버에 업로드
      const formData = new FormData();
      formData.append('file', croppedImageBlob, 'cropped-card-image.png');
      
      const res = await fetch('/api/card-layout/crop-image', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Failed to upload cropped image');
      }

      const data = await res.json();
      
      // cardForm 업데이트: 크롭된 이미지와 transform 정보 저장
      setCardForm(prev => ({
        ...prev,
        image: data.url, // 크롭된 최종 이미지
        imageTransform: transform, // transform 정보 저장
      }));

      console.log('크롭 완료:', {
        originalImage: cardForm.originalImage,
        croppedImage: data.url,
        transform,
      });
      
      // 레이아웃 편집기 닫기
      setLayoutEditorOpen(false);
    } catch (error) {
      console.error('Failed to process cropped image:', error);
      alert('이미지 처리에 실패했습니다.');
    }
  };

  const handleSaveCard = async () => {
    // 새 카드 생성 시 가장 상단의 빈자리 찾기
    let positionX = 0;
    let positionY = 0;
    
    if (editingCard) {
      // 기존 카드 편집: 기존 위치 유지
      positionX = editingCard.positionX;
      positionY = editingCard.positionY;
    } else {
      // 새 카드 생성: 가장 상단의 빈자리 찾기
      const position = findFirstAvailablePosition(
        cardForm.gridSizeX || 1,
        cardForm.gridSizeY || 1,
        cards
      );
      
      if (!position) {
        alert("더 이상 카드를 추가할 공간이 없습니다.");
        return;
      }
      
      positionX = position.x;
      positionY = position.y;
    }
    
    const cardData: Partial<CardItem> = {
      ...cardForm,
      // 편집 중이면 cardForm의 parentFolderId 사용, 새 카드면 현재 폴더 사용
      parentFolderId: editingCard ? cardForm.parentFolderId : currentFolderId,
      positionX,
      positionY,
    };

    if (editingCard) {
      cardData.id = editingCard.id;
    }

    // 폴더 타입 카드인데 folderId가 없으면 자동으로 새 폴더 생성
    if (cardForm.type === "folder" && !cardForm.folderId) {
      try {
        const res = await fetch("/api/card-layout/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: cardForm.title || "새 폴더",
            description: cardForm.description || "",
          }),
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error("폴더 생성 실패:", errorText);
          alert("폴더 생성에 실패했습니다.");
          return;
        }
        
        const newFolder = await res.json();
        cardData.folderId = newFolder.id;
        // 폴더 목록 캐시 무효화
        queryClient.invalidateQueries({ queryKey: ["/api/card-layout/folders"] });
      } catch (error) {
        console.error("폴더 생성 실패:", error);
        alert("폴더 생성에 실패했습니다.");
        return;
      }
    }

    saveCardMutation.mutate(cardData);
  };

  const handleSaveFolder = () => {
    createFolderMutation.mutate(folderForm);
  };

  const resetCardForm = () => {
    setEditingCard(null);
    setCardForm({
      title: "",
      description: "",
      type: "chat",
      gridSizeX: 1,
      gridSizeY: 1,
      chatRoomId: null,
      folderId: null,
      targetChatRoomId: null,
      targetRoute: "",
      parentFolderId: null,
      image: "",
      originalImage: "",
      imageTransform: null,
      color: "",
      icon: "",
      customIcon: "",
    });
  };

  const resetFolderForm = () => {
    setFolderForm({
      title: "",
      description: "",
    });
  };

  // pendingCardForChat 처리 - 채팅방 생성 후 카드 생성 다이얼로그 열기 (데스크탑)
  useEffect(() => {
    if (pendingCardForChat && cards) {
      const { chatRoomId, chatRoomTitle } = pendingCardForChat;
      
      // 1. 카드 이름 중복 체크 및 넘버 붙이기
      let cardTitle = chatRoomTitle;
      const existingTitles = cards.map(c => c.title);
      let counter = 1;
      
      while (existingTitles.includes(cardTitle)) {
        counter++;
        cardTitle = `${chatRoomTitle} (${counter})`;
      }
      
      // 2. 카드 폼 초기화 및 다이얼로그 열기
      setEditingCard(null); // 새 카드 생성 모드
      setCardForm({
        title: cardTitle,
        description: "",
        type: "chat",
        gridSizeX: 1,
        gridSizeY: 1,
        chatRoomId: chatRoomId,
        folderId: null,
        targetChatRoomId: null,
        targetRoute: "",
        parentFolderId: currentFolderId,
        image: "",
        originalImage: "",
        imageTransform: null,
        color: "",
        icon: "",
        customIcon: "",
      });
      setEditDialogOpen(true);
      
      // 3. pending 상태 초기화
      if (onPendingCardProcessed) {
        onPendingCardProcessed();
      }
    }
  }, [pendingCardForChat, cards, currentFolderId, onPendingCardProcessed]);

  // URL query parameter에서 pendingChat 처리 - 채팅방 생성 후 카드 생성 다이얼로그 열기 (모바일)
  useEffect(() => {
    if (pendingChatIdFromUrl && pendingChatTitleFromUrl && cards) {
      const chatRoomId = parseInt(pendingChatIdFromUrl, 10);
      const chatRoomTitle = decodeURIComponent(pendingChatTitleFromUrl);
      
      // 1. 카드 이름 중복 체크 및 넘버 붙이기
      let cardTitle = chatRoomTitle;
      const existingTitles = cards.map(c => c.title);
      let counter = 1;
      
      while (existingTitles.includes(cardTitle)) {
        counter++;
        cardTitle = `${chatRoomTitle} (${counter})`;
      }
      
      // 2. 카드 폼 초기화 및 다이얼로그 열기
      setEditingCard(null); // 새 카드 생성 모드
      setCardForm({
        title: cardTitle,
        description: "",
        type: "chat",
        gridSizeX: 1,
        gridSizeY: 1,
        chatRoomId: chatRoomId,
        folderId: null,
        targetChatRoomId: null,
        targetRoute: "",
        parentFolderId: currentFolderId,
        image: "",
        originalImage: "",
        imageTransform: null,
        color: "",
        icon: "",
        customIcon: "",
      });
      setEditDialogOpen(true);
      
      // 3. URL에서 pending 파라미터 제거
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('pendingChatId');
      newUrl.searchParams.delete('pendingChatTitle');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [pendingChatIdFromUrl, pendingChatTitleFromUrl, cards, currentFolderId]);

  // 게시판 카드 자동 생성 - 게시판 생성 후 카드 생성 다이얼로그 열기
  useEffect(() => {
    if (createBoardCard && boardId && boardTitle && cards) {
      const title = decodeURIComponent(boardTitle);
      const targetBoardId = parseInt(boardId, 10);
      
      // 1. 카드 이름 중복 체크 및 넘버 붙이기
      let cardTitle = title;
      const existingTitles = cards.map(c => c.title);
      let counter = 1;
      
      while (existingTitles.includes(cardTitle)) {
        counter++;
        cardTitle = `${title} (${counter})`;
      }
      
      // 2. 게시판 카드 폼 설정
      resetCardForm();
      setCardForm({
        title: cardTitle,
        description: "",
        type: "board",
        gridSizeX: 2,
        gridSizeY: 2,
        chatRoomId: null,
        folderId: null,
        targetChatRoomId: null,
        targetRoute: `/boards/${targetBoardId}`,
        parentFolderId: currentFolderId,
        image: "",
        originalImage: "",
        imageTransform: null,
        color: "",
        icon: "",
        customIcon: "",
      });
      setEditDialogOpen(true);
      
      // 3. URL에서 파라미터 제거
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('createBoardCard');
      newUrl.searchParams.delete('boardId');
      newUrl.searchParams.delete('boardTitle');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [createBoardCard, boardId, boardTitle, cards, currentFolderId]);

  // TabletLayout trigger 감지
  useEffect(() => {
    if (trigger) {
      if (trigger === 'folder') {
        resetCardForm();
        setCardForm(prev => ({
          ...prev,
          type: "chat",
          title: "새 채팅방",
          gridSizeX: 1,
          gridSizeY: 1,
        }));
        setEditDialogOpen(true);
      } else if (trigger === 'card') {
        resetCardForm();
        setEditDialogOpen(true);
      } else if (trigger === 'save') {
        alert("변경사항이 저장되었습니다.");
      }
      onTriggerComplete?.();
    }
  }, [trigger, onTriggerComplete]);

  // initialFolderId 처리: 폴더 편집 모드로 진입
  useEffect(() => {
    if (effectiveInitialFolderId !== null && folders.length > 0) {
      const folder = folders.find(f => f.id === effectiveInitialFolderId);
      if (folder) {
        setCurrentFolderId(effectiveInitialFolderId);
        setFolderHistory([
          { id: null, title: "홈" },
          { id: effectiveInitialFolderId, title: folder.title }
        ]);
      }
    }
  }, [effectiveInitialFolderId, folders]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center ${isDesktopMode ? "h-full" : "min-h-screen"}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className={`${isDesktopMode ? "h-full flex flex-col" : "fixed inset-0 flex flex-col"} bg-gray-50 dark:bg-gray-900`}>
      {/* 데스크탑 모드가 아닐 때만 헤더 표시 (TabletLayout에서 렌더링) */}
      {!isDesktopMode && (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
          <div className="flex items-center justify-between max-w-7xl mx-auto">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                편집
              </h1>
              {currentFolderId !== null && (
                <Button variant="ghost" size="sm" onClick={handleBack} className="flex items-center gap-1">
                  <ArrowLeft className="h-4 w-4" />
                  뒤로
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation("/create-group-chat?fromCardEditor=true")}
              >
                <Plus className="h-4 w-4 mr-1" />
                채팅방
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation("/boards/new")}
              >
                <Plus className="h-4 w-4 mr-1" />
                게시판
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setLocation("/")}
              >
                취소
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => {
                  // 저장 로직 (현재는 자동 저장되므로 사용자에게 피드백만 제공)
                  alert("변경사항이 저장되었습니다.");
                }}
              >
                저장
              </Button>
              <Button 
                size="sm" 
                onClick={() => setLocation("/")}
              >
                완료
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 카드 그리드 */}
      <div className={`${isDesktopMode ? "p-4 flex-1 overflow-y-auto min-h-0" : "flex-1 overflow-y-auto min-h-0 max-w-7xl mx-auto p-4 w-full"}`}>
        {cards.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">표시할 카드가 없습니다.</p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => {
                resetCardForm();
                setEditDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              첫 번째 카드 추가
            </Button>
          </div>
        ) : (
          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div
              ref={gridRef}
              className="relative"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_ROWS}, 70px)`,
                gap: "10px",
              }}
            >
              {/* 그리드 셀 렌더링 (드롭존) */}
              {Array.from({ length: GRID_ROWS }, (_, y) =>
                Array.from({ length: GRID_COLS }, (_, x) => {
                  const draggedCard = activeId ? cards.find(c => c.id === activeId) : null;
                  
                  // 빈 셀 여부: 1x1 크기로 해당 위치에 카드가 배치 가능한지 확인
                  // 드래그 중이면 드래그 카드 크기로, 아니면 1x1로 체크
                  const isAvailable = isCellAvailable(
                    x,
                    y,
                    draggedCard ? (draggedCard.gridSizeX || 1) : 1,
                    draggedCard ? (draggedCard.gridSizeY || 1) : 1,
                    cards,
                    draggedCard?.id // 드래그 중인 카드는 충돌 체크에서 제외
                  );

                  return (
                    <GridCell
                      key={`cell-${x}-${y}`}
                      x={x}
                      y={y}
                      isAvailable={isAvailable}
                      onClick={handleCellClick}
                      dragOverPosition={dragOverCell}
                      draggedCardSize={draggedCard ? { width: draggedCard.gridSizeX || 1, height: draggedCard.gridSizeY || 1 } : null}
                      isValidDrop={isValidDrop}
                    />
                  );
                })
              )}

              {/* 카드 렌더링 */}
              {cards.map((card) => (
                <DraggableCard
                  key={card.id}
                  card={card}
                  onEdit={handleEditCard}
                  onResize={handleCardResize}
                  cellSize={cellSize}
                />
              ))}
            </div>
            <DragOverlay>
              {activeId ? (() => {
                const card = cards.find(c => c.id === activeId);
                if (!card) return null;
                
                const gap = 10;
                const cardWidth = (cellSize.width * (card.gridSizeX || 1)) + (gap * ((card.gridSizeX || 1) - 1));
                const cardHeight = (cellSize.height * (card.gridSizeY || 1)) + (gap * ((card.gridSizeY || 1) - 1));
                
                return (
                  <div
                    className={`rounded-lg overflow-hidden shadow-2xl border-2 ${
                      isValidDrop ? "border-blue-500" : "border-red-500"
                    } opacity-90 relative ${getCardBackground(card)}`}
                    style={{
                      width: `${cardWidth}px`,
                      height: `${cardHeight}px`,
                    }}
                  >
                    {card.image && (
                      <div className="h-full w-full overflow-hidden opacity-60">
                        <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className={`absolute inset-0 flex flex-col justify-end p-4 ${card.image ? "bg-black/50" : ""}`}>
                      <div className="text-white">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs px-2 py-0.5 bg-white/30 rounded-full backdrop-blur-sm">
                            {getCardTypeLabel(card.type)}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-blue-500/30 rounded-full backdrop-blur-sm">
                            {card.gridSizeX}x{card.gridSizeY}
                          </span>
                        </div>
                        <h3 className="font-bold text-lg mb-1">{card.title}</h3>
                        {card.description && (
                          <p className="text-sm text-gray-200 line-clamp-2">{card.description}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })() : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* 카드 편집 다이얼로그 */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{editingCard ? "카드 편집" : "새 카드 추가"}</DialogTitle>
            <DialogDescription>
              카드의 정보를 입력하고 그리드 크기를 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 min-h-0">
            <div className="grid gap-4 py-4 pr-2">
              <div className="grid gap-2">
                <Label htmlFor="title">제목</Label>
                <Input
                  id="title"
                  value={cardForm.title}
                  onChange={(e) => setCardForm({ ...cardForm, title: e.target.value })}
                  placeholder="카드 제목"
                />
              </div>

            <div className="grid gap-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                  id="description"
                  value={cardForm.description}
                  onChange={(e) => setCardForm({ ...cardForm, description: e.target.value })}
                  placeholder="카드 설명 (선택사항)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">카드 타입</Label>
                  <Select
                    value={cardForm.type}
                    onValueChange={(value) =>
                      setCardForm({ ...cardForm, type: value as "chat" | "folder" | "link" | "board" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">채팅방</SelectItem>
                      <SelectItem value="folder">폴더</SelectItem>
                      <SelectItem value="link">바로가기</SelectItem>
                      <SelectItem value="board">게시판</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="parentFolder">소속 폴더</Label>
                  <Select
                    value={cardForm.parentFolderId?.toString() || "home"}
                    onValueChange={(value) =>
                      setCardForm({ ...cardForm, parentFolderId: value === "home" ? null : parseInt(value) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home">홈 화면</SelectItem>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id.toString()}>
                          {folder.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="image">이미지 URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="image"
                    value={cardForm.image}
                    onChange={(e) => setCardForm({ ...cardForm, image: e.target.value })}
                    placeholder="https://..."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      // 카드 제목과 설명으로 검색어 생성
                      const searchQuery = `${cardForm.title} ${cardForm.description}`.trim();
                      if (!searchQuery) {
                        alert('카드 제목이나 설명을 먼저 입력하세요.');
                        return;
                      }
                      
                      try {
                        // 현재 이미지 인덱스 가져오기 (없으면 -1로 시작해서 첫 번째 이미지가 0이 되도록)
                        const currentIndex = (cardForm as any).imageRecommendIndex ?? -1;
                        
                        // API 호출
                        const res = await fetch(`/api/card-layout/recommend-image?query=${encodeURIComponent(searchQuery)}&page=1`);
                        if (!res.ok) {
                          throw new Error('이미지 검색 실패');
                        }
                        
                        const data = await res.json();
                        if (!data.images || data.images.length === 0) {
                          alert('검색 결과가 없습니다. 다른 제목이나 설명을 입력해보세요.');
                          return;
                        }
                        
                        // 다음 이미지 선택 (순환) - 첫 클릭 시 0번 이미지부터 시작
                        const nextIndex = (currentIndex + 1) % data.images.length;
                        const selectedImage = data.images[nextIndex];
                        
                        // 이미지 URL 업데이트 (입력 필드에도 바로 표시되도록 image에도 설정)
                        setCardForm({ 
                          ...cardForm, 
                          originalImage: selectedImage.url,
                          image: selectedImage.url, // 입력 필드에 URL 표시
                          imageTransform: null,
                          imageRecommendIndex: nextIndex
                        } as any);
                        
                        console.log(`AI 추천 이미지 적용: ${nextIndex + 1}/${data.images.length}`, selectedImage);
                      } catch (error) {
                        console.error('AI 이미지 추천 실패:', error);
                        alert('이미지 추천에 실패했습니다. 잠시 후 다시 시도해주세요.');
                      }
                    }}
                    className="whitespace-nowrap"
                  >
                    ✨ AI 추천
                  </Button>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <Label htmlFor="imageFileUpload" className="cursor-pointer">
                    <div className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <Upload className="w-4 h-4" />
                      <span className="text-sm">이미지 파일 업로드</span>
                    </div>
                  </Label>
                  <input
                    id="imageFileUpload"
                    type="file"
                    accept="image/gif,image/jpeg,image/jpg,image/png"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const formData = new FormData();
                        formData.append('file', file);
                        try {
                          const res = await fetch('/api/card-layout/upload-image', {
                            method: 'POST',
                            body: formData,
                          });
                          if (res.ok) {
                            const data = await res.json();
                            // 원본 이미지로 저장 (크롭 전)
                            setCardForm({ 
                              ...cardForm, 
                              originalImage: data.url,
                              image: "", // 크롭 전에는 최종 이미지 비우기
                              imageTransform: null
                            });
                          } else {
                            const error = await res.json();
                            alert(error.error || '이미지 업로드에 실패했습니다.');
                          }
                        } catch (error) {
                          console.error('Image upload failed:', error);
                          alert('이미지 업로드에 실패했습니다.');
                        }
                      }
                      e.target.value = '';
                    }}
                  />
                  {(cardForm.originalImage || cardForm.image) && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setLayoutEditorOpen(true)}
                        disabled={!cardForm.originalImage && !cardForm.image}
                      >
                        레이아웃
                      </Button>
                      <button
                        type="button"
                        onClick={() => setCardForm({ 
                          ...cardForm, 
                          image: "", 
                          originalImage: "",
                          imageTransform: null
                        })}
                        className="text-red-500 hover:text-red-700 px-2 py-1 text-sm"
                      >
                        이미지 제거
                      </button>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  GIF, JPG, JPEG, PNG 파일을 업로드하거나 이미지 URL을 직접 입력하세요.
                  {cardForm.originalImage && !cardForm.image && (
                    <span className="text-orange-600 dark:text-orange-400 block mt-1">
                      ⚠️ "레이아웃" 버튼을 눌러 이미지를 카드에 맞게 배치하세요.
                    </span>
                  )}
                </p>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>카드 색상</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const customColor = prompt('HEX 색상 코드를 입력하세요 (예: #A200FF 또는 A200FF):');
                      if (customColor) {
                        const hexColor = customColor.startsWith('#') ? customColor : `#${customColor}`;
                        if (/^#[0-9A-F]{6}$/i.test(hexColor)) {
                          setCardForm({ ...cardForm, color: hexColor });
                        } else {
                          alert('올바른 HEX 색상 코드를 입력하세요 (예: #A200FF)');
                        }
                      }
                    }}
                    className="h-8"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    커스텀 색상
                  </Button>
                </div>
                <div className="grid grid-cols-10 gap-2">
                  <button
                    key="none"
                    type="button"
                    onClick={() => setCardForm({ ...cardForm, color: '' })}
                    className={`
                      w-10 h-10 rounded-md border-2 transition-all flex items-center justify-center
                      bg-gray-200 dark:bg-gray-700
                      ${cardForm.color === '' ? 'border-black dark:border-white ring-2 ring-offset-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}
                      hover:scale-110
                    `}
                    title="기본"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                  {[
                    { name: 'PURPLE', value: '#A200FF' },
                    { name: 'MAGENTA', value: '#FF0097' },
                    { name: 'TEAL', value: '#00ABA9' },
                    { name: 'LIME', value: '#8CBF26' },
                    { name: 'BROWN', value: '#A05000' },
                    { name: 'PINK', value: '#E671B8' },
                    { name: 'ORANGE', value: '#F09609' },
                    { name: 'BLUE', value: '#1BA1E2' },
                    { name: 'RED', value: '#E51400' },
                    { name: 'GREEN', value: '#339933' },
                  ].map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setCardForm({ ...cardForm, color: color.value })}
                      className={`
                        w-10 h-10 rounded-md border-2 transition-all
                        ${cardForm.color === color.value ? 'border-black dark:border-white ring-2 ring-offset-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}
                        hover:scale-110
                      `}
                      style={{ backgroundColor: color.value }}
                      title={color.name}
                    />
                  ))}
                </div>
                {cardForm.color && !cardForm.color.startsWith('bg-') && (
                  <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded border">
                    <div 
                      className="w-6 h-6 rounded border border-gray-300" 
                      style={{ backgroundColor: cardForm.color }}
                    />
                    <span className="text-sm font-mono">{cardForm.color}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {cardForm.image ? '이미지가 있으면 색상은 무시됩니다' : '카드의 배경 색상을 선택하세요'}
                </p>
              </div>

              <div className="grid gap-2">
                <Label>카드 아이콘 (1x1 타일용)</Label>
                <div className="grid grid-cols-10 gap-2 max-h-40 overflow-y-auto p-2 border rounded-md">
                  <button
                    key="none"
                    type="button"
                    onClick={() => setCardForm({ ...cardForm, icon: "", customIcon: "" })}
                    className={`
                      w-10 h-10 rounded-md border-2 transition-all flex items-center justify-center
                      bg-gray-100 dark:bg-gray-800
                      ${!cardForm.icon && !cardForm.customIcon ? 'border-black dark:border-white ring-2 ring-offset-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}
                      hover:scale-110
                    `}
                    title="아이콘 없음"
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                  {AVAILABLE_ICONS.map((iconData) => {
                    const IconComponent = iconData.icon;
                    return (
                      <button
                        key={iconData.name}
                        type="button"
                        onClick={() => setCardForm({ ...cardForm, icon: iconData.name, customIcon: "" })}
                        className={`
                          w-10 h-10 rounded-md border-2 transition-all flex items-center justify-center
                          bg-white dark:bg-gray-800
                          ${cardForm.icon === iconData.name ? 'border-black dark:border-white ring-2 ring-offset-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}
                          hover:scale-110
                        `}
                        title={iconData.label}
                      >
                        <IconComponent className="w-5 h-5" />
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 items-center">
                  <Label htmlFor="customIconUpload" className="cursor-pointer">
                    <div className="flex items-center gap-2 px-3 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <Upload className="w-4 h-4" />
                      <span className="text-sm">PNG 아이콘 업로드</span>
                    </div>
                  </Label>
                  <input
                    id="customIconUpload"
                    type="file"
                    accept="image/png"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const formData = new FormData();
                        formData.append('file', file);
                        try {
                          const res = await fetch('/api/card-layout/upload-icon', {
                            method: 'POST',
                            body: formData,
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setCardForm({ ...cardForm, customIcon: data.url, icon: "" });
                          } else {
                            const error = await res.json();
                            alert(error.error || '아이콘 업로드에 실패했습니다.');
                          }
                        } catch (error) {
                          console.error('Icon upload failed:', error);
                          alert('아이콘 업로드에 실패했습니다.');
                        }
                      }
                    }}
                  />
                  {cardForm.customIcon && (
                    <div className="flex items-center gap-2">
                      <img src={cardForm.customIcon} alt="Custom icon" className="w-10 h-10 border rounded" />
                      <button
                        type="button"
                        onClick={() => setCardForm({ ...cardForm, customIcon: "" })}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  1x1 타일에 표시될 아이콘입니다. 커스텀 PNG 업로드 또는 표준 아이콘을 선택하세요.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="sizeX">가로 크기 (1-4)</Label>
                  <Input
                    id="sizeX"
                    type="number"
                    min="1"
                    max="4"
                    value={cardForm.gridSizeX}
                    onChange={(e) =>
                      setCardForm({ ...cardForm, gridSizeX: parseInt(e.target.value) || 1 })
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="sizeY">세로 크기 (1-4)</Label>
                  <Input
                    id="sizeY"
                    type="number"
                    min="1"
                    max="4"
                    value={cardForm.gridSizeY}
                    onChange={(e) =>
                      setCardForm({ ...cardForm, gridSizeY: parseInt(e.target.value) || 1 })
                    }
                  />
                </div>
              </div>

              {cardForm.type === "chat" && (
                <div className="grid gap-2">
                  <Label>대상 채팅방</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => {
                      setChatRoomSearchQuery("");
                      setChatRoomSelectDialogOpen(true);
                    }}
                  >
                    {cardForm.chatRoomId ? (
                      <>
                        {(() => {
                          const conv = conversations.find((c: any) => c.id === cardForm.chatRoomId);
                          const group = groupChats.find((g: any) => g.id === cardForm.chatRoomId);
                          if (conv) {
                            const agent = agents.find((a: any) => a.id === conv.agentId);
                            return agent ? agent.name : `대화방 #${cardForm.chatRoomId}`;
                          }
                          if (group) return group.title;
                          return `채팅방 #${cardForm.chatRoomId}`;
                        })()}
                      </>
                    ) : (
                      "채팅방을 선택하세요"
                    )}
                  </Button>
                </div>
              )}

              {cardForm.type === "folder" && (
                <div className="grid gap-2">
                  <Label htmlFor="folderId">폴더 선택</Label>
                  <Select
                    value={cardForm.folderId?.toString() || ""}
                    onValueChange={(value) =>
                      setCardForm({ ...cardForm, folderId: value ? parseInt(value) : null })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="폴더를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id.toString()}>
                          {folder.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {cardForm.type === "link" && (
                <div className="grid gap-2">
                  <Label htmlFor="targetRoute">대상 페이지 경로 (라우트)</Label>
                  <Input
                    id="targetRoute"
                    type="text"
                    value={cardForm.targetRoute || ""}
                    onChange={(e) =>
                      setCardForm({
                        ...cardForm,
                        targetRoute: e.target.value,
                      })
                    }
                    placeholder="예: /management 또는 비워두고 채팅방 ID 입력"
                  />
                  <Label htmlFor="targetChatRoomId" className="mt-2">또는 대상 채팅방 ID</Label>
                  <Input
                    id="targetChatRoomId"
                    type="number"
                    value={cardForm.targetChatRoomId || ""}
                    onChange={(e) =>
                      setCardForm({
                        ...cardForm,
                        targetChatRoomId: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="채팅방 ID (라우트가 없을 때)"
                    disabled={!!cardForm.targetRoute}
                  />
                  <p className="text-xs text-muted-foreground">
                    페이지 경로를 입력하면 해당 페이지로, 채팅방 ID를 입력하면 채팅방으로 이동합니다.
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex flex-row justify-between items-center w-full flex-shrink-0">
            {editingCard ? (
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (confirm("정말로 이 카드를 삭제하시겠습니까?")) {
                    handleDeleteCard(editingCard.id);
                    setEditDialogOpen(false);
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                삭제
              </Button>
            ) : (
              <div></div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                취소
              </Button>
              <Button onClick={handleSaveCard}>저장</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 폴더 생성 다이얼로그 */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 폴더 생성</DialogTitle>
            <DialogDescription>폴더 정보를 입력하세요.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="folderTitle">폴더 이름</Label>
              <Input
                id="folderTitle"
                value={folderForm.title}
                onChange={(e) => setFolderForm({ ...folderForm, title: e.target.value })}
                placeholder="폴더 이름"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="folderDescription">설명</Label>
              <Textarea
                id="folderDescription"
                value={folderForm.description}
                onChange={(e) => setFolderForm({ ...folderForm, description: e.target.value })}
                placeholder="폴더 설명 (선택사항)"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleSaveFolder}>생성</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 채팅방 선택 다이얼로그 */}
      <Dialog open={chatRoomSelectDialogOpen} onOpenChange={setChatRoomSelectDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>채팅방 선택</DialogTitle>
            <DialogDescription>
              카드에 연결할 채팅방을 선택하세요.
            </DialogDescription>
          </DialogHeader>

          {/* 검색창 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="채팅방 검색..."
              value={chatRoomSearchQuery}
              onChange={(e) => setChatRoomSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-6">
              {/* 1:1 대화방 섹션 */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
                  <MessageSquare className="h-4 w-4" />
                  1:1 대화방
                </h3>
                <div className="space-y-2">
                  {conversations
                    .filter((conv: any) => {
                      if (!chatRoomSearchQuery) return true;
                      const agent = agents.find((a: any) => a.id === conv.agentId);
                      const agentName = agent?.name || "";
                      return agentName.toLowerCase().includes(chatRoomSearchQuery.toLowerCase());
                    })
                    .map((conv: any) => {
                      const agent = agents.find((a: any) => a.id === conv.agentId);
                      return (
                        <button
                          key={conv.id}
                          onClick={() => {
                            setCardForm({ ...cardForm, chatRoomId: conv.id });
                            setChatRoomSelectDialogOpen(false);
                          }}
                          className={`
                            w-full text-left p-3 rounded-lg border transition-colors
                            ${
                              cardForm.chatRoomId === conv.id
                                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                : "border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                            }
                          `}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{agent?.name || `에이전트 #${conv.agentId}`}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                ID: {conv.id}
                              </div>
                            </div>
                            <MessageSquare className="h-5 w-5 text-gray-400" />
                          </div>
                        </button>
                      );
                    })}
                  {conversations.filter((conv: any) => {
                    if (!chatRoomSearchQuery) return true;
                    const agent = agents.find((a: any) => a.id === conv.agentId);
                    const agentName = agent?.name || "";
                    return agentName.toLowerCase().includes(chatRoomSearchQuery.toLowerCase());
                  }).length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      검색 결과가 없습니다.
                    </p>
                  )}
                </div>
              </div>

              {/* 그룹 채팅 섹션 */}
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">
                  <Users className="h-4 w-4" />
                  그룹 채팅
                </h3>
                <div className="space-y-2">
                  {groupChats
                    .filter((group: any) => {
                      if (!chatRoomSearchQuery) return true;
                      return group.title.toLowerCase().includes(chatRoomSearchQuery.toLowerCase());
                    })
                    .sort((a: any, b: any) => {
                      // 최근 사용 순으로 정렬 (updatedAt 기준)
                      return new Date(b.updatedAt || b.createdAt).getTime() - 
                             new Date(a.updatedAt || a.createdAt).getTime();
                    })
                    .map((group: any) => (
                      <button
                        key={group.id}
                        onClick={() => {
                          setCardForm({ ...cardForm, chatRoomId: group.id });
                          setChatRoomSelectDialogOpen(false);
                        }}
                        className={`
                          w-full text-left p-3 rounded-lg border transition-colors
                          ${
                            cardForm.chatRoomId === group.id
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                              : "border-gray-200 dark:border-gray-700 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                          }
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{group.title}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              ID: {group.id}
                            </div>
                          </div>
                          <Users className="h-5 w-5 text-gray-400" />
                        </div>
                      </button>
                    ))}
                  {groupChats.filter((group: any) => {
                    if (!chatRoomSearchQuery) return true;
                    return group.title.toLowerCase().includes(chatRoomSearchQuery.toLowerCase());
                  }).length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                      검색 결과가 없습니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChatRoomSelectDialogOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 이미지 레이아웃 편집 모달 */}
      {layoutEditorOpen && (cardForm.originalImage || cardForm.image) && (
        <ImageLayoutEditor
          imageUrl={cardForm.originalImage || cardForm.image}
          cardWidth={cardForm.gridSizeX}
          cardHeight={cardForm.gridSizeY}
          cardX={editingCard?.positionX || 0}
          cardY={editingCard?.positionY || 0}
          initialTransform={cardForm.imageTransform || undefined}
          onSave={handleCropComplete}
          onCancel={() => setLayoutEditorOpen(false)}
        />
      )}
    </div>
  );
}
