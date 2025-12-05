import fs from 'fs';
import path from 'path';

// Create data directory if it doesn't exist
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const usersFile = path.join(dataDir, 'memory-storage-users.json');

// Load existing users or create empty array
let users = [];
if (fs.existsSync(usersFile)) {
  try {
    const data = fs.readFileSync(usersFile, 'utf8');
    users = JSON.parse(data);
  } catch (error) {
    console.log('Creating new users file...');
    users = [];
  }
}

// Check if agent admin already exists
const existingAgentAdmin = users.find(user => user.role === 'agent_admin');
if (existingAgentAdmin) {
  console.log('Agent admin user already exists:', existingAgentAdmin.id);
  process.exit(0);
}

// Add agent admin user
const agentAdminUser = {
  id: "agent_admin_001",
  username: "agent_admin_001",
  role: "agent_admin",
  firstName: "에이전트",
  lastName: "관리자",
  name: "에이전트 관리자",
  email: "agent_admin@lobo.edu",
  createdAt: new Date().toISOString(),
  lastLoginAt: new Date().toISOString(),
  isActive: true,
  status: "active",
  upperCategory: "대학본부",
  lowerCategory: "기획처",
  detailCategory: "기획예산팀",
  position: "직원",
  organizationAffiliations: 0,
  agentPermissions: 0,
  userMemo: "에이전트 관리 전담 사용자"
};

// Ensure master_admin has correct role
const masterAdminIndex = users.findIndex(user => user.id === 'master_admin');
if (masterAdminIndex !== -1) {
  users[masterAdminIndex].role = 'master_admin';
  console.log('Updated master_admin role to master_admin');
}

// Add the new agent admin user
users.push(agentAdminUser);

// Save users back to file
fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));

console.log('Successfully added agent admin user:', agentAdminUser.id);
console.log('Total users:', users.length);