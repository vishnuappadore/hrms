import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { PermissionKey } from "@keystonehr/shared";
import type { RequestContext } from "./request-context";

export const IS_PUBLIC_KEY = "isPublic";
/** Skip JWT auth for this route (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = "requiredPermissions";
/** Require ALL listed permission keys (checked by PermissionsGuard). */
export const Permissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, keys);

export const BRANCH_SCOPE_KEY = "branchScopeParam";
/**
 * Enforce branch-level access: the request's branch id (route param, query or
 * body field named `paramName`) must be in the user's assigned branches,
 * unless the user has all-branches access. Checked by BranchScopeGuard.
 */
export const BranchScoped = (paramName = "branchId") => SetMetadata(BRANCH_SCOPE_KEY, paramName);

/** Injects the authenticated request context populated by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    return ctx.switchToHttp().getRequest().userContext;
  },
);
