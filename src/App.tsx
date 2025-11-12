import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ColorProvider } from "./components/ColorProvider";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Feeds from "./pages/Feeds";
import ReferenceCards from "./pages/ReferenceCards";
import CardDetail from "./pages/CardDetail";
import CreateContent from "./pages/CreateContent";
import Drafts from "./pages/Drafts";
import DraftDetail from "./pages/DraftDetail";
import AutopilotTemplates from "./pages/AutopilotTemplates";
import AutopilotTemplateEditor from "./pages/AutopilotTemplateEditor";
import QuestionSettings from "./pages/QuestionSettings";
import Auth from "./pages/Auth";
import Insights from "./pages/Insights";
import InsightDetail from "./pages/InsightDetail";
import Review from "./pages/Review";
import ContentCalendar from "./pages/ContentCalendar";
import QuestionSets from "./pages/QuestionSets";
import QuestionSetEditor from "./pages/QuestionSetEditor";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ColorProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/feeds" element={<Feeds />} />
          <Route path="/cards" element={<ReferenceCards />} />
          <Route path="/cards/:id" element={<CardDetail />} />
          <Route path="/cards/:id/edit" element={<CardDetail />} />
          <Route path="/create" element={<CreateContent />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/drafts/:id" element={<DraftDetail />} />
          <Route path="/autopilot" element={<AutopilotTemplates />} />
          <Route path="/autopilot/new" element={<AutopilotTemplateEditor />} />
          <Route path="/autopilot/:id/edit" element={<AutopilotTemplateEditor />} />
          <Route path="/questions" element={<QuestionSettings />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/insights/new" element={<InsightDetail />} />
          <Route path="/insights/:id" element={<InsightDetail />} />
          <Route path="/review" element={<Review />} />
          {/* ✅ ADD CONTENT CALENDAR ROUTE HERE */}
          <Route path="/calendar" element={<ContentCalendar />} />
          {/* KEEP CATCH-ALL ROUTE AT THE BOTTOM */}
          <Route path="*" element={<NotFound />} />
          <Route path="/questions" element={<QuestionSets />} />
          <Route path="/questions/new" element={<QuestionSetEditor />} />
          <Route path="/questions/:id/edit" element={<QuestionSetEditor />} />
        </Routes>
      </BrowserRouter>
      </ColorProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;