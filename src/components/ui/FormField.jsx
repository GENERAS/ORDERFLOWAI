import { useId } from 'react';
import { cn } from '../../utils/cn';
import {
  controlClasses,
  controlErrorClasses,
  errorClasses,
  hintClasses,
  labelClasses,
} from './formStyles';

export function FormField({
  id,
  label,
  type = 'text',
  hint,
  error,
  required = false,
  className,
  inputClassName,
  trailing,
  ...props
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : null;
  const errorId = error ? `${inputId}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={inputId} className={labelClasses}>
        {label}
        {required ? (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <div className={trailing ? 'relative mt-1.5' : 'mt-1.5'}>
        <input
          id={inputId}
          type={type}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            controlClasses,
            error && controlErrorClasses,
            trailing && 'pr-11',
            inputClassName,
          )}
          {...props}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">{trailing}</div>
        ) : null}
      </div>
      {hint ? (
        <p id={hintId} className={hintClasses}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={errorClasses}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
