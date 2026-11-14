import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PasswordField } from '../../components/ui/PasswordField';
import { signUp } from '../../services/authService';
import { buildAppUrl } from '../../utils/url';
import {
  isBlank,
  isValidEmail,
  isValidFullName,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
  toTrimmedString,
} from '../../utils/validation';
import { useAuth } from './authContext';
import { AuthCard } from './components/AuthCard';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
    setEmailAlreadyRegistered(false);
  };

  const validate = () => {
    const nextErrors = {};
    if (!isValidFullName(form.fullName)) {
      nextErrors.fullName = 'Enter your full name (up to 160 characters).';
    }
    if (!isValidEmail(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (!isValidPassword(form.password)) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (isBlank(form.confirmPassword)) {
      nextErrors.confirmPassword = 'Confirm your password.';
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
    setEmailAlreadyRegistered(false);

    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const email = toTrimmedString(form.email);
      const result = await signUp({
        email,
        password: form.password,
        fullName: toTrimmedString(form.fullName),
        emailRedirectTo: buildAppUrl('/auth/callback'),
      });

      if (result.emailAlreadyRegistered) {
        setEmailAlreadyRegistered(true);
        return;
      }

      if (result.session) {
        navigate('/', { replace: true });
        return;
      }

      navigate('/verify-email', { replace: true, state: { email } });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      description="Start with your account. You will set up your business workspace next."
      footer={
        <p className="text-center">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        {emailAlreadyRegistered ? (
          <Alert variant="warning" title="Account already exists">
            <p>
              An account with this email already exists. Sign in instead, or reset your
              password if you cannot remember it.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <Link
                to="/login"
                state={{ email: toTrimmedString(form.email) }}
                className="font-semibold underline underline-offset-2"
              >
                Sign in
              </Link>
              <Link
                to="/forgot-password"
                state={{ email: toTrimmedString(form.email) }}
                className="font-semibold underline underline-offset-2"
              >
                Reset password
              </Link>
            </p>
          </Alert>
        ) : null}

        <FormField
          id="register-name"
          label="Full name"
          autoComplete="name"
          value={form.fullName}
          onChange={updateField('fullName')}
          error={errors.fullName}
          required
          placeholder="Your full name"
          maxLength={160}
        />

        <FormField
          id="register-email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={updateField('email')}
          error={errors.email}
          required
          placeholder="you@business.com"
        />

        <PasswordField
          id="register-password"
          label="Password"
          autoComplete="new-password"
          value={form.password}
          onChange={updateField('password')}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          required
          placeholder="Create a password"
        />

        <PasswordField
          id="register-confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={updateField('confirmPassword')}
          error={errors.confirmPassword}
          required
          placeholder="Enter the same password again"
        />

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-slate-500">
          We will send a confirmation link to verify your email address before you sign in.
        </p>
      </form>
    </AuthCard>
  );
}
