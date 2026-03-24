import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'

// ─── Input ────────────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', style, id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {label && (
          <label
            htmlFor={inputId}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)' }}
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`sh-input${className ? ` ${className}` : ''}`}
          style={style}
          {...rest}
        />
        {error && (
          <span style={{ fontSize: 12, color: 'var(--sh-red)', marginTop: 2 }}>{error}</span>
        )}
      </div>
    )
  },
)
Input.displayName = 'Input'

// ─── Textarea ─────────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = '', style, id, ...rest }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {label && (
          <label
            htmlFor={textareaId}
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--sh-text-main)' }}
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`sh-textarea${className ? ` ${className}` : ''}`}
          style={style}
          {...rest}
        />
        {error && (
          <span style={{ fontSize: 12, color: 'var(--sh-red)', marginTop: 2 }}>{error}</span>
        )}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'
