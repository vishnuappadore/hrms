import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

/**
 * Resolves a role's permission-key set, cached in-process for 60s (role edits call
 * `bustCache(roleId)`). Shared by `PermissionsGuard` (the actual enforcement point) and any
 * service that needs to branch its own behavior on the caller's permissions (e.g.
 * `DashboardService` omitting sections the caller's role can't see) — one cache, not two that
 * could disagree about staleness after a role edit.
 */
@Injectable()
export class PermissionSetService {
  private static cache = new Map<string, { keys: Set<string>; expires: number }>();
  private static TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  static bustCache(roleId: string) {
    PermissionSetService.cache.delete(roleId);
  }

  async getPermissionSet(roleId: string): Promise<Set<string>> {
    const cached = PermissionSetService.cache.get(roleId);
    if (cached && cached.expires > Date.now()) return cached.keys;

    const rows = await this.prisma.client.rolePermission.findMany({
      where: { roleId },
      select: { permissionKey: true },
    });
    const keys = new Set(rows.map((r) => r.permissionKey));
    PermissionSetService.cache.set(roleId, { keys, expires: Date.now() + PermissionSetService.TTL_MS });
    return keys;
  }
}
