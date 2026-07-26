import { FolderKanban } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, NavListItem, SectionLabel } from "@/components";
import { useProjects } from "@/hooks/useProjects";
import { DeleteProjectDialog } from "@/layout/DeleteProjectDialog";
import { Sidebar } from "@/layout/Sidebar";
import type { Project } from "@/types/api";

/** Route: "/" — lists every project; destination of the sidebar's "View All Projects". */
export function HomePage() {
  const navigate = useNavigate();
  const { data: projects, loading, refetch } = useProjects();
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  return (
    <AppShell left={<Sidebar />}>
      <SectionLabel>All Projects</SectionLabel>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2, maxWidth: 480 }}>
        {loading && !projects ? (
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-body)" }}>Loading…</p>
        ) : null}
        {projects?.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: "var(--text-body)" }}>No projects yet.</p>
        ) : null}
        {(projects ?? []).map((project) => (
          <NavListItem
            key={project.id}
            icon={<FolderKanban size={15} strokeWidth={1.75} />}
            label={project.id}
            onClick={() => navigate(`/projects/${project.id}`)}
            onDelete={() => setDeleteTarget(project)}
          />
        ))}
      </div>

      {deleteTarget ? (
        <DeleteProjectDialog
          open
          onClose={() => setDeleteTarget(null)}
          projectId={deleteTarget.id}
          workspacePath={deleteTarget.workspace_path}
          onDeleted={() => {
            setDeleteTarget(null);
            refetch();
          }}
        />
      ) : null}
    </AppShell>
  );
}
