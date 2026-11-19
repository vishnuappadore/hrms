import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "ready"] });
  app.enableShutdownHooks(); // SIGTERM draining — required for ECS/K8s rolling deploys

  // OpenAPI — the future mobile contract.
  // TODO: nestjs-zod's patchNestJsSwagger is incompatible with @nestjs/swagger 11;
  // wire zod schema output (zodToOpenAPI / upgrade when nestjs-zod supports it)
  // before generating the mobile client (docs/API-CONVENTIONS.md).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Keystone HR API")
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);

  await app.listen(Number(process.env.API_PORT ?? 4000));
}

void bootstrap();
