import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface InstructionsToggleProps {
  instructions: string;
  autoShowDuration?: number;
}

export const InstructionsToggle = ({ instructions, autoShowDuration = 10000 }: InstructionsToggleProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showPulse, setShowPulse] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowPulse(false);
    }, autoShowDuration);

    return () => clearTimeout(timer);
  }, [autoShowDuration]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full mb-6">
      <CollapsibleTrigger asChild>
        <Button 
          variant="outline" 
          className={`w-full justify-between ${showPulse ? 'animate-pulse border-primary' : ''}`}
        >
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span>Instructions</span>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground whitespace-pre-line">{instructions}</p>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
};
