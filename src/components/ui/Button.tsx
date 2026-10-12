import { forwardRef, type ButtonHTMLAttributes } from 'react';

/** Minimal shadcn/ui Button pattern adapted to ship prebuilt, isolated CSS.
 * We intentionally keep this internal, rather than re-exporting an alternative design system.
 * See https://ui.shadcn.com/docs/components/button
 */
type Variant = 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';
type Size = 'default' | 'sm' | 'icon';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', className = '', type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={`darl-button darl-button--${variant} darl-button-size--${size} ${className}`} {...props} />
  )
);
Button.displayName = 'Button';
