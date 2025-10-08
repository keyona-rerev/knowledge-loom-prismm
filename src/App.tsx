import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Feeds from "./pages/Feeds";
import ReferenceCards from "./pages/ReferenceCards";
import CardDetail from "./pages/CardDetail";
import CreateContent from "./pages/CreateContent";
import Drafts from "./pages/Drafts";
import AutopilotTemplates from "./pages/AutopilotTemplates";
import QuestionSettings from "./pages/QuestionSettings";
import Auth from "./pages/Auth";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
          <Route path="/autopilot" element={<ProtectedRoute><AutopilotTemplates /></ProtectedRoute>} />
          <Route path="/questions" element={<ProtectedRoute><QuestionSettings /></ProtectedRoute>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
