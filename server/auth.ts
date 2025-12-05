import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import connectPg from "connect-pg-simple";
import MemoryStore from "memorystore";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

async function hashPassword(password: string) {
  return await bcrypt.hash(password, 10);
}

async function comparePasswords(supplied: string, stored: string) {
  return await bcrypt.compare(supplied, stored);
}

export function setupAuth(app: Express) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  
  // Use PostgreSQL store for sessions
  console.log('Using PostgreSQL database storage');
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  // 🔒 SESSION_SECRET 필수 설정
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    name: 'connect.sid',
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // 프로덕션에서는 true
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user || !user.password || !(await comparePasswords(password, user.password))) {
          return done(null, false);
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });
  
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (user) {
        return done(null, user);
      } else {
        return done(null, false);
      }
    } catch (error) {
      return done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const { username, password, firstName, lastName, email, userType } = req.body;
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "사용자가 이미 존재합니다" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        id: username, // 학번/교번을 ID로 사용
        username,
        password: hashedPassword,
        firstName,
        lastName,
        email,
        userType: userType || "student",
      });

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json({ 
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          userType: user.userType,
          role: user.role
        });
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "회원가입 중 오류가 발생했습니다" });
    }
  });

  app.post("/api/login", (req, res, next) => {
    // 🔒 passport.authenticate 콜백 패턴으로 세션 고정 방지 개선
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      // 세션 재생성 후 로그인 처리
      req.session.regenerate((err) => {
        if (err) {
          console.error('세션 재생성 실패:', err);
          return res.status(500).json({ message: 'Login session error' });
        }
        
        req.login(user, (err) => {
          if (err) {
            console.error('로그인 처리 실패:', err);
            return res.status(500).json({ message: 'Login processing error' });
          }
          
          // 🔒 민감 정보 제거된 안전한 사용자 데이터만 반환
          res.status(200).json({
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            userType: user.userType,
            role: user.role
          });
        });
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    console.log('📤 로그아웃 요청 처리 시작');
    
    req.logout((err) => {
      if (err) {
        console.error('Passport 로그아웃 실패:', err);
        return next(err);
      }
      
      req.session.destroy((err) => {
        if (err) {
          console.error('세션 삭제 실패:', err);
          // 세션 삭제 실패해도 쿠키는 클리어하고 성공 응답
        }
        
        // 세션 쿠키 완전 삭제 (환경별 secure 설정)
        res.clearCookie('connect.sid', {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax'
        });
        
        console.log('✅ 로그아웃 완료 - 세션 및 쿠키 정리됨');
        res.json({ success: true, message: 'Logout successful' });
      });
    });
  });


  app.get("/api/user", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.sendStatus(401);
    }
    
    const userId = (req.user as SelectUser).id;
    try {
      // Get fresh user data from storage
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // 🔒 민감 정보 제거된 안전한 사용자 데이터만 반환
      res.json({
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        userType: user.userType,
        role: user.role,
        status: user.status,
        organizationAffiliations: user.organizationAffiliations,
        nickname: user.nickname,
        age: user.age,
        gender: user.gender,
        country: user.country,
        religion: user.religion,
        occupation: user.occupation,
        lifeStage: user.lifeStage
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update user profile
  app.patch("/api/user/profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const userId = (req.user as SelectUser).id;
      const { name, email, position, userMemo, nickname, age, gender, country, religion, occupation, preferredLanguage, lifeStage } = req.body;

      console.log('[AUTH.TS PROFILE UPDATE] 받은 데이터:', { userId, lifeStage, nickname });

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // 🔒 LifeStage 값 검증
      const VALID_LIFE_STAGES = ["EC", "LC", "EA", "AD", "YA1", "YA2", "MA1", "MA2", "FS"];
      if (lifeStage !== undefined && lifeStage !== "" && lifeStage !== null && !VALID_LIFE_STAGES.includes(lifeStage)) {
        return res.status(400).json({ message: "Invalid lifeStage value" });
      }

      // Build updates object with only defined fields
      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) updates.email = email;
      if (position !== undefined) updates.position = position;
      if (userMemo !== undefined) updates.userMemo = userMemo;
      if (nickname !== undefined) updates.nickname = nickname;
      if (age !== undefined) updates.age = age;
      if (gender !== undefined) updates.gender = gender;
      if (country !== undefined) updates.country = country;
      if (religion !== undefined) updates.religion = religion;
      if (occupation !== undefined) updates.occupation = occupation;
      if (preferredLanguage !== undefined) updates.preferredLanguage = preferredLanguage;
      if (lifeStage !== undefined) updates.lifeStage = lifeStage;

      console.log('[AUTH.TS PROFILE UPDATE] updates 객체:', updates);

      // Update user profile
      const updatedUser = await storage.updateUser(userId, updates);

      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update user" });
      }

      // 🔒 민감 정보 제거된 안전한 사용자 데이터만 반환
      res.json({ 
        success: true, 
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          email: updatedUser.email,
          userType: updatedUser.userType,
          role: updatedUser.role,
          status: updatedUser.status,
          organizationAffiliations: updatedUser.organizationAffiliations,
          nickname: updatedUser.nickname,
          age: updatedUser.age,
          gender: updatedUser.gender,
          country: updatedUser.country,
          religion: updatedUser.religion,
          occupation: updatedUser.occupation,
          lifeStage: updatedUser.lifeStage
        }
      });
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Change user password
  app.patch("/api/user/password", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const userId = (req.user as SelectUser).id;
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters long" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const isCurrentPasswordValid = await comparePasswords(currentPassword, user.password);
      
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const hashedNewPassword = await hashPassword(newPassword);

      // Update password
      await storage.updateUser(userId, {
        password: hashedNewPassword,
      });

      res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}

export const isAuthenticated = (req: any, res: any, next: any) => {
  console.log(`[AUTH DEBUG] isAuthenticated called for ${req.method} ${req.path}`);
  console.log(`[AUTH DEBUG] req.isAuthenticated(): ${req.isAuthenticated()}`);
  console.log(`[AUTH DEBUG] req.user:`, req.user ? { id: req.user.id, username: req.user.username } : 'undefined');
  
  if (req.isAuthenticated()) {
    console.log(`[AUTH DEBUG] Authentication successful, proceeding...`);
    return next();
  }
  console.log(`[AUTH DEBUG] Authentication failed, returning 401`);
  res.status(401).json({ message: "Unauthorized" });
};