import Link from "next/link";
import type { Student } from "@/lib/db/types";

type Props = {
  students: Student[];
  selectedStudentId?: string | null;
  /** Return the route for a profile. Undefined means the household overview. */
  hrefFor: (studentId?: string) => string;
  includeHousehold?: boolean;
};

/**
 * A small, fixed rotation of accent colors so a household with more than one
 * student can tell them apart at a glance — in the switcher, on plan cards,
 * and beside queue items — without needing a per-student color picker.
 * Index-based (not name-hashed) so a given household's colors stay stable
 * as long as the student list order does.
 */
const ACCENTS = [
  { dot: "bg-coral", border: "border-t-coral", text: "text-coral" },
  { dot: "bg-accent", border: "border-t-accent", text: "text-accent" },
  { dot: "bg-violet", border: "border-t-violet", text: "text-violet" },
  { dot: "bg-gold", border: "border-t-gold", text: "text-gold" },
] as const;

export function studentAccent(index: number) {
  return ACCENTS[index % ACCENTS.length];
}

export function StudentDot({ index, className = "" }: { index: number; className?: string }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${studentAccent(index).dot} ${className}`} aria-hidden="true" />;
}

/** Clear, link-based profile selection that works without client state. */
export function StudentSwitcher({ students, selectedStudentId, hrefFor, includeHousehold = true }: Props) {
  if (students.length <= 1 && !includeHousehold) return null;
  return (
    <nav aria-label="Student plan switcher" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/70 p-3">
      <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Viewing</span>
      {includeHousehold && <Link href={hrefFor()} className={`rounded-full px-3 py-1.5 text-sm ${!selectedStudentId ? "bg-tealDark text-white" : "bg-ink/5 text-ink/65 hover:bg-ink/10"}`}>Household overview</Link>}
      {students.map((student, index) => <Link key={student.id} href={hrefFor(student.id)} className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${selectedStudentId === student.id ? "bg-accent text-white" : "bg-ink/5 text-ink/65 hover:bg-ink/10"}`}><StudentDot index={index} className={selectedStudentId === student.id ? "ring-2 ring-white/70" : ""} />{student.name}&apos;s plan</Link>)}
    </nav>
  );
}
