import { Draggable } from "@hello-pangea/dnd";
import { Badge } from "@/components/ui/badge";
import { CalendarSlot } from "./drag-drop-types";
import { format } from "date-fns";
import { FileText, Mail, Share, Video } from "lucide-react";

interface CalendarSlotCardProps {
  slot: CalendarSlot;
  index: number;
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

export const CalendarSlotCard = ({ slot, index }: CalendarSlotCardProps) => {
  return (
    <Draggable draggableId={slot.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`
            p-3 rounded-lg border border-l-4 cursor-grab
            transition-all duration-200
            ${getCardColors(slot.content_type)}
            ${snapshot.isDragging ? 'shadow-lg rotate-1 scale-105' : 'shadow-sm hover:shadow-md'}
          `}
        >
          <h4 className="font-medium text-sm line-clamp-2 mb-2 leading-tight">
            {slot.draft?.title || "Untitled Draft"}
          </h4>
          
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