import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ChevronLeft, Settings, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";

import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "../contexts/LanguageContext";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import ChatInterface from "@/components/ChatInterface";
import type { Agent } from "@/types/agent";

export default function Chat() {
  const { agentId } = useParams<{ agentId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Listen for account settings event from ChatInterface
  useEffect(() => {
    const handleOpenAccountSettings = () => {
      setShowAccountModal(true);
    };

    window.addEventListener('openAccountSettings', handleOpenAccountSettings);
    return () => {
      window.removeEventListener('openAccountSettings', handleOpenAccountSettings);
    };
  }, []);

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: [`/api/agents/${agentId}`],
    enabled: !!agentId,
  });

  // Regular chat should never use management mode, even for managers
  const isManagementMode = false;

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        window.location.href = '/auth';
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center korean-text">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center korean-text">
            <p className="text-muted-foreground">에이전트를 찾을 수 없습니다.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ChatInterface will handle its own header - remove Chat.tsx header to prevent duplication */}
      <ChatInterface agent={agent} isManagementMode={isManagementMode || false} />

      {/* Account Settings Modal */}
      <AccountSettingsModal 
        isOpen={showAccountModal} 
        onClose={() => setShowAccountModal(false)} 
      />
    </div>
  );
}