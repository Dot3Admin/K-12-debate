
import XLSX from 'xlsx';
import fs from 'fs';

async function updateAgentsFromExcel() {
  try {
    console.log('🔄 Excel 파일에서 에이전트 데이터 업데이트 시작...');
    
    // 첨부된 Excel 파일 읽기
    const filePath = './attached_assets/AI 에이전트 0627 (1)_1751189489188.xlsx';
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ Excel 파일을 찾을 수 없습니다:', filePath);
      return;
    }

    console.log('📊 Excel 파일 읽는 중...');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📋 Excel에서 ${jsonData.length}개의 에이전트 데이터를 읽었습니다.`);
    
    // 데이터 구조 확인
    if (jsonData.length > 0) {
      console.log('컬럼 구조:', Object.keys(jsonData[0]));
      console.log('첫 번째 행 샘플:', jsonData[0]);
    }
    
    // 에이전트 데이터 변환
    const agents = {};
    let idCounter = 115; // 기존 데이터 이후 ID부터 시작
    
    jsonData.forEach((row, index) => {
      const id = row.id || idCounter++;
      const name = (row.name || row['에이전트명'] || row['이름'] || `에이전트 ${index + 1}`).toString().trim();
      const description = (row.description || row['설명'] || row['기능설명'] || '').toString().trim();
      
      // 조직 정보 매핑
      const upperCategory = (row.upperCategory || row['상위카테고리'] || row['대학'] || '').toString().trim();
      const lowerCategory = (row.lowerCategory || row['하위카테고리'] || row['학과'] || '').toString().trim();
      const detailCategory = (row.detailCategory || row['세부카테고리'] || row.lowerCategory || '').toString().trim();
      
      const category = (row.category || row['카테고리'] || row['유형'] || '학생').toString().trim();
      const managerId = (row.managerId || row['관리자ID'] || 'master_admin').toString().trim();
      
      agents[id] = {
        id: parseInt(id),
        name: name,
        description: description,
        category: category,
        icon: "Bot",
        backgroundColor: "#3B82F6",
        upperCategory: upperCategory,
        lowerCategory: lowerCategory,
        detailCategory: detailCategory,
        status: "active",
        llmModel: "gpt-4o",
        chatbotType: "doc-fallback-llm",
        maxInputLength: 2048,
        maxOutputLength: 1024,
        personaNickname: (row.personaNickname || row['페르소나'] || '').toString().trim(),
        speechStyle: (row.speechStyle || row['말투'] || '공손하고 친절한 말투').toString().trim(),
        personality: (row.personality || row['성격'] || '친절하고 전문적인 성격으로 정확한 정보를 제공').toString().trim(),
        forbiddenResponseStyle: "죄송합니다. 해당 내용에 대해서는 답변드릴 수 없습니다.",
        visibility: "organization",
        managerId: managerId,
        agentEditorIds: [],
        documentManagerIds: [],
        isActive: true,
        createdAt: new Date().toISOString(),
        averageRating: null,
        messageCount: 0,
        creatorId: "system",
        updatedAt: new Date().toISOString(),
        isCustomIcon: false,
        organizationId: null,
        maxResponseLength: null,
        speakingStyle: (row.speechStyle || row['말투'] || '친근하고 도움이 되는 말투').toString().trim(),
        personalityTraits: (row.personality || row['성격'] || '친절하고 전문적인 성격으로 정확한 정보를 제공').toString().trim(),
        prohibitedWordResponse: "죄송합니다. 해당 내용에 대해서는 답변드릴 수 없습니다.",
        personaName: null,
        rolePrompt: null,
        uploadFormats: [],
        uploadMethod: null,
        maxFileCount: null,
        maxFileSizeMB: null
      };
    });
    
    console.log(`✅ ${Object.keys(agents).length}개의 에이전트 데이터 변환 완료`);
    
    // 기존 데이터 백업
    const agentDataPath = 'data/memory-storage-agents.json';
    const backupPath = `data/agents_backup_${Date.now()}.json`;
    
    if (fs.existsSync(agentDataPath)) {
      fs.copyFileSync(agentDataPath, backupPath);
      console.log(`💾 기존 데이터를 ${backupPath}에 백업했습니다.`);
    }
    
    // 새 데이터 저장
    fs.writeFileSync(agentDataPath, JSON.stringify(agents, null, 2), 'utf8');
    console.log(`💾 새 에이전트 데이터 저장 완료: ${Object.keys(agents).length}개`);
    
    // 통계 출력
    const categoryStats = {};
    Object.values(agents).forEach(agent => {
      categoryStats[agent.category] = (categoryStats[agent.category] || 0) + 1;
    });
    
    console.log('\n📊 카테고리별 통계:');
    Object.entries(categoryStats).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}개`);
    });
    
    console.log('\n🎉 에이전트 데이터 업데이트 완료!');
    console.log('서버를 재시작하여 변경사항을 적용하세요.');
    
  } catch (error) {
    console.error('❌ 에이전트 데이터 업데이트 중 오류 발생:', error);
  }
}

// 스크립트 실행
updateAgentsFromExcel();
