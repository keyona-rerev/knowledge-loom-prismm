import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ColorProvider } from "./components/ColorProvider";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
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
        <AuthProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter basename="/knowledge-loom-prismm">
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/feeds" element={<ProtectedRoute><Feeds /></ProtectedRoute>} />
              <Route path="/cards" element={<ProtectedRoute><ReferenceCards /></ProtectedRoute>} />
              <Route path="/cards/:id" element={<ProtectedRoute><CardDetail /></ProtectedRoute>} />
              <Route path="/cards/:id/edit" element={<ProtectedRoute><CardDetail /></ProtectedRoute>} />
              <Route path="/create" element={<ProtectedRoute><CreateContent /></ProtectedRoute>} />
              <Route path="/drafts" element={<ProtectedRoute><Drafts /></ProtectedRoute>} />
              <Route path="/drafts/:id" element={<ProtectedRoute><DraftDetail /></ProtectedRoute>} />
              <Route path="/autopilot" element={<ProtectedRoute><AutopilotTemplates /></ProtectedRoute>} />
              <Route path="/autopilot/new" element={<ProtectedRoute><AutopilotTemplateEditor /></ProtectedRoute>} />
              <Route path="/autopilot/:id/edit" element={<ProtectedRoute><AutopilotTemplateEditor /></ProtectedRoute>} />
              <Route path="/questions" element={<ProtectedRoute><QuestionSettings /></ProtectedRoute>} />
              <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
              <Route path="/insights/new" element={<ProtectedRoute><InsightDetail /></ProtectedRoute>} />
              <Route path="/insights/:id" element={<ProtectedRoute><InsightDetail /></ProtectedRoute>} />
              <Route path="/review" element={<ProtectedRoute><Review /></ProtectedRoute>} />
              <Route path="/calendar" element={<ProtectedRoute><ContentCalendar /></ProtectedRoute>} />
              <Route path="/question-sets" element={<ProtectedRoute><QuestionSets /></ProtectedRoute>} />
              <Route path="/question-sets/new" element={<ProtectedRoute><QuestionSetEditor /></ProtectedRoute>} />
              <Route path="/question-sets/:id/edit" element={<ProtectedRoute><QuestionSetEditor /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ColorProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
