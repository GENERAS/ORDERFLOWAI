import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/Card';

export function AuthCard({ title, description, children, footer }) {
  return (
    <Card className="overflow-hidden shadow-xl shadow-slate-200/60">
      <CardHeader className="pb-0">
        <div>
          <CardTitle as="h2" className="text-xl">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="mt-2 leading-relaxed">{description}</CardDescription>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
      {footer ? (
        <div className="border-t border-slate-200 bg-slate-50/70 px-5 py-4 text-sm text-slate-600">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
