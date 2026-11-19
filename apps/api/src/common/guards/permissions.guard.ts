import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES, type PermissionKey } from "@keystonehr/shared";
import { PermissionSetService } from "../permission-set.service";
import { PERMISSIONS_KEY } from "../decorators";

/**
 * Global guard, runs after JwtAuthGuard. Loads the role's permission set (via
 * PermissionSetService, cached 60s in-process; role edits call
 * PermissionSetService.bustCache(roleId)) and requires every key declared via
 * @Permissions(...).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionSet: PermissionSetService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const roleId: string | undefined = req.userContext?.roleId;
    if (!roleId) return false;

    const keys = await this.permissionSet.getPermissionSet(roleId);
    const missing = required.filter((k) => !keys.has(k));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: ERROR_CODES.PERMISSION_DENIED,
        message: `Missing permission: ${missing.join(", ")}`,
      });
    }
    return true;
  }
}
