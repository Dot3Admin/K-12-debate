import fs from 'fs';
import path from 'path';

async function cleanupUser1082Conversations() {
  try {
    // Load conversations
    const conversationsPath = path.join(process.cwd(), 'data', 'conversations.json');
    const conversationsData = JSON.parse(fs.readFileSync(conversationsPath, 'utf8'));
    
    // Load messages
    const messagesPath = path.join(process.cwd(), 'data', 'messages.json');
    const messagesData = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    
    console.log('현재 user1082의 대화 목록:');
    
    // Find user1082 conversations
    const user1082Conversations = [];
    for (const [convId, conv] of conversationsData.conversations) {
      if (conv.userId === 'user1082') {
        user1082Conversations.push({ id: convId, agentId: conv.agentId });
        console.log(`- 대화 ID: ${convId}, 에이전트 ID: ${conv.agentId}`);
      }
    }
    
    // Keep only these agent conversations: 146, 117, 177
    const keepAgentIds = [146, 117, 177];
    const conversationsToDelete = [];
    const conversationsToKeep = [];
    
    for (const conv of user1082Conversations) {
      if (keepAgentIds.includes(conv.agentId)) {
        conversationsToKeep.push(conv);
        console.log(`✓ 보존: 대화 ID ${conv.id}, 에이전트 ID ${conv.agentId}`);
      } else {
        conversationsToDelete.push(conv);
        console.log(`✗ 삭제: 대화 ID ${conv.id}, 에이전트 ID ${conv.agentId}`);
      }
    }
    
    console.log(`\n총 ${conversationsToDelete.length}개 대화 삭제, ${conversationsToKeep.length}개 대화 보존`);
    
    if (conversationsToDelete.length === 0) {
      console.log('삭제할 대화가 없습니다.');
      return;
    }
    
    // Delete conversations
    const filteredConversations = conversationsData.conversations.filter(([convId, conv]) => {
      return !(conv.userId === 'user1082' && !keepAgentIds.includes(conv.agentId));
    });
    
    // Delete related messages
    const deleteConversationIds = conversationsToDelete.map(c => c.id);
    const filteredMessages = messagesData.messages.filter(([msgId, msg]) => {
      return !deleteConversationIds.includes(msg.conversationId);
    });
    
    console.log(`대화 삭제: ${conversationsData.conversations.length} → ${filteredConversations.length}`);
    console.log(`메시지 삭제: ${messagesData.messages.length} → ${filteredMessages.length}`);
    
    // Save updated data
    conversationsData.conversations = filteredConversations;
    messagesData.messages = filteredMessages;
    
    fs.writeFileSync(conversationsPath, JSON.stringify(conversationsData, null, 2));
    fs.writeFileSync(messagesPath, JSON.stringify(messagesData, null, 2));
    
    console.log('✅ 사용자 대화 정리 완료');
    
  } catch (error) {
    console.error('Error cleaning up conversations:', error);
  }
}

cleanupUser1082Conversations();