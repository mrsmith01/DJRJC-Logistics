import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Label({ className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-1.5 block text-sm font-medium text-slate-700 ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${className}`}
      {...props}
    />
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 ${className}`}
      {...props}
    />
  )
}

export function Button({
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {children}
    </div>
  )
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {children}
    </div>
  )
}

const statusStyles: Record<string, string> = {
  booked: 'bg-slate-100 text-slate-700',
  in_transit: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-rose-100 text-rose-700',
}

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] ?? 'bg-slate-100 text-slate-700'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
