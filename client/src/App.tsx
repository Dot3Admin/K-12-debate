import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useIsTablet } from "@/hooks/use-tablet";
import { useSSE } from "@/hooks/useSSE";
import { useEffect, lazy, Suspense } from "react";
import AuthPage from "@/pages/auth-page";
import Home from "@/pages/Home";
import Chat from "@/pages/Chat";
import Management from "@/pages/Management";
import CreateGroupChat from "@/pages/CreateGroupChat";
import GroupChat from "@/pages/GroupChat";
import ChatSettings from "@/pages/ChatSettings";
import TabletLayout from "@/components/TabletLayout";
import NotFound from "@/pages/not-found";
import EmbedChat from "@/pages/EmbedChat";
import CallNAskEmbed from "@/pages/CallNAskEmbed";
import CallNAskPage from "@/pages/CallNAskPage";
import CardHome from "@/pages/CardHome";
import { TokenGaugeBar } from "@/components/TokenGaugeBar";

const MasterAdmin = lazy(() => import("@/pages/MasterAdmin"));
const CardLayoutEditor = lazy(() => import("@/pages/CardLayoutEditor"));
const BoardList = lazy(() => import("@/pages/BoardList"));
const BoardDetail = lazy(() => import("@/pages/BoardDetail"));
const BoardPostDetail = lazy(() => import("@/pages/BoardPostDetail"));
const BoardPostForm = lazy(() => import("@/pages/BoardPostForm"));
const BoardForm = lazy(() => import("@/pages/BoardForm"));
const AgentManagement = lazy(() => import("@/pages/AgentManagement"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const PersonalizationSettings = lazy(() => import("@/pages/PersonalizationSettings"));
const ConversationAnalytics = lazy(() => import("@/pages/ConversationAnalytics"));
const StyleDemo = lazy(() => import("@/components/StyleDemo"));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
  </div>
);

function MobileHomeRouter() {
  const { data: user } = useQuery<any>({ queryKey: ["/api/user"] });
  const isAdmin = user?.role === 'agent_admin' || user?.role === 'master_admin' || 
                  user?.role === 'operation_admin' || user?.userType === 'agent_admin' || 
                  user?.userType === 'master_admin';
  
  return isAdmin ? <Home /> : <CardHome />;
}

function Router() {
  const [location] = useLocation();
  const { isAuthenticated, isLoading, user } = useAuth();
  const isTablet = useIsTablet();
  
  // CallNAsk 페이지는 인증 불필요
  const isPublicCallNAskPage = location.startsWith('/callnask') || location.startsWith('/embed');
  
  // 운영자 권한 확인
  const isAdmin = user?.role === 'master_admin' || user?.role === 'operation_admin' || user?.role === 'agent_admin';
  
  // Setup SSE for real-time updates - always call hook but only connect when authenticated
  useSSE(isAuthenticated, user?.id);

  // 글로벌 프리로딩 - 인증된 사용자만
  const { data: preloadedChats, isLoading: preloadingLoading, isSuccess: preloadingSuccess } = useQuery<any>({
    queryKey: ["/api/preload-recent-chats"],
    enabled: isAuthenticated, // 인증된 사용자만 실행
    staleTime: 0, // Don't cache - always fetch fresh data to prevent showing hidden conversations
    gcTime: 0, // Don't keep in memory - prevents resurrection of hidden conversations
    retry: false, // 실패해도 재시도하지 않음 (백그라운드 기능이므로)
  });

  // 프리로딩 상태 로그
  useEffect(() => {
    if (isAuthenticated) {
      console.log('🚀 [APP PRELOAD] 프리로딩 상태:', {
        isAuthenticated,
        preloadingLoading,
        preloadingSuccess,
        preloadedData: !!preloadedChats
      });
    }
  }, [isAuthenticated, preloadingLoading, preloadingSuccess, preloadedChats]);

  // 프리로딩된 데이터를 React Query 캐시에 저장
  useEffect(() => {
    if (preloadingSuccess && preloadedChats?.preloadedChats) {
      console.log(`🚀 [APP PRELOAD] 캐시에 저장 중: ${preloadedChats.preloadedChats.length}개 채팅방`);
      
      preloadedChats.preloadedChats.forEach((chat: any) => {
        const queryKey = chat.type === 'group' 
          ? `/api/group-chats/${chat.id}/messages`
          : `/api/conversations/${chat.id}/messages`;
        
        // 기존 캐시 확인 (더 나은 데이터가 있으면 저장)
        const existingData = queryClient.getQueryData([queryKey]) as any[] | undefined;
        const existingCount = existingData?.length || 0;
        const preloadedCount = chat.messages?.length || 0;
        
        // 프리로딩된 데이터가 더 많거나, 기존 캐시가 없으면 저장
        if (!existingData || preloadedCount > existingCount) {
          queryClient.setQueryData([queryKey], chat.messages);
          console.log(`🚀 [APP PRELOAD] ${chat.type}:${chat.id}(${chat.title}) 캐시 저장 완료 - ${preloadedCount}개 메시지 (기존: ${existingCount}개)`);
        } else {
          console.log(`🚀 [APP PRELOAD] ${chat.type}:${chat.id}(${chat.title}) 캐시 스킵 - 기존 데이터가 더 좋음 (기존: ${existingCount}개, 프리로딩: ${preloadedCount}개)`);
        }
      });
    }
  }, [preloadingSuccess, preloadedChats]);

  // 공개 페이지는 인증 로딩 건너뛰기
  if (isLoading && !isPublicCallNAskPage) {
    return <LoadingFallback />;
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      {isAuthenticated && isAdmin && <TokenGaugeBar limit={1000000} period={24} />}
      <Switch>
        <Route path="/callnask">{() => <CallNAskPage />}</Route>
        <Route path="/callnask/:embedCode">{() => <CallNAskEmbed />}</Route>
        <Route path="/callnask/:embedCode/*">{() => <CallNAskEmbed />}</Route>
        <Route path="/embed/:embedCode/callnask">{() => <CallNAskEmbed />}</Route>
        <Route path="/embed/:embedCode">{() => <EmbedChat />}</Route>
        
        {!isAuthenticated ? (
          <>
            <Route path="/auth" component={AuthPage} />
            <Route path="/">
              {() => {
                window.location.replace("/auth");
                return null;
              }}
            </Route>
          </>
        ) : (
          <>
            <Route path="/master-admin">{() => <MasterAdmin />}</Route>
            <Route path="/style-demo">{() => <StyleDemo />}</Route>
          
          {isTablet ? (
            <>
              <Route path="/" component={TabletLayout} />
              <Route path="/chat/:agentId" component={TabletLayout} />
              <Route path="/management" component={TabletLayout} />
              <Route path="/management/:agentId" component={TabletLayout} />
              <Route path="/create-group-chat" component={TabletLayout} />
              <Route path="/group-chat/:groupChatId" component={TabletLayout} />
              <Route path="/group-chat/:groupChatId/agents" component={TabletLayout} />
              <Route path="/group-chat/:groupChatId/settings" component={TabletLayout} />
              <Route path="/group-chat/:groupChatId/members" component={TabletLayout} />
              <Route path="/personalization" component={TabletLayout} />
              <Route path="/agent-management" component={TabletLayout} />
              <Route path="/conversation-analytics" component={TabletLayout} />
              <Route path="/card-layout-editor">{() => <CardLayoutEditor />}</Route>
              <Route path="/boards">{() => <BoardList />}</Route>
              <Route path="/boards/new">{() => <BoardForm />}</Route>
              <Route path="/boards/:id/edit">{() => <BoardForm />}</Route>
              <Route path="/boards/:boardId/new-post">{() => <BoardPostForm />}</Route>
              <Route path="/boards/posts/:id/edit" component={TabletLayout} />
              <Route path="/boards/posts/:id" component={TabletLayout} />
              <Route path="/boards/:id" component={TabletLayout} />
            </>
          ) : (
            <>
              <Route path="/" component={MobileHomeRouter} />
              <Route path="/chat-home" component={Home} />
              <Route path="/card-layout-editor">{() => <CardLayoutEditor />}</Route>
              <Route path="/boards">{() => <BoardList />}</Route>
              <Route path="/boards/new">{() => <BoardForm />}</Route>
              <Route path="/boards/:id/edit">{() => <BoardForm />}</Route>
              <Route path="/boards/:id">{() => <BoardDetail />}</Route>
              <Route path="/boards/:boardId/new-post">{() => <BoardPostForm />}</Route>
              <Route path="/boards/posts/:id">{() => <BoardPostDetail />}</Route>
              <Route path="/boards/posts/:id/edit">{() => <BoardPostForm />}</Route>
              <Route path="/management" component={Home} />
              <Route path="/management/:agentId" component={Management} />
              <Route path="/chat/:agentId" component={Chat} />
              <Route path="/create-group-chat">{() => <CreateGroupChat />}</Route>
              <Route path="/group-chat/:groupChatId">{() => <GroupChat />}</Route>
              <Route path="/group-chat/:groupChatId/agents">{() => <AgentManagement />}</Route>
              <Route path="/group-chat/:groupChatId/settings" component={ChatSettings} />
              <Route path="/group-chat/:groupChatId/members">{() => <UserManagement />}</Route>
              <Route path="/personalization">{() => <PersonalizationSettings />}</Route>
              <Route path="/agent-management">
                {() => <AgentManagement isOperationsMode={true} />}
              </Route>
              <Route path="/conversation-analytics">{() => <ConversationAnalytics />}</Route>
            </>
          )}
        </>
      )}
        <Route path="/auth" component={AuthPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;