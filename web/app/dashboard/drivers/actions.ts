'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'

async function requireOwner() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    throw new Error('Only the owner can perform this action')
  }
}

export async function inviteDriver(formData: FormData) {
  await requireOwner()

  const email = formData.get('email') as string
  const name = formData.get('name') as string

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
  await requireOwner()

  const unitNumber = formData.get('unit_number') as string
  const plate = formData.get('plate') as string

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('trucks').insert({
    unit_number: unitNumber,
    plate: plate || null,
    owner_id: user!.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}
