import { useRef } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import ChatInterface from "@/components/ChatInterface";
import type { Agent } from "@/types/agent";

export default function Management() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const chatInterfaceRef = useRef<any>(null);


  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: [`/api/agents/${agentId}`],
    enabled: !!agentId,
  });

  // Check if user is the manager of this agent or master admin
  const isAuthorized = agent && user && (agent.managerId === user.id || user.userType === 'admin' || user.id === 'master_admin');

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--neu-bg)' }}>
        <div className="flex justify-center items-center min-h-screen">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--neu-bg)' }}>
        <div className="text-center korean-text">
          <p className="text-muted-foreground">{t('admin:agent.notFound')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--neu-bg)' }}>
        <div className="text-center korean-text">
          <p className="text-muted-foreground">{t('error:general.agentUnauthorized')}</p>
        </div>
      </div>
    );
  }

  return (
    <ChatInterface 
      ref={chatInterfaceRef}
      agent={agent} 
      isManagementMode={true} 
    />
  );
}