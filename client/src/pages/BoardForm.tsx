import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "../hooks/useAuth";

interface Board {
  id: number;
  title: string;
  description: string | null;
}

interface CreatedBoard {
  id: number;
  title: string;
  description: string;
}

export default function BoardForm() {
  const [, params] = useRoute("/boards/:id/edit");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const boardId = params?.id ? parseInt(params.id) : null;
  const isEditMode = !!boardId;
  
  const [form, setForm] = useState({
    title: "",
    description: "",
  });
  
  const [createdBoard, setCreatedBoard] = useState<CreatedBoard | null>(null);

  const isAdmin = user?.role === "master_admin" || user?.role === "operation_admin" || user?.role === "agent_admin";

  // 수정 모드일 때 기존 게시판 데이터 로드
  const { data: existingBoard, isLoading, isError } = useQuery<Board>({
    queryKey: [`/api/boards/${boardId}`],
    enabled: isEditMode && !!boardId,
  });

  // 기존 게시판 데이터를 폼에 채우기
  useEffect(() => {
    if (existingBoard) {
      setForm({
        title: existingBoard.title,
        description: existingBoard.description || "",
      });
    }
  }, [existingBoard]);

  const createBoardMutation = useMutation({
    mutationFn: async (data: { title: string; description: string }) => {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || "게시판 생성에 실패했습니다");
      }
      
      return res.json();
    },
    onSuccess: (data: CreatedBoard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards"] });
      setCreatedBoard(data);
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const updateBoardMutation = useMutation({
    mutationFn: async (data: { title: string; description: string }) => {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || "게시판 수정에 실패했습니다");
      }
      
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boards"] });
      queryClient.invalidateQueries({ queryKey: [`/api/boards/${boardId}`] });
      alert("게시판이 수정되었습니다.");
      setLocation(`/boards/${boardId}`);
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!form.title.trim()) {
      alert("게시판 제목을 입력해주세요");
      return;
    }
    
    if (isEditMode) {
      updateBoardMutation.mutate(form);
    } else {
      createBoardMutation.mutate(form);
    }
  };
  
  const handleCreateCard = () => {
    setLocation(`/card-layout-editor?createBoardCard=true&boardId=${createdBoard?.id}&boardTitle=${encodeURIComponent(createdBoard?.title || "")}`);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            접근 권한이 없습니다
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            게시판 {isEditMode ? "수정" : "생성"}은 운영자만 가능합니다.
          </p>
          <Button onClick={() => setLocation("/boards")}>
            게시판 목록으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (isEditMode && isError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            게시판을 찾을 수 없습니다
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            존재하지 않거나 접근 권한이 없는 게시판입니다.
          </p>
          <Button onClick={() => setLocation("/boards")}>
            게시판 목록으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation(isEditMode ? `/boards/${boardId}` : "/boards")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            뒤로
          </Button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {isEditMode ? "게시판 수정" : "새 게시판 만들기"}
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">게시판 제목</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="게시판 제목을 입력하세요"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="게시판에 대한 설명을 입력하세요 (선택사항)"
                rows={4}
              />
            </div>

            {isEditMode ? (
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation(`/boards/${boardId}`)}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={updateBoardMutation.isPending}
                >
                  {updateBoardMutation.isPending ? "수정 중..." : "수정 완료"}
                </Button>
              </div>
            ) : !createdBoard ? (
              <div className="flex gap-3 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLocation("/boards")}
                >
                  취소
                </Button>
                <Button
                  type="submit"
                  disabled={createBoardMutation.isPending}
                >
                  {createBoardMutation.isPending ? "생성 중..." : "게시판 만들기"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <p className="text-green-800 dark:text-green-200 font-medium">
                    ✓ 게시판 "{createdBoard.title}"이(가) 성공적으로 생성되었습니다!
                  </p>
                </div>
                <div className="flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/boards")}
                  >
                    취소
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCreateCard}
                  >
                    새 카드로 만들기
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setLocation(`/boards/${createdBoard.id}`)}
                  >
                    게시판 보기
                  </Button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
