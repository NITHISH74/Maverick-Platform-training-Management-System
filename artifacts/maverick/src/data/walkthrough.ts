/**
 * Role-specific in-app walkthrough content (F4).
 *
 * The Help button in the top nav opens <WalkthroughModal>, which renders
 * the sections returned by `getWalkthrough(role)`. Admins see all three
 * role groups; coordinators and trainers see only their own.
 *
 * Keep step text concrete — name actual buttons/menus/routes ("Click
 * 'Add User' on Admin → Users") rather than vague verbs ("Open users").
 */

export interface WalkthroughStep {
  /** Short imperative title shown in the section's checklist. */
  title: string;
  /** One-paragraph "how to do it" description. */
  body: string;
  /** Optional route the user can jump to from the step. */
  link?: { label: string; href: string };
}

export interface WalkthroughSection {
  /** Stable slug used as the React key — keep unique across all roles. */
  id: string;
  /** Sidebar label. */
  title: string;
  /** Optional one-line subtitle under the title. */
  subtitle?: string;
  steps: WalkthroughStep[];
}

const ADMIN_SECTION: WalkthroughSection = {
  id: "admin",
  title: "Admin Features",
  subtitle: "User management, system settings, and audit",
  steps: [
    {
      title: "Manage users",
      body: 'Go to Admin → Users (left nav). Click "Add User" in the top right to create a trainer, coordinator, or another admin. Pick the role from the dropdown — that determines what the new user can see and do.',
      link: { label: "Open Users", href: "/users" },
    },
    {
      title: "Edit or delete users",
      body: "Find the user in the list and click the three-dot menu at the end of the row. Choose Edit to change their name, email, or role, or Delete to remove them entirely. Deleting is hard delete — prefer disabling if you might bring them back.",
      link: { label: "Open Users", href: "/users" },
    },
    {
      title: "System settings",
      body: "Admin → Settings holds global configuration that applies to every batch — most notably the topper weightage formula (sprint, project, attendance). Sliders sum to 100% and the Save button stays disabled until they do.",
      link: { label: "Open Settings", href: "/settings" },
    },
    {
      title: "Audit logs",
      body: "Admin → Audit Log shows every write across the platform. Filter by action type, performed-by, or date range. Click an entity ID to jump to the affected record. Use this to investigate who changed what and when.",
      link: { label: "Open Audit Log", href: "/audit" },
    },
  ],
};

const COORDINATOR_SECTION: WalkthroughSection = {
  id: "coordinator",
  title: "Coordinator Features",
  subtitle: "Day-to-day batch operations",
  steps: [
    {
      title: "Create a batch",
      body: 'Go to Batches → New Batch (top right). Fill in program, dates, capacity, trainer, and starting candidates, then Save. The batch starts in "planned" — switch to "running" when training begins.',
      link: { label: "Open Batches", href: "/batches" },
    },
    {
      title: "Upload candidates",
      body: 'On a batch detail page, click "Bulk Import" to upload an Excel sheet. Duplicates (same name or email already in the batch) are surfaced row-by-row instead of silently dropped.',
      link: { label: "Open Candidates", href: "/candidates" },
    },
    {
      title: "Set attendance cutoff time",
      body: "Open a batch → Attendance Settings tab. Set the daily cutoff time — after this, trainers marking attendance see it flagged as late. Saved per-batch, so different cohorts can have different schedules.",
    },
    {
      title: "Assessment clearance rate",
      body: 'On the dashboard, click the gear icon next to a batch to set its clearance percentage (the minimum score that counts as "cleared"). This drives the cleared/not-cleared status on the Toppers leaderboard.',
      link: { label: "Open Dashboard", href: "/dashboard" },
    },
    {
      title: "Trigger feedback",
      body: 'Go to Feedback → "Send Feedback Request". Fill the form, paste the MS Forms link, and send. Candidates receive the link; once responses come in, the Feedback page shows sentiment + topic analysis.',
      link: { label: "Open Feedback", href: "/feedback" },
    },
    {
      title: "Download reports",
      body: 'Go to Reports → pick a tab (Consolidated, Attendance, Assessments, Toppers). Each tab has "Export CSV" for the raw rows and "Download PDF" for an AI-narrated report with executive summary, insights, risks, and recommendations.',
      link: { label: "Open Reports", href: "/reports" },
    },
    {
      title: "Topper weightages",
      body: "Open Settings (left nav). Adjust the Sprint, Project, and Attendance percentage sliders — they must sum to 100. Saving here re-shapes the composite score used on the Toppers leaderboard.",
      link: { label: "Open Settings", href: "/settings" },
    },
  ],
};

const TRAINER_SECTION: WalkthroughSection = {
  id: "trainer",
  title: "Trainer Features",
  subtitle: "Run your assigned batches",
  steps: [
    {
      title: "View your batches",
      body: "The Batches page shows only the batches assigned to you. Coordinators handle assignment — if a batch you expect is missing, ask your coordinator to add you under Batch Detail → Trainers.",
      link: { label: "Open Batches", href: "/batches" },
    },
    {
      title: "Upload attendance",
      body: "Open a batch → Attendance tab. You can mark each candidate present / absent / on leave manually, or upload an Excel sheet via Bulk Upload. Late marks are flagged when you submit after the cutoff time.",
      link: { label: "Open Attendance", href: "/attendance" },
    },
    {
      title: "Upload assessment scores",
      body: 'Open a batch → Assessments tab → "Upload Scores". The Excel template lets you record sprint, API, and coding scores for every candidate in one go. You can edit your own uploads later; assessments you didn\'t create are read-only.',
      link: { label: "Open Assessments", href: "/assessments" },
    },
    {
      title: "Upload project files",
      body: "Open a batch → Assessments → Project Evaluation. Attach the project rubric and the deliverables for each candidate. Once scores are entered, they feed into the Topper leaderboard via the project weight.",
      link: { label: "Open Assessments", href: "/assessments" },
    },
  ],
};

type Role = "admin" | "coordinator" | "trainer" | string | undefined;

export function getWalkthroughSections(role: Role): WalkthroughSection[] {
  if (role === "admin") {
    // Admins see everything so they can answer questions from either kind
    // of user. Admin section first, then coordinator, then trainer.
    return [ADMIN_SECTION, COORDINATOR_SECTION, TRAINER_SECTION];
  }
  if (role === "coordinator") return [COORDINATOR_SECTION];
  if (role === "trainer") return [TRAINER_SECTION];
  // Unknown / unauthenticated — show the smallest helpful set.
  return [TRAINER_SECTION];
}

/** localStorage key the modal uses to remember the user has dismissed it once. */
export const WALKTHROUGH_SEEN_KEY = "walkthrough_seen";
