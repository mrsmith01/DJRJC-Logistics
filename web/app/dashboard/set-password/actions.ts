'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function setPassword(formData: FormData) {
  const password = formData.get('password')
  const confirm = formData.get('confirm')

  if (typeof password !== 'string' || typeof confirm !== 'string') {
    redirect('/dashboard/set-password?error=missing_fields')
  }

  if (password.length < 8) {
    redirect('/dashboard/set-password?error=too_short')
  }

  if (password !== confirm) {
    redirect('/dashboard/set-password?error=mismatch')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect('/dashboard/set-password?error=update_failed')
  }

  redirect('/dashboard')
}
