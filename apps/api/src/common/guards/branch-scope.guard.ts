import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@keystonehr/shared";
import { BRANCH_SCOPE_KEY } from "../decorators";

/**
 * Global guard, runs after JwtAuthGuard. Active only on routes decorated with
 * @BranchScoped(paramName): asserts the branch id found in route params, query
 * or body is within the user's assigned branches (all-branches users pass).
 *
 * List endpoints WITHOUT a single branch id use getEffectiveBranchIds() in the
 * service query instead — this guard is for single-branch operations.
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string>(BRANCH_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!paramName) return true;

    const req = context.switchToHttp().getRequest();
    const ctx = req.userContext;
    if (!ctx) return false;
    if (ctx.allBranches) return true;

    const branchId: string | undefined =
      req.params?.[paramName] ?? req.query?.[paramName] ?? req.body?.[paramName];

    // No branch specified on a scoped route: let the service apply
    // getEffectiveBranchIds() filtering rather than failing here.
    if (!branchId) return true;

    if (!ctx.branchIds.includes(branchId)) {
      throw new ForbiddenException({
        code: ERROR_CODES.BRANCH_ACCESS_DENIED,
        message: "You do not have access to this branch",
      });
    }
    return true;
  }
}
