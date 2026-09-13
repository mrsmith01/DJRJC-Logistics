'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function requestPasswordReset(formData: FormData) {
  const email = formData.get('email')

  if (typeof email !== 'string' || !email) {
    redirect('/forgot-password?error=invalid')
  }

  const supabase = await createClient()

  // Errors are intentionally ignored: never reveal whether an email has an
  // account. The user sees the same "check your inbox" message either way.
  await supabase.auth.resetPasswordForEmail(email)

  redirect('/forgot-password?sent=1')
}
