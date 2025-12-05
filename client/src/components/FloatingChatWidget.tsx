import { useState, useEffect } from "react";
import { MessageCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface FloatingChatWidgetProps {
  embedCode?: string;
}

export default function FloatingChatWidget({ embedCode = "help-chat" }: FloatingChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  // iframe 내부에서 보낸 closeChat 메시지 수신
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'closeChat') {
        setIsOpen(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <>
      <AnimatePresence mode="wait">
        {!isOpen ? (
          <motion.button
            key="chat-button"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={toggleChat}
            className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-full shadow-lg hover:shadow-xl hover:scale-110 transition-all duration-200 flex items-center justify-center z-50"
            aria-label="도움말 채팅 열기"
          >
            <MessageCircle className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></span>
          </motion.button>
        ) : (
          <motion.div
            key="chat-window"
            initial={{ scale: 0.8, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="fixed bottom-6 right-6 w-[380px] h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden border border-gray-200"
            style={{ transformOrigin: "bottom right" }}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                <span className="font-semibold">도움말 채팅</span>
              </div>
              <button
                onClick={toggleChat}
                className="p-1 hover:bg-white/20 rounded-full transition-colors"
                aria-label="채팅 닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Content - Embedded iframe */}
            <div className="flex-1 relative">
              <iframe
                src={`/embed/${embedCode}`}
                className="w-full h-full border-0"
                title="도움말 채팅"
                allow="clipboard-write"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Responsive */}
      <style>{`
        @media (max-width: 640px) {
          .fixed.bottom-6.right-6.w-\\[380px\\] {
            width: calc(100vw - 2rem);
            height: calc(100vh - 2rem);
            bottom: 1rem;
            right: 1rem;
          }
        }
      `}</style>
    </>
  );
}
