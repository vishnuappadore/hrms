import {
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { ERROR_CODES, type AuthTokens, type AuthUser } from "@keystonehr/shared";
import { PrismaService } from "../../database/prisma.service";
import type { AccessTokenPayload } from "../../common/guards/jwt-auth.guard";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(identifier: string, password: string, deviceInfo?: string) {
    const db = this.prisma.client;
    const user = await db.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier.toLowerCase() }, { username: identifier }],
      },
      include: {
        role: { include: { permissions: { select: { permissionKey: true } } } },
        branchAssignments: { select: { branchId: true } },
      },
    });

    // argon2 verify even on miss — keeps timing uniform
    const hash = user?.passwordHash ?? (await AuthService.dummyHash());
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!user || !valid) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: "Invalid email/username or password",
      });
    }
    if (user.status !== "active") {
      throw new UnauthorizedException({
        code: ERROR_CODES.ACCOUNT_INACTIVE,
        message: "Your account is inactive. Please contact administrator",
      });
    }

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user.id, {
      roleId: user.roleId,
      allBranches: user.allBranches,
      branchIds: user.branchAssignments.map((a) => a.branchId),
      deviceInfo,
    });

    const company = await db.companySettings.findUnique({ where: { id: "default" } });

    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      roleId: user.roleId,
      roleNameEn: user.role.nameEn,
      roleNameAr: user.role.nameAr,
      permissions: user.role.permissions.map((p) => p.permissionKey),
      allBranches: user.allBranches,
      branchIds: user.branchAssignments.map((a) => a.branchId),
      locale: user.locale === "ar" ? "ar" : "en",
      currency: company?.defaultCurrency ?? "AED",
    };
    return { tokens, user: authUser };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const db = this.prisma.client;
    const tokenHash = sha256(refreshToken);
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: { include: { branchAssignments: { select: { branchId: true } } } },
      },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: "Invalid refresh token",
      });
    }
    if (stored.user.status !== "active" || stored.user.deletedAt) {
      throw new UnauthorizedException({
        code: ERROR_CODES.ACCOUNT_INACTIVE,
        message: "Your account is inactive. Please contact administrator",
      });
    }

    // Rotation: the old token is revoked, a new pair is issued.
    await db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.userId, {
      roleId: stored.user.roleId,
      allBranches: stored.user.allBranches,
      branchIds: stored.user.branchAssignments.map((a) => a.branchId),
      deviceInfo: stored.deviceInfo ?? undefined,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.client.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Always responds success (no user enumeration). Token is logged in dev;
   * a mailer adapter sends it once notifications land.
   */
  async forgotPassword(email: string): Promise<void> {
    const db = this.prisma.client;
    const user = await db.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null, status: "active" },
    });
    if (!user) return;

    const raw = randomBytes(32).toString("base64url");
    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
      },
    });
    this.logger.log(`Password reset token for ${email}: ${raw} (dev only — wire mailer)`);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const db = this.prisma.client;
    const stored = await db.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_INVALID,
        message: "Invalid or expired reset token",
      });
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await db.$transaction([
      db.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      db.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      // password change revokes all sessions
      db.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async issueTokens(
    userId: string,
    ctx: {
      roleId: string;
      allBranches: boolean;
      branchIds: string[];
      deviceInfo?: string;
    },
  ): Promise<AuthTokens> {
    const payload: AccessTokenPayload = {
      sub: userId,
      roleId: ctx.roleId,
      allBranches: ctx.allBranches,
      branchIds: ctx.branchIds,
    };
    const expiresIn = Number(process.env.JWT_ACCESS_TTL ?? 900);
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn,
    });

    const refreshToken = randomBytes(48).toString("base64url");
    const refreshTtl = Number(process.env.JWT_REFRESH_TTL ?? 2_592_000);
    await this.prisma.client.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        deviceInfo: ctx.deviceInfo,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn };
  }

  private static dummy?: string;
  private static async dummyHash(): Promise<string> {
    AuthService.dummy ??= await argon2.hash("dummy-timing-password", { type: argon2.argon2id });
    return AuthService.dummy;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
