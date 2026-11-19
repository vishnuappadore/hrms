import { z } from "zod";

/** Standard list-endpoint query params. Extend per endpoint with flat filters. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** `-field` for descending, `field` for ascending */
  sort: z.string().max(50).optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export const UuidSchema = z.string().uuid();

/** E.164-ish mobile numbers; primary customer identifier (dedupe key). */
export const MobileSchema = z
  .string()
  .regex(/^\+?[0-9]{8,15}$/, "Invalid mobile number");
