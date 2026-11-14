import { Inbox } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function InboxPage() {
  return (
    <ModulePlaceholder
      icon={Inbox}
      title="Unified inbox"
      description="Capture customer inquiries, keep the conversation history and connect each request to a customer and an order draft."
      emptyTitle="No conversations yet"
      emptyDescription="Manual inquiry capture arrives first, followed by connected customer communication channels."
      upcoming={[
        'Manual inquiry capture',
        'Customer identity and message history',
        'Assignment to employees',
        'Link conversations to order drafts',
        'Follow-up reminders',
        'Official WhatsApp Business integration (later phase)',
      ]}
    />
  );
}
