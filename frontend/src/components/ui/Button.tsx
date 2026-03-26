import { type ButtonHTMLAttributes, type CSSProperties, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:   'sh-btn-primary',
  secondary: 'sh-btn-secondary',
  danger:    'sh-btn-danger',
  ghost:     'sh-btn-ghost',
}

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '6px 12px',  fontSize: 13 },
  md: { padding: '10px 20px', fontSize: 15 },
  lg: { padding: '14px 28px', fontSize: 16 },
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', fullWidth = false, className = '', style, children, ...rest }, ref) => {
    const baseClass = `${variantStyles[variant]} hover-scale${className ? ` ${className}` : ''}`
    const combinedStyle: CSSProperties = {
      ...(fullWidth ? { width: '100%', display: 'flex', justifyContent: 'center' } : {}),
      ...sizeStyles[size],
      ...style,
    }

    return (
      <button ref={ref} className={baseClass} style={combinedStyle} {...rest}>
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
