import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ClsService } from "nestjs-cls";
import { ERROR_CODES } from "@keystonehr/shared";
import { IS_PUBLIC_KEY } from "../decorators";
import { setRequestContext } from "../request-context";

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  allBranches: boolean;
  branchIds: string[];
}

/**
 * Global guard: verifies the Bearer access token and populates both the
 * request object (`req.userContext`) and CLS — everything downstream
 * (PermissionsGuard, audit) reads from CLS.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers["authorization"];
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException({ code: ERROR_CODES.TOKEN_INVALID, message: "Missing token" });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch (err) {
      const expired = (err as Error).name === "TokenExpiredError";
      throw new UnauthorizedException({
        code: expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        message: expired ? "Token expired" : "Invalid token",
      });
    }

    const userContext = {
      userId: payload.sub,
      roleId: payload.roleId,
      allBranches: payload.allBranches,
      branchIds: payload.branchIds ?? [],
    };
    req.userContext = userContext;
    setRequestContext(this.cls, userContext);
    return true;
  }
}
