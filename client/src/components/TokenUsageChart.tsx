import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BarChart3, TrendingUp, Clock } from "lucide-react";

interface TokenUsageData {
  timestamp: Date;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface TokenUsageChartProps {
  className?: string;
}

export function TokenUsageChart({ className = "" }: TokenUsageChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<number>(24);

  const periods = [
    { label: "1h", hours: 1 },
    { label: "24h", hours: 24 },
    { label: "7d", hours: 168 },
    { label: "30d", hours: 720 },
  ];

  const { data: usageData, isLoading } = useQuery<TokenUsageData[]>({
    queryKey: ["/api/admin/token-usage/period", selectedPeriod],
    queryFn: async () => {
      const res = await fetch(`/api/admin/token-usage/period?hours=${selectedPeriod}`);
      if (!res.ok) throw new Error("Failed to fetch usage data");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const maxTokens = usageData ? Math.max(...usageData.map((d) => d.totalTokens), 1) : 1;

  const formatTime = (timestamp: Date) => {
    const date = new Date(timestamp);
    if (selectedPeriod <= 24) {
      return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 ${className}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            시간대별 토큰 소비
          </h3>
        </div>

        <div className="flex gap-2">
          {periods.map((period) => (
            <button
              key={period.hours}
              onClick={() => setSelectedPeriod(period.hours)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
                selectedPeriod === period.hours
                  ? "bg-blue-500 text-white shadow-md"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : usageData && usageData.length > 0 ? (
        <div className="space-y-4">
          <div className="h-64 flex items-end gap-1 md:gap-2">
            {usageData.map((data, index) => {
              const heightPercent = (data.totalTokens / maxTokens) * 100;
              const isHigh = heightPercent > 75;
              const isMedium = heightPercent > 50 && heightPercent <= 75;

              return (
                <div
                  key={index}
                  className="flex-1 group relative"
                  style={{ height: "100%" }}
                >
                  <div
                    className={`absolute bottom-0 left-0 right-0 rounded-t-sm transition-all duration-300 ${
                      isHigh
                        ? "bg-gradient-to-t from-red-500 to-red-400"
                        : isMedium
                        ? "bg-gradient-to-t from-orange-500 to-orange-400"
                        : "bg-gradient-to-t from-blue-500 to-blue-400"
                    } group-hover:opacity-80 cursor-pointer`}
                    style={{ height: `${heightPercent}%` }}
                  >
                    <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                      <div className="font-semibold">{formatTime(data.timestamp)}</div>
                      <div className="text-gray-300">토큰: {data.totalTokens.toLocaleString()}</div>
                      <div className="text-gray-300">비용: ${Number(data.totalCost).toFixed(4)}</div>
                      <div className="text-gray-300">요청: {data.requestCount}회</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2">
            {usageData.length > 0 && (
              <>
                <span>{formatTime(usageData[0].timestamp)}</span>
                <span>{formatTime(usageData[usageData.length - 1].timestamp)}</span>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {usageData.reduce((sum, d) => sum + d.totalTokens, 0).toLocaleString()}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">총 토큰</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                ${usageData.reduce((sum, d) => sum + Number(d.totalCost), 0).toFixed(4)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">총 비용</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {usageData.reduce((sum, d) => sum + d.requestCount, 0)}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">총 요청</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>사용 데이터가 없습니다</p>
          </div>
        </div>
      )}
    </div>
  );
}
