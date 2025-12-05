import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const CATEGORIES = [
  { key: "고민", color: "#ef4444", label: "고민" },
  { key: "질문", color: "#3b82f6", label: "질문" },
  { key: "연애", color: "#ec4899", label: "연애" },
  { key: "지역", color: "#10b981", label: "지역" },
  { key: "상병", color: "#f59e0b", label: "상병" },
  { key: "학업", color: "#8b5cf6", label: "학업" },
  { key: "진로", color: "#06b6d4", label: "진로" },
  { key: "기타", color: "#6b7280", label: "기타" },
];

export default function ConversationAnalytics() {
  const [, setLocation] = useLocation();
  const [selectedConversationId, setSelectedConversationId] = useState<string>("all");
  const [periodType, setPeriodType] = useState<"week" | "month">("month");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // 대화방 목록 조회
  const { data: conversations } = useQuery<any[]>({
    queryKey: ["/api/group-chats"],
  });
  
  // 분석 결과 조회
  const { data: analyticsData, refetch } = useQuery<any>({
    queryKey: [
      selectedConversationId === "all"
        ? `/api/conversation-analytics?periodType=${periodType}`
        : `/api/conversation-analytics?periodType=${periodType}&conversationId=${selectedConversationId}`
    ],
  });

  // 대화방별/전체 증분 분석 시작
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    
    try {
      // 기간 계산 - 정규화된 날짜 사용 (일관성 보장)
      const now = new Date();
      const periods = periodType === "week" ? 12 : 6; // 주: 12주, 월: 6개월
      
      // 전체 대화방 분석인지 확인
      const isAllConversations = selectedConversationId === "all";
      const targetConversations = isAllConversations 
        ? (conversations || [])
        : conversations?.filter((conv: any) => conv.id.toString() === selectedConversationId) || [];
      
      // 각 대화방에 대해 분석 수행
      for (const conv of targetConversations) {
        for (let i = 0; i < periods; i++) {
          let periodStart: Date;
          let periodEnd: Date;
          
          if (periodType === "week") {
            // ISO 주 시작 (월요일 00:00:00 ~ 일요일 23:59:59)
            const targetDate = new Date(now);
            targetDate.setDate(now.getDate() - (i * 7));
            const dayOfWeek = targetDate.getDay();
            const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            
            periodStart = new Date(targetDate);
            periodStart.setDate(targetDate.getDate() - daysFromMonday);
            periodStart.setHours(0, 0, 0, 0);
            
            periodEnd = new Date(periodStart);
            periodEnd.setDate(periodStart.getDate() + 6);
            periodEnd.setHours(23, 59, 59, 999);
          } else {
            // 월 시작/끝 (1일 00:00:00 ~ 말일 23:59:59)
            const year = now.getFullYear();
            const month = now.getMonth() - i;
            
            periodStart = new Date(year, month, 1, 0, 0, 0, 0);
            periodEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
          }
          
          // 대화방별 증분 분석 API 호출
          const response = await fetch("/api/conversation-analytics/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              conversationId: conv.id,
              periodType,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            }),
          });
          
          if (!response.ok) {
            const error = await response.json();
            console.error(`대화방 ${conv.id} 분석 실패:`, error);
          }
        }
      }
      
      // 분석 완료 후 결과 조회
      await refetch();
      alert(`${isAllConversations ? '전체 대화방' : '대화방'} 분석이 완료되었습니다.`);
    } catch (error) {
      console.error("분석 오류:", error);
      alert("분석 중 오류가 발생했습니다.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 차트 데이터 변환 - 전체 또는 선택한 대화방 데이터 필터링
  const chartData = (analyticsData?.analytics ?? [])
    .filter((item: any) => {
      if (selectedConversationId === "all") return true;
      return item.conversationId === parseInt(selectedConversationId);
    })
    .reduce((acc: any[], item: any) => {
      const date = new Date(item.periodStart);
      const label = periodType === "week"
        ? `${date.getMonth() + 1}/${date.getDate()}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      // 전체 대화방인 경우 같은 기간의 데이터를 합산
      const existing = acc.find((d: any) => d.period === label);
      if (existing) {
        // 카테고리 데이터 합산
        CATEGORIES.forEach(cat => {
          existing[cat.key] = (existing[cat.key] || 0) + (item.categoryData[cat.key] || 0);
        });
        existing._count = (existing._count || 0) + 1;
      } else {
        acc.push({
          period: label,
          ...item.categoryData,
          _count: 1,
          _periodStart: date.getTime(),
        });
      }
      return acc;
    }, [])
    .map((item: any) => {
      // 전체 대화방인 경우 평균값으로 변환
      if (selectedConversationId === "all" && item._count > 1) {
        const result: any = { period: item.period };
        CATEGORIES.forEach(cat => {
          result[cat.key] = item[cat.key] / item._count;
        });
        return result;
      }
      const { _count, _periodStart, ...rest } = item;
      return rest;
    })
    .sort((a: any, b: any) => {
      const aDate = new Date(a.period);
      const bDate = new Date(b.period);
      return aDate.getTime() - bDate.getTime();
    });

  // 선택한 대화방 정보
  const selectedConversation = conversations?.find(
    (conv: any) => conv.id.toString() === selectedConversationId
  );

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* 모바일 최적화 헤더 */}
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/management")}
          className="rounded-full"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          고민 및 질문 분석
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* 대화방 선택 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              분석할 대화방 선택
            </label>
            <Select value={selectedConversationId} onValueChange={setSelectedConversationId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="대화방을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 대화방</SelectItem>
                {conversations?.map((conv: any) => (
                  <SelectItem key={conv.id} value={conv.id.toString()}>
                    {conv.title || `대화방 ${conv.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 분석 컨트롤 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">분석 기간</label>
              <div className="flex gap-2">
                <Button
                  variant={periodType === "week" ? "default" : "outline"}
                  onClick={() => setPeriodType("week")}
                  disabled={isAnalyzing}
                  size="sm"
                >
                  주간
                </Button>
                <Button
                  variant={periodType === "month" ? "default" : "outline"}
                  onClick={() => setPeriodType("month")}
                  disabled={isAnalyzing}
                  size="sm"
                >
                  월간
                </Button>
              </div>
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className="w-full"
            >
              {isAnalyzing ? "분석 중..." : "대화 분석 시작"}
            </Button>
            
            {/* 이전 분석 날짜 표시 */}
            {(() => {
              const relevantAnalytics = (analyticsData?.analytics ?? [])
                .filter((item: any) => {
                  if (selectedConversationId === "all") return true;
                  return item.conversationId === parseInt(selectedConversationId);
                });
              
              if (relevantAnalytics.length > 0) {
                const latestAnalysis = relevantAnalytics.reduce((latest: any, current: any) => {
                  const latestDate = new Date(latest.updatedAt);
                  const currentDate = new Date(current.updatedAt);
                  return currentDate > latestDate ? current : latest;
                });
                
                const analysisDate = new Date(latestAnalysis.updatedAt);
                const formattedDate = `${analysisDate.getFullYear()}.${String(analysisDate.getMonth() + 1).padStart(2, '0')}.${String(analysisDate.getDate()).padStart(2, '0')} ${String(analysisDate.getHours()).padStart(2, '0')}:${String(analysisDate.getMinutes()).padStart(2, '0')}`;
                
                return (
                  <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 text-center">
                    📅 이전 분석: {formattedDate}
                  </p>
                );
              }
              
              return (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 text-center">
                  💡 이미 분석된 데이터는 건너뛰고 새로운 메시지만 분석합니다
                </p>
              );
            })()}
          </div>

          {/* 차트 영역 */}
          {chartData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-medium mb-2 text-gray-900 dark:text-gray-100">
                {selectedConversation?.agentName} - 카테고리별 대화 분포 (%)
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                대화방별 시간대별 카테고리 분석 결과
              </p>
              
              {/* 모바일 최적화된 차트 */}
              <div className="h-[350px] sm:h-[450px] -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart 
                    data={chartData}
                    margin={{ top: 5, right: 10, left: -10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="period"
                      tick={{ fill: "#6b7280", fontSize: 12 }}
                      tickMargin={10}
                    />
                    <YAxis
                      tick={{ fill: "#6b7280", fontSize: 12 }}
                      tickMargin={5}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1f2937",
                        border: "1px solid #374151",
                        borderRadius: "0.5rem",
                        color: "#f9fafb",
                        fontSize: "13px",
                      }}
                      formatter={(value: any) => `${value}%`}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: "13px" }}
                      iconSize={12}
                    />
                    {CATEGORIES.map((category) => (
                      <Line
                        key={category.key}
                        type="monotone"
                        dataKey={category.key}
                        stroke={category.color}
                        strokeWidth={2}
                        name={category.label}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 빈 상태 */}
          {chartData.length === 0 && !isAnalyzing && selectedConversationId && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-8 text-center shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                {(() => {
                  // 이미 분석된 적이 있는지 확인
                  const relevantAnalytics = (analyticsData?.analytics ?? [])
                    .filter((item: any) => {
                      if (selectedConversationId === "all") return true;
                      return item.conversationId === parseInt(selectedConversationId);
                    });
                  
                  if (relevantAnalytics.length > 0) {
                    return (
                      <>
                        📊 분석 완료!<br />
                        이 대화방의 모든 메시지가 분석되었습니다.<br />
                        <span className="text-xs text-gray-400 mt-2 inline-block">
                          (새로운 메시지가 있으면 "대화 분석 시작"을 눌러주세요)
                        </span>
                      </>
                    );
                  } else {
                    return (
                      <>
                        분석 결과가 없습니다.<br />
                        위에서 "대화 분석 시작" 버튼을 눌러주세요.<br />
                        <span className="text-xs text-gray-400 mt-2 inline-block">
                          (사용자가 작성한 메시지만 분석됩니다)
                        </span>
                      </>
                    );
                  }
                })()}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
