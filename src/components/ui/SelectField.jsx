import { useId } from 'react';
import { cn } from '../../utils/cn';
import {
  controlClasses,
  controlErrorClasses,
  errorClasses,
  hintClasses,
  labelClasses,
} from './formStyles';

export function SelectField({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  options = [],
  placeholder = 'Select an option',
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
      <select
        id={inputId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(controlClasses, 'mt-1.5', error && controlErrorClasses)}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value;
          const labelText = typeof option === 'string' ? option : option.label;
          return (
            <option key={value} value={value}>
              {labelText}
            </option>
          );
        })}
      </select>
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
