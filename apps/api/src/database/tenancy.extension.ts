import { Prisma } from "@prisma/client";
import { ClsService } from "nestjs-cls";
import { getTenantId } from "../common/request-context";

/**
 * Tenant isolation choke point.
 *
 * Wraps EVERY model query in a batch transaction whose first statement sets
 * the transaction-local `app.tenant_id` GUC. RLS policies read that setting.
 *
 * Why a transaction: `set_config(..., true)` is transaction-local, which is
 * the only pooling-safe way to carry per-request state — a session-level SET
 * would leak across requests once a pooler reuses the connection.
 *
 * Queries with no tenant in CLS (background jobs that forgot context, stray
 * calls before auth) run WITHOUT the setting and RLS fails closed (zero rows).
 */
export function createTenancyExtension(cls: ClsService) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: "tenancy",
      query: {
        $allModels: {
          async $allOperations({ args, query, model, operation }) {
            const tenantId = getTenantId(cls);
            if (!tenantId) {
              // Fail closed — surface a clear error instead of empty results.
              throw new Error(
                `Tenant context missing for ${model}.${operation}. ` +
                  `Use AuthPrismaService for pre-auth flows or runWithTenant() in jobs.`,
              );
            }
            const [, result] = await client.$transaction([
              client.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    }),
  );
}
