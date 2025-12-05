import XLSX from 'xlsx';
import fs from 'fs';

async function loadFinalAgents() {
  try {
    console.log('📋 최종 에이전트 데이터 로드 시작...');
    
    // 엑셀 파일 읽기
    const filePath = './attached_assets/Final_Updated_AI_Agents_List (1)_1750979430001.xlsx';
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ Excel 파일을 찾을 수 없습니다:', filePath);
      return;
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`📊 엑셀에서 ${data.length}개의 에이전트 데이터를 발견했습니다.`);

    // 새로운 에이전트 배열 생성
    const newAgents = [];
    
    data.forEach((row, index) => {
      try {
        // 실제 엑셀 컬럼 매핑
        const agent = {
          id: row.id || index + 1,
          name: row.name || `에이전트 ${index + 1}`,
          description: row.description || '',
          category: row.category || '기능형',
          type: row['유형'] || '기능형',
          icon: row.icon || '🤖',
          backgroundColor: row.backgroundColor || '#3B82F6',
          isActive: row.isActive !== false,
          status: row.status || 'active',
          managerId: row.managerId || 'prof001',
          organizationId: null,
          upperCategory: row.upperCategory || null,
          lowerCategory: row.lowerCategory || null,
          detailCategory: row.detailCategory || null,
          createdAt: new Date(row.createdAt || new Date()),
          updatedAt: new Date(row.updatedAt || new Date()),
          llmModel: row.llmModel || 'gpt-4o',
          chatbotType: row.chatbotType || 'doc-fallback-llm',
          maxInputLength: row.maxInputLength || 2048,
          maxResponseLength: row.maxResponseLength || 1024,
          visibility: row.visibility || 'private',
          rolePrompt: row.rolePrompt || '',
          persona: row.personaName || '',
          systemPrompt: '',
          speechStyle: row.speakingStyle || '친근한',
          personality: row.personalityTraits || '도움이 되는',
          prohibitedWords: row.prohibitedWordResponse || '',
          responseStyle: '상세한',
          uploadFormats: row.uploadFormats || "['PDF', 'DOCX', 'TXT']",
          uploadMethod: row.uploadMethod || 'dragdrop',
          maxFileCount: row.maxFileCount || 100,
          maxFileSizeMB: row.maxFileSizeMB || 100,
          isCustomIcon: row.isCustomIcon || false,
          agentManagerIds: row.agentManagerIds ? JSON.parse(row.agentManagerIds.replace(/'/g, '"')) : ['prof001'],
          documentManagerIds: row.documentManagerIds ? JSON.parse(row.documentManagerIds.replace(/'/g, '"')) : ['prof001'],
          agentEditorIds: row.agentEditorIds ? JSON.parse(row.agentEditorIds.replace(/'/g, '"')) : ['prof001'],
          allowedGroups: row.allowedGroups ? JSON.parse(row.allowedGroups.replace(/'/g, '"')) : [],
          creatorId: row.creatorId || 'master_admin'
        };

        newAgents.push(agent);
        console.log(`✓ 에이전트 처리 완료: ${agent.name} (${agent.type}) - ${agent.category}`);
      } catch (error) {
        console.log(`❌ 에이전트 ${index + 1} 처리 실패:`, error.message);
      }
    });

    // JSON 파일로 저장
    fs.writeFileSync('./final_agents.json', JSON.stringify(newAgents, null, 2), 'utf-8');
    console.log(`✅ ${newAgents.length}개의 최종 에이전트 데이터가 final_agents.json에 저장되었습니다.`);

    // 처리된 에이전트 요약 출력
    const typeCount = {};
    newAgents.forEach(agent => {
      typeCount[agent.type] = (typeCount[agent.type] || 0) + 1;
    });

    console.log('\n📈 에이전트 유형별 통계:');
    Object.entries(typeCount).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}개`);
    });

    console.log('\n🎯 첫 5개 에이전트 샘플:');
    newAgents.slice(0, 5).forEach(agent => {
      console.log(`  • ${agent.name} (${agent.type}) - ${agent.description}`);
    });

  } catch (error) {
    console.error('❌ 최종 에이전트 데이터 로드 실패:', error);
  }
}

// 스크립트가 직접 실행되는 경우
if (import.meta.url === `file://${process.argv[1]}`) {
  loadFinalAgents();
}

export default loadFinalAgents;