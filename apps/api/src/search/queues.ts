export const SEARCH_QUEUE = 'search';
export const NOTIFY_QUEUE = 'notifications';

export type SearchJob =
  /** runId: the QUEUED SearchRun created at enqueue (absent in jobs queued by older versions) */
  | { type: 'tracker'; trackerId: string; trigger: 'MANUAL' | 'INITIAL'; runId?: string }
  | { type: 'batch'; trackerIds: string[]; batchId: string };

export type NotifyJob =
  | { type: 'daily-summary'; userId: string; reportDate: string }
  | { type: 'price-drop'; userId: string; trackerId: string; searchRunId: string; reportDate: string };
