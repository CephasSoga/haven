import { useState } from "react";
import { useSearchParams } from "react-router";
import { format } from "date-fns";
import { FolderKanban, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, PageHeader, Progress } from "@/components/ui";
import { ask } from "@/components/confirm";
import { useAiReady } from "@/lib/ai";
import { parseDay } from "@/lib/dates";
import { swatch } from "@/lib/utils";
import { formatDuration, useCalendar, type Project } from "@/modules/calendar/store";
import { dayLabel, usePlan } from "@/modules/calendar/plan";
import type { Plan } from "@/modules/calendar/scheduler";
import { summarize } from "./logic";
import { ProjectDialog } from "./ProjectDialog";
import { DraftDialog } from "./DraftDialog";
import { HealthChip, ProjectView } from "./ProjectView";

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const projects = useCalendar((s) => s.projects);
  const templates = useCalendar((s) => s.templates);
  const plan = usePlan();
  const aiReady = useAiReady();
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const project = projects.find((p) => p.id === params.get("id"));
  const openProject = (id: string) => setParams({ id });

  if (project) return <ProjectView project={project} onBack={() => setParams({})} />;

  const active = projects.filter((p) => p.status === "active");
  const held = projects.filter((p) => p.status === "paused");
  const finished = projects.filter((p) => p.status === "done" || p.status === "cancelled");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Work"
        title="Projects"
        actions={
          <>
            {aiReady && (
              <Button onClick={() => setDrafting(true)}>
                <Sparkles className="size-4" /> Draft with AI
              </Button>
            )}
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New project
            </Button>
          </>
        }
      />

      {!projects.length ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="Group related tasks into projects"
            body="Give a project a deadline and stages, add its tasks, and say what has to come first. The planner fits everything into your free time in the right order, and tells you early if it won't be done in time."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-4" /> New project
                </Button>
                {aiReady && (
                  <Button onClick={() => setDrafting(true)}>
                    <Sparkles className="size-4" /> Draft with AI
                  </Button>
                )}
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Grid projects={active} plan={plan} onOpen={openProject} />
          {held.length > 0 && <Section title="On hold" projects={held} plan={plan} onOpen={openProject} />}
          {finished.length > 0 && <Section title="Done and cancelled" projects={finished} plan={plan} onOpen={openProject} />}
        </>
      )}

      {templates.length > 0 && (
        <Card>
          <CardHeader title="Templates" subtitle="Saved from projects, to start new ones with the same stages and tasks." />
          <ul className="flex flex-col px-3 pb-3 pt-2">
            {templates.map((t) => (
              <li key={t.id} className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-sunken">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-[12px] text-muted">
                    {t.stages.length ? `${t.stages.length} stages · ` : ""}
                    {t.tasks.length} tasks · {formatDuration(t.tasks.reduce((n, x) => n + x.duration, 0))}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    if (await ask({ title: `Delete the template “${t.name}”?`, body: "Projects made from it stay as they are.", confirmLabel: "Delete", danger: true })) useCalendar.getState().removeTemplate(t.id);
                  }}
                  aria-label="Delete template"
                  className="rounded-lg p-1.5 text-muted opacity-0 hover:text-neg group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ProjectDialog open={creating} onClose={() => setCreating(false)} onCreated={openProject} />
      <DraftDialog open={drafting} onClose={() => setDrafting(false)} onCreated={openProject} />
    </div>
  );
}

function Section({ title, ...rest }: { title: string; projects: Project[]; plan: Plan; onOpen: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-muted">{title}</h2>
      <Grid {...rest} />
    </section>
  );
}

function Grid({ projects, plan, onOpen }: { projects: Project[]; plan: Plan; onOpen: (id: string) => void }) {
  const tasks = useCalendar((s) => s.tasks);
  if (!projects.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => {
        const sum = summarize(p, tasks, plan);
        const color = swatch(p.color).fg;
        return (
          <button key={p.id} onClick={() => onOpen(p.id)} className="flex flex-col gap-3 rounded-3xl border border-line bg-surface p-5 text-left shadow-card transition-colors hover:border-line-strong">
            <div className="flex items-start gap-3">
              <span className="mt-2 size-2.5 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className="font-serif text-xl leading-snug">{p.name}</div>
                {p.description && <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{p.description}</div>}
              </div>
            </div>
            <Progress value={sum.minutes ? sum.doneMinutes / sum.minutes : 0} color={color} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
              <HealthChip health={sum.health} />
              <span>
                {sum.done}/{sum.total} tasks
              </span>
              {p.deadline && <span>Due {format(parseDay(p.deadline), "d MMM")}</span>}
              {sum.finish && sum.health !== "done" && <span>Finishes {dayLabel(sum.finish)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
