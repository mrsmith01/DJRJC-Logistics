'use client'

import type { ButtonHTMLAttributes } from 'react'
import { Button } from './ui'

export function ConfirmSubmitButton({
  confirmMessage,
  variant = 'secondary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string
  variant?: 'primary' | 'secondary'
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault()
        }
      }}
      {...props}
    >
      {children}
    </Button>
  )
}
