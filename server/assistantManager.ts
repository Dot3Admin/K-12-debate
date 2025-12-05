import { getOpenAIClient } from "./openai";
import { storage } from "./storage";

export async function createAssistantForRoom(roomId: number): Promise<string> {
  try {
    const groupChat = await storage.getGroupChat(roomId);
    
    if (!groupChat) {
      throw new Error(`Group chat with ID ${roomId} not found`);
    }

    if (groupChat.assistantId) {
      console.log(`[AssistantManager] Group chat ${roomId} already has assistant: ${groupChat.assistantId}`);
      return groupChat.assistantId;
    }

    const client = getOpenAIClient();

    const assistant = await client.beta.assistants.create({
      name: `LoBo-GroupRoom-${roomId}`,
      instructions: "This Assistant manages conversation context for one chatroom.",
      model: process.env.LLM_MODEL || "gpt-4o-mini"
    });

    console.log(`[AssistantManager] Created new assistant ${assistant.id} for room ${roomId}`);

    await storage.updateGroupChat(roomId, {
      assistantId: assistant.id
    });

    return assistant.id;
  } catch (error) {
    console.error(`[AssistantManager] Error creating assistant for room ${roomId}:`, error);
    throw error;
  }
}

export async function getAssistantForRoom(roomId: number): Promise<string | null> {
  try {
    const groupChat = await storage.getGroupChat(roomId);
    
    if (!groupChat) {
      throw new Error(`Group chat with ID ${roomId} not found`);
    }

    return groupChat.assistantId || null;
  } catch (error) {
    console.error(`[AssistantManager] Error getting assistant for room ${roomId}:`, error);
    throw error;
  }
}

export async function deleteAssistantForRoom(roomId: number): Promise<void> {
  try {
    const assistantId = await getAssistantForRoom(roomId);
    
    if (!assistantId) {
      console.log(`[AssistantManager] No assistant found for room ${roomId}`);
      return;
    }

    const client = getOpenAIClient();
    
    await client.beta.assistants.delete(assistantId);
    console.log(`[AssistantManager] Deleted assistant ${assistantId} for room ${roomId}`);

    await storage.updateGroupChat(roomId, {
      assistantId: null
    });
  } catch (error) {
    console.error(`[AssistantManager] Error deleting assistant for room ${roomId}:`, error);
    throw error;
  }
}

export async function updateAssistantSettings(roomId: number, updates: {
  name?: string;
  instructions?: string;
  model?: string;
}): Promise<void> {
  try {
    const assistantId = await getAssistantForRoom(roomId);
    
    if (!assistantId) {
      throw new Error(`No assistant found for room ${roomId}`);
    }

    const client = getOpenAIClient();
    
    await client.beta.assistants.update(assistantId, updates);
    console.log(`[AssistantManager] Updated assistant ${assistantId} for room ${roomId}`);
  } catch (error) {
    console.error(`[AssistantManager] Error updating assistant for room ${roomId}:`, error);
    throw error;
  }
}

export async function getOrCreateThread(roomId: number): Promise<string> {
  try {
    const groupChat = await storage.getGroupChat(roomId);
    
    if (!groupChat) {
      throw new Error(`Group chat with ID ${roomId} not found`);
    }

    if (groupChat.threadId) {
      console.log(`[ThreadManager] Group chat ${roomId} already has thread: ${groupChat.threadId}`);
      return groupChat.threadId;
    }

    const client = getOpenAIClient();

    const thread = await client.beta.threads.create();
    
    console.log(`[ThreadManager] Created new thread ${thread.id} for room ${roomId}`);

    await storage.updateGroupChat(roomId, {
      threadId: thread.id
    });

    return thread.id;
  } catch (error) {
    console.error(`[ThreadManager] Error creating thread for room ${roomId}:`, error);
    throw error;
  }
}

export async function appendMessageToThread(
  roomId: number, 
  role: string, 
  message: string
): Promise<void> {
  try {
    const threadId = await getOrCreateThread(roomId);
    const client = getOpenAIClient();

    const openaiRole = role.toLowerCase().includes('user') || role.toLowerCase().includes('사용자') 
      ? 'user' 
      : 'assistant';

    const formattedContent = `[${role}]: "${message}"`;

    await client.beta.threads.messages.create(threadId, {
      role: openaiRole,
      content: formattedContent
    });

    console.log(`[ThreadManager] ✅ Appended message to thread ${threadId} for room ${roomId}: ${role} - ${message.substring(0, 50)}...`);
  } catch (error) {
    console.error(`[ThreadManager] ❌ Error appending message to thread for room ${roomId}:`, error);
    throw error;
  }
}

export async function fetchContext(roomId: number): Promise<string> {
  try {
    const groupChat = await storage.getGroupChat(roomId);
    
    if (!groupChat || !groupChat.threadId) {
      console.log(`[ThreadManager] No thread context available for room ${roomId}`);
      return "";
    }

    const client = getOpenAIClient();
    
    const messages = await client.beta.threads.messages.list(groupChat.threadId, {
      limit: 50,
      order: 'asc'
    });

    const contextMessages = messages.data.map(msg => {
      const content = msg.content[0];
      if (content.type === 'text') {
        return content.text.value;
      }
      return '';
    }).filter(text => text.length > 0);

    const context = contextMessages.join('\n');
    
    console.log(`[ThreadManager] 📚 Fetched ${contextMessages.length} messages from thread ${groupChat.threadId} for room ${roomId}`);
    
    return context;
  } catch (error) {
    console.error(`[ThreadManager] Error fetching context for room ${roomId}:`, error);
    return "";
  }
}
