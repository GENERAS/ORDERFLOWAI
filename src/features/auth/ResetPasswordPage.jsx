import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { updatePassword } from '../../services/authService';
import {
  isBlank,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
} from '../../utils/validation';
import { useAuth } from './authContext';
import { AuthCard } from './components/AuthCard';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { status, error: authError, retry, signOut } = useAuth();
  const [form, setForm] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTimedOut(true), 8000);
    return () => window.clearTimeout(timeout);
  }, []);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  };

  const validate = () => {
    const nextErrors = {};
    if (!isValidPassword(form.password)) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (isBlank(form.confirmPassword)) {
      nextErrors.confirmPassword = 'Confirm your new password.';
    } else if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }
    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError('');

    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await updatePassword(form.password);
      try {
        await signOut();
      } catch {
        // The provider clears local state even if the sign-out request fails.
      }
      navigate('/login', {
        replace: true,
        state: {
          notice: 'Your password has been updated. Sign in with your new password.',
        },
      });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading' || (status === 'unauthenticated' && !timedOut)) {
    return (
      <AuthCard
        title="Verifying your reset link"
        description="Hang on while we confirm the link is valid."
      >
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-3 py-8 text-sm text-slate-500"
        >
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
            aria-hidden="true"
          />
          <span>Checking your link…</span>
        </div>
      </AuthCard>
    );
  }

  if (status === 'error') {
    return (
      <AuthCard
        title="We could not verify your link"
        description="The authentication service returned an error."
      >
        <div className="space-y-4">
          <Alert variant="error">{authError}</Alert>
          <Button type="button" onClick={retry} className="w-full">
            Try again
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <AuthCard
        title="Reset link expired"
        description="This password reset link is invalid or has expired."
        footer={
          <p className="text-center">
            <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
              Back to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-4">
          <Alert variant="warning">
            Request a new password reset link to continue.
          </Alert>
          <Link
            to="/forgot-password"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Request a new link
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      description="Choose a password you have not used for this account before."
      footer={
        <p className="text-center">
          <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <PasswordField
          id="reset-password"
          label="New password"
          autoComplete="new-password"
          value={form.password}
          onChange={updateField('password')}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
          placeholder="Enter a new password"
        />

        <PasswordField
          id="reset-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={updateField('confirmPassword')}
          error={errors.confirmPassword}
          required
          placeholder="Enter the same password again"
        />

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Updating password…' : 'Update password'}
        </Button>
      </form>
    </AuthCard>
  );
}
