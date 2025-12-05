import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, Pin, Eye, Plus, Edit, Trash2, MoreVertical } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useAuth } from "../hooks/useAuth";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  authorId: string;
  isPinned: boolean;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function BoardDetail() {
  const [, params] = useRoute("/boards/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const boardId = params?.id ? parseInt(params.id) : 0;
  
  // 데스크탑 모드 감지 (768px 이상)
  const [isDesktopMode, setIsDesktopMode] = useState(window.innerWidth >= 768);
  
  useEffect(() => {
    const handleResize = () => {
      setIsDesktopMode(window.innerWidth >= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { data: board } = useQuery<Board>({
    queryKey: [`/api/boards/${boardId}`],
    enabled: !!boardId,
  });

  const { data: posts = [], isLoading } = useQuery<BoardPost[]>({
    queryKey: [`/api/boards/${boardId}/posts`],
    enabled: !!boardId,
  });

  const handleGoBack = () => {
    // 카드 홈으로 돌아가기
    setLocation("/");
  };

  const handlePostClick = (postId: number) => {
    setLocation(`/boards/posts/${postId}`);
  };

  const handleCreatePost = () => {
    setLocation(`/boards/${boardId}/new-post`);
  };

  const handleEditPost = (postId: number) => {
    setLocation(`/boards/posts/${postId}/edit`);
  };

  const deleteMutation = useMutation({
    mutationFn: async (postId: number) => {
      const response = await fetch(`/api/boards/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("게시물 삭제에 실패했습니다.");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${boardId}/posts`] });
    },
  });

  const handleDeletePost = (postId: number, postTitle: string) => {
    if (confirm(`"${postTitle}" 게시물을 삭제하시겠습니까?`)) {
      deleteMutation.mutate(postId);
    }
  };

  // 운영자 권한 체크
  const isAdmin =
    user?.role === "master_admin" || user?.role === "operation_admin" || user?.role === "agent_admin";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={handleGoBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              {board?.title || "게시판"}
            </h1>
          </div>

          {/* 우측 버튼들 (운영자만) */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLocation(`/boards/${boardId}/edit`)}
                className="px-3 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
              >
                <Edit className="w-4 h-4" />
                <span>게시판 수정</span>
              </button>
              <button
                onClick={handleCreatePost}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>글쓰기</span>
              </button>
            </div>
          )}
        </div>

        {board?.description && (
          <p className="text-sm text-gray-600 ml-12">{board.description}</p>
        )}
      </div>

      {/* 게시물 목록 */}
      <div className="flex-1 overflow-y-auto">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p>게시물이 없습니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {posts.map((post) => (
              <div
                key={post.id}
                className="w-full bg-white p-4 hover:bg-gray-50 transition-colors relative group"
              >
                <div
                  onClick={() => handlePostClick(post.id)}
                  className="cursor-pointer"
                >
                  <div className="flex items-start gap-2 mb-2">
                    {post.isPinned && (
                      <Pin className="w-4 h-4 text-blue-500 flex-shrink-0 mt-1" />
                    )}
                    <h3
                      className={`font-medium text-gray-900 flex-1 ${
                        post.isPinned ? "text-blue-600" : ""
                      }`}
                    >
                      {post.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      {format(new Date(post.createdAt), "yyyy.MM.dd", {
                        locale: ko,
                      })}
                    </span>
                    <div className="flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      <span>{post.viewCount}</span>
                    </div>
                  </div>
                </div>

                {/* 운영자 또는 작성자 메뉴 */}
                {(isAdmin || post.authorId === user?.id) && (
                  <div className="absolute top-3 right-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="p-1 hover:bg-gray-200 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-5 h-5 text-gray-600" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            handleEditPost(post.id);
                          }}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={(event) => {
                            event.preventDefault();
                            handleDeletePost(post.id, post.title);
                          }}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
