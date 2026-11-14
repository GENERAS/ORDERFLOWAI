import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { resendSignupConfirmation } from '../../services/authService';
import { buildAppUrl } from '../../utils/url';
import { isValidEmail, toTrimmedString } from '../../utils/validation';
import { useAuth } from './authContext';
import { AuthCard } from './components/AuthCard';

export default function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status } = useAuth();
  const [email, setEmail] = useState(location.state?.email ?? '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSent(false);

    if (!isValidEmail(email)) {
      setError('Enter the email address you registered with.');
      return;
    }

    setSubmitting(true);
    try {
      await resendSignupConfirmation({
        email: toTrimmedString(email),
        emailRedirectTo: buildAppUrl('/auth/callback'),
      });
      setSent(true);
    } catch (resendError) {
      setError(resendError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Check your email"
      description={
        location.state?.email
          ? `We sent a confirmation link to ${location.state.email}. Open it to verify your account, then sign in.`
          : 'Open the confirmation link in your email to verify your account, then sign in.'
      }
      footer={
        <p className="text-center">
          Already confirmed?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {sent ? (
          <Alert variant="success" title="Confirmation email sent">
            Check your inbox and spam folder. The link expires after a short time.
          </Alert>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}

        <FormField
          id="verify-email"
          label="Email address"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setError('');
            setSent(false);
          }}
          required
          placeholder="you@business.com"
          hint="Use the same email address you registered with."
        />

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Sending…' : 'Resend confirmation email'}
        </Button>

        <p className="text-center text-xs leading-relaxed text-slate-500">
          If you cannot find the email, check your spam folder before requesting another one.
        </p>
      </form>
    </AuthCard>
  );
}
