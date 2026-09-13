'use server'

import { parse } from 'csv-parse/sync'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/supabase/require-owner'
import { REQUIRED_COLUMNS, mapRelayRow, type MappedLoad } from './csv-mapping'

export type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      created: number
      updated: number
      skippedCancelled: number
      needsReview: { externalLoadId: string; driverName: string }[]
      failed: { row: number; reason: string }[]
    }

export async function importLoads(
  _prevState: ImportState,
  formData: FormData
): Promise<ImportState> {
  const { supabase } = await requireOwner()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a CSV file to upload.' }
  }

  const text = await file.text()
  const records: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  if (records.length === 0) {
    return { status: 'error', message: 'The CSV file has no data rows.' }
  }

  const header = Object.keys(records[0])
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missingColumns.length > 0) {
    return {
      status: 'error',
      message: `CSV is missing expected columns: ${missingColumns.join(', ')}`,
    }
  }

  const { data: drivers, error: driversError } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('role', 'driver')

  if (driversError) {
    return { status: 'error', message: driversError.message }
  }

  const driverIdByName = new Map(
    (drivers ?? []).map((d) => [d.name.trim().toLowerCase(), d.id])
  )

  const toUpsert: MappedLoad[] = []
  const needsReview: { externalLoadId: string; driverName: string }[] = []
  const failed: { row: number; reason: string }[] = []
  let skippedCancelled = 0

  records.forEach((row, index) => {
    const outcome = mapRelayRow(row, driverIdByName)

    if (outcome.kind === 'failed') {
      failed.push({ row: index + 2, reason: outcome.reason }) // +2: 1-indexed, plus header row
      return
    }

    if (outcome.kind === 'skipped_cancelled') {
      skippedCancelled += 1
      return
    }

    toUpsert.push(outcome.load)
    if (outcome.needsReview) {
      needsReview.push({
        externalLoadId: outcome.load.external_load_id,
        driverName: outcome.load.assigned_driver_name ?? '(blank)',
      })
    }
  })

  if (toUpsert.length === 0) {
    return { status: 'done', created: 0, updated: 0, skippedCancelled, needsReview, failed }
  }

  const externalIds = toUpsert.map((l) => l.external_load_id)
  const { data: existing, error: existingError } = await supabase
    .from('loads')
    .select('external_load_id')
    .in('external_load_id', externalIds)

  if (existingError) {
    return { status: 'error', message: existingError.message }
  }

  const existingIds = new Set((existing ?? []).map((l) => l.external_load_id))
  const created = toUpsert.filter((l) => !existingIds.has(l.external_load_id)).length
  const updated = toUpsert.length - created

  const { error: upsertError } = await supabase
    .from('loads')
    .upsert(toUpsert, { onConflict: 'external_load_id' })

  if (upsertError) {
    return { status: 'error', message: upsertError.message }
  }

  revalidatePath('/dashboard/loads')

  return { status: 'done', created, updated, skippedCancelled, needsReview, failed }
}
