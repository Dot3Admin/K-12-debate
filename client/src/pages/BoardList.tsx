import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { format } from "date-fns";

interface Board {
  id: number;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export default function BoardList() {
  const [, setLocation] = useLocation();

  const { data: boards = [], isLoading } = useQuery<Board[]>({
    queryKey: ["/api/boards"],
  });

  const handleGoBack = () => {
    setLocation("/");
  };

  const handleBoardClick = (boardId: number) => {
    setLocation(`/boards/${boardId}`);
  };

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
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={handleGoBack}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">게시판</h1>
      </div>

      {/* 게시판 목록 */}
      <div className="flex-1 overflow-y-auto p-4">
        {boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <MessageSquare className="w-12 h-12 mb-2 opacity-50" />
            <p>게시판이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => handleBoardClick(board.id)}
                className="w-full bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-all border border-gray-200 text-left"
              >
                <div className="flex items-start gap-3">
                  {/* 아이콘 */}
                  <div
                    className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
                      board.color || "bg-blue-500"
                    }`}
                  >
                    <MessageSquare className="w-6 h-6 text-white" />
                  </div>

                  {/* 게시판 정보 */}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-900 mb-1">
                      {board.title}
                    </h2>
                    {board.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {board.description}
                      </p>
                    )}
                  </div>

                  {/* 화살표 */}
                  <div className="flex-shrink-0 text-gray-400">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
