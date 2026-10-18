import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

type ClassNameProps = { className?: string };

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement> & ClassNameProps) {
  return <div data-slot="card" className={`darl-card ${className}`} {...props} />;
}

export function CardHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement> & ClassNameProps) {
  return <div data-slot="card-header" className={`darl-card-header ${className}`} {...props} />;
}

export function CardTitle({ className = '', ...props }: HTMLAttributes<HTMLHeadingElement> & ClassNameProps) {
  return <h3 data-slot="card-title" className={`darl-card-title ${className}`} {...props} />;
}

export function CardDescription({ className = '', ...props }: HTMLAttributes<HTMLParagraphElement> & ClassNameProps) {
  return <p data-slot="card-description" className={`darl-card-description ${className}`} {...props} />;
}

export function CardContent({ className = '', ...props }: HTMLAttributes<HTMLDivElement> & ClassNameProps) {
  return <div data-slot="card-content" className={`darl-card-content ${className}`} {...props} />;
}

export function Field({ className = '', ...props }: HTMLAttributes<HTMLDivElement> & ClassNameProps) {
  return <div data-slot="field" className={`darl-field ${className}`} {...props} />;
}

export function FieldLabel({ className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement> & ClassNameProps) {
  return <label data-slot="field-label" className={`darl-field-label ${className}`} {...props} />;
}

export function FieldDescription({ className = '', ...props }: HTMLAttributes<HTMLParagraphElement> & ClassNameProps) {
  return <p data-slot="field-description" className={`darl-field-description ${className}`} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & ClassNameProps>(function Input({ className = '', ...props }, ref) {
  return <input ref={ref} data-slot="input" className={`darl-input ${className}`} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & ClassNameProps>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} data-slot="textarea" className={`darl-textarea ${className}`} {...props} />;
});

export function NativeSelect({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & ClassNameProps) {
  return <div className="darl-native-select"><select data-slot="select" className={`darl-select ${className}`} {...props}>{children}</select></div>;
}

export function Switch({ className = '', children, ...props }: InputHTMLAttributes<HTMLInputElement> & ClassNameProps) {
  return <label className={`darl-switch ${className}`}><input type="checkbox" role="switch" {...props} /><span aria-hidden="true" /><span className="darl-switch-copy">{children}</span></label>;
}

export function Badge({ className = '', ...props }: HTMLAttributes<HTMLSpanElement> & ClassNameProps) {
  return <span data-slot="badge" className={`darl-badge ${className}`} {...props} />;
}
