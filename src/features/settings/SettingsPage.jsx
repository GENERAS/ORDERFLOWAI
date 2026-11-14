import { Settings } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      icon={Settings}
      title="Business settings"
      description="Configure your workspace, currency, working hours and communication preferences."
      emptyTitle="Workspace setup not started"
      emptyDescription="Business profile and configuration forms arrive with onboarding and authentication."
      upcoming={[
        'Business profile and logo',
        'Currency, timezone and date formats',
        'Working, delivery and collection hours',
        'Order and payment rules',
        'AI behaviour settings',
        'Communication channel configuration',
      ]}
    />
  );
}
