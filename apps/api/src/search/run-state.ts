import { Prisma, PrismaClient, SearchRunStatus } from '@prisma/client';

/**
 * SearchRun lifecycle – every status change goes through the rules below.
 *
 *   enqueue ──▶ QUEUED ──▶ RUNNING ──▶ SUCCESS | PARTIAL | NO_RESULTS | FAILED
 *                 │           │
 *                 │           └──▶ FAILED      job threw, or no live worker any more (stale)
 *                 ├──▶ FAILED                  job gave up before it started, or stale
 *                 └──▶ (deleted)               tracker paused / trip dates passed before the job ran
 *
 * The row is created as QUEUED when the job is enqueued, so "a search is in progress" is visible
 * from that moment on. A run can only stay QUEUED/RUNNING while a worker is behind it: after
 * STALE_RUN_MINUTES it no longer counts as active and the scheduler fails it.
 * A late finalize may still overwrite a stale FAILED with the real outcome – the real result wins.
 */
export const ACTIVE_RUN_STATUSES: SearchRunStatus[] = ['QUEUED', 'RUNNING'];

/** No search takes this long (BullMQ re-delivers a job after a 10 min lock loss), so such a run has no worker behind it. */
export const STALE_RUN_MINUTES = 30;

export const INTERRUPTED_MESSAGE = 'Search was interrupted (worker restarted or job failed)';

export function staleCutoff(now = new Date()): Date {
  return new Date(now.getTime() - STALE_RUN_MINUTES * 60_000);
}

/** "A search is in progress" – the one definition behind the API gate, the UI spinner and report scheduling. */
export function activeRunWhere(now = new Date()): Prisma.SearchRunWhereInput {
  return { status: { in: ACTIVE_RUN_STATUSES }, startedAt: { gte: staleCutoff(now) } };
}

/** QUEUED/RUNNING → FAILED. Never touches runs that already reached a final status. */
export function failUnfinishedRuns(prisma: PrismaClient, where: Prisma.SearchRunWhereInput, message = INTERRUPTED_MESSAGE) {
  return prisma.searchRun.updateMany({
    where: { AND: [where, { status: { in: ACTIVE_RUN_STATUSES } }] },
    data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
  });
}
