import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function CallNAskPage() {
  const [, setLocation] = useLocation();
  const [isCreating, setIsCreating] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const createNewSession = async () => {
      try {
        console.log('[VERDICT 고정 URL] 새 세션 생성 시작...');

        // 1. 템플릿 목록 조회
        const roomsResponse = await fetch('/api/callnask/rooms');
        if (!roomsResponse.ok) {
          throw new Error('템플릿 목록을 불러올 수 없습니다.');
        }

        const rooms = await roomsResponse.json();
        console.log('[VERDICT 고정 URL] 전체 목록:', rooms);

        // 템플릿만 필터링
        const templates = rooms.filter((room: any) => room.isCallnaskTemplate === true);
        console.log('[VERDICT 고정 URL] 템플릿 목록:', templates);

        if (!templates || templates.length === 0) {
          throw new Error('사용 가능한 템플릿이 없습니다.');
        }

        // 2. 첫 번째 템플릿을 기본값으로 사용
        const defaultTemplate = templates[0];
        console.log('[VERDICT 고정 URL] 기본 템플릿 선택:', defaultTemplate);

        // 3. 템플릿 복제하여 새 세션 생성
        const cloneResponse = await fetch(`/api/callnask/rooms/${defaultTemplate.id}/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!cloneResponse.ok) {
          throw new Error('새 세션을 생성할 수 없습니다.');
        }

        const newRoom = await cloneResponse.json();
        console.log('[VERDICT 고정 URL] 새 세션 생성 완료:', newRoom);

        // 4. 새로운 embedCode로 리다이렉트
        console.log('[VERDICT 고정 URL] 리다이렉트:', `/callnask/${newRoom.embedCode}`);
        window.location.href = `/callnask/${newRoom.embedCode}`;
      } catch (err: any) {
        console.error('[VERDICT 고정 URL] 세션 생성 실패:', err);
        setError(err.message || '세션을 생성하는 중 오류가 발생했습니다.');
        setIsCreating(false);
      }
    };

    createNewSession();
  }, [setLocation]);

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4 p-8">
          <div className="text-red-500 dark:text-red-400 text-lg font-medium">
            오류가 발생했습니다
          </div>
          <div className="text-gray-600 dark:text-gray-400">
            {error}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <div className="text-xl font-medium text-gray-700 dark:text-gray-300">
          새로운 세션을 준비하고 있습니다...
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          잠시만 기다려주세요
        </div>
      </div>
    </div>
  );
}
