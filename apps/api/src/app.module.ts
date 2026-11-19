import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_PIPE } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { JwtModule } from "@nestjs/jwt";
import { ClsModule } from "nestjs-cls";
import { LoggerModule } from "nestjs-pino";
import { ZodValidationPipe } from "nestjs-zod";
import { randomUUID } from "node:crypto";
import { validateEnv } from "./config/env";
import { CLS_KEYS } from "./common/request-context";
import { GlobalExceptionFilter } from "./common/filters/http-exception.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { BranchScopeGuard } from "./common/guards/branch-scope.guard";
import { PermissionSetModule } from "./common/permission-set.module";
import { DatabaseModule } from "./database/database.module";
import { AttendanceModule } from "./modules/attendance/attendance.module";
import { AuditModule } from "./modules/audit/audit.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BranchesModule } from "./modules/branches/branches.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { HealthModule } from "./modules/health/health.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { PosModule } from "./modules/pos/pos.module";
import { WalkInsModule } from "./modules/walk-ins/walk-ins.module";
import { LeaveModule } from "./modules/leave/leave.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
import { ServicesModule } from "./modules/services/services.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { TaxesModule } from "./modules/taxes/taxes.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req) => {
          const requestId = req.headers["x-request-id"] ?? randomUUID();
          cls.set(CLS_KEYS.requestId, requestId);
        },
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        transport:
          process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
        redact: ["req.headers.authorization", "req.headers.cookie"],
      },
    }),
    EventEmitterModule.forRoot(),
    JwtModule.register({ global: true }),
    DatabaseModule,
    PermissionSetModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    BranchesModule,
    CustomersModule,
    ServicesModule,
    AppointmentsModule,
    WalkInsModule,
    InventoryModule,
    PosModule,
    SettingsModule,
    TaxesModule,
    PayrollModule,
    AttendanceModule,
    LeaveModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Order matters: auth populates CLS → permissions → branch scope
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: BranchScopeGuard },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
