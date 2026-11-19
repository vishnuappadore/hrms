import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_NAMES_AR, SYSTEM_ROLES } from "@keystonehr/shared";
import { AuthPrismaService } from "../../database/auth-prisma.service";

/**
 * Tenant provisioning — used by the seed script and (later) the platform
 * admin surface. Runs on the RLS-bypassing client because it creates the
 * tenant that RLS scopes to. No public controller by design.
 */
@Injectable()
export class TenantsService {
  constructor(private readonly db: AuthPrismaService) {}

  async provisionTenant(input: {
    name: string;
    slug: string;
    admin: { name: string; email: string; username: string; password: string };
    /** Market-specific defaults — never hard-code these in feature code */
    defaults?: {
      currency?: string;
      taxProfile?: {
        name: string;
        country?: string;
        components: { name: string; ratePercent: number }[];
      };
    };
  }) {
    const tenant = await this.db.tenant.create({
      data: {
        name: input.name,
        slug: input.slug,
        ...(input.defaults?.currency ? { defaultCurrency: input.defaults.currency } : {}),
      },
    });

    // Default tax scheme — branches created without an explicit profile inherit it
    const tax = input.defaults?.taxProfile ?? {
      name: "VAT",
      country: "OM",
      components: [{ name: "VAT", ratePercent: 5 }],
    };
    await this.db.taxProfile.create({
      data: {
        tenantId: tenant.id,
        name: tax.name,
        country: tax.country ?? null,
        isDefault: true,
        components: {
          create: tax.components.map((c, i) => ({
            tenantId: tenant.id,
            name: c.name,
            ratePercent: c.ratePercent,
            sortOrder: i,
          })),
        },
      },
    });

    // Seed system roles from the shared catalog
    const roleIdsByName = new Map<string, string>();
    for (const [roleName, keys] of Object.entries(SYSTEM_ROLES)) {
      const role = await this.db.role.create({
        data: {
          tenantId: tenant.id,
          nameEn: roleName,
          nameAr: SYSTEM_ROLE_NAMES_AR[roleName] ?? roleName,
          isSystem: true,
          isSuperAdmin: roleName === "Super Admin",
          isBarber: roleName === "Barber",
          permissions: {
            create: (keys === "*" ? ALL_PERMISSION_KEYS : [...keys]).map((permissionKey) => ({
              tenantId: tenant.id,
              permissionKey,
            })),
          },
        },
      });
      roleIdsByName.set(roleName, role.id);
    }

    const passwordHash = await argon2.hash(input.admin.password, { type: argon2.argon2id });
    const adminUser = await this.db.user.create({
      data: {
        tenantId: tenant.id,
        name: input.admin.name,
        email: input.admin.email.toLowerCase(),
        username: input.admin.username,
        passwordHash,
        allBranches: true,
        roleId: roleIdsByName.get("Super Admin")!,
      },
    });

    return { tenant, adminUser, roleIdsByName };
  }
}
