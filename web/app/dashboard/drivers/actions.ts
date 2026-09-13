'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service-client'
import { requireOwner } from '@/lib/supabase/require-owner'

export async function inviteDriver(formData: FormData) {
  await requireOwner()

  const email = formData.get('email')
  const name = formData.get('name')

  if (typeof email !== 'string' || !email || typeof name !== 'string' || !name) {
    throw new Error('Name and email are required')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { name },
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}

export async function addTruck(formData: FormData) {
  const { supabase, user } = await requireOwner()

  const unitNumber = formData.get('unit_number')
  const plate = formData.get('plate')

  if (typeof unitNumber !== 'string' || !unitNumber) {
    throw new Error('Unit number is required')
  }

  const { error } = await supabase.from('trucks').insert({
    unit_number: unitNumber,
    plate: typeof plate === 'string' && plate ? plate : null,
    owner_id: user.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}
