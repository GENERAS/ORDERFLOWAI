import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { FormField } from './FormField';

export function PasswordField({ label, hint, error, ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      }
      {...props}
    />
  );
}
