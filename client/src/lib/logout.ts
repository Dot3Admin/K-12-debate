import { queryClient } from './queryClient';

// 로그아웃 진행 중 플래그 (중복 실행 방지)
let isLoggingOut = false;

// 공통 로그아웃 함수
export const performLogout = async (): Promise<void> => {
  // 이미 로그아웃 진행 중이면 무시
  if (isLoggingOut) {
    console.log('[LOGOUT] 이미 로그아웃 진행 중입니다. 중복 실행 방지.');
    return;
  }

  isLoggingOut = true;
  console.log('[LOGOUT] 로그아웃 시작...');
  
  try {
    console.log('[LOGOUT] 서버에 로그아웃 요청 전송...');
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // 세션 쿠키 포함
    });
    
    if (response.ok) {
      console.log('[LOGOUT] ✅ 서버 로그아웃 성공');
    } else {
      console.error('[LOGOUT] ❌ 서버 로그아웃 실패, 상태 코드:', response.status);
    }
  } catch (error) {
    console.error('[LOGOUT] ❌ 로그아웃 요청 실패:', error);
  } finally {
    // 서버 응답 성공 여부와 관계없이 클라이언트 정리 수행
    console.log('[LOGOUT] 클라이언트 데이터 정리 중...');
    
    // 모든 캐시 데이터 클리어
    queryClient.clear();
    console.log('[LOGOUT] ✅ React Query 캐시 클리어 완료');
    
    // 로컬 스토리지 정리 (있다면)
    localStorage.clear();
    sessionStorage.clear();
    console.log('[LOGOUT] ✅ 로컬/세션 스토리지 클리어 완료');
    
    // 로그인 페이지로 강제 리다이렉트
    console.log('[LOGOUT] 로그인 페이지로 이동 중...');
    console.log('[LOGOUT] window.location.replace("/auth") 실행...');
    
    // 즉시 리다이렉트
    window.location.replace('/auth');
    
    // 리다이렉트 후 플래그 리셋 (실제로는 페이지가 리로드되므로 실행되지 않음)
    // 하지만 만약의 경우를 대비
    setTimeout(() => {
      isLoggingOut = false;
    }, 1000);
  }
};
