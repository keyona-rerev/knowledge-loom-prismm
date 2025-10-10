// src/components/calendar/drag-drop-types.ts
export interface CalendarSlot {
  id: string;
  user_id: string;
  draft_id: string;
  scheduled_date: string;
  content_type: 'blog_post' | 'newsletter' | 'social_post' | 'video_script';
  status: 'scheduled' | 'published' | 'cancelled';
  created_at: string;
  draft?: {
    id: string;
    title: string;
    body: string;
    approval_status: string;
  };
}

export interface DropResult {
  draggableId: string;
  type: string;
  source: { droppableId: string; index: number };
  destination?: { droppableId: string; index: number };
}