'use server'

import { parse } from 'csv-parse/sync'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
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
  let records: Record<string, string>[]
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown parsing error'
    return { status: 'error', message: `Failed to parse CSV: ${errorMessage}` }
  }

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

  // Dedupe by external_load_id in case the same Load ID appears twice within
  // one CSV upload — Postgres rejects an upsert that would affect the same
  // row twice in a single statement. Last occurrence wins, matching the
  // behavior of re-uploading an entire file.
  const deduped = [...new Map(toUpsert.map((l) => [l.external_load_id, l])).values()]

  const externalIds = deduped.map((l) => l.external_load_id)
  const { data: existing, error: existingError } = await supabase
    .from('loads')
    .select('external_load_id')
    .in('external_load_id', externalIds)

  if (existingError) {
    return { status: 'error', message: existingError.message }
  }

  const existingIds = new Set((existing ?? []).map((l) => l.external_load_id))
  const created = deduped.filter((l) => !existingIds.has(l.external_load_id)).length
  const updated = deduped.length - created

  const { error: upsertError } = await supabase
    .from('loads')
    .upsert(deduped, { onConflict: 'external_load_id' })

  if (upsertError) {
    return { status: 'error', message: upsertError.message }
  }

  revalidatePath('/dashboard/loads')

  return { status: 'done', created, updated, skippedCancelled, needsReview, failed }
}

export async function createLoad(formData: FormData) {
  const { supabase } = await requireOwner()

  const externalLoadIdRaw = formData.get('external_load_id')
  const externalLoadId =
    typeof externalLoadIdRaw === 'string' && externalLoadIdRaw.trim()
      ? externalLoadIdRaw.trim()
      : null

  const status = formData.get('status')
  if (status !== 'booked' && status !== 'in_transit' && status !== 'delivered' && status !== 'cancelled') {
    throw new Error('Invalid status')
  }

  const pickupFacilityCodeRaw = formData.get('pickup_facility_code')
  if (typeof pickupFacilityCodeRaw !== 'string' || !pickupFacilityCodeRaw.trim()) {
    throw new Error('Pickup facility is required')
  }
  const pickupFacilityCode = pickupFacilityCodeRaw.trim()

  const deliveryFacilityCodeRaw = formData.get('delivery_facility_code')
  if (typeof deliveryFacilityCodeRaw !== 'string' || !deliveryFacilityCodeRaw.trim()) {
    throw new Error('Delivery facility is required')
  }
  const deliveryFacilityCode = deliveryFacilityCodeRaw.trim()

  const pickupDatetimeRaw = formData.get('pickup_datetime')
  const pickupDatetime =
    typeof pickupDatetimeRaw === 'string' && pickupDatetimeRaw
      ? new Date(pickupDatetimeRaw).toISOString()
      : null

  const deliveryDatetimeRaw = formData.get('delivery_datetime')
  const deliveryDatetime =
    typeof deliveryDatetimeRaw === 'string' && deliveryDatetimeRaw
      ? new Date(deliveryDatetimeRaw).toISOString()
      : null

  const distanceRaw = formData.get('distance_miles')
  const distanceMiles = typeof distanceRaw === 'string' && distanceRaw ? Number(distanceRaw) : null

  const rateRaw = formData.get('rate_total')
  const rateTotal = typeof rateRaw === 'string' && rateRaw ? Number(rateRaw) : null

  const ratePerMile =
    rateTotal && distanceMiles && distanceMiles > 0 ? rateTotal / distanceMiles : null

  const driverIdRaw = formData.get('driver_id')
  const driverId = typeof driverIdRaw === 'string' && driverIdRaw ? driverIdRaw : null

  let assignedDriverName: string | null = null
  if (driverId) {
    const { data: driverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', driverId)
      .single()
    assignedDriverName = driverProfile?.name ?? null
  }

  const { error } = await supabase.from('loads').insert({
    external_load_id: externalLoadId,
    status,
    pickup_facility_code: pickupFacilityCode,
    pickup_datetime: pickupDatetime,
    delivery_facility_code: deliveryFacilityCode,
    delivery_datetime: deliveryDatetime,
    distance_miles: distanceMiles,
    rate_total: rateTotal,
    rate_per_mile: ratePerMile,
    driver_id: driverId,
    assigned_driver_name: assignedDriverName,
  })

  if (error) {
    throw new Error(error.message)
  }

  redirect('/dashboard/loads')
}
