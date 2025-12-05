import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, Pin, Eye, Edit, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useAuth } from "../hooks/useAuth";

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

export default function BoardPostDetail() {
  const [, params] = useRoute("/boards/posts/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const postId = params?.id ? parseInt(params.id) : 0;

  const { data: post, isLoading } = useQuery<BoardPost>({
    queryKey: [`/api/boards/posts/${postId}`],
    enabled: !!postId,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
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
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${post?.boardId}/posts`] });
      setLocation(`/boards/${post?.boardId}`);
    },
  });

  const handleGoBack = () => {
    if (post) {
      setLocation(`/boards/${post.boardId}`);
    } else {
      setLocation("/boards");
    }
  };

  const handleDelete = async () => {
    if (confirm("정말로 이 게시물을 삭제하시겠습니까?")) {
      deleteMutation.mutate();
    }
  };

  const handleEdit = () => {
    setLocation(`/boards/posts/${postId}/edit`);
  };

  const isAdmin =
    user?.role === "master_admin" || user?.role === "operation_admin";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">게시물을 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={handleGoBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>

          {/* 운영자 액션 버튼 */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleEdit}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Edit className="w-5 h-5 text-gray-600" />
              </button>
              <button
                onClick={handleDelete}
                className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-5 h-5 text-red-600" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 게시물 내용 */}
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white">
          {/* 제목 영역 */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-start gap-2 mb-3">
              {post.isPinned && (
                <Pin className="w-5 h-5 text-blue-500 flex-shrink-0 mt-1" />
              )}
              <h1 className="text-xl font-bold text-gray-900">{post.title}</h1>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>
                {format(new Date(post.createdAt), "yyyy년 MM월 dd일 HH:mm", {
                  locale: ko,
                })}
              </span>
              <div className="flex items-center gap-1">
                <Eye className="w-4 h-4" />
                <span>조회 {post.viewCount}</span>
              </div>
            </div>
          </div>

          {/* 본문 영역 */}
          <div className="p-6">
            <div className="prose prose-sm max-w-none">
              <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                {post.content}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
