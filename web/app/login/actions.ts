'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    redirect('/login?error=invalid')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const message = error.message.toLowerCase()

    if (message.includes('email not confirmed')) {
      redirect('/login?error=unconfirmed')
    }

    // Anything other than a plain credential mismatch is unexpected — log the
    // real reason server-side (Vercel function logs) so it isn't lost behind
    // the generic message every login failure shows the user.
    if (!message.includes('invalid login credentials')) {
      console.error('Unexpected sign-in error:', error.message)
    }

    redirect('/login?error=invalid')
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
