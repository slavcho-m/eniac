import { CheckSquare, FolderKanban, Plus, Settings } from "lucide-react";
import {
  ActivityCard,
  AppShell,
  Button,
  FileListItem,
  FormField,
  MarkdownPreviewCard,
  NavListItem,
  NumberedSteps,
  PageHeader,
  ProjectSwitcher,
  SectionLabel,
  StatusBanner,
  TextInput,
} from "@/components";

function LeftNav() {
  return (
    <>
      <ProjectSwitcher name="checkout-service" />
      <div style={{ marginTop: 24 }}>
        <SectionLabel>Projects</SectionLabel>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <NavListItem icon={<FolderKanban size={15} strokeWidth={1.75} />} label="notification-hub" />
          <NavListItem icon={<FolderKanban size={15} strokeWidth={1.75} />} label="billing-api" />
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <SectionLabel>Tasks</SectionLabel>
        <div style={{ marginTop: 8 }}>
          <NavListItem
            icon={<CheckSquare size={15} strokeWidth={1.75} />}
            label="Add Stripe webhook handler"
            meta="18m ago"
            active
          />
        </div>
      </div>
      <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", paddingTop: 16 }}>
        <Button variant="ghost" icon={<Settings size={14} strokeWidth={1.75} />}>
          Settings
        </Button>
        <Button variant="secondary" icon={<Plus size={14} strokeWidth={1.75} />}>
          New Project
        </Button>
      </div>
    </>
  );
}

function RightFiles() {
  return (
    <>
      <SectionLabel>Files</SectionLabel>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        <FileListItem name="context.md" meta="14m ago" badge={{ variant: "success", label: "Approved" }} />
        <FileListItem
          name="requirements.md"
          meta="3m ago"
          badge={{ variant: "warning", label: "Awaiting Approval" }}
          active
        />
        <FileListItem name="artifacts/" kind="folder" meta="empty" />
      </div>

      <div style={{ marginTop: 20 }}>
        <MarkdownPreviewCard filename="requirements.md" onEdit={() => {}}>
          <h2>Webhook endpoint</h2>
          <ul>
            <li>
              Verify <code>Stripe-Signature</code> header against the endpoint's signing secret
            </li>
            <li>
              Return <code>200</code> within 5s to avoid retry storms
            </li>
          </ul>
        </MarkdownPreviewCard>
      </div>
    </>
  );
}

function TaskDetailPage() {
  return (
    <AppShell left={<LeftNav />} right={<RightFiles />}>
      <SectionLabel>Task #128</SectionLabel>
      <p style={{ fontSize: "var(--text-label)", color: "var(--text-primary)", marginTop: 6 }}>
        Add a Stripe webhook handler that validates signatures, updates order status, and writes an audit log
        entry for every event.
      </p>

      <div style={{ marginTop: 16 }}>
        <StatusBanner variant="warning">Awaiting your approval on requirements.md</StatusBanner>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <ActivityCard title="Supervisor — Context confirmed" timestamp="12m ago" />
        <ActivityCard title="Backend Mastermind — Requirements drafted" timestamp="3m ago" defaultExpanded>
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-hairline)",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: "var(--text-body)",
              color: "var(--text-secondary)",
            }}
          >
            $ drafting requirements.md ...
          </div>
        </ActivityCard>
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Button variant="primary">Confirm &amp; Continue</Button>
        <Button variant="secondary">Edit file</Button>
        <Button variant="ghost">Override Assistant</Button>
      </div>
    </AppShell>
  );
}

function NewProjectPage() {
  return (
    <AppShell
      left={<LeftNav />}
      right={
        <>
          <SectionLabel>What Happens Next</SectionLabel>
          <div style={{ marginTop: 8 }}>
            <NumberedSteps
              steps={[
                <>
                  Eniac creates <code>~/.eniac/ppm/payments-gateway/</code> and initializes conventions.
                </>,
                "You'll land in the empty project view, ready to write your first prompt.",
              ]}
            />
          </div>
        </>
      }
    >
      <PageHeader
        title="New project"
        subtitle="Set up a workspace for Eniac to help with."
        onBack={() => {}}
      />
      <FormField label="Project Name" helperText="Lowercase letters, numbers, and hyphens.">
        <TextInput placeholder="payments-gateway" />
      </FormField>
      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <Button variant="primary">Create Project</Button>
        <Button variant="secondary">Cancel</Button>
      </div>
    </AppShell>
  );
}

export default function Showcase() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ borderBottom: "4px solid var(--warning)" }}>
        <TaskDetailPage />
      </div>
      <NewProjectPage />
    </div>
  );
}
