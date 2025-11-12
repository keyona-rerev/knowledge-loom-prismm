import { Draggable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarSlot } from "./drag-drop-types";
import { format } from "date-fns";
import { FileText, Mail, Share, Video, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CalendarSlotCardProps {
  slot: CalendarSlot;
  index: number;
  onDelete?: () => void;
}

const getContentTypeIcon = (contentType: string) => {
  switch (contentType) {
    case 'blog_post':
      return <FileText className="h-3 w-3" />;
    case 'newsletter':
      return <Mail className="h-3 w-3" />;
    case 'social_post':
      return <Share className="h-3 w-3" />;
    case 'video_script':
      return <Video className="h-3 w-3" />;
    default:
      return <FileText className="h-3 w-3" />;
  }
};

const getCardColors = (contentType: string) => {
  const colors = {
    blog_post: "border-l-blue-500 bg-blue-50 hover:bg-blue-100 text-blue-900",
    newsletter: "border-l-green-500 bg-green-50 hover:bg-green-100 text-green-900",
    social_post: "border-l-purple-500 bg-purple-50 hover:bg-purple-100 text-purple-900",
    video_script: "border-l-orange-500 bg-orange-50 hover:bg-orange-100 text-orange-900"
  };
  return colors[contentType] || "border-l-gray-500 bg-gray-50 text-gray-900";
};

export const CalendarSlotCard = ({ slot, index, onDelete }: CalendarSlotCardProps) => {
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    try {
      const { error } = await supabase
        .from('content_calendar')
        .delete()
        .eq('id', slot.id);

      if (error) throw error;

      toast.success('Removed from calendar');
      onDelete?.();
    } catch (error) {
      console.error('Error deleting calendar slot:', error);
      toast.error('Failed to remove from calendar');
    }
  };

  return (
    <Draggable draggableId={slot.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`
            p-3 rounded-lg border border-l-4 cursor-grab
            transition-all duration-200 group
            ${getCardColors(slot.content_type)}
            ${snapshot.isDragging ? 'shadow-lg rotate-1 scale-105' : 'shadow-sm hover:shadow-md'}
          `}
        >
          <div className="flex justify-between items-start gap-2 mb-2">
            <h4 className="font-medium text-sm line-clamp-2 leading-tight flex-1">
              {slot.draft?.title || "Untitled Draft"}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={handleDelete}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <Badge 
              variant="outline" 
              className="capitalize bg-white/50"
            >
              <span className="flex items-center gap-1">
                {getContentTypeIcon(slot.content_type)}
                {slot.content_type?.replace('_', ' ')}
              </span>
            </Badge>
            
            <span className="font-medium opacity-75">
              {format(new Date(slot.scheduled_date), 'h:mm a')}
            </span>
          </div>
        </div>
      )}
    </Draggable>
  );
};