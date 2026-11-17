import { ExternalLink, Globe2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui/Alert';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Business settings
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage the configuration that is available today. More workspace settings will appear here
          as they are built.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Globe2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">Online store and public profile</h2>
            <p className="mt-1 text-sm text-slate-600">
              Edit your public store name, description, logo, contact details, store link and product
              visibility.
            </p>
            <Link
              to="/store"
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Manage online store
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>

      <Alert variant="info" title="Additional settings">
        Currency and timezone are set when the business workspace is created. Communication channel
        configuration is planned for a later development day.
      </Alert>
    </div>
  );
}
