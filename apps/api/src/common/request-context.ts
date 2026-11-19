import { ClsService } from "nestjs-cls";

/** Keys stored in CLS (AsyncLocalStorage) for the lifetime of one request. */
export interface RequestContext {
  userId: string;
  roleId: string;
  allBranches: boolean;
  branchIds: string[];
  requestId: string;
}

export const CLS_KEYS = {
  userId: "ctx.userId",
  roleId: "ctx.roleId",
  allBranches: "ctx.allBranches",
  branchIds: "ctx.branchIds",
  requestId: "ctx.requestId",
} as const;

export function setRequestContext(cls: ClsService, ctx: Omit<RequestContext, "requestId">): void {
  cls.set(CLS_KEYS.userId, ctx.userId);
  cls.set(CLS_KEYS.roleId, ctx.roleId);
  cls.set(CLS_KEYS.allBranches, ctx.allBranches);
  cls.set(CLS_KEYS.branchIds, ctx.branchIds);
}

/**
 * Branch scoping helper used by every list/KPI query:
 * returns undefined for all-branches users (no filter),
 * else the array of assigned branch ids.
 */
export function getEffectiveBranchIds(cls: ClsService): string[] | undefined {
  if (cls.get(CLS_KEYS.allBranches)) return undefined;
  return cls.get(CLS_KEYS.branchIds) ?? [];
}
