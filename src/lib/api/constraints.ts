import { supabase } from '../supabase'
import type { Constraint } from '../../types/database'
import { selectAllRows } from './paginate'

export async function getConstraints(orgId: string): Promise<Constraint[]> {
  const { data, error } = await supabase
    .from('constraints')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as Constraint[]
}

export async function createConstraint(
  data: Omit<Constraint, 'id' | 'created_at' | 'updated_at'>
): Promise<{ data: Constraint | null; error: string | null }> {
  const { data: inserted, error } = await supabase.from('constraints').insert(data).select().maybeSingle()

  if (error) {
    return { data: null, error: error.message }
  }

  return { data: (inserted as Constraint) ?? null, error: null }
}

export async function updateConstraint(id: string, updates: Partial<Constraint>): Promise<{ error: string | null }> {
  const { error } = await supabase.from('constraints').update(updates).eq('id', id)

  return { error: error?.message ?? null }
}

export async function archiveConstraint(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('constraints').update({ is_archived: true }).eq('id', id)

  return { error: error?.message ?? null }
}

export async function getArchivedConstraints(orgId: string): Promise<Constraint[]> {
  const { data, error } = await supabase
    .from('constraints')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_archived', true)
    .order('name', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as Constraint[]
}

/** An archived constraint keeps its mapped key, so nothing can have taken its place. */
export async function restoreConstraint(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('constraints').update({ is_archived: false }).eq('id', id)

  return { error: error?.message ?? null }
}

/** Next sort_order for a new constraint (non-archived only). */
export async function getNextConstraintSortOrder(orgId: string): Promise<number> {
  const list = await getConstraints(orgId)
  if (list.length === 0) {
    return 0
  }
  return Math.max(...list.map((c) => c.sort_order)) + 1
}

/**
 * Question counts for many constraints in one pass.
 *
 * Counting per row previously cost one request per constraint on every load of
 * the constraints list.
 */
export async function getConstraintQuestionCounts(
  constraintIds: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const id of constraintIds) {
    counts[id] = 0
  }
  if (constraintIds.length === 0) {
    return counts
  }

  const rows = await selectAllRows<{ constraint_id: string | null }>((from, to) =>
    supabase
      .from('questions')
      .select('constraint_id')
      .eq('is_archived', false)
      .in('constraint_id', constraintIds)
      .range(from, to),
  )
  if (!rows) {
    return counts
  }

  for (const row of rows) {
    if (row.constraint_id != null && row.constraint_id in counts) {
      counts[row.constraint_id] += 1
    }
  }

  return counts
}
