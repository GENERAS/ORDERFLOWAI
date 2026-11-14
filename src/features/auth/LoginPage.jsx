import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PasswordField } from '../../components/ui/PasswordField';
import { signInWithPassword } from '../../services/authService';
import { isBlank, isValidEmail, toTrimmedString } from '../../utils/validation';
import { useAuth } from './authContext';
import { getPostAuthPath, getSafeDestination } from './authRouting';
import { AuthCard } from './components/AuthCard';

export default function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    status,
    memberships,
    activeBusinessId,
    error: authError,
    retry,
  } = useAuth();

  const [form, setForm] = useState({
    email: location.state?.email ?? '',
    password: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const notice = location.state?.notice;
  const destination = getSafeDestination(location.state?.from, null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    navigate(destination ?? getPostAuthPath({ memberships, activeBusinessId }), {
      replace: true,
    });
  }, [status, destination, memberships, activeBusinessId, navigate]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setErrorCode('');
  };

  const validate = () => {
    const nextErrors = {};
    if (!isValidEmail(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (isBlank(form.password)) nextErrors.password = 'Enter your password.';
    return nextErrors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError('');
    setErrorCode('');

    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await signInWithPassword({
        email: toTrimmedString(form.email),
        password: form.password,
      });
    } catch (error) {
      setFormError(error.message);
      setErrorCode(error.code ?? '');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      description="Access your workspace, catalogue and customer orders."
      footer={
        <p className="text-center">
          New to OrderFlow AI?{' '}
          <Link
            to="/register"
            className="font-semibold text-brand-700 hover:text-brand-800"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        {authError && status === 'unauthenticated' ? (
          <Alert variant="warning" title="Service unavailable">
            <p>{authError}</p>
            {retry ? (
              <button
                type="button"
                onClick={retry}
                className="mt-1 font-semibold underline underline-offset-2"
              >
                Try again
              </button>
            ) : null}
          </Alert>
        ) : null}

        {formError ? (
          <Alert variant="error">
            <p>{formError}</p>
            {errorCode === 'email_not_confirmed' ? (
              <Link
                to="/verify-email"
                state={{ email: toTrimmedString(form.email) }}
                className="mt-1 inline-block font-semibold underline underline-offset-2"
              >
                Resend the confirmation email
              </Link>
            ) : null}
          </Alert>
        ) : null}

        <FormField
          id="login-email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={updateField('email')}
          error={errors.email}
          required
          placeholder="you@business.com"
        />

        <div>
          <PasswordField
            id="login-password"
            label="Password"
            autoComplete="current-password"
            value={form.password}
            onChange={updateField('password')}
            error={errors.password}
            required
            placeholder="Enter your password"
          />
          <div className="mt-1.5 text-right">
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
