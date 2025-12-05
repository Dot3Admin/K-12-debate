import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import CallNAskUnified from "./CallNAskUnified";

interface Agent {
  id: number;
  name: string;
  icon: string;
  backgroundColor: string;
  category?: string;
  description?: string;
}

export default function CallNAskEmbed() {
  const { embedCode } = useParams<{ embedCode: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [groupChatId, setGroupChatId] = useState<number | null>(null);
  const isRefreshing = useRef(false);

  // Token 리프레시 함수
  const refreshToken = () => {
    if (isRefreshing.current) {
      return;
    }
    
    isRefreshing.current = true;
    localStorage.removeItem(`callnask_token_${embedCode}`);
    setGuestToken(null);
    createSessionMutation.mutate();
  };

  // Guest 세션 생성
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const requestStartTime = Date.now();
      
      const response = await fetch(`/api/embed/${embedCode}/session`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Origin': window.location.origin
        },
        body: JSON.stringify({
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          referrer: document.referrer || null,
          requestStartTime,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to create session');
      }
      return response.json();
    },
    onSuccess: async (data: { token: string; expiresAt: string; groupChatId: number }) => {
      try {
        setGuestToken(data.token);
        setGroupChatId(data.groupChatId);
        localStorage.setItem(`callnask_token_${embedCode}`, data.token);
        localStorage.setItem(`callnask_groupChatId_${embedCode}`, String(data.groupChatId));
        console.log('[VERDICT] New session created, groupChatId:', data.groupChatId, 'expires:', data.expiresAt);
        
        queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/agents`] });
        queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
      } finally {
        isRefreshing.current = false;
      }
    },
    onError: () => {
      isRefreshing.current = false;
      toast({
        title: "오류",
        description: "세션 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // 에이전트 목록 조회
  const { data: agentsData } = useQuery<{ agents: Agent[]; maxAgents: number }>({
    queryKey: [`/api/embed/${embedCode}/agents`],
    enabled: !!guestToken,
    queryFn: async () => {
      const response = await fetch(`/api/embed/${embedCode}/agents`, {
        headers: { 
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        }
      });
      if (response.status === 401) {
        refreshToken();
        throw new Error('Token expired');
      }
      if (!response.ok) throw new Error('Failed to fetch agents');
      return response.json();
    },
    retry: false,
  });

  const agents = agentsData?.agents || [];

  // 초기 세션 복원
  useEffect(() => {
    const savedToken = localStorage.getItem(`callnask_token_${embedCode}`);
    const savedGroupChatId = localStorage.getItem(`callnask_groupChatId_${embedCode}`);
    if (savedToken) {
      setGuestToken(savedToken);
      if (savedGroupChatId) {
        setGroupChatId(parseInt(savedGroupChatId, 10));
      }
    } else {
      createSessionMutation.mutate();
    }
  }, [embedCode]);

  if (!guestToken) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">세션 초기화 중...</p>
        </div>
      </div>
    );
  }

  return (
    <CallNAskUnified
      embedCode={embedCode!}
      guestToken={guestToken}
      agents={agents}
      groupChatId={groupChatId || undefined}
      onAgentsUpdate={() => {
        queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/agents`] });
      }}
    />
  );
}
