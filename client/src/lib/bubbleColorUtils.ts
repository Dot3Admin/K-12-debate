const bubbleColors = [
  // 💙 Blue family — 신뢰·안정감
  "#3C91FF", // Soft Sky Blue (기준)
  "#5AA9FF", // Baby Blue
  "#2D89E5", // Calm Blue
  "#4BA3FF", // Bright Blue
  
  // 💚 Green family — 평화·균형·치유
  "#3CC6A8", // Soft Mint
  "#5FD4B5", // Aqua Green
  "#47B39C", // Sage Mint
  "#36B8A2", // Teal Breeze

  // 💜 Purple family — 사려·창의·고요
  "#9E7BFF", // Lavender
  "#B085FF", // Lilac
  "#A069FF", // Light Violet
  "#8D63E8", // Soft Purple

  // ❤️ Red/Pink family — 생동·친근·따뜻함
  "#FF6B7A", // Coral Rose
  "#FF708C", // Bright Pink
  "#F45B69", // Soft Red
  "#E95E85", // Warm Magenta

  // 🧡 Orange/Yellow family — 활력·긍정·낙천
  "#FFB357", // Honey Orange
  "#FFAD5E", // Apricot
  "#FBAA3C", // Amber
  "#F5A742", // Soft Gold

  // 🩵 Aqua/Pastel family — 산뜻·밝음·깨끗함
  "#55CFFF", // Aqua Blue
  "#4ED4E1", // Seafoam Cyan
  "#60C3F1", // Ocean Mint
  "#47C1E8", // Turquoise Calm
];

// 채팅방별 사용자 색상 매핑 테이블
// { [chatRoomId]: { [userId]: color } }
const STORAGE_KEY = 'chatRoomBubbleColors';

// localStorage에서 색상 매핑 로드
function loadColorMaps(): Record<string, Record<string, string>> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('[🎨 색상 로드 실패]', error);
    return {};
  }
}

// localStorage에 색상 매핑 저장
function saveColorMaps(maps: Record<string, Record<string, string>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  } catch (error) {
    console.error('[🎨 색상 저장 실패]', error);
  }
}

export function getBubbleColorForUser(chatRoomId: string, userId: string): string {
  // localStorage에서 색상 매핑 로드
  const chatRoomColorMaps = loadColorMaps();
  
  // 채팅방별 색상 맵 초기화
  if (!chatRoomColorMaps[chatRoomId]) {
    chatRoomColorMaps[chatRoomId] = {};
  }

  // 이미 지정된 색이 있다면 그대로 사용
  if (chatRoomColorMaps[chatRoomId][userId]) {
    console.log(`[🎨 색상 재사용] 채팅방: ${chatRoomId}, 사용자: ${userId}, 색상: ${chatRoomColorMaps[chatRoomId][userId]}`);
    return chatRoomColorMaps[chatRoomId][userId];
  }

  // 사용되지 않은 색 중 하나를 랜덤 선택
  const usedColors = Object.values(chatRoomColorMaps[chatRoomId]);
  const availableColors = bubbleColors.filter(c => !usedColors.includes(c));

  const assignedColor =
    availableColors.length > 0
      ? availableColors[Math.floor(Math.random() * availableColors.length)]
      : bubbleColors[Math.floor(Math.random() * bubbleColors.length)];

  // 색상 할당 후 저장
  chatRoomColorMaps[chatRoomId][userId] = assignedColor;
  saveColorMaps(chatRoomColorMaps);
  
  console.log(`[🎨 새 색상 할당] 채팅방: ${chatRoomId}, 사용자: ${userId}, 색상: ${assignedColor}`);
  return assignedColor;
}

export function getChatBubbleStyle(chatRoomId: string, userId: string) {
  return {
    backgroundColor: getBubbleColorForUser(chatRoomId, userId),
    color: "#FFFFFF",
  };
}
