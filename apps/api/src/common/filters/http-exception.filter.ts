import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ZodValidationException } from "nestjs-zod";
import { ERROR_CODES } from "@keystonehr/shared";

/**
 * Normalizes every error to the API contract:
 *   { statusCode, code, message, details? }
 * Clients switch on `code` (stable enum in @keystonehr/shared) — never on message.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return res.status(400).json({
        statusCode: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Validation failed",
        details: zodError.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const normalized =
        typeof body === "string"
          ? { message: body }
          : (body as { code?: string; message?: string; details?: unknown });
      return res.status(status).json({
        statusCode: status,
        code: normalized.code ?? defaultCodeFor(status),
        message: normalized.message ?? exception.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      });
    }

    // Unexpected error: log full, return opaque 500
    // eslint-disable-next-line no-console
    console.error(exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 401:
      return ERROR_CODES.TOKEN_INVALID;
    case 403:
      return ERROR_CODES.PERMISSION_DENIED;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    default:
      return "ERROR";
  }
}
