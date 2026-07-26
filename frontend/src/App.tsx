import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { NewProjectPage } from "@/pages/NewProjectPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { TaskDetailPage } from "@/pages/TaskDetailPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new-project" element={<NewProjectPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/tasks/:taskId" element={<TaskDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
