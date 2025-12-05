import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";

interface BoardPost {
  id: number;
  boardId: number;
  title: string;
  content: string;
  isPinned: boolean;
}

export default function BoardPostForm() {
  const [matchNew, paramsNew] = useRoute("/boards/:boardId/new-post");
  const [matchEdit, paramsEdit] = useRoute("/boards/posts/:id/edit");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const isEditMode = matchEdit;
  const boardId = matchNew ? parseInt(paramsNew.boardId) : 0;
  const postId = matchEdit ? parseInt(paramsEdit.id) : 0;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isPinned, setIsPinned] = useState(false);

  // 수정 모드일 때 기존 게시물 로드
  const { data: post } = useQuery<BoardPost>({
    queryKey: [`/api/boards/posts/${postId}`],
    enabled: isEditMode && !!postId,
  });

  useEffect(() => {
    if (post) {
      setTitle(post.title);
      setContent(post.content);
      setIsPinned(post.isPinned);
    }
  }, [post]);

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; isPinned: boolean }) => {
      const response = await fetch(`/api/boards/${boardId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error("게시물 작성에 실패했습니다.");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${boardId}/posts`] });
      setLocation(`/boards/${boardId}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; isPinned: boolean }) => {
      const response = await fetch(`/api/boards/posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error("게시물 수정에 실패했습니다.");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/boards/posts/${postId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${post?.boardId}/posts`] });
      setLocation(`/boards/posts/${postId}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !content.trim()) {
      alert("제목과 내용을 입력해주세요.");
      return;
    }

    if (isEditMode) {
      updateMutation.mutate({ title, content, isPinned });
    } else {
      createMutation.mutate({ title, content, isPinned });
    }
  };

  const handleGoBack = () => {
    if (isEditMode && post) {
      setLocation(`/boards/posts/${postId}`);
    } else {
      setLocation(`/boards/${boardId}`);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleGoBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              disabled={isPending}
            >
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              {isEditMode ? "게시물 수정" : "게시물 작성"}
            </h1>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 폼 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <form onSubmit={handleSubmit} className="divide-y divide-gray-200">
            {/* 제목 입력 */}
            <div className="p-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목을 입력하세요"
                className="w-full text-lg font-semibold border-none focus:outline-none focus:ring-0 p-0"
                disabled={isPending}
              />
            </div>

            {/* 내용 입력 */}
            <div className="p-4">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="내용을 입력하세요"
                rows={15}
                className="w-full border-none focus:outline-none focus:ring-0 p-0 resize-none"
                disabled={isPending}
              />
            </div>

            {/* 고정 옵션 */}
            <div className="p-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPinned}
                  onChange={(e) => setIsPinned(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  disabled={isPending}
                />
                <span className="text-sm text-gray-700">상단 고정</span>
              </label>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
