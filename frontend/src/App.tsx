import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { OnboardingTour } from "@/components/OnboardingTour/OnboardingTour";
import { useOnboardingTour } from "@/hooks/useOnboardingTour";
import { OnboardingTourContext } from "@/hooks/useOnboardingTourContext";
import { HomePage } from "@/pages/HomePage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { TaskDetailPage } from "@/pages/TaskDetailPage";

// useOnboardingTour() calls useNavigate()/useLocation(), which need real Router context
// -- this has to be a child of <BrowserRouter>, not called directly in App() (App's own
// body runs before the <BrowserRouter> it returns exists). Called once here, above
// <Routes> -- not per-page from inside AppShell (which unmounts/remounts on every route
// change). See useOnboardingTourContext.ts for why that caused a literal duplicate
// render during navigations. <OnboardingTour> itself is rendered here too, as a sibling
// of <Routes>, for the same reason -- AppShell only reads startTutorial back out via
// context, for its Help button.
function AppRoutes() {
  const tour = useOnboardingTour();

  return (
    <OnboardingTourContext.Provider value={tour}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new-project" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <OnboardingTour
        step={tour.step}
        stepNumber={tour.stepNumber}
        totalSteps={tour.totalSteps}
        canGoBack={tour.canGoBack}
        onNext={tour.next}
        onBack={tour.back}
        onSkip={tour.skip}
      />
    </OnboardingTourContext.Provider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
