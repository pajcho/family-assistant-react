// Who gets told about which newly created tasks, and what the push says.
//
// Pure, and unit-tested next door - the same split `send-due-pushes` uses
// (plan.ts decides, index.ts does I/O). Everything here is a decision that is
// easy to get wrong and impossible to verify by staring at a lock screen.

export type OutboxRow = {
  id: string;
  entity_id: string;
  actor_id: string | null;
};

export type QueuedTask = {
  id: string;
  name: string;
  family_id: string;
};

export type PlanInput = {
  /** Queue rows ripe for sending, oldest first. */
  rows: OutboxRow[];
  /** The tasks those rows point at, by id. A missing id = deleted meanwhile. */
  tasksById: Map<string, QueuedTask>;
  /** task id -> the people it is assigned to (`profiles.id`). */
  assigneesByTask: Map<string, string[]>;
  /** family id -> every profile in it. */
  membersByFamily: Map<string, string[]>;
  /** Profiles with a child login. Excluded from the family-wide fan-out. */
  kidProfileIds: Set<string>;
  /**
   * Profiles with at least one push subscription - the only ones a push can
   * reach at all. A family profile can exist without any `auth.users` row
   * behind it (a child the parents track but who never logs in), and
   * `notification_log` references that table, so claiming a slot for one is a
   * foreign-key error rather than a notification.
   */
  pushableIds: Set<string>;
  /** Profiles that switched this kind of push off. */
  optedOut: Set<string>;
  /** profile id -> display name, for the push body. */
  nameById: Map<string, string>;
};

export type PushBatch = {
  userId: string;
  /** Every task this push announces - one `notification_log` claim each. */
  taskIds: string[];
  /** Their names, in the same order, for the body. */
  taskNames: string[];
  /** Named only when the whole batch came from one person; "" otherwise. */
  actorName: string;
};

/**
 * Who a single task's push goes to.
 *
 * ASSIGNED -> its assignees, and nobody else. A chore for Ana is Ana's business;
 * telling the whole family every time is how a shared app turns into noise.
 *
 * UNASSIGNED -> the whole family, because a task nobody is named on is
 * everybody's. Minus children with a kid login: their app only ever shows what
 * is assigned to them, so a family-wide task is something they could not open
 * even if they were told about it.
 *
 * The actor is always dropped - including when they assigned it to themselves.
 * Nobody needs a notification about their own typing.
 */
export function recipientsFor(
  taskId: string,
  familyId: string,
  actorId: string | null,
  input: Pick<
    PlanInput,
    "assigneesByTask" | "membersByFamily" | "kidProfileIds" | "pushableIds" | "optedOut"
  >,
): string[] {
  const assignees = input.assigneesByTask.get(taskId) ?? [];
  const pool =
    assignees.length > 0
      ? assignees
      : (input.membersByFamily.get(familyId) ?? []).filter((id) => !input.kidProfileIds.has(id));

  return pool.filter(
    (id) => id !== actorId && input.pushableIds.has(id) && !input.optedOut.has(id),
  );
}

/**
 * The queue as one push per recipient.
 *
 * Batches, not rows: whoever ends up with three of these gets "3 nova zadatka"
 * rather than three buzzes. Order is preserved from the queue, so the body reads
 * in the order the tasks were typed.
 */
export function planOutboxPushes(input: PlanInput): PushBatch[] {
  /** user -> the tasks queued for them, in queue order. */
  const perUser = new Map<string, { tasks: QueuedTask[]; actors: Set<string> }>();

  for (const row of input.rows) {
    const task = input.tasksById.get(row.entity_id);
    if (!task) continue; // deleted, or no longer a dated family task

    const recipients = recipientsFor(task.id, task.family_id, row.actor_id, input);
    for (const userId of recipients) {
      const bucket = perUser.get(userId) ?? { tasks: [], actors: new Set<string>() };
      bucket.tasks.push(task);
      if (row.actor_id) bucket.actors.add(row.actor_id);
      perUser.set(userId, bucket);
    }
  }

  const batches: PushBatch[] = [];
  for (const [userId, bucket] of perUser) {
    batches.push({
      userId,
      taskIds: bucket.tasks.map((task) => task.id),
      taskNames: bucket.tasks.map((task) => task.name),
      // Two people adding at once is not "Milan je dodao" - it is just news.
      actorName: bucket.actors.size === 1 ? (input.nameById.get([...bucket.actors][0]) ?? "") : "",
    });
  }
  return batches;
}

/** "Novi zadatak" / "3 nova zadatka" / "7 novih zadataka". */
export function batchTitle(count: number): string {
  if (count === 1) return "Novi zadatak";
  return `${count} ${pluralTasks(count)}`;
}

/**
 * Serbian counts the noun off the LAST digit, with the teens as the exception:
 * 2-4 take one form, everything else the other, but 12-14 are "novih" like the
 * rest of the teens.
 */
function pluralTasks(count: number): string {
  const last = count % 10;
  const lastTwo = count % 100;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return "nova zadatka";
  return "novih zadataka";
}

/**
 * What the push says under the title: the names, so it is worth reading on a
 * lock screen, capped at three so it stays one glance.
 */
export function batchBody(names: string[], actorName: string): string {
  const shown = names.slice(0, MAX_NAMES_IN_BODY);
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} i još ${rest}` : shown.join(", ");
  return actorName ? `${actorName} je dodao(la): ${list}` : list;
}

const MAX_NAMES_IN_BODY = 3;
