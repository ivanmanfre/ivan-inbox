export function evaluate(input: {
  seat: string; prospect: object; rows: object[]; messages: object[];
  complete: boolean; now?: number; firstGap?: number; allowEmail?: boolean; morningBatch?: boolean;
}): {
  ok: boolean; reason: string; due_at?: string; last_delivered_touch_at?: string;
  followup_count?: number; gap_days?: number;
}
