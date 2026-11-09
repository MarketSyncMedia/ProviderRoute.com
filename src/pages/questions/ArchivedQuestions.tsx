import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ArchivedList from '../../components/shared/ArchivedList'
import { useToast } from '../../components/ui/toastStore'
import { getArchivedQuestions, restoreQuestion } from '../../lib/api/questions'
import { useAuthStore } from '../../stores/authStore'
import type { Question } from '../../types/database'

const SYSTEM_LABELS: Record<string, string> = { location: 'Location', provider: 'Provider' }

/** Questions archived from the flow, each restorable at the end of it. */
export default function ArchivedQuestions() {
  const orgId = useAuthStore((s) => s.org?.id ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [restoring, setRestoring] = useState<string | null>(null)

  // Nested under the plain list's key so every existing
  // invalidateQueries(['questions', orgId]) also refreshes this one.
  const { data: archived = [] } = useQuery({
    queryKey: ['questions', orgId, 'archived'],
    queryFn: () => getArchivedQuestions(orgId),
    enabled: Boolean(orgId),
  })

  async function restore(question: Question) {
    setRestoring(question.id)
    const { error } = await restoreQuestion(question)
    setRestoring(null)
    if (error) {
      toast.error(error)
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['questions', orgId] })
    toast.success('Question restored at the end of the flow')
  }

  return (
    <ArchivedList
      label="questions"
      items={archived}
      nameOf={(question) => question.question_text}
      detailOf={(question) => SYSTEM_LABELS[question.question_type] ?? null}
      restoringId={restoring}
      onRestore={(question) => void restore(question)}
    />
  )
}
