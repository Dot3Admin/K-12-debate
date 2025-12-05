import express, { Request, Response } from "express";
import { storage } from "./storage";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { translateText } from "./ai-services";

// 아이콘 업로드 디렉토리 설정
const iconUploadDir = path.join(process.cwd(), 'uploads', 'icons');
if (!fs.existsSync(iconUploadDir)) {
  fs.mkdirSync(iconUploadDir, { recursive: true });
}

// 아이콘 업로드 multer 설정
const iconUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, iconUploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `icon-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 제한
  },
  fileFilter: (req, file, cb) => {
    // PNG만 허용
    if (file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('PNG 파일만 업로드 가능합니다.') as any, false);
    }
  }
});

// 배경 이미지 업로드 디렉토리 설정
const imageUploadDir = path.join(process.cwd(), 'uploads', 'card-images');
if (!fs.existsSync(imageUploadDir)) {
  fs.mkdirSync(imageUploadDir, { recursive: true });
}

// 배경 이미지 업로드 multer 설정
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, imageUploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `card-bg-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB 제한
  },
  fileFilter: (req, file, cb) => {
    // GIF, JPG, JPEG, PNG 허용
    const allowedTypes = ['image/gif', 'image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('GIF, JPG, JPEG, PNG 파일만 업로드 가능합니다.') as any, false);
    }
  }
});

export const cardLayoutRouter = express.Router();

// ==================== 폴더 API ====================

// 모든 폴더 조회
cardLayoutRouter.get("/folders", async (req: Request, res: Response) => {
  try {
    const folders = await storage.getAllCardFolders();
    res.json(folders);
  } catch (error) {
    console.error("[API] 폴더 조회 실패:", error);
    res.status(500).json({ error: "폴더 조회에 실패했습니다" });
  }
});

// 특정 폴더 조회
cardLayoutRouter.get("/folders/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const folder = await storage.getCardFolderById(id);
    
    if (!folder) {
      return res.status(404).json({ error: "폴더를 찾을 수 없습니다" });
    }
    
    res.json(folder);
  } catch (error) {
    console.error("[API] 폴더 조회 실패:", error);
    res.status(500).json({ error: "폴더 조회에 실패했습니다" });
  }
});

// 폴더 생성
cardLayoutRouter.post("/folders", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    const { title, description, image } = req.body;
    
    const folder = await storage.createCardFolder({
      title,
      description,
      image,
      createdBy: req.user.id
    });
    
    res.json(folder);
  } catch (error) {
    console.error("[API] 폴더 생성 실패:", error);
    res.status(500).json({ error: "폴더 생성에 실패했습니다" });
  }
});

// 폴더 업데이트
cardLayoutRouter.put("/folders/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, image } = req.body;
    
    const updated = await storage.updateCardFolder(id, {
      title,
      description,
      image
    });
    
    res.json(updated);
  } catch (error) {
    console.error("[API] 폴더 업데이트 실패:", error);
    res.status(500).json({ error: "폴더 업데이트에 실패했습니다" });
  }
});

// 폴더 삭제
cardLayoutRouter.delete("/folders/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteCardFolder(id);
    res.json({ success: true });
  } catch (error) {
    console.error("[API] 폴더 삭제 실패:", error);
    res.status(500).json({ error: "폴더 삭제에 실패했습니다" });
  }
});

// ==================== 카드 API ====================

// 홈 화면 카드 조회
cardLayoutRouter.get("/cards/home", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const cards = await storage.getHomeCardItems(userId);
    res.json(cards);
  } catch (error) {
    console.error("[API] 홈 카드 조회 실패:", error);
    res.status(500).json({ error: "카드 조회에 실패했습니다" });
  }
});

// 특정 폴더 내 카드 조회
cardLayoutRouter.get("/cards/folder/:folderId", async (req: Request, res: Response) => {
  try {
    const folderId = parseInt(req.params.folderId);
    const userId = req.user?.id;
    const cards = await storage.getFolderCardItems(folderId, userId);
    res.json(cards);
  } catch (error) {
    console.error("[API] 폴더 카드 조회 실패:", error);
    res.status(500).json({ error: "카드 조회에 실패했습니다" });
  }
});

// 특정 카드 조회
cardLayoutRouter.get("/cards/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const card = await storage.getCardItemById(id);
    
    if (!card) {
      return res.status(404).json({ error: "카드를 찾을 수 없습니다" });
    }
    
    res.json(card);
  } catch (error) {
    console.error("[API] 카드 조회 실패:", error);
    res.status(500).json({ error: "카드 조회에 실패했습니다" });
  }
});

// 카드 생성
cardLayoutRouter.post("/cards", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    const {
      type,
      title,
      description,
      image,
      color,
      chatRoomId,
      folderId,
      targetChatRoomId,
      sourceFolderId,
      targetRoute,
      gridSizeX,
      gridSizeY,
      positionX,
      positionY,
      parentFolderId
    } = req.body;
    
    const card = await storage.createCardItem({
      type,
      title,
      description,
      image,
      color,
      chatRoomId,
      folderId,
      targetChatRoomId,
      sourceFolderId,
      targetRoute,
      gridSizeX,
      gridSizeY,
      positionX,
      positionY,
      parentFolderId,
      createdBy: req.user.id
    });
    
    res.json(card);
  } catch (error) {
    console.error("[API] 카드 생성 실패:", error);
    res.status(500).json({ error: "카드 생성에 실패했습니다" });
  }
});

// 카드 업데이트
cardLayoutRouter.put("/cards/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updateData = req.body;
    
    const updated = await storage.updateCardItem(id, updateData);
    res.json(updated);
  } catch (error) {
    console.error("[API] 카드 업데이트 실패:", error);
    res.status(500).json({ error: "카드 업데이트에 실패했습니다" });
  }
});

// 카드 업데이트 (PATCH도 지원)
cardLayoutRouter.patch("/cards/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const updateData = req.body;
    
    console.log(`[🎴 카드 업데이트 요청] ID: ${id}, 데이터:`, JSON.stringify(updateData, null, 2));
    
    const updated = await storage.updateCardItem(id, updateData);
    res.json(updated);
  } catch (error) {
    console.error("[API] 카드 업데이트 실패:", error);
    res.status(500).json({ error: "카드 업데이트에 실패했습니다" });
  }
});

// 카드 순서 일괄 업데이트 (드래그 앤 드롭용)
cardLayoutRouter.patch("/cards/positions", async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: "updates는 배열이어야 합니다" });
    }
    
    await storage.updateCardPositions(updates);
    res.json({ success: true });
  } catch (error) {
    console.error("[API] 카드 순서 업데이트 실패:", error);
    res.status(500).json({ error: "카드 순서 업데이트에 실패했습니다" });
  }
});

// 아이콘 업로드
cardLayoutRouter.post("/upload-icon", iconUpload.single('file'), async (req: Request, res: Response) => {
  try {
    // 인증 확인
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "파일이 업로드되지 않았습니다" });
    }

    const iconUrl = `/uploads/icons/${req.file.filename}`;
    
    console.log("[아이콘 업로드] 성공:", {
      userId: req.user?.id,
      filename: req.file.filename,
      url: iconUrl,
      size: req.file.size
    });

    res.json({
      success: true,
      url: iconUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error("[API] 아이콘 업로드 실패:", error);
    res.status(500).json({ error: "아이콘 업로드에 실패했습니다" });
  }
});

// 배경 이미지 업로드
cardLayoutRouter.post("/upload-image", imageUpload.single('file'), async (req: Request, res: Response) => {
  try {
    // 인증 확인
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "파일이 업로드되지 않았습니다" });
    }

    const imageUrl = `/uploads/card-images/${req.file.filename}`;
    
    console.log("[배경 이미지 업로드] 성공:", {
      userId: req.user?.id,
      filename: req.file.filename,
      url: imageUrl,
      size: req.file.size,
      type: req.file.mimetype
    });

    res.json({
      success: true,
      url: imageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error("[API] 배경 이미지 업로드 실패:", error);
    res.status(500).json({ error: "배경 이미지 업로드에 실패했습니다" });
  }
});

// 크롭된 이미지 업로드 (클라이언트 Canvas에서 생성된 Blob)
cardLayoutRouter.post("/crop-image", imageUpload.single('file'), async (req: Request, res: Response) => {
  try {
    // 인증 확인
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "파일이 업로드되지 않았습니다" });
    }

    const croppedImageUrl = `/uploads/card-images/${req.file.filename}`;
    
    console.log("[크롭된 이미지 업로드] 성공:", {
      userId: req.user?.id,
      filename: req.file.filename,
      url: croppedImageUrl,
      size: req.file.size,
      type: req.file.mimetype
    });

    res.json({
      success: true,
      url: croppedImageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error("[API] 크롭된 이미지 업로드 실패:", error);
    res.status(500).json({ error: "크롭된 이미지 업로드에 실패했습니다" });
  }
});

// 카드 삭제
cardLayoutRouter.delete("/cards/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    await storage.deleteCardItem(id);
    res.json({ success: true });
  } catch (error) {
    console.error("[API] 카드 삭제 실패:", error);
    res.status(500).json({ error: "카드 삭제에 실패했습니다" });
  }
});

// ==================== NEW 뱃지 관련 API ====================

// 카드 조회 기록 (NEW 뱃지 제거용)
cardLayoutRouter.post("/cards/:id/view", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    const cardId = parseInt(req.params.id);
    const view = await storage.markCardAsViewed(req.user.id, cardId);
    res.json({ success: true, view });
  } catch (error) {
    console.error("[API] 카드 조회 기록 실패:", error);
    res.status(500).json({ error: "카드 조회 기록에 실패했습니다" });
  }
});

// 사용자의 카드 조회 기록 조회 (NEW 뱃지 표시용)
cardLayoutRouter.get("/card-views", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "인증이 필요합니다" });
    }

    const views = await storage.getUserCardViews(req.user.id);
    res.json(views);
  } catch (error) {
    console.error("[API] 카드 조회 기록 조회 실패:", error);
    res.status(500).json({ error: "카드 조회 기록 조회에 실패했습니다" });
  }
});

// ==================== 이미지 프록시 API ====================

// 외부 이미지 프록시 (CORS 우회)
cardLayoutRouter.get("/proxy-image", async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;
    
    if (!imageUrl) {
      return res.status(400).json({ error: "url 파라미터가 필요합니다" });
    }

    // 허용된 도메인 목록 (화이트리스트)
    const allowedDomains = [
      'i.pinimg.com',
      'images.unsplash.com',
      'cdn.pixabay.com',
      'images.pexels.com',
      'source.unsplash.com',
    ];

    // URL 파싱 및 검증
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
    } catch {
      return res.status(400).json({ error: "유효하지 않은 URL입니다" });
    }

    // 프로토콜 검증 (http, https만 허용)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return res.status(400).json({ error: "http 또는 https 프로토콜만 허용됩니다" });
    }

    // 도메인 화이트리스트 검증
    const isAllowed = allowedDomains.some(domain => 
      parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain)
    );
    
    if (!isAllowed) {
      return res.status(403).json({ 
        error: "허용되지 않은 도메인입니다",
        allowedDomains 
      });
    }

    // 내부 IP 대역 차단
    const hostname = parsedUrl.hostname;
    const privateIPPatterns = [
      /^127\./,                    // 127.0.0.0/8
      /^10\./,                     // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
      /^192\.168\./,               // 192.168.0.0/16
      /^169\.254\./,               // 169.254.0.0/16 (link-local)
      /^localhost$/i,
    ];

    if (privateIPPatterns.some(pattern => pattern.test(hostname))) {
      return res.status(403).json({ error: "내부 IP 주소는 허용되지 않습니다" });
    }

    // 외부 이미지 fetch
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: "이미지를 가져올 수 없습니다" });
    }

    // Content-Type 확인
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      return res.status(400).json({ error: "유효한 이미지가 아닙니다" });
    }

    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24시간 캐시

    // 이미지 데이터 스트리밍
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error) {
    console.error("[API] 이미지 프록시 실패:", error);
    res.status(500).json({ error: "이미지 프록시에 실패했습니다" });
  }
});

// AI 이미지 추천 엔드포인트 (Pexels API 사용)
cardLayoutRouter.get("/recommend-image", async (req: Request, res: Response) => {
  try {
    const { query, page = "1" } = req.query;
    
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: "검색어(query)가 필요합니다" });
    }
    
    const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
    if (!PEXELS_API_KEY) {
      console.error("[API] PEXELS_API_KEY 환경 변수가 설정되지 않았습니다");
      return res.status(500).json({ error: "이미지 검색 서비스가 설정되지 않았습니다" });
    }
    
    // 한글 감지 (한글이 포함되어 있으면 영어로 번역)
    const hasKorean = /[가-힣]/.test(query);
    let searchQuery = query;
    
    if (hasKorean) {
      try {
        console.log(`[API] 한글 검색어 감지: "${query}" - 영어로 번역 중...`);
        searchQuery = await translateText(query, "English");
        console.log(`[API] 번역 완료: "${query}" → "${searchQuery}"`);
      } catch (error) {
        console.error("[API] 번역 실패, 원본 검색어 사용:", error);
        // 번역 실패 시 원본 그대로 사용
      }
    }
    
    // Pexels API 호출
    const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=10&page=${page}`;
    const response = await fetch(pexelsUrl, {
      headers: {
        'Authorization': PEXELS_API_KEY
      }
    });
    
    if (!response.ok) {
      console.error("[API] Pexels API 호출 실패:", response.status, response.statusText);
      return res.status(response.status).json({ error: "이미지 검색에 실패했습니다" });
    }
    
    const data = await response.json() as {
      photos: Array<{
        id: number;
        width: number;
        height: number;
        url: string;
        photographer: string;
        photographer_url: string;
        src: {
          original: string;
          large2x: string;
          large: string;
          medium: string;
          small: string;
          portrait: string;
          landscape: string;
          tiny: string;
        };
      }>;
      total_results: number;
      page: number;
      per_page: number;
    };
    
    // 이미지 URL 목록 반환 (landscape 또는 large 사이즈 사용)
    const images = data.photos.map(photo => ({
      url: photo.src.large, // 큰 사이즈 이미지
      thumbnail: photo.src.medium, // 썸네일
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url
    }));
    
    console.log(`[API] Pexels 이미지 검색 성공: 원본="${query}", 검색="${searchQuery}", page=${page}, 결과=${images.length}개`);
    
    res.json({
      images,
      totalResults: data.total_results,
      page: data.page,
      hasMore: data.photos.length === data.per_page
    });
  } catch (error) {
    console.error("[API] 이미지 추천 실패:", error);
    res.status(500).json({ error: "이미지 추천에 실패했습니다" });
  }
});
