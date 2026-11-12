import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestHarness, type TestHarness } from './fixtures'
import {
  anonInsertPayloads,
  anonUpdatePayload,
  APPLICATION_TABLES,
  expectDeniedRead,
  expectDeniedWrite,
  isRlsDenied,
  randomId,
  recordProbes,
  TINY_PNG_BYTES,
} from './helpers'

let harness: TestHarness

function importPayload(providerName: string, caseType: string, extra: Record<string, unknown> = {}) {
  return {
    filename: 'tenant-integration.xlsx',
    headers: ['Provider', 'Case Type'],
    mappings: [
      { excelHeader: 'Provider', role: 'provider_name' },
      { excelHeader: 'Case Type', role: 'case_type' },
    ],
    rows: [{ Provider: providerName, 'Case Type': caseType }],
    conflicts: [],
    resolvedConflicts: {},
    ...extra,
  }
}

beforeAll(async () => {
  harness = await createTestHarness()
}, 120_000)

afterAll(async () => {
  if (harness) {
    await harness.cleanup()
  }
}, 120_000)

describe('tenant isolation (staging Supabase RLS)', () => {
  describe('1. anonymous access is denied', () => {
    it('denies anonymous SELECT on every seeded tenant B table', async () => {
      const { anon, tenantB } = harness

      for (const probe of recordProbes(tenantB.records)) {
        const { data, error } = await anon
          .from(probe.table)
          .select('id')
          .eq(probe.column, probe.value)

        expect(error).toBeNull()
        expectDeniedRead(data)
      }
    })

    it('denies anonymous INSERT on every application table with RLS errors', async () => {
      const { anon, tenantB } = harness
      const randomUserId = randomId()
      const payloads = anonInsertPayloads(tenantB.records, tenantB.orgId, randomUserId)

      for (const table of APPLICATION_TABLES) {
        const { error } = await anon.from(table).insert(payloads[table])
        expectDeniedWrite(error)
      }
    })

    it('denies anonymous UPDATE on every seeded tenant B table', async () => {
      const { anon, tenantB, service } = harness

      for (const probe of recordProbes(tenantB.records)) {
        const { data, error } = await anon
          .from(probe.table)
          .update(anonUpdatePayload(probe.table))
          .eq(probe.column, probe.value)
          .select('id')

        if (error) {
          expectDeniedWrite(error)
        } else {
          expectDeniedRead(data)
        }

        const { data: unchanged, error: verifyError } = await service
          .from(probe.table)
          .select('id')
          .eq(probe.column, probe.value)
          .maybeSingle()

        expect(verifyError).toBeNull()
        expect(unchanged?.id).toBe(probe.value)
      }
    })

    it('denies anonymous DELETE on every seeded tenant B table', async () => {
      const { anon, tenantB, service } = harness

      for (const probe of recordProbes(tenantB.records)) {
        const { data, error } = await anon
          .from(probe.table)
          .delete()
          .eq(probe.column, probe.value)
          .select('id')

        if (error) {
          expectDeniedWrite(error)
        } else {
          expectDeniedRead(data)
        }

        const { data: stillThere, error: verifyError } = await service
          .from(probe.table)
          .select('id')
          .eq(probe.column, probe.value)
          .maybeSingle()

        expect(verifyError).toBeNull()
        expect(stillThere?.id).toBe(probe.value)
      }
    })
  })

  describe('2. cross-tenant access is denied', () => {
    it('prevents tenant A from inserting into tenant B org or users table', async () => {
      const { tenantA, tenantB } = harness

      const { error: userInsertError } = await tenantA.client.from('users').insert({
        id: randomId(),
        org_id: tenantA.orgId,
        email: `blocked-${randomId()}@example.invalid`,
        name: 'Blocked',
      })

      expectDeniedWrite(userInsertError)

      const { error: crossOrgLocationError } = await tenantA.client.from('locations').insert({
        org_id: tenantB.orgId,
        name: 'Cross insert',
      })

      expectDeniedWrite(crossOrgLocationError)
    })

    it('prevents tenant A from updating or deleting tenant B records', async () => {
      const { tenantA, tenantB, service } = harness

      const { data: updated, error: updateError } = await tenantA.client
        .from('locations')
        .update({ name: 'Cross-tenant hijack' })
        .eq('id', tenantB.records.location)
        .select('id')

      expect(updateError).toBeNull()
      expectDeniedRead(updated)

      const { data: deleted, error: deleteError } = await tenantA.client
        .from('locations')
        .delete()
        .eq('id', tenantB.records.location)
        .select('id')

      expect(deleteError).toBeNull()
      expectDeniedRead(deleted)

      const { data: stillThere } = await service
        .from('locations')
        .select('name')
        .eq('id', tenantB.records.location)
        .single()

      expect(stillThere?.name).toContain('RLS Test Location B')
    })
  })

  describe('3. forged org_id writes are denied', () => {
    it('rejects INSERT with another tenant org_id', async () => {
      const { tenantA, tenantB } = harness

      const { error } = await tenantA.client.from('locations').insert({
        org_id: tenantB.orgId,
        name: 'Forged org insert',
      })

      expectDeniedWrite(error)
    })

    it('rejects UPDATE that moves a row into another org', async () => {
      const { tenantA, tenantB } = harness

      const { data, error } = await tenantA.client
        .from('locations')
        .update({ org_id: tenantB.orgId })
        .eq('id', tenantA.records.location)
        .select('org_id')

      // The row is tenant A's own, so the policy's USING clause admits it and
      // the WITH CHECK clause rejects the new org_id -- Postgres raises 42501
      // rather than silently matching zero rows. Asserting a null error and an
      // empty result described a no-op that only happens when USING excludes
      // the row, so it failed against a database that was behaving correctly.
      expectDeniedWrite(error)
      expect(data ?? []).toEqual([])

      const { data: unchanged } = await tenantA.client
        .from('locations')
        .select('org_id')
        .eq('id', tenantA.records.location)
        .single()

      expect(unchanged?.org_id).toBe(tenantA.orgId)
    })
  })

  describe('4. known tenant B IDs do not bypass RLS for tenant A', () => {
    it('returns no rows when tenant A queries tenant B record IDs', async () => {
      const { tenantA, tenantB } = harness

      for (const probe of recordProbes(tenantB.records)) {
        const { data, error } = await tenantA.client
          .from(probe.table)
          .select('id')
          .eq(probe.column, probe.value)

        expect(error).toBeNull()
        expectDeniedRead(data)
      }
    })
  })

  describe('5. provider image uploads respect org folders', () => {
    it('denies upload outside the authenticated user org folder', async () => {
      const { tenantA, tenantB } = harness
      const foreignPath = `${tenantB.orgId}/cross-tenant-probe.png`

      const { error } = await tenantA.client.storage
        .from('provider-images')
        .upload(foreignPath, TINY_PNG_BYTES, {
          contentType: 'image/png',
          upsert: true,
        })

      expect(error).not.toBeNull()
      expect(isRlsDenied(error)).toBe(true)
    })

    it('allows upload inside the authenticated user org folder', async () => {
      const { tenantA } = harness
      const ownPath = `${tenantA.orgId}/rls-probe-${randomId()}.png`

      const { error } = await tenantA.client.storage
        .from('provider-images')
        .upload(ownPath, TINY_PNG_BYTES, {
          contentType: 'image/png',
          upsert: true,
        })

      expect(error).toBeNull()
      tenantA.storagePaths.push(ownPath)
    })
  })

  describe('6. same-organization CRUD succeeds', () => {
    it('supports create, read, update, and delete within the tenant org', async () => {
      const { tenantA } = harness

      const { data: created, error: createError } = await tenantA.client
        .from('case_types')
        .insert({ org_id: tenantA.orgId, name: 'Same-org case type' })
        .select('id, name')
        .single()

      expect(createError).toBeNull()
      expect(created?.id).toBeTruthy()

      const { data: readBack, error: readError } = await tenantA.client
        .from('case_types')
        .select('id, name')
        .eq('id', created!.id)
        .single()

      expect(readError).toBeNull()
      expect(readBack?.name).toBe('Same-org case type')

      const { data: updated, error: updateError } = await tenantA.client
        .from('case_types')
        .update({ name: 'Same-org case type updated' })
        .eq('id', created!.id)
        .select('name')
        .single()

      expect(updateError).toBeNull()
      expect(updated?.name).toBe('Same-org case type updated')

      const { error: deleteError } = await tenantA.client
        .from('case_types')
        .delete()
        .eq('id', created!.id)

      expect(deleteError).toBeNull()
    })
  })

  describe('7. user profile immutability', () => {
    it('allows name changes only', async () => {
      const { tenantA, tenantB } = harness

      const { data: before, error: beforeError } = await tenantA.client
        .from('users')
        .select('id, org_id, email, created_at, name')
        .eq('id', tenantA.authUserId)
        .single()

      expect(beforeError).toBeNull()
      expect(before).toBeTruthy()

      const { error: nameError } = await tenantA.client
        .from('users')
        .update({ name: 'Allowed Name Change' })
        .eq('id', tenantA.authUserId)

      expect(nameError).toBeNull()

      const { data: afterName } = await tenantA.client
        .from('users')
        .select('name')
        .eq('id', tenantA.authUserId)
        .single()

      expect(afterName?.name).toBe('Allowed Name Change')

      const immutableAttempts: Array<Record<string, unknown>> = [
        { org_id: tenantB.orgId },
        { email: `hijack-${randomId()}@example.invalid` },
        { created_at: new Date(0).toISOString() },
        { id: randomId() },
      ]

      for (const patch of immutableAttempts) {
        const { error } = await tenantA.client
          .from('users')
          .update(patch)
          .eq('id', tenantA.authUserId)

        expect(error).not.toBeNull()
        expect(isRlsDenied(error)).toBe(true)
      }

      const { data: after } = await tenantA.client
        .from('users')
        .select('id, org_id, email, created_at')
        .eq('id', tenantA.authUserId)
        .single()

      expect(after?.id).toBe(before!.id)
      expect(after?.org_id).toBe(before!.org_id)
      expect(after?.email).toBe(before!.email)
      expect(after?.created_at).toBe(before!.created_at)
    })
  })

  describe('8. analytics tables reject client writes', () => {
    it('denies authenticated INSERT, UPDATE, and DELETE on widget_sessions', async () => {
      const { tenantA, tenantB, service } = harness

      const { error: insertError } = await tenantA.client.from('widget_sessions').insert({
        widget_id: tenantA.records.widget,
        org_id: tenantA.orgId,
        // Must be a bare uuid: a prefixed string is rejected with 22P02 before
        // RLS runs, which would make this assert type validation, not policy.
        session_id: randomId(),
        zero_results: false,
        answers: {},
        providers_clicked: [],
        providers_shown: [],
      })

      expectDeniedWrite(insertError)

      const { data: beforeUpdate } = await service
        .from('widget_sessions')
        .select('id, zero_results')
        .eq('id', tenantB.records.widgetSession)
        .single()

      expect(beforeUpdate?.zero_results).toBe(false)

      const { data: updated, error: updateError } = await tenantB.client
        .from('widget_sessions')
        .update({ zero_results: true })
        .eq('id', tenantB.records.widgetSession)
        .select('id')

      expect(updateError).toBeNull()
      expectDeniedRead(updated)

      const { data: afterUpdate } = await service
        .from('widget_sessions')
        .select('id, zero_results')
        .eq('id', tenantB.records.widgetSession)
        .single()

      expect(afterUpdate?.id).toBe(tenantB.records.widgetSession)
      expect(afterUpdate?.zero_results).toBe(false)

      const { data: deleted, error: deleteError } = await tenantB.client
        .from('widget_sessions')
        .delete()
        .eq('id', tenantB.records.widgetSession)
        .select('id')

      expect(deleteError).toBeNull()
      expectDeniedRead(deleted)

      const { data: afterDelete } = await service
        .from('widget_sessions')
        .select('id')
        .eq('id', tenantB.records.widgetSession)
        .maybeSingle()

      expect(afterDelete?.id).toBe(tenantB.records.widgetSession)
    })

    it('denies authenticated INSERT, UPDATE, and DELETE on widget_session_events', async () => {
      const { tenantA, tenantB, service } = harness

      const { error: insertError } = await tenantA.client.from('widget_session_events').insert({
        widget_id: tenantA.records.widget,
        org_id: tenantA.orgId,
        // Must be a bare uuid: a prefixed string is rejected with 22P02 before
        // RLS runs, which would make this assert type validation, not policy.
        session_id: randomId(),
        event_type: 'probe',
      })

      expectDeniedWrite(insertError)

      const { data: beforeUpdate } = await service
        .from('widget_session_events')
        .select('id, event_type')
        .eq('id', tenantB.records.widgetSessionEvent)
        .single()

      expect(beforeUpdate?.event_type).toBe('seed')

      const { data: updated, error: updateError } = await tenantB.client
        .from('widget_session_events')
        .update({ event_type: 'client-update' })
        .eq('id', tenantB.records.widgetSessionEvent)
        .select('id')

      expect(updateError).toBeNull()
      expectDeniedRead(updated)

      const { data: afterUpdate } = await service
        .from('widget_session_events')
        .select('id, event_type')
        .eq('id', tenantB.records.widgetSessionEvent)
        .single()

      expect(afterUpdate?.id).toBe(tenantB.records.widgetSessionEvent)
      expect(afterUpdate?.event_type).toBe('seed')

      const { data: deleted, error: deleteError } = await tenantB.client
        .from('widget_session_events')
        .delete()
        .eq('id', tenantB.records.widgetSessionEvent)
        .select('id')

      expect(deleteError).toBeNull()
      expectDeniedRead(deleted)

      const { data: afterDelete } = await service
        .from('widget_session_events')
        .select('id')
        .eq('id', tenantB.records.widgetSessionEvent)
        .maybeSingle()

      expect(afterDelete?.id).toBe(tenantB.records.widgetSessionEvent)
    })
  })

  describe('9. database roles are authoritative', () => {
    it('keeps the last owner and rejects viewer configuration writes', async () => {
      const { tenantA, service } = harness

      const { error: lastOwnerError } = await tenantA.client.rpc('set_organization_member_role', {
        p_user_id: tenantA.authUserId,
        p_role: 'viewer',
      })
      expect(lastOwnerError).not.toBeNull()

      const { error: makeViewerError } = await service
        .from('users')
        .update({ role: 'viewer' })
        .eq('id', tenantA.authUserId)
      expect(makeViewerError).toBeNull()

      try {
        const { error: writeError } = await tenantA.client
          .from('case_types')
          .insert({ org_id: tenantA.orgId, name: 'Viewer write probe' })
        expect(writeError).not.toBeNull()

        const { data: readable, error: readError } = await tenantA.client
          .from('providers')
          .select('id')
          .eq('id', tenantA.records.provider)
          .single()
        expect(readError).toBeNull()
        expect(readable?.id).toBe(tenantA.records.provider)

        const { error: importError } = await tenantA.client.rpc(
          'execute_provider_import',
          { p_payload: importPayload('Viewer Import Probe', 'Viewer Case Probe') },
        )
        expect(importError).not.toBeNull()
      } finally {
        await service.from('users').update({ role: 'owner' }).eq('id', tenantA.authUserId)
      }
    })
  })

  describe('10. provider imports are atomic and tenant-bound', () => {
    it('commits a valid import as one tenant-scoped operation', async () => {
      const { tenantA, runId } = harness
      const providerName = `Atomic Provider ${runId}`
      const caseType = `Atomic Case ${runId}`

      const { data, error } = await tenantA.client.rpc('execute_provider_import', {
        p_payload: importPayload(providerName, caseType),
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ providersCreated: 1, offeringsUpserted: 1 })

      const providerKey = providerName.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
      const { data: provider, error: providerError } = await tenantA.client
        .from('providers')
        .select('id,org_id')
        .eq('normalized_name', providerKey)
        .single()
      expect(providerError).toBeNull()
      expect(provider?.org_id).toBe(tenantA.orgId)

      const { data: history, error: historyError } = await tenantA.client
        .from('import_history')
        .select('rows_processed,providers_created')
        .eq('filename', 'tenant-integration.xlsx')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      expect(historyError).toBeNull()
      expect(history).toMatchObject({ rows_processed: 1, providers_created: 1 })
    })

    it('rolls back earlier inserts when a later relationship is cross-tenant', async () => {
      const { tenantA, tenantB, runId } = harness
      const providerName = `Rollback Provider ${runId}`
      const caseType = `Rollback Case ${runId}`
      const payload = importPayload(providerName, caseType, {
        headers: ['Provider', 'Case Type', 'Foreign Location'],
        mappings: [
          { excelHeader: 'Provider', role: 'provider_name' },
          { excelHeader: 'Case Type', role: 'case_type' },
          { excelHeader: 'Foreign Location', role: 'location', locationId: tenantB.records.location },
        ],
        rows: [{ Provider: providerName, 'Case Type': caseType, 'Foreign Location': 'yes' }],
      })

      const { error } = await tenantA.client.rpc('execute_provider_import', { p_payload: payload })
      expect(error).not.toBeNull()

      const providerKey = providerName.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
      const [{ count: providerCount }, { count: caseCount }] = await Promise.all([
        tenantA.client.from('providers').select('id', { count: 'exact', head: true }).eq('normalized_name', providerKey),
        tenantA.client.from('case_types').select('id', { count: 'exact', head: true }).ilike('name', caseType),
      ])
      expect(providerCount).toBe(0)
      expect(caseCount).toBe(0)
    })

    it('rejects a conflict resolution targeting another tenant provider', async () => {
      const { tenantA, tenantB, runId } = harness
      const payload = importPayload(`Conflict Probe ${runId}`, `Conflict Case ${runId}`, {
        conflicts: [{ rowIndex: 0, existingProviderId: tenantB.records.provider }],
        resolvedConflicts: { 0: 'merge' },
      })
      const { error } = await tenantA.client.rpc('execute_provider_import', { p_payload: payload })
      expect(error).not.toBeNull()
    })
  })

  describe('10b. imports and archived offerings', () => {
    it('brings back an archived offering instead of failing on the unique constraint', async () => {
      const { tenantA, runId } = harness
      const name = `Revive Provider ${runId}`
      const caseName = `Revive Case ${runId}`
      const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

      const { data: provider, error: providerError } = await tenantA.client
        .from('providers')
        .insert({ org_id: tenantA.orgId, name, normalized_name: key, category_ids: [] })
        .select('id')
        .single()
      expect(providerError).toBeNull()
      const { data: caseType, error: caseTypeError } = await tenantA.client
        .from('case_types')
        .insert({ org_id: tenantA.orgId, name: caseName })
        .select('id')
        .single()
      expect(caseTypeError).toBeNull()
      const { error: offeringError } = await tenantA.client.from('offerings').insert({
        org_id: tenantA.orgId,
        provider_id: provider!.id,
        case_type_id: caseType!.id,
        location_ids: [],
        constraints: { age_min: 1 },
        is_archived: true,
      })
      expect(offeringError).toBeNull()

      const { data, error } = await tenantA.client.rpc('execute_provider_import', {
        p_payload: importPayload(name, caseName, {
          conflicts: [{ rowIndex: 0, existingProviderId: provider!.id }],
          resolvedConflicts: { 0: 'merge' },
        }),
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ providersUpdated: 1, offeringsUpserted: 1 })

      const { data: offerings } = await tenantA.client
        .from('offerings')
        .select('is_archived')
        .eq('provider_id', provider!.id)
        .eq('case_type_id', caseType!.id)
      expect(offerings).toEqual([{ is_archived: false }])
    })
  })

  describe('10c. imports and archived providers', () => {
    it('merges into an archived provider and brings them back', async () => {
      const { tenantA, runId } = harness
      const name = `Restore Import Provider ${runId}`
      const caseName = `Restore Import Case ${runId}`
      const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

      const { data: provider, error: providerError } = await tenantA.client
        .from('providers')
        .insert({ org_id: tenantA.orgId, name, normalized_name: key, category_ids: [], is_archived: true })
        .select('id')
        .single()
      expect(providerError).toBeNull()

      const { data, error } = await tenantA.client.rpc('execute_provider_import', {
        p_payload: importPayload(name, caseName, {
          conflicts: [{ rowIndex: 0, existingProviderId: provider!.id }],
          resolvedConflicts: { 0: 'merge' },
        }),
      })
      expect(error).toBeNull()
      expect(data).toMatchObject({ providersCreated: 0, providersUpdated: 1, offeringsUpserted: 1 })

      const { data: restored } = await tenantA.client
        .from('providers')
        .select('is_archived')
        .eq('id', provider!.id)
        .single()
      expect(restored?.is_archived).toBe(false)
      const { count } = await tenantA.client
        .from('providers')
        .select('id', { count: 'exact', head: true })
        .eq('normalized_name', key)
      expect(count).toBe(1)
    })

    it('leaves an archived provider archived when the row is kept separate', async () => {
      const { tenantA, runId } = harness
      const name = `Separate Import Provider ${runId}`
      const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
      const { data: provider } = await tenantA.client
        .from('providers')
        .insert({ org_id: tenantA.orgId, name, normalized_name: key, category_ids: [], is_archived: true })
        .select('id')
        .single()

      const { error } = await tenantA.client.rpc('execute_provider_import', {
        p_payload: importPayload(name, `Separate Import Case ${runId}`, {
          conflicts: [{ rowIndex: 0, existingProviderId: provider!.id }],
          resolvedConflicts: { 0: 'separate' },
        }),
      })
      expect(error).toBeNull()

      const { data: original } = await tenantA.client.from('providers').select('is_archived').eq('id', provider!.id).single()
      expect(original?.is_archived).toBe(true)
    })

    it('still rejects a conflict provider from another tenant, archived or not', async () => {
      const { tenantA, tenantB, runId } = harness
      const { data: foreign } = await harness.service
        .from('providers')
        .insert({ org_id: tenantB.orgId, name: `Foreign Archived ${runId}`, normalized_name: `foreign archived ${runId}`, category_ids: [], is_archived: true })
        .select('id')
        .single()

      const { error } = await tenantA.client.rpc('execute_provider_import', {
        p_payload: importPayload(`Foreign Archived ${runId}`, `Foreign Case ${runId}`, {
          conflicts: [{ rowIndex: 0, existingProviderId: foreign!.id }],
          resolvedConflicts: { 0: 'merge' },
        }),
      })
      expect(error).not.toBeNull()
    })
  })

  describe('10d. case types placed on the body map by an admin', () => {
    const position = { map_view: 'front', map_x: 45, map_y: 27.5 }

    async function newCaseType(label: string, extra: Record<string, unknown> = {}) {
      const { tenantA, runId } = harness
      return tenantA.client
        .from('case_types')
        .insert({ org_id: tenantA.orgId, name: `Placed ${label} ${runId}`, ...extra })
        .select('id, map_tag, map_view, map_x, map_y, map_label_x, map_label_y')
        .single()
    }

    it('stores a position with or without a label, and reads it back as numbers', async () => {
      const plain = await newCaseType('plain', position)
      expect(plain.error).toBeNull()
      expect(plain.data).toMatchObject({ map_view: 'front', map_x: 45, map_y: 27.5, map_label_x: null, map_label_y: null })

      const labelled = await newCaseType('labelled', { ...position, map_view: 'back', map_label_x: -12.5, map_label_y: 130 })
      expect(labelled.error).toBeNull()
      expect(labelled.data).toMatchObject({ map_view: 'back', map_label_x: -12.5, map_label_y: 130 })
    })

    it('leaves case types with no position as they were', async () => {
      const { data, error } = await newCaseType('none')
      expect(error).toBeNull()
      expect(data).toMatchObject({ map_view: null, map_x: null, map_y: null, map_label_x: null, map_label_y: null })
    })

    it('never holds both a built-in spot and its own position', async () => {
      const { error } = await newCaseType('both', { ...position, map_tag: 'knee' })
      expect(error).not.toBeNull()
    })

    it('rejects a position that is incomplete', async () => {
      expect((await newCaseType('no-view', { map_x: 1, map_y: 2 })).error).not.toBeNull()
      expect((await newCaseType('no-y', { map_view: 'front', map_x: 1 })).error).not.toBeNull()
      expect((await newCaseType('half-label', { ...position, map_label_x: 5 })).error).not.toBeNull()
      expect((await newCaseType('label-only', { map_label_x: 5, map_label_y: 5 })).error).not.toBeNull()
    })

    it('rejects a dot off the figure, a label off the drawing, and an unknown view', async () => {
      expect((await newCaseType('x-high', { ...position, map_x: 100.5 })).error).not.toBeNull()
      expect((await newCaseType('y-low', { ...position, map_y: -1 })).error).not.toBeNull()
      expect((await newCaseType('label-far', { ...position, map_label_x: 141, map_label_y: 0 })).error).not.toBeNull()
      expect((await newCaseType('side', { ...position, map_view: 'side' })).error).not.toBeNull()
    })

    it('lets two case types sit at the same place, since a position is not a shared slot', async () => {
      expect((await newCaseType('twin-a', position)).error).toBeNull()
      expect((await newCaseType('twin-b', position)).error).toBeNull()
    })

    it('can move a case type from a built-in spot to its own position, and back', async () => {
      const { tenantA } = harness
      const made = await newCaseType('swap')
      const id = made.data!.id
      const own = await tenantA.client
        .from('case_types')
        .update({ map_tag: null, ...position })
        .eq('id', id)
        .select('map_tag, map_view')
        .single()
      expect(own.error).toBeNull()
      expect(own.data).toMatchObject({ map_tag: null, map_view: 'front' })

      const builtIn = await tenantA.client
        .from('case_types')
        .update({ map_tag: 'pelvis', map_view: null, map_x: null, map_y: null, map_label_x: null, map_label_y: null })
        .eq('id', id)
        .select('map_tag, map_view')
        .single()
      expect(builtIn.error).toBeNull()
      expect(builtIn.data).toMatchObject({ map_tag: 'pelvis', map_view: null })
      // Leave the shared spot free for the other sections.
      await tenantA.client.from('case_types').update({ map_tag: null }).eq('id', id)
    })
  })

  describe('10e. self-scheduling links and the widget buttons\' wording', () => {
    it('stores an https self-scheduling link at a location, and clears it', async () => {
      const { tenantA } = harness
      const row = tenantA.records.providerLocation
      const set = async (value: string | null) =>
        tenantA.client.from('provider_locations').update({ self_schedule_link: value }).eq('id', row).select('self_schedule_link').single()

      const stored = await set('https://cal.example/dr-smith')
      expect(stored.error).toBeNull()
      expect(stored.data?.self_schedule_link).toBe('https://cal.example/dr-smith')

      const cleared = await set(null)
      expect(cleared.error).toBeNull()
      expect(cleared.data?.self_schedule_link).toBeNull()
    })

    it('keeps a self-scheduling link to https, the way every other patient-facing link is', async () => {
      const { tenantA } = harness
      const row = tenantA.records.providerLocation
      for (const bad of ['http://cal.example/dr', 'javascript:alert(1)', 'https://cal.example/a b', 'cal.example/dr']) {
        const { error } = await tenantA.client.from('provider_locations').update({ self_schedule_link: bad }).eq('id', row)
        expect(error, bad).not.toBeNull()
      }
    })

    it('takes only simple, advanced or the default as a provider\'s self-scheduling mode', async () => {
      const { tenantA } = harness
      const mode = (value: string) =>
        tenantA.client.from('providers').update({ self_schedule_mode: value }).eq('id', tenantA.records.provider)

      expect((await mode('advanced')).error).toBeNull()
      expect((await mode('simple')).error).toBeNull()
      expect((await mode('default')).error).toBeNull()
      expect((await mode('sometimes')).error).not.toBeNull()
    })

    it('takes only simple or advanced as the organization\'s default self-scheduling mode', async () => {
      const { tenantA } = harness
      const mode = (value: string) =>
        tenantA.client.from('organizations').update({ default_self_schedule_mode: value }).eq('id', tenantA.orgId)

      expect((await mode('advanced')).error).toBeNull()
      expect((await mode('simple')).error).toBeNull()
      // "default" only makes sense for a provider, who falls back to this.
      expect((await mode('default')).error).not.toBeNull()
    })

    it('limits the button wording to 40 characters, and lets it be blank', async () => {
      const { tenantA } = harness
      const widget = tenantA.records.widget
      const update = (patch: Record<string, string | null>) =>
        tenantA.client.from('widgets').update(patch).eq('id', widget)

      expect((await update({ booking_button_text: 'Request an appointment', self_schedule_button_text: 'Schedule online' })).error).toBeNull()
      expect((await update({ booking_button_text: 'x'.repeat(40) })).error).toBeNull()
      expect((await update({ booking_button_text: 'x'.repeat(41) })).error).not.toBeNull()
      expect((await update({ self_schedule_button_text: 'x'.repeat(41) })).error).not.toBeNull()
      expect((await update({ booking_button_text: null, self_schedule_button_text: null })).error).toBeNull()
    })
  })

  describe('11. live widget publication requirements', () => {
    const PRIVACY_URL = 'https://example.invalid/privacy'
    const DISCLAIMER = 'Informational only, not medical advice.'

    beforeAll(async () => {
      // Publishing checks the org's approved domains, which the fixtures leave
      // empty because nothing else in the suite publishes anything.
      const { error } = await harness.service
        .from('organizations')
        .update({ allowed_domains: ['clinic.example.com'] })
        .eq('id', harness.tenantA.orgId)
      expect(error).toBeNull()
    })

    afterAll(async () => {
      await harness.service
        .from('widgets')
        .update({ status: 'draft' })
        .eq('id', harness.tenantA.records.widget)
    })

    it('rejects publishing a widget with no privacy notice', async () => {
      const { tenantA } = harness

      const { error } = await tenantA.client
        .from('widgets')
        .update({
          status: 'live',
          disclaimer_text: DISCLAIMER,
          published_snapshot: {},
          privacy_url: null,
        })
        .eq('id', tenantA.records.widget)

      expect(error).not.toBeNull()
      expect((error?.message ?? '').toLowerCase()).toContain('privacy notice')
    })

    it('publishes when every requirement is met', async () => {
      const { tenantA } = harness

      const { error } = await tenantA.client
        .from('widgets')
        .update({
          status: 'live',
          disclaimer_text: DISCLAIMER,
          published_snapshot: {},
          privacy_url: PRIVACY_URL,
        })
        .eq('id', tenantA.records.widget)

      expect(error).toBeNull()
    })

    it('rejects clearing the privacy notice on a live widget', async () => {
      const { tenantA } = harness

      const { error } = await tenantA.client
        .from('widgets')
        .update({ privacy_url: null })
        .eq('id', tenantA.records.widget)

      expect(error).not.toBeNull()
      expect((error?.message ?? '').toLowerCase()).toContain('privacy notice')
    })

    it('allows editing a live widget without restating the requirements', async () => {
      const { tenantA, runId } = harness

      // The reason this migration exists: a live widget has to stay editable.
      // Under the previous trigger every write re-checked all four
      // requirements, so a rename failed unless it also resupplied them.
      const { error } = await tenantA.client
        .from('widgets')
        .update({ name: `Renamed live widget ${runId}` })
        .eq('id', tenantA.records.widget)

      expect(error).toBeNull()
    })
  })
})
