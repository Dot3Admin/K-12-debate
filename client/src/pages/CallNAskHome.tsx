import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, Search, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { TrendingTopic } from "@shared/schema";
import { CALLNASK_CATEGORY_LABELS, type CallnaskCategory } from "@shared/schema";

interface Candidate {
  fullName: string;
  primaryDescriptor: string;
  notability: number;
  confidence: number;
  isUnique: boolean;
}

interface CallNAskHomeProps {
  embedCode: string;
  guestToken: string | null;
  onCharacterCreated?: () => void;
}

const categoryIcons: Record<string, string> = {
  all: "🌐",
  philosophy: "💭",
  science: "🔬",
  art: "🎨",
  politics: "⚖️",
  economy: "💼"
};

export default function CallNAskHome({ embedCode, guestToken, onCharacterCreated }: CallNAskHomeProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CallnaskCategory>("all");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: trendingTopics = [] } = useQuery<TrendingTopic[]>({
    queryKey: [`/api/embed/${embedCode}/trending`, selectedCategory],
    enabled: !!guestToken,
    queryFn: async () => {
      const response = await fetch(
        `/api/embed/${embedCode}/trending?category=${selectedCategory}`,
        {
          headers: {
            'Authorization': `Bearer ${guestToken}`,
            'Origin': window.location.origin
          }
        }
      );
      if (!response.ok) throw new Error('Failed to fetch trending topics');
      return response.json();
    },
  });

  const disambiguateMutation = useMutation({
    mutationFn: async (characterName: string) => {
      const response = await fetch(`/api/embed/${embedCode}/disambiguate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ characterName }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to search character');
      }
      return response.json();
    },
    onSuccess: (data: { status: 'unique' | 'needsSelection'; candidates: Candidate[] }) => {
      if (data.status === 'unique' && data.candidates.length > 0) {
        if (!confirmCharacterMutation.isPending) {
          confirmCharacterMutation.mutate(data.candidates[0]);
        }
      } else {
        toast({
          title: "여러 인물 발견",
          description: "더 구체적인 이름을 입력해 주세요.",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "인물 검색에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const confirmCharacterMutation = useMutation({
    mutationFn: async (candidate: Candidate) => {
      const response = await fetch(`/api/embed/${embedCode}/confirm-character`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ candidate }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create character');
      }
      return response.json();
    },
    onSuccess: () => {
      setSearchQuery("");
      if (onCharacterCreated) {
        onCharacterCreated();
      }
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "캐릭터 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSearch = (query: string) => {
    if (!query.trim()) return;
    if (disambiguateMutation.isPending || confirmCharacterMutation.isPending) {
      console.log('[CallNAsk] Already processing, ignoring duplicate request');
      return;
    }
    disambiguateMutation.mutate(query.trim());
  };

  const handleTrendingSelect = (topic: TrendingTopic) => {
    handleSearch(topic.title);
  };

  const categories = Object.keys(CALLNASK_CATEGORY_LABELS) as CallnaskCategory[];

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-12 md:py-20 max-w-4xl">
        <div className="flex flex-col items-center space-y-8">
          <div className="text-center space-y-3">
            <h1 
              className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white"
              data-testid="text-slogan"
            >
              관점을 불러 답을 구합니다.
            </h1>
            <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
              누구의 관점으로도 질문할 수 있습니다
            </p>
          </div>

          <div className="w-full max-w-3xl relative">
            <div className="relative">
              <Input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(e.target.value.length > 0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    handleSearch(searchQuery);
                  }
                  if (e.key === 'Escape') {
                    setShowSuggestions(false);
                  }
                }}
                onFocus={() => setShowSuggestions(searchQuery.length > 0)}
                placeholder='누구의 관점으로 무엇을 알고 싶나요? 예: "칸트의 윤리관", "블록체인 기술 설명"'
                className="h-14 md:h-16 pr-24 pl-6 text-base md:text-lg rounded-2xl border-2 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-400 shadow-lg"
                data-testid="input-search"
                aria-label="검색 입력"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                  disabled
                  data-testid="button-voice-search"
                  aria-label="음성 검색 (곧 제공 예정)"
                >
                  <Mic className="h-5 w-5 text-gray-400" />
                </Button>
                <Button
                  size="icon"
                  className="h-10 w-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handleSearch(searchQuery)}
                  disabled={!searchQuery.trim()}
                  data-testid="button-search"
                  aria-label="검색"
                >
                  <Search className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {showSuggestions && searchQuery.trim() && (
              <Card className="absolute top-full mt-2 w-full shadow-xl z-10">
                <CardContent className="p-3">
                  <div className="text-sm text-gray-500 mb-2">추천 검색어</div>
                  {trendingTopics.slice(0, 5).map((topic) => (
                    <button
                      key={topic.id}
                      onClick={() => {
                        setSearchQuery(topic.title);
                        setShowSuggestions(false);
                        handleSearch(topic.title);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-2"
                      data-testid={`suggestion-${topic.id}`}
                    >
                      <span className="text-lg">{topic.iconEmoji || categoryIcons[topic.category]}</span>
                      <span className="text-sm">{topic.title}</span>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="w-full max-w-3xl">
            <div className="flex flex-wrap gap-2 justify-center mb-6" role="tablist">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`
                    px-4 py-2 rounded-full text-sm font-medium transition-all min-h-[44px]
                    ${selectedCategory === category 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500'
                    }
                  `}
                  data-testid={`filter-${category}`}
                  role="tab"
                  aria-selected={selectedCategory === category}
                  aria-label={`${CALLNASK_CATEGORY_LABELS[category]} 카테고리`}
                >
                  <span className="mr-1">{categoryIcons[category]}</span>
                  {CALLNASK_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                지금 인기 있는 관점
              </h2>
              <div 
                className="flex overflow-x-auto gap-4 pb-4 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                role="region"
                aria-label="인기 관점 목록"
              >
                {trendingTopics.map((topic) => (
                  <Card
                    key={topic.id}
                    className="min-w-[280px] cursor-pointer hover:shadow-xl transition-shadow"
                    onClick={() => handleTrendingSelect(topic)}
                    data-testid={`trending-card-${topic.id}`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTrendingSelect(topic);
                      }
                    }}
                    aria-label={`${topic.title} 관점 선택`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="text-3xl">
                          {topic.iconEmoji || categoryIcons[topic.category]}
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {CALLNASK_CATEGORY_LABELS[topic.category as CallnaskCategory] || topic.category}
                        </Badge>
                      </div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                        {topic.title}
                      </h3>
                      {topic.subtitle && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                          {topic.subtitle}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-xs text-gray-500">
                          {topic.clickCount}회 조회
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
                
                {trendingTopics.length === 0 && (
                  <div className="w-full text-center py-12 text-gray-500">
                    아직 인기 관점이 없습니다
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
            관점은 AI가 자동으로 생성하며, 실제 인물이나 전문가의 의견이 아닐 수 있습니다
          </div>
        </div>
      </div>
    </div>
  );
}
