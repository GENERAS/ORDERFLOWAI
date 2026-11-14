import { AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card';
import { ConfigNotice } from '../../../components/layout/ConfigNotice';

export function AuthErrorScreen({
  title = 'We could not load your account',
  message,
  onRetry,
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg">
        <ConfigNotice />
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </span>
              <CardTitle as="h1" className="text-lg">
                {title}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-600">
              {message || 'The authentication service is temporarily unavailable.'}
            </p>
            {onRetry ? (
              <Button type="button" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
