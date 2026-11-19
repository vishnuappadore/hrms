import { Global, Module } from "@nestjs/common";
import { PermissionSetService } from "./permission-set.service";

/** Global like DatabaseModule — PermissionsGuard (an APP_GUARD) and any service
 *  that needs the caller's resolved permission set (e.g. DashboardService) both
 *  depend on this. */
@Global()
@Module({
  providers: [PermissionSetService],
  exports: [PermissionSetService],
})
export class PermissionSetModule {}
