import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 900;
// Short and fail-fast: every app bootstrap (every test file's own Nest app included) calls
// onModuleInit, so a slow/unreachable MinIO must never stall startup — the bucket/CORS setup
// below already swallows failures, but the default SDK socket timeout (minutes) would still
// block until the client gives up.
const INIT_REQUEST_TIMEOUT_MS = 4_000;

/**
 * Presigned-URL object storage (docs/ARCHITECTURE.md: "bytes never proxy through the app").
 * MinIO in dev speaks the real S3 protocol, so this is the same client/calls real AWS S3 would
 * use — switching later is purely swapping S3_ENDPOINT/credentials, no code change.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_UPLOADS_BUCKET!;
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      // required for MinIO (and most non-AWS S3-compatible stores) — real AWS S3 also accepts this
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: INIT_REQUEST_TIMEOUT_MS,
        requestTimeout: INIT_REQUEST_TIMEOUT_MS,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })).catch((err) => {
        this.logger.warn(`Could not create uploads bucket "${this.bucket}": ${err}`);
      });
    }
    // Real S3 buckets have no CORS by default, so this matters once we point at actual AWS —
    // MinIO, however, doesn't implement the S3 PutBucketCors API at all (always NotImplemented;
    // its CORS is the server-level MINIO_API_CORS_ALLOW_ORIGIN env var in docker-compose.yml
    // instead), so this call is expected to no-op there. Keep it for when the endpoint changes.
    await this.client
      .send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ["*"],
                AllowedMethods: ["GET", "PUT"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      )
      .catch((err) => {
        this.logger.debug(`Bucket CORS not set (expected against MinIO): ${err}`);
      });
  }

  async getUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  }

  async getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  }
}
