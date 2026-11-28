export * from './session-view.js'
export interface UsageRecord {
  readonly schemaVersion: 1
  readonly usageId: string
  readonly rawUsageHash: string
  readonly attribution: Readonly<Record<string, unknown>>
  readonly observedAt: string | null
  readonly normalized: Readonly<Record<string, number | null>>
  readonly raw: Readonly<Record<string, unknown>>
  readonly correctionOf: string | null
}
export interface UsageReadOptions {
  readonly observedAt?: string | null
  readonly correctionOf?: string
}
export function adaptUsage(
  raw: Readonly<Record<string, unknown>>,
  attribution: Readonly<Record<string, unknown>>,
  options?: UsageReadOptions,
): UsageRecord
export function adaptUsageFromEvent(event: unknown): UsageRecord | null
export * from './toolset.js'
export * from './workbench-limits.js'
