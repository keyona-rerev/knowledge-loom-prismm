import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import QuestionSettings from "./pages/QuestionSettings";
import Auth from "./pages/Auth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
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
          <Route path="/questions" element={<QuestionSettings />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
