import { UsersRound } from 'lucide-react';
import { ModulePlaceholder } from '../../components/ui/ModulePlaceholder';

export default function TeamPage() {
  return (
    <ModulePlaceholder
      icon={UsersRound}
      title="Team and permissions"
      description="Invite employees and control access with server-enforced, role-based permissions."
      emptyTitle="No team members yet"
      emptyDescription="Owner and employee accounts arrive with authentication in the next build phase."
      upcoming={[
        'Owner, admin, manager and staff roles',
        'Server-side permission checks',
        'Module-level access control',
        'Employee activity history',
        'Invitations and membership',
        'Audit-friendly access changes',
      ]}
    />
  );
}
