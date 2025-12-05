import { storage } from "./storage";

async function seedCardLayout() {
  try {
    console.log("🌱 카드 레이아웃 샘플 데이터 생성 시작...");

    // 테스트 사용자 ID (기존 사용자 사용)
    const testUserId = "admin"; // 실제 존재하는 사용자 ID

    // 1. 폴더 생성
    const youthFolder = await storage.createCardFolder({
      title: "청년회 모임",
      description: "청년회 관련 채팅방 모음",
      image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800",
      createdBy: testUserId
    });

    const bibleFolder = await storage.createCardFolder({
      title: "성경 공부",
      description: "성경 관련 학습 채팅방",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800",
      createdBy: testUserId
    });

    console.log(`✅ 폴더 생성 완료: ${youthFolder.id}, ${bibleFolder.id}`);

    // 2. 홈 화면 카드 생성 (기존 그룹 채팅방을 참조한다고 가정)
    // 실제 환경에서는 group_chats 테이블에서 실제 ID를 가져와야 함
    
    // 폴더 카드 (2x2)
    await storage.createCardItem({
      type: "folder",
      title: "청년회 모음",
      description: "청년회 관련 채팅방 모음",
      image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800",
      folderId: youthFolder.id,
      gridSizeX: 2,
      gridSizeY: 2,
      positionX: 0,
      positionY: 0,
      parentFolderId: null, // 홈 화면
      createdBy: testUserId
    });

    // 폴더 카드 (2x2)
    await storage.createCardItem({
      type: "folder",
      title: "성경 공부",
      description: "성경 관련 학습 채팅방",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800",
      folderId: bibleFolder.id,
      gridSizeX: 2,
      gridSizeY: 2,
      positionX: 2,
      positionY: 0,
      parentFolderId: null,
      createdBy: testUserId
    });

    // 채팅방 카드 예시 (1x1) - 실제 chatRoomId가 필요
    await storage.createCardItem({
      type: "chat",
      title: "공지사항",
      description: "교회 공지사항 및 알림",
      image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800",
      chatRoomId: null, // 실제 환경에서는 유효한 group chat ID 필요
      gridSizeX: 1,
      gridSizeY: 1,
      positionX: 0,
      positionY: 2,
      parentFolderId: null,
      createdBy: testUserId
    });

    // 채팅방 카드 예시 (2x1)
    await storage.createCardItem({
      type: "chat",
      title: "자유 게시판",
      description: "자유롭게 이야기를 나눠요",
      image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800",
      chatRoomId: null,
      gridSizeX: 2,
      gridSizeY: 1,
      positionX: 1,
      positionY: 2,
      parentFolderId: null,
      createdBy: testUserId
    });

    // 3. 폴더 내부 카드 생성 (청년회 폴더)
    await storage.createCardItem({
      type: "chat",
      title: "금요기도회",
      description: "매주 금요일 저녁 기도 모임",
      image: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=800",
      chatRoomId: null,
      gridSizeX: 2,
      gridSizeY: 1,
      positionX: 0,
      positionY: 0,
      parentFolderId: youthFolder.id, // 청년회 폴더 내부
      createdBy: testUserId
    });

    await storage.createCardItem({
      type: "chat",
      title: "주일 나눔",
      description: "주일 예배 후 나눔 시간",
      image: "https://images.unsplash.com/photo-1491975474562-1f4e30bc9468?w=800",
      chatRoomId: null,
      gridSizeX: 1,
      gridSizeY: 1,
      positionX: 0,
      positionY: 1,
      parentFolderId: youthFolder.id,
      createdBy: testUserId
    });

    // 4. 폴더 내부 카드 생성 (성경 공부 폴더)
    await storage.createCardItem({
      type: "chat",
      title: "창세기 통독",
      description: "창세기 1장부터 함께 읽어요",
      image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=800",
      chatRoomId: null,
      gridSizeX: 1,
      gridSizeY: 1,
      positionX: 0,
      positionY: 0,
      parentFolderId: bibleFolder.id,
      createdBy: testUserId
    });

    await storage.createCardItem({
      type: "chat",
      title: "잠언 묵상",
      description: "매일 잠언 한 장씩 묵상해요",
      image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800",
      chatRoomId: null,
      gridSizeX: 1,
      gridSizeY: 1,
      positionX: 1,
      positionY: 0,
      parentFolderId: bibleFolder.id,
      createdBy: testUserId
    });

    // 5. Shortcut 카드 생성 (폴더 내 채팅방을 홈에 링크)
    await storage.createCardItem({
      type: "link",
      title: "금요기도회 (바로가기)",
      description: "청년회 > 금요기도회",
      image: "https://images.unsplash.com/photo-1507692049790-de58290a4334?w=800",
      targetChatRoomId: null, // 실제 채팅방 ID
      sourceFolderId: youthFolder.id,
      gridSizeX: 1,
      gridSizeY: 1,
      positionX: 3,
      positionY: 2,
      parentFolderId: null, // 홈 화면에 표시
      createdBy: testUserId
    });

    console.log("✅ 카드 레이아웃 샘플 데이터 생성 완료!");
  } catch (error) {
    console.error("❌ 카드 레이아웃 샘플 데이터 생성 실패:", error);
  }
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  seedCardLayout().then(() => {
    console.log("시드 작업 완료");
    process.exit(0);
  }).catch(error => {
    console.error("시드 작업 실패:", error);
    process.exit(1);
  });
}

export { seedCardLayout };
