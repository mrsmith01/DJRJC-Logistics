'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service-client'
import { requireOwner } from '@/lib/supabase/require-owner'

const BAN_FOREVER = '87600h' // ~10 years; Supabase has no permanent-ban value

function requireNonEmptyString(value: FormDataEntryValue | null, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required`)
  }
  return value.trim()
}

export async function inviteDriver(formData: FormData) {
  await requireOwner()

  const email = requireNonEmptyString(formData.get('email'), 'Email')
  const name = requireNonEmptyString(formData.get('name'), 'Name')

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { name },
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

// Bypasses email entirely: the owner sets the driver's initial password
// directly and the account is created already-confirmed, so the driver can
// sign in immediately. Exists because this project's email deliverability
// is unreliable (Supabase's default mailer rate-limits aggressively).
export async function createDriverWithPassword(formData: FormData) {
  await requireOwner()

  const email = requireNonEmptyString(formData.get('email'), 'Email')
  const name = requireNonEmptyString(formData.get('name'), 'Name')
  const password = requireNonEmptyString(formData.get('password'), 'Password')

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function setUserPassword(formData: FormData) {
  await requireOwner()

  const userId = requireNonEmptyString(formData.get('user_id'), 'User')
  const password = requireNonEmptyString(formData.get('password'), 'Password')

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function resendInvite(formData: FormData) {
  await requireOwner()

  const email = requireNonEmptyString(formData.get('email'), 'Email')

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function setUserActive(formData: FormData) {
  const { user: currentUser } = await requireOwner()

  const userId = requireNonEmptyString(formData.get('user_id'), 'User')
  const active = formData.get('active') === 'true'

  if (userId === currentUser.id) {
    throw new Error('You cannot deactivate your own account')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : BAN_FOREVER,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function deleteUser(formData: FormData) {
  const { user: currentUser } = await requireOwner()

  const userId = requireNonEmptyString(formData.get('user_id'), 'User')

  if (userId === currentUser.id) {
    throw new Error('You cannot remove your own account')
  }

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.deleteUser(userId)

  if (error) {
    if (error.message.toLowerCase().includes('foreign key')) {
      throw new Error(
        'Cannot remove this user: they have loads or expenses on record. Deactivate them instead to preserve history.'
      )
    }
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function updateUserProfile(formData: FormData) {
  const { supabase, user: currentUser } = await requireOwner()

  const userId = requireNonEmptyString(formData.get('user_id'), 'User')
  const name = requireNonEmptyString(formData.get('name'), 'Name')
  const phoneRaw = formData.get('phone')
  const phone = typeof phoneRaw === 'string' && phoneRaw.trim() ? phoneRaw.trim() : null
  const role = formData.get('role')

  if (role !== 'owner' && role !== 'driver') {
    throw new Error('Invalid role')
  }

  if (userId === currentUser.id && role !== 'owner') {
    throw new Error('You cannot change your own role')
  }

  const { error } = await supabase
    .from('profiles')
    .update({ name, phone, role })
    .eq('id', userId)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function assignTruckDriver(formData: FormData) {
  const { supabase } = await requireOwner()

  const truckId = requireNonEmptyString(formData.get('truck_id'), 'Truck')
  const driverIdRaw = formData.get('driver_id')
  const driverId = typeof driverIdRaw === 'string' && driverIdRaw ? driverIdRaw : null

  const { error } = await supabase
    .from('trucks')
    .update({ driver_id: driverId })
    .eq('id', truckId)

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}

export async function addTruck(formData: FormData) {
  const { supabase, user } = await requireOwner()

  const unitNumber = requireNonEmptyString(formData.get('unit_number'), 'Unit number')
  const plate = formData.get('plate')

  const { error } = await supabase.from('trucks').insert({
    unit_number: unitNumber,
    plate: typeof plate === 'string' && plate ? plate : null,
    owner_id: user.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/admin')
}
