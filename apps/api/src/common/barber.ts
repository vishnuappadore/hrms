import { BadRequestException } from "@nestjs/common";
import { ERROR_CODES } from "@keystonehr/shared";
import type { Prisma } from "@prisma/client";
import type { TxClient } from "../database/prisma.service";

/**
 * The ONE definition of a bookable barber, shared by Appointments (create/update/listBarbers) and
 * the Walk-in Queue: an active user whose role carries `isBarber` (a flag, not the renameable role
 * name) and who works `branchId` (or all branches). Copies of this predicate drifted before.
 */
export function bookableBarberWhere(branchId: string): Prisma.UserWhereInput {
  return {
    status: "active",
    deletedAt: null,
    role: { isBarber: true },
    OR: [{ allBranches: true }, { branchAssignments: { some: { branchId } } }],
  };
}

export async function assertBarberAvailable(tx: TxClient, branchId: string, barberId: string): Promise<void> {
  const barber = await tx.user.findFirst({
    where: { id: barberId, ...bookableBarberWhere(branchId) },
    select: { id: true },
  });
  if (!barber) {
    throw new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: "Selected barber is not available at this branch",
    });
  }
}
