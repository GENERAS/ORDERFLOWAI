import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { requestPasswordReset } from '../../services/authService';
import { buildAppUrl } from '../../utils/url';
import { isValidEmail, toTrimmedString } from '../../utils/validation';
import { AuthCard } from './components/AuthCard';

export default function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email ?? '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSent(false);

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      await requestPasswordReset({
        email: toTrimmedString(email),
        redirectTo: buildAppUrl('/reset-password'),
      });
      setSent(true);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we will send a password reset link."
      footer={
        <p className="text-center">
          Remembered your password?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        {sent ? (
          <Alert variant="success" title="Check your email">
            If an account exists for that email, a password reset link is on its way. Check
            your inbox and spam folder.
          </Alert>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}

        <FormField
          id="forgot-email"
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
        />

        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {submitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthCard>
  );
}
