import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Compass className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-semibold text-brand-600">404</p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
        Page not found
      </h2>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        The page you requested does not exist in this workspace.
      </p>
      <Link
        to="/overview"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Back to overview
      </Link>
    </div>
  );
}
