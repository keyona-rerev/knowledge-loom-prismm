import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { notificationClient } from '@/integrations/email/notification-client';
import { toast } from 'sonner';

export const useEmailNotifications = () => {
  const sendDraftNotification = useCallback(async (draftId: string) => {
    try {
      // Get draft with template info
      const { data: draft, error } = await supabase
        .from('drafts')
        .select(`
          *,
          autopilot_templates (
            name
          )
        `)
        .eq('id', draftId)
        .single();

      if (error) throw error;

      // Get user profile
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session found');

      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('user_id', session.user.id)
        .single();

      if (!profile?.email) {
        console.warn('No email found for user, using mock notification');
        // Still show toast even if no email
        toast.info(`📝 New draft ready for review!`, {
          action: {
            label: 'Review Now',
            onClick: () => {
              if (typeof window !== 'undefined') {
                window.location.href = '/review';
              }
            }
          }
        });
        return;
      }

      // Get pending draft count
      const { count: pendingCount } = await supabase
        .from('drafts')
        .select('*', { count: "exact", head: true })
        .eq('user_id', session.user.id)
        .eq('approval_status', 'pending');

      // Send notification (currently shows toast and logs to console)
      await notificationClient.sendDraftNotification(profile.email, draft, pendingCount || 0);

      // Log the notification (optional - requires email_notifications table)
      try {
        await supabase
          .from('email_notifications')
          .insert({
            user_id: session.user.id,
            draft_id: draftId,
            type: 'draft_ready',
            sent_at: new Date().toISOString()
          });
      } catch (logError) {
        // Ignore logging errors - table might not exist yet
        console.log('Could not log email notification (table may not exist)');
      }

    } catch (error) {
      console.error('Failed to send notification:', error);
      // Don't show error to user - notification is secondary to draft creation
      toast.success('Draft created successfully!');
    }
  }, []);

  return {
    sendDraftNotification
  };
};