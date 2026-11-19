import { Global, Module } from "@nestjs/common";
import { AuthPrismaService } from "./auth-prisma.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, AuthPrismaService],
  exports: [PrismaService, AuthPrismaService],
})
export class DatabaseModule {}
