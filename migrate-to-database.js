#!/usr/bin/env node

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import fs from 'fs';
import path from 'path';

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrateData() {
  try {
    console.log('Starting data migration from memory storage to PostgreSQL...');

    // Read memory storage files
    const usersFile = path.join(process.cwd(), 'data', 'memory-storage.json');
    const agentsFile = path.join(process.cwd(), 'data', 'memory-storage-agents.json');

    if (!fs.existsSync(usersFile) || !fs.existsSync(agentsFile)) {
      console.log('Memory storage files not found, skipping migration');
      return;
    }

    const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const agentsData = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));

    // Migrate users
    console.log('Migrating users...');
    const usersArray = Array.from(usersData.users || []);
    for (const [userId, user] of usersArray) {
      try {
        await pool.query(`
          INSERT INTO users (id, username, first_name, last_name, email, password, user_type, upper_category, status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            email = EXCLUDED.email,
            password = EXCLUDED.password,
            user_type = EXCLUDED.user_type,
            upper_category = EXCLUDED.upper_category,
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        `, [
          user.id,
          user.username,
          user.firstName || '',
          user.lastName || '',
          user.email || '',
          user.password || '',
          user.userType || 'student',
          user.organizationLevel || '',
          user.status || '활성',
          user.createdAt ? new Date(user.createdAt) : new Date(),
          user.updatedAt ? new Date(user.updatedAt) : new Date()
        ]);
        console.log(`Migrated user: ${user.username}`);
      } catch (error) {
        console.error(`Error migrating user ${user.username}:`, error.message);
      }
    }

    // Migrate agents
    console.log('Migrating agents...');
    const agentsArray = Array.from(agentsData.agents || []);
    for (const [agentId, agent] of agentsArray) {
      try {
        await pool.query(`
          INSERT INTO agents (id, name, description, creator_id, type, visibility, upper_category, lower_category, detail_category, status, llm_model, chatbot_type, max_input_length, max_response_length, persona_nickname, speech_style, personality, manager_id, agent_editor_ids, document_manager_ids, is_active, created_at, updated_at, organization_id, category, icon, background_color, is_custom_icon)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            creator_id = EXCLUDED.creator_id,
            type = EXCLUDED.type,
            visibility = EXCLUDED.visibility,
            upper_category = EXCLUDED.upper_category,
            lower_category = EXCLUDED.lower_category,
            detail_category = EXCLUDED.detail_category,
            status = EXCLUDED.status,
            llm_model = EXCLUDED.llm_model,
            chatbot_type = EXCLUDED.chatbot_type,
            max_input_length = EXCLUDED.max_input_length,
            max_response_length = EXCLUDED.max_response_length,
            persona_nickname = EXCLUDED.persona_nickname,
            speech_style = EXCLUDED.speech_style,
            personality = EXCLUDED.personality,
            manager_id = EXCLUDED.manager_id,
            agent_editor_ids = EXCLUDED.agent_editor_ids,
            document_manager_ids = EXCLUDED.document_manager_ids,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at,
            organization_id = EXCLUDED.organization_id,
            category = EXCLUDED.category,
            icon = EXCLUDED.icon,
            background_color = EXCLUDED.background_color,
            is_custom_icon = EXCLUDED.is_custom_icon
        `, [
          agent.id,
          agent.name,
          agent.description || '',
          (agent.creatorId && ['admin', 'master_admin', 'user1081', 'user1082', 'agent_admin_001'].includes(agent.creatorId)) ? agent.creatorId : 'admin',
          agent.type || 'general-llm',
          agent.visibility || 'organization',
          agent.upperCategory || '',
          agent.lowerCategory || '',
          agent.detailCategory || '',
          agent.status || 'active',
          agent.llmModel || 'gpt-4o',
          agent.chatbotType || 'general-llm',
          agent.maxInputLength || 2048,
          agent.maxOutputLength || 1024,
          agent.personaNickname || '',
          agent.speechStyle || '친근하고 도움이 되는 말투',
          agent.personality || '친절하고 전문적인 성격으로 정확한 정보를 제공',
          null,
          JSON.stringify(agent.agentEditorIds || []),
          JSON.stringify(agent.documentManagerIds || []),
          agent.isActive !== undefined ? agent.isActive : true,
          agent.createdAt ? new Date(agent.createdAt) : new Date(),
          agent.updatedAt ? new Date(agent.updatedAt) : new Date(),
          agent.organizationId || null,
          agent.category || '',
          agent.icon || 'Bot',
          agent.backgroundColor || '#3B82F6',
          agent.isCustomIcon || false
        ]);
        console.log(`Migrated agent: ${agent.name}`);
      } catch (error) {
        console.error(`Error migrating agent ${agent.name}:`, error.message);
      }
    }

    console.log('Data migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrateData();