// src/components/calendar/ReadyToSchedule.tsx
import { useState, useEffect } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { FileText, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Draft {
  id: string;
  title: string;
  body: string;
  content_type: string;
  updated_at: string;
  approval_status: string;
}

export const ReadyToSchedule = () => {
  const [approvedDrafts, setApprovedDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  const loadApprovedDrafts = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    // Get approved drafts
    const { data: draftsData, error: draftsError } = await supabase
      .from('drafts')
      .select('id, title, body, content_type, updated_at, approval_status')
      .eq('user_id', session?.user?.id)
      .eq('approval_status', 'approved')
      .order('updated_at', { ascending: false });

    if (draftsError) {
      console.error('Error loading approved drafts:', draftsError);
      setLoading(false);
      return;
    }

    // Get scheduled draft IDs to filter them out
    const { data: scheduledData, error: scheduledError } = await supabase
      .from('content_calendar')
      .select('draft_id')
      .eq('user_id', session?.user?.id)
      .not('draft_id', 'is', null);

    if (scheduledError) {
      console.error('Error loading scheduled drafts:', scheduledError);
    }

    // Filter out drafts that are already scheduled
    const scheduledDraftIds = new Set(scheduledData?.map(s => s.draft_id) || []);
    const unscheduledDrafts = (draftsData || []).filter(
      draft => !scheduledDraftIds.has(draft.id)
    );

    setApprovedDrafts(unscheduledDrafts);
    setLoading(false);
  };

  useEffect(() => {
    loadApprovedDrafts();
    
    // Listen for calendar updates to refresh the list
    const handleCalendarUpdate = () => {
      loadApprovedDrafts();
    };
    
    window.addEventListener('calendar-updated', handleCalendarUpdate);
    return () => window.removeEventListener('calendar-updated', handleCalendarUpdate);
  }, []);

  const getContentTypeIcon = (contentType: string) => {
    switch (contentType) {
      case 'blog_post': return <FileText className="h-3 w-3" />;
      case 'newsletter': return <FileText className="h-3 w-3" />;
      case 'social_post': return <FileText className="h-3 w-3" />;
      case 'video_script': return <FileText className="h-3 w-3" />;
      default: return <FileText className="h-3 w-3" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved': return 'default';
      case 'pending': return 'secondary';
      case 'rejected': return 'destructive';
      default: return 'outline';
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse text-sm text-gray-600">Loading drafts...</div>
      </div>
    );
  }

  if (approvedDrafts.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        No approved drafts ready to schedule
      </div>
    );
  }

  return (
    <Droppable droppableId="drafts-sidebar" isDropDisabled={true}>
      {(provided) => (
        <div 
          ref={provided.innerRef}
          {...provided.droppableProps}
          className="p-4 space-y-2"
        >
          <h3 className="font-semibold text-sm mb-3">Ready to Schedule</h3>
          {approvedDrafts.map((draft, index) => (
            <Draggable 
              key={draft.id} 
              draggableId={`draft-${draft.id}`} 
              index={index}
            >
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                  className={`
                    p-3 rounded-lg border border-l-4 border-l-green-500 bg-green-50 
                    cursor-grab transition-all duration-200
                    ${snapshot.isDragging ? 'shadow-lg rotate-1 scale-105' : 'shadow-sm hover:shadow-md'}
                  `}
                >
                  <h4 className="font-medium text-sm line-clamp-2 mb-2 leading-tight">
                    {draft.title || "Untitled Draft"}
                  </h4>
                  
                  <div className="flex flex-wrap gap-2 mb-2">
                    <Badge variant={getStatusBadgeVariant(draft.approval_status)} className="capitalize text-xs">
                      {draft.approval_status}
                    </Badge>
                    <Badge variant="outline" className="capitalize bg-white/50">
                      <span className="flex items-center gap-1">
                        {getContentTypeIcon(draft.content_type)}
                        {draft.content_type?.replace('_', ' ')}
                      </span>
                    </Badge>
                  </div>
                  
                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="h-3 w-3 mr-1" />
                    {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
                  </div>
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
};