import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, ArrowLeft, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageReference, FollowUpQuestion } from "@shared/schema";

interface Agent {
  id: number;
  name: string;
  icon: string;
  backgroundColor: string;
  category?: string;
  description?: string;
}

interface Message {
  id: number;
  content: string;
  senderName?: string;
  agentId?: number;
  agentName?: string;
  agent?: Agent;
  createdAt: string;
  references?: MessageReference[];
  followUpQuestions?: FollowUpQuestion[];
}

interface CallNAskChatProps {
  embedCode: string;
  guestToken: string | null;
  selectedAgents: Agent[];
  onBack?: () => void;
}

export default function CallNAskChat({ embedCode, guestToken, selectedAgents, onBack }: CallNAskChatProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messageInput, setMessageInput] = useState("");
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCountWhenSent = useRef<number>(0);
  const lastSubmitTimeStamp = useRef<number>(0);
  const [hasShownWelcome, setHasShownWelcome] = useState(false);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: [`/api/embed/${embedCode}/messages`],
    enabled: !!guestToken,
    refetchInterval: 3000,
    queryFn: async () => {
      const response = await fetch(`/api/embed/${embedCode}/messages`, {
        headers: {
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        }
      });
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      const baseMessages = await response.json();
      
      const messagesWithExtras = await Promise.all(
        baseMessages.map(async (msg: Message) => {
          if (!msg.agentId) return msg;
          
          try {
            const [refsRes, followUpsRes] = await Promise.all([
              fetch(`/api/embed/${embedCode}/messages/${msg.id}/references`, {
                headers: {
                  'Authorization': `Bearer ${guestToken}`,
                  'Origin': window.location.origin
                }
              }),
              fetch(`/api/embed/${embedCode}/messages/${msg.id}/followups`, {
                headers: {
                  'Authorization': `Bearer ${guestToken}`,
                  'Origin': window.location.origin
                }
              })
            ]);
            
            const references = refsRes.ok ? await refsRes.json() : [];
            const followUpQuestions = followUpsRes.ok ? await followUpsRes.json() : [];
            
            return { ...msg, references, followUpQuestions };
          } catch (error) {
            console.error('Error fetching message extras:', error);
            return msg;
          }
        })
      );
      
      return messagesWithExtras;
    },
    retry: false,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await fetch(`/api/embed/${embedCode}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`,
          'Origin': window.location.origin
        },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send message');
      }
      return response.json();
    },
    onSuccess: () => {
      setMessageInput("");
      setIsWaitingForResponse(true);
      queryClient.invalidateQueries({ queryKey: [`/api/embed/${embedCode}/messages`] });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "메시지 전송에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    
    const currentTimeStamp = 'timeStamp' in e ? e.timeStamp : Date.now();
    if (currentTimeStamp === lastSubmitTimeStamp.current) {
      return;
    }
    lastSubmitTimeStamp.current = currentTimeStamp;
    
    if (sendMessageMutation.isPending || isWaitingForResponse) {
      return;
    }
    
    if (!messageInput.trim()) return;

    messageCountWhenSent.current = messages.length;
    sendMessageMutation.mutate(messageInput.trim());
  };

  const handleFollowUpClick = (question: string) => {
    setMessageInput(question);
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {}, timeStamp: Date.now() } as any;
      handleSubmit(fakeEvent);
    }, 100);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isWaitingForResponse && messages.length > messageCountWhenSent.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.agentId) {
        setIsWaitingForResponse(false);
      }
    }
  }, [messages, isWaitingForResponse]);

  useEffect(() => {
    if (selectedAgents.length > 0 && messages.length === 0 && !hasShownWelcome) {
      setHasShownWelcome(true);
    }
  }, [selectedAgents, messages.length, hasShownWelcome]);

  const formatMessageTime = (dateString: string) => {
    const messageDate = new Date(dateString);
    return messageDate.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const activeAgent = selectedAgents[0];

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 bg-gradient-to-b from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                className="h-10 w-10"
                data-testid="button-back"
                aria-label="뒤로 가기"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">CallNAsk</h1>
          </div>
        </div>
      </div>

      {activeAgent && (
        <div className="flex-shrink-0 mx-4 mt-4">
          <Card className="bg-gray-50 dark:bg-gray-800 border-none">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ backgroundColor: activeAgent.backgroundColor }}
                >
                  {activeAgent.icon?.startsWith('/uploads/') ? (
                    <img src={activeAgent.icon} alt={activeAgent.name} className="w-full h-full object-cover rounded-full" />
                  ) : (
                    <span>{activeAgent.icon || '🤖'}</span>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      현재 활성 관점: {activeAgent.name}
                    </h3>
                    {activeAgent.category && (
                      <Badge variant="secondary" className="text-xs">
                        {activeAgent.category}
                      </Badge>
                    )}
                  </div>
                  {activeAgent.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {activeAgent.description}
                    </p>
                  )}
                  {messages.length === 0 && (
                    <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 space-y-1">
                      <p className="font-medium">이 관점은 다음과 같은 시각을 기반으로 답변합니다:</p>
                      <ul className="list-disc list-inside space-y-1 text-xs text-gray-600 dark:text-gray-400">
                        <li>주요 분야: {activeAgent.category || '다양한 분야'}</li>
                        <li>관점 특징: AI가 생성한 개성 있는 시각</li>
                      </ul>
                      <p className="mt-2 text-xs">무엇이든 물어보세요. 이 관점으로 해석해 드립니다.</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => {
          const isUser = !message.agentId;
          const agent = message.agent;
          
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              data-testid={`message-${message.id}`}
            >
              <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
                {!isUser && agent && (
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                      style={{ backgroundColor: agent.backgroundColor }}
                    >
                      {agent.icon?.startsWith('/uploads/') ? (
                        <img src={agent.icon} alt={agent.name} className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <span>{agent.icon || '🤖'}</span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {agent.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatMessageTime(message.createdAt)}
                    </span>
                  </div>
                )}
                
                <div
                  className={`rounded-2xl px-4 py-3 ${
                    isUser
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                  }`}
                >
                  <div className="prose prose-sm max-w-none dark:prose-invert leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>

                {!isUser && message.references && message.references.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.references.map((ref, idx) => (
                      <a
                        key={ref.id}
                        href={ref.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        data-testid={`reference-${ref.id}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>{idx + 1}. {ref.title}</span>
                      </a>
                    ))}
                  </div>
                )}

                {!isUser && message.followUpQuestions && message.followUpQuestions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      이 관점에서 더 알아보기:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {message.followUpQuestions.map((followUp) => (
                        <Button
                          key={followUp.id}
                          variant="outline"
                          size="sm"
                          onClick={() => handleFollowUpClick(followUp.question)}
                          className="text-xs h-auto py-2 px-3 min-h-[44px]"
                          data-testid={`followup-${followUp.id}`}
                        >
                          {followUp.question}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {isUser && (
                  <div className="text-xs text-gray-500 mt-1 text-right">
                    {formatMessageTime(message.createdAt)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isWaitingForResponse && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            placeholder="메시지를 입력하세요..."
            className="flex-1"
            disabled={sendMessageMutation.isPending || isWaitingForResponse}
            data-testid="input-message"
            aria-label="메시지 입력"
          />
          <Button
            type="submit"
            disabled={!messageInput.trim() || sendMessageMutation.isPending || isWaitingForResponse}
            className="min-h-[44px] min-w-[44px]"
            data-testid="button-send"
            aria-label="전송"
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
