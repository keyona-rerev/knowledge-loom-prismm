import { toast } from 'sonner';

// Mock email client for development - falls back to console logs and toasts
export const notificationClient = {
  async sendDraftNotification(email: string, draft: any, pendingCount: number) {
    // In production, this would use Resend or another email service
    // For now, we'll log to console and show toast notifications
    
    console.log('📧 Email Notification:', {
      to: email,
      subject: `📝 Draft Ready for Review: ${draft.title || draft.seed_insight || 'New Draft'}`,
      pendingCount,
      draftId: draft.id,
      template: draft.autopilot_templates?.name || 'Manual Creation'
    });

    // Show toast notification in the app
    toast.info(`📝 New draft ready for review! ${pendingCount} draft(s) awaiting approval.`, {
      duration: 5000,
      action: {
        label: 'Review Now',
        onClick: () => {
          if (typeof window !== 'undefined') {
            window.location.href = '/review';
          }
        }
      }
    });

    // In a real implementation, this would be:
    /*
    const resend = new Resend(process.env.RESEND_API_KEY);
    return await resend.emails.send({
      from: 'Insight Forge <notifications@insightforge.com>',
      to: email,
      subject: `📝 Draft Ready for Review: ${draft.title || 'New Draft'}`,
      html: generateDraftNotificationEmail(draft, pendingCount),
    });
    */
  }
};

// Email template generator (for future use)
const generateDraftNotificationEmail = (draft: any, pendingCount: number) => {
  const draftTitle = draft.title || draft.seed_insight || 'New Draft';
  const templateName = draft.autopilot_templates?.name || 'Manual Creation';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #3B82F6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 20px; background: #f9f9f9; }
        .button { background: #3B82F6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
        .draft-preview { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3B82F6; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 Insight Forge</h1>
          <p>Draft Ready for Review</p>
        </div>
        <div class="content">
          <h2>${draftTitle}</h2>
          <p><strong>Source:</strong> ${templateName}</p>
          
          <div class="draft-preview">
            <strong>Preview:</strong>
            <p>${draft.body?.substring(0, 200) || 'No content preview available'}...</p>
          </div>
          
          <p><strong>You have ${pendingCount} draft(s) awaiting review.</strong></p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.APP_URL || 'https://app.insightforge.com'}/review" class="button">
              Review Drafts in Insight Forge →
            </a>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated notification from Insight Forge.</p>
          <p><a href="${process.env.APP_URL || 'https://app.insightforge.com'}/settings">Manage notifications</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
};