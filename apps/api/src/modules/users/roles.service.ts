import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import {
  ERROR_CODES,
  type CreateRoleInput,
  type PermissionKey,
  type Role as RoleResponse,
  type RoleDetail,
  type RoleSummary,
  type UpdateRoleInput,
} from "@keystonehr/shared";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PermissionSetService } from "../../common/permission-set.service";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  /** Read-only role listing for the user-form dropdown — no permission data. */
  listRoles(): Promise<RoleResponse[]> {
    return this.prisma.client.role.findMany({
      select: { id: true, nameEn: true, nameAr: true, isSystem: true, isSuperAdmin: true },
      orderBy: { nameEn: "asc" },
    });
  }

  async list(): Promise<RoleSummary[]> {
    const roles = await this.prisma.client.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { nameEn: "asc" },
    });
    return roles.map((role) => ({
      id: role.id,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      isSystem: role.isSystem,
      isSuperAdmin: role.isSuperAdmin,
      staffCount: role._count.users,
    }));
  }

  async getDetail(id: string): Promise<RoleDetail> {
    const role = await this.prisma.client.role.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
        permissions: { select: { permissionKey: true } },
      },
    });
    if (!role) throw new NotFoundException();
    return {
      id: role.id,
      nameEn: role.nameEn,
      nameAr: role.nameAr,
      isSystem: role.isSystem,
      isSuperAdmin: role.isSuperAdmin,
      staffCount: role._count.users,
      // Trusted at the write boundary (CreateRoleSchema/UpdateRoleSchema validate against the
      // catalog); role_permissions.permission_key is a plain string column, not a DB enum.
      permissionKeys: role.permissions.map((p) => p.permissionKey as PermissionKey),
    };
  }

  async create(input: CreateRoleInput): Promise<RoleDetail> {
    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    await this.assertNameFree(input.nameEn);

    const created = await this.prisma.withTenantTx(async (tx) => {
      const role = await tx.role.create({
        data: {
          tenantId,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          isSystem: false,
          isSuperAdmin: false,
          permissions: {
            create: input.permissionKeys.map((permissionKey) => ({ tenantId, permissionKey })),
          },
        },
      });
      await this.audit.log(
        {
          action: "role.created",
          entityType: "role",
          entityId: role.id,
          after: { nameEn: role.nameEn, nameAr: role.nameAr, permissionKeys: input.permissionKeys },
        },
        tx,
      );
      return role;
    });

    return this.getDetail(created.id);
  }

  async update(id: string, input: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.prisma.client.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException();
    this.assertNotSuperAdmin(role.isSuperAdmin, "edited");
    await this.assertNameFree(input.nameEn, id);

    const tenantId = this.cls.get(CLS_KEYS.tenantId) as string;
    await this.prisma.withTenantTx(async (tx) => {
      await tx.role.update({ where: { id }, data: { nameEn: input.nameEn, nameAr: input.nameAr } });
      // permissionKeys omitted = rename only; never treat "not sent" as "remove everything".
      if (input.permissionKeys) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (input.permissionKeys.length > 0) {
          await tx.rolePermission.createMany({
            data: input.permissionKeys.map((permissionKey) => ({ tenantId, roleId: id, permissionKey })),
          });
        }
      }
      await this.audit.log(
        {
          action: "role.updated",
          entityType: "role",
          entityId: id,
          before: { nameEn: role.nameEn, nameAr: role.nameAr },
          after: { nameEn: input.nameEn, nameAr: input.nameAr, permissionKeys: input.permissionKeys },
        },
        tx,
      );
    });

    PermissionSetService.bustCache(id);
    return this.getDetail(id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.prisma.client.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException();
    this.assertNotSuperAdmin(role.isSuperAdmin, "deleted");

    const staffCount = await this.prisma.client.user.count({ where: { roleId: id } });
    if (staffCount > 0) {
      throw new ConflictException({
        code: ERROR_CODES.ROLE_IN_USE,
        message: "Reassign the staff members holding this role before deleting it",
      });
    }

    await this.prisma.withTenantTx(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.audit.log(
        { action: "role.deleted", entityType: "role", entityId: id, before: { nameEn: role.nameEn, nameAr: role.nameAr } },
        tx,
      );
    });

    PermissionSetService.bustCache(id);
  }

  private assertNotSuperAdmin(isSuperAdmin: boolean, attempted: "edited" | "deleted"): void {
    if (isSuperAdmin) {
      throw new ForbiddenException({
        code: ERROR_CODES.ROLE_PROTECTED,
        message: `The Super Admin role cannot be ${attempted}`,
      });
    }
  }

  /** RLS scopes the lookup, so a foreign tenant's name clash is simply not found. Uniqueness is
   *  checked on the stable English name only (matching Branch/LeaveType's own convention). */
  private async assertNameFree(nameEn: string, excludeId?: string): Promise<void> {
    const clash = await this.prisma.client.role.findFirst({
      where: { nameEn, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException({
        code: ERROR_CODES.NAME_EXISTS,
        message: `A role named "${nameEn}" already exists`,
      });
    }
  }
}
