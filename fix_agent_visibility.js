import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fixAgentVisibility() {
  const agentDataPath = path.join(__dirname, 'data', 'memory-storage-agents.json');
  
  try {
    // Read the current agent data
    const data = fs.readFileSync(agentDataPath, 'utf8');
    const agentsData = JSON.parse(data);
    
    if (!agentsData.agents || !Array.isArray(agentsData.agents)) {
      console.error('Invalid agent data structure');
      return;
    }
    
    let updatedCount = 0;
    
    // Update first 10 agents to have public visibility
    for (let i = 0; i < Math.min(10, agentsData.agents.length); i++) {
      const agent = agentsData.agents[i][1]; // Get the agent data from [id, agent_data] format
      if (agent && agent.visibility === 'organization') {
        agent.visibility = 'public';
        updatedCount++;
        console.log(`Updated agent ${agent.id} (${agent.name}) to public visibility`);
      }
    }
    
    // Save the updated data
    fs.writeFileSync(agentDataPath, JSON.stringify(agentsData, null, 2), 'utf8');
    
    console.log(`Successfully updated ${updatedCount} agents to public visibility`);
    console.log('Agent visibility fix completed');
    
  } catch (error) {
    console.error('Error fixing agent visibility:', error);
  }
}

fixAgentVisibility();