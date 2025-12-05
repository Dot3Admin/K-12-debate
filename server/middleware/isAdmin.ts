import type { Request, Response, NextFunction } from "express";

// 운영자 권한 체크 미들웨어
export function isAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "인증이 필요합니다." });
  }

  const userRole = req.user.role;
  
  // operation_admin, master_admin, agent_admin 허용
  if (userRole === "operation_admin" || userRole === "master_admin" || userRole === "agent_admin") {
    return next();
  }

  return res.status(403).json({ message: "운영자 권한이 필요합니다." });
}
