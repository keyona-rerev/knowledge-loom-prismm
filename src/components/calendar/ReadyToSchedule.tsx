// src/components/calendar/ReadyToSchedule.tsx
import { useState, useEffect } from 'react';
import { Draggable } from '@hello-pangea/dnd';
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
}

export const ReadyToSchedule = () => {
  const [approvedDrafts, setApprovedDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  const loadApprovedDrafts = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    const { data, error } = await supabase
      .from('drafts')
      .select('id, title, body, content_type, updated_at')
      .eq('user_id', session?.user?.id)
      .eq('approval_status', 'approved')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error loading approved drafts:', error);
    } else {
      setApprovedDrafts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadApprovedDrafts();
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
    <div className="p-4 space-y-2">
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
              
              <div className="flex justify-between items-center text-xs">
                <Badge variant="outline" className="capitalize bg-white/50">
                  <span className="flex items-center gap-1">
                    {getContentTypeIcon(draft.content_type)}
                    {draft.content_type?.replace('_', ' ')}
                  </span>
                </Badge>
                
                <span className="flex items-center gap-1 text-gray-500">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(draft.updated_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          )}
        </Draggable>
      ))}
    </div>
  );
};