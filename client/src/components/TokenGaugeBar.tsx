import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Zap, TrendingUp, DollarSign, Activity, Settings, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TokenStats {
  totalTokens: number;
  totalCost: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

interface TokenUsageEntry {
  id: number;
  userId: string | null;
  agentId: number | null;
  conversationId: number | null;
  groupChatId: number | null;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: string;
  requestDuration: number | null;
  metadata: any;
  timestamp: string;
}

interface TokenGaugeBarProps {
  limit?: number;
  period?: number;
}

export function TokenGaugeBar({ limit: initialLimit = 1000000, period = 24 }: TokenGaugeBarProps) {
  const [showCriticalHit, setShowCriticalHit] = useState(false);
  const [lastTokenCount, setLastTokenCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showUsageHistory, setShowUsageHistory] = useState(false);
  const [limit, setLimit] = useState(initialLimit);
  const [tempLimit, setTempLimit] = useState(initialLimit.toString());

  const { data: stats, isLoading } = useQuery<TokenStats>({
    queryKey: ["/api/admin/token-stats", period],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (period) params.append("period", period.toString());
      const res = await fetch(`/api/admin/token-stats?${params}`);
      if (!res.ok) throw new Error("Failed to fetch token stats");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: usageHistory } = useQuery<TokenUsageEntry[]>({
    queryKey: ["/api/token-usage/recent"],
    queryFn: async () => {
      const res = await fetch("/api/token-usage/recent?limit=10");
      if (!res.ok) throw new Error("Failed to fetch usage history");
      return res.json();
    },
    enabled: showUsageHistory,
  });

  const totalTokens = stats?.totalTokens || 0;
  const percentage = Math.min((totalTokens / limit) * 100, 100);
  const totalCost = Number(stats?.totalCost) || 0;
  const remainingTokens = Math.max(limit - totalTokens, 0);

  useEffect(() => {
    if (totalTokens > lastTokenCount) {
      const tokenDiff = totalTokens - lastTokenCount;
      if (tokenDiff > 1000) {
        setShowCriticalHit(true);
        setTimeout(() => setShowCriticalHit(false), 2000);
      }
    }
    setLastTokenCount(totalTokens);
  }, [totalTokens]);

  const getBarColor = () => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 75) return "bg-orange-500";
    if (percentage >= 50) return "bg-yellow-500";
    return "bg-green-500";
  };

  const getGlowColor = () => {
    if (percentage >= 90) return "shadow-red-500/50";
    if (percentage >= 75) return "shadow-orange-500/50";
    if (percentage >= 50) return "shadow-yellow-500/50";
    return "shadow-green-500/50";
  };

  const shouldBlink = percentage >= 75;

  const handleSaveLimit = () => {
    const newLimit = parseInt(tempLimit.replace(/,/g, ''));
    if (!isNaN(newLimit) && newLimit > 0) {
      setLimit(newLimit);
      setTempLimit(newLimit.toString());
      localStorage.setItem('token_limit', newLimit.toString());
      setShowSettings(false);
    } else {
      alert('유효한 토큰 한도를 입력해주세요 (1 이상의 숫자)');
    }
  };

  useEffect(() => {
    const savedLimit = localStorage.getItem('token_limit');
    if (savedLimit) {
      const parsedLimit = parseInt(savedLimit);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        setLimit(parsedLimit);
        setTempLimit(parsedLimit.toString());
      }
    }
  }, []);

  if (isLoading) {
    return (
      <div className="w-full bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 animate-pulse">
        <div className="h-12 md:h-10" />
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 w-full bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 border-b border-gray-700 shadow-lg">
      {showCriticalHit && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-yellow-400 font-bold text-xl animate-bounce">
            🔥 Critical Token!
          </div>
        </div>
      )}

      <div className="max-w-full mx-auto px-3 py-2 md:py-1.5">
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => setShowUsageHistory(true)}
            className="text-xs text-gray-300 min-w-fit hover:bg-gray-700 px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
            title="토큰 사용 내역 보기"
          >
            <History className="w-3 h-3" />
            <span className="font-mono">사용: {totalTokens.toLocaleString()}</span>
          </button>

          <div className="flex-1 min-w-0">
            <div className="relative h-6 bg-gray-700 rounded-full overflow-hidden shadow-inner">
              <div
                className={`absolute inset-y-0 left-0 ${getBarColor()} ${
                  shouldBlink ? "animate-pulse" : ""
                } transition-all duration-500 ease-out shadow-lg ${getGlowColor()}`}
                style={{ width: `${percentage}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-white drop-shadow-md z-10">
                  {percentage.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-300 min-w-fit">
            <span className="font-mono">남음: {remainingTokens.toLocaleString()}</span>
          </div>

          <div className="flex items-center gap-2 md:gap-3 text-xs text-gray-300 min-w-fit border-l border-gray-600 pl-2 md:pl-3">
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-yellow-400" />
              <span className="font-mono font-semibold">{limit.toLocaleString()}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1 hover:bg-gray-700 px-2 py-1 rounded transition-colors cursor-pointer"
              title="토큰 한도 설정"
            >
              <DollarSign className="w-3 h-3 text-green-400" />
              <span className="font-mono">${totalCost.toFixed(4)}</span>
            </button>
            <div className="hidden lg:flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-purple-400" />
              <span>{stats?.requestCount || 0} 요청</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>토큰 모니터링 설정</DialogTitle>
            <DialogDescription>
              월간 토큰 한도를 설정하세요. 게이지 바는 이 한도를 기준으로 표시됩니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="token-limit">월간 토큰 한도</Label>
              <Input
                id="token-limit"
                type="number"
                value={tempLimit}
                onChange={(e) => setTempLimit(e.target.value)}
                placeholder="1000000"
                min="1"
              />
              <p className="text-xs text-muted-foreground">
                현재 사용량: {totalTokens.toLocaleString()} 토큰 ({percentage.toFixed(1)}%)
              </p>
            </div>

            <div className="space-y-2">
              <Label>예상 비용</Label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="p-2 bg-muted rounded">
                  <div className="text-xs text-muted-foreground">현재 비용</div>
                  <div className="font-mono font-semibold">${totalCost.toFixed(4)}</div>
                </div>
                <div className="p-2 bg-muted rounded">
                  <div className="text-xs text-muted-foreground">요청 수</div>
                  <div className="font-mono font-semibold">{stats?.requestCount || 0}회</div>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Settings className="w-4 h-4 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                <div className="text-xs text-yellow-800 dark:text-yellow-200">
                  <strong>알림 임계값:</strong>
                  <ul className="mt-1 space-y-1 ml-2">
                    <li>• 75% 도달: 주황색 + 깜빡임</li>
                    <li>• 90% 도달: 빨간색 + 깜빡임</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowSettings(false)}>
              취소
            </Button>
            <Button onClick={handleSaveLimit}>
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showUsageHistory} onOpenChange={setShowUsageHistory}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>최근 토큰 사용 내역</DialogTitle>
            <DialogDescription>
              최근 10개의 AI 요청 내역을 확인할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2">
            {usageHistory && usageHistory.length > 0 ? (
              usageHistory.map((entry, index) => {
                const timestamp = new Date(entry.timestamp);
                const cost = parseFloat(entry.estimatedCost);
                
                const getFeatureLabel = (feature: string) => {
                  const labels: Record<string, string> = {
                    'chat-response': '💬 채팅',
                    'vision-api': '🖼️ Vision API',
                    'document-analysis': '📄 문서 분석',
                    'image-generation': '🎨 이미지 생성',
                  };
                  return labels[feature] || feature;
                };

                return (
                  <div
                    key={entry.id}
                    className="border rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold">{getFeatureLabel(entry.feature)}</span>
                          <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                            {entry.model}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600 dark:text-gray-400 mt-2">
                          <div>
                            <span className="text-gray-500">입력:</span>{' '}
                            <span className="font-mono">{entry.promptTokens.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">출력:</span>{' '}
                            <span className="font-mono">{entry.completionTokens.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">총:</span>{' '}
                            <span className="font-mono font-semibold">{entry.totalTokens.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">비용:</span>{' '}
                            <span className="font-mono text-green-600 dark:text-green-400">
                              ${cost.toFixed(4)}
                            </span>
                          </div>
                        </div>

                        {entry.requestDuration && (
                          <div className="text-xs text-gray-500 mt-1">
                            ⏱️ {(entry.requestDuration / 1000).toFixed(2)}초
                          </div>
                        )}
                      </div>

                      <div className="text-right text-xs text-gray-500 shrink-0">
                        <div>{timestamp.toLocaleDateString('ko-KR')}</div>
                        <div>{timestamp.toLocaleTimeString('ko-KR')}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-gray-500">
                사용 내역이 없습니다.
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowUsageHistory(false)}>
              닫기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
