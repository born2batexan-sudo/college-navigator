import Link from "next/link";
import type { Student } from "@/lib/db/types";

type Props = {
  students: Student[];
  selectedStudentId?: string | null;
  /** Return the route for a profile. Undefined means the household overview. */
  hrefFor: (studentId?: string) => string;
  includeHousehold?: boolean;
};

/** Clear, link-based profile selection that works without client state. */
export function StudentSwitcher({ students, selectedStudentId, hrefFor, includeHousehold = true }: Props) {
  if (students.length <= 1 && !includeHousehold) return null;
  return (
    <nav aria-label="Student plan switcher" className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/70 p-3">
      <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink/45">Viewing</span>
      {includeHousehold && <Link href={hrefFor()} className={`rounded-full px-3 py-1.5 text-sm ${!selectedStudentId ? "bg-tealDark text-white" : "bg-ink/5 text-ink/65 hover:bg-ink/10"}`}>Household overview</Link>}
      {students.map((student) => <Link key={student.id} href={hrefFor(student.id)} className={`rounded-full px-3 py-1.5 text-sm ${selectedStudentId === student.id ? "bg-accent text-white" : "bg-ink/5 text-ink/65 hover:bg-ink/10"}`}>{student.name}&apos;s plan</Link>)}
    </nav>
  );
}
