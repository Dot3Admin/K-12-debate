import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { useLocation } from "wouter";

interface BoardCardProps {
  width: number;
  height: number;
  title?: string;
  targetRoute?: string;
}

interface Board {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

interface BoardPost {
  id: number;
  boardId: number;
  title: string;
  content: string;
  createdBy: string;
  createdAt: string;
  viewCount: number;
}

export default function BoardCard({ width, height, title = "게시판", targetRoute }: BoardCardProps) {
  const [, setLocation] = useLocation();

  const boardId = targetRoute ? parseInt(targetRoute.split('/').pop() || '0', 10) : null;

  const { data: board } = useQuery<Board>({
    queryKey: [`/api/boards/${boardId}`],
    enabled: !!boardId,
  });

  const { data: posts = [], isLoading } = useQuery<BoardPost[]>({
    queryKey: [`/api/boards/${boardId}/posts`],
    enabled: !!boardId,
  });

  const handleCardClick = () => {
    if (targetRoute) {
      setLocation(targetRoute);
    }
  };

  const bgColor = board?.color || "#B91C1C";
  
  const stripHtml = (html: string) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  if (!targetRoute || !boardId) {
    return (
      <div 
        className="w-full h-full flex items-center justify-center relative overflow-hidden cursor-pointer"
        style={{ backgroundColor: bgColor, borderRadius: '4px' }}
      >
        <div className="text-center text-white p-4">
          <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-60" />
          <p className="text-xs opacity-80">게시판 연결 필요</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div 
        className="w-full h-full relative overflow-hidden cursor-pointer"
        style={{ backgroundColor: bgColor, borderRadius: '4px' }}
      >
        <div className="absolute inset-0 flex flex-col p-3">
          <div className="flex-1 flex flex-col justify-center">
            <div className="h-4 bg-white/20 rounded w-3/4 mb-1 animate-pulse"></div>
            <div className="h-3 bg-white/10 rounded w-1/2 animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div 
        className="w-full h-full relative overflow-hidden cursor-pointer"
        style={{ backgroundColor: bgColor, borderRadius: '4px' }}
      >
        <div className="absolute inset-0 flex flex-col p-3">
          <div className="flex-1 flex flex-col justify-center items-center text-white/60">
            <MessageCircle className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">게시물이 없습니다</p>
          </div>
        </div>
        <div className="absolute bottom-3 left-3">
          <MessageCircle className="w-5 h-5 text-white/60" />
        </div>
      </div>
    );
  }

  const post = posts[0];
  const gridArea = width * height;
  const cleanContent = stripHtml(post.content);

  const isSmallCard = width === 1 && height === 1;

  if (isSmallCard) {
    return (
      <div 
        onClick={handleCardClick}
        className="w-full h-full relative overflow-hidden cursor-pointer transition-all hover:brightness-110 active:brightness-95"
        style={{ backgroundColor: bgColor, borderRadius: '4px' }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3">
          <div className="flex-1 flex items-center justify-center">
            <MessageCircle className="w-10 h-10 text-white" strokeWidth={1.5} />
          </div>
          <div className="text-white text-center w-full">
            <h3 className="live-tile-subtitle line-clamp-1 truncate">{post.title}</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      onClick={handleCardClick}
      className="w-full h-full relative overflow-hidden cursor-pointer transition-all hover:brightness-110 active:brightness-95"
      style={{ backgroundColor: bgColor, borderRadius: '4px' }}
    >
      <div className="absolute inset-0 flex flex-col p-3">
        <div className="flex-1 flex flex-col justify-center text-white">
          <h3 className="live-tile-title mb-1 line-clamp-2">{post.title}</h3>
          {cleanContent && (
            <p className={`live-tile-subtitle text-white/80 ${
              gridArea <= 2 ? 'line-clamp-2' : 
              gridArea <= 4 ? 'line-clamp-3' : 
              'line-clamp-4'
            }`}>
              {cleanContent}
            </p>
          )}
        </div>
      </div>
      
      <div className="absolute bottom-3 left-3">
        <MessageCircle className="w-5 h-5 text-white/60" />
      </div>
    </div>
  );
}
