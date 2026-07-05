import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ColorProvider } from "./components/ColorProvider";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Strategy from "./pages/Strategy";
import Feeds from "./pages/Feeds";
import ReferenceCards from "./pages/ReferenceCards";
import CardDetail from "./pages/CardDetail";
import CreateContent from "./pages/CreateContent";
import DraftDetail from "./pages/DraftDetail";
import QuestionSettings from "./pages/QuestionSettings";
import Auth from "./pages/Auth";
import InsightDetail from "./pages/InsightDetail";
import Review from "./pages/Review";
import Schedule from "./pages/Schedule";
import QuestionSets from "./pages/QuestionSets";
import QuestionSetEditor from "./pages/QuestionSetEditor";
import VisualStudio from "./pages/VisualStudio";

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
              <Route path="/visual-studio" element={<ProtectedRoute><VisualStudio /></ProtectedRoute>} />
              <Route path="/strategy" element={<ProtectedRoute><Strategy /></ProtectedRoute>} />
              {/* Audience merged into Strategy; keep the old URL working */}
              <Route path="/audience" element={<Navigate to="/strategy" replace />} />
              <Route path="/feeds" element={<ProtectedRoute><Feeds /></ProtectedRoute>} />
              <Route path="/cards" element={<ProtectedRoute><ReferenceCards /></ProtectedRoute>} />
              <Route path="/cards/:id" element={<ProtectedRoute><CardDetail /></ProtectedRoute>} />
              <Route path="/cards/:id/edit" element={<ProtectedRoute><CardDetail /></ProtectedRoute>} />
              <Route path="/create" element={<ProtectedRoute><CreateContent /></ProtectedRoute>} />
              {/* Drafts list page decommissioned: it approved drafts without ever
                  triggering visual generation or publishing, a dead end that
                  looked identical to a working approval. Review is the real one. */}
              <Route path="/drafts" element={<Navigate to="/review" replace />} />
              <Route path="/drafts/:id" element={<ProtectedRoute><DraftDetail /></ProtectedRoute>} />
              <Route path="/questions" element={<ProtectedRoute><QuestionSettings /></ProtectedRoute>} />
              {/* Journal merged into the Sources page's Observations tab; keep the old URL working */}
              <Route path="/insights" element={<Navigate to="/feeds?tab=observations" replace />} />
              <Route path="/insights/new" element={<ProtectedRoute><InsightDetail /></ProtectedRoute>} />
              <Route path="/insights/:id" element={<ProtectedRoute><InsightDetail /></ProtectedRoute>} />
              <Route path="/review" element={<ProtectedRoute><Review /></ProtectedRoute>} />
              {/* Calendar merged into Schedule's Upcoming tab; keep the old URL working */}
              <Route path="/calendar" element={<Navigate to="/schedule?tab=upcoming" replace />} />
              <Route path="/schedule" element={<ProtectedRoute><Schedule /></ProtectedRoute>} />
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
