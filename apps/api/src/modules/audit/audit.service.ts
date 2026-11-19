import { Injectable } from "@nestjs/common";
import { ClsService } from "nestjs-cls";
import { CLS_KEYS } from "../../common/request-context";
import { PrismaService, type TxClient } from "../../database/prisma.service";

export interface AuditEntry {
  action: string; // e.g. "branch.created"
  entityType: string; // e.g. "branch"
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Audit writes. Inside business transactions pass the tx client so the audit
 * row commits atomically with the change; otherwise fire-and-forget.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  async log(entry: AuditEntry, tx?: TxClient): Promise<void> {
    const data = {
      tenantId: this.cls.get(CLS_KEYS.tenantId) as string,
      userId: (this.cls.get(CLS_KEYS.userId) as string) ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
    };
    if (tx) {
      await tx.auditLog.create({ data });
    } else {
      await this.prisma.client.auditLog.create({ data }).catch(() => {
        // fire-and-forget: audit failure must not fail the request
      });
    }
  }
}
