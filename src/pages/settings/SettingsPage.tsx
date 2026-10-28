import { useCallback, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { supabase } from '../../lib/supabase'
import { approvedDomainListProblem, normalizeApprovedDomain } from '../../lib/approvedDomain'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../../components/ui/toastStore'
import type { Organization, OrganizationInvitation, User } from '../../types/database'
import { asOrgMode } from '../../lib/schemaEnums'

type OrgFormValues = {
  name: string
  fallback_phone: string
  fallback_message: string
  allowed_domains_text: string
  default_booking_mode: 'simple' | 'advanced'
  default_phone_mode: 'simple' | 'advanced'
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const org = useAuthStore((s) => s.org)
  const setUser = useAuthStore((s) => s.setUser)
  const setOrg = useAuthStore((s) => s.setOrg)
  const { toast } = useToast()

  const [modal, setModal] = useState<{ type: 'change-password' | null }>({ type: null })
  const [accountName, setAccountName] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)
  const [orgSaving, setOrgSaving] = useState(false)
  const [members, setMembers] = useState<User[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<OrganizationInvitation[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<User['role']>('viewer')
  const [inviteSending, setInviteSending] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { isDirty, errors },
  } = useForm<OrgFormValues>({
    defaultValues: {
      name: '',
      fallback_phone: '',
      fallback_message: '',
      allowed_domains_text: '',
    },
  })

  useEffect(() => {
    if (!org) {
      return
    }
    reset({
      name: org.name,
      fallback_phone: org.fallback_phone ?? '',
      fallback_message: org.fallback_message ?? '',
      allowed_domains_text: (org.allowed_domains ?? []).join('\n'),
      default_booking_mode: asOrgMode(org.default_booking_mode),
      default_phone_mode: asOrgMode(org.default_phone_mode),
    })
  }, [org, reset])

  const isOwner = user?.role === 'owner'
  const domainProblem = approvedDomainListProblem(useWatch({ control, name: 'allowed_domains_text' }) ?? '')

  const loadTeam = useCallback(async () => {
    if (!org || !user) return
    // Keep the effect-triggered refresh asynchronous; state updates occur only
    // after control returns to the event loop.
    await Promise.resolve()
    setTeamLoading(true)
    const membersQuery = supabase
      .from('users')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at')
    const invitationsQuery = isOwner
      ? supabase
          .from('organization_invitations')
          .select('*')
          .eq('org_id', org.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null })
    const [membersResult, invitationsResult] = await Promise.all([membersQuery, invitationsQuery])
    setMembers((membersResult.data ?? []) as User[])
    setPendingInvitations((invitationsResult.data ?? []) as OrganizationInvitation[])
    setTeamLoading(false)
  }, [isOwner, org, user])

  useEffect(() => {
    // Initial external database synchronization for the team panel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeam()
  }, [loadTeam])

  // Reseed the editable account name whenever the stored user changes, during
  // render rather than in an effect. Comparing the source value (not just the
  // id) keeps an in-progress edit from being clobbered by an unrelated
  // re-render, which is what the effect's dependency list was expressing.
  const [syncedUserName, setSyncedUserName] = useState<string | null>(null)
  const currentUserName = user?.name ?? ''
  if (syncedUserName !== currentUserName) {
    setSyncedUserName(currentUserName)
    setAccountName(currentUserName)
  }

  const closePasswordModal = useCallback(() => {
    setModal({ type: null })
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
  }, [])

  useEffect(() => {
    if (modal.type !== 'change-password') {
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePasswordModal()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modal.type, closePasswordModal])

  useEffect(() => {
    if (modal.type) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [modal.type])

  const onSaveOrg = handleSubmit(async (values) => {
    if (!org) {
      return
    }
    // The field's validate rule has already rejected any invalid entry, naming
    // it on the form, so every entry here normalizes.
    const normalizedDomains = values.allowed_domains_text
      .split('\n')
      .map((line) => normalizeApprovedDomain(line.trim()))
      .filter((domain): domain is string => Boolean(domain))
    const allowed_domains = Array.from(new Set(normalizedDomains))
    setOrgSaving(true)

    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: values.name.trim(),
        fallback_phone: values.fallback_phone.trim() || null,
        fallback_message: values.fallback_message,
        allowed_domains,
        default_booking_mode: values.default_booking_mode,
        default_phone_mode: values.default_phone_mode,
      })
      .eq('id', org.id)
      .select()
      .single()

    setOrgSaving(false)

    if (error || !data) {
      toast.error(error?.message ?? 'Failed to save organization')
      return
    }

    const updated = data as Organization
    setOrg(updated)
    toast.success('Settings saved')
    reset({
      name: updated.name,
      fallback_phone: updated.fallback_phone ?? '',
      fallback_message: updated.fallback_message ?? '',
      allowed_domains_text: (updated.allowed_domains ?? []).join('\n'),
      default_booking_mode: asOrgMode(updated.default_booking_mode),
      default_phone_mode: asOrgMode(updated.default_phone_mode),
    })
  })

  const accountNameChanged = accountName.trim() !== (user?.name ?? '').trim()

  async function onSaveAccount() {
    if (!user || !accountNameChanged) {
      return
    }
    setAccountSaving(true)
    const newName = accountName.trim() || null
    const { data, error } = await supabase
      .from('users')
      .update({ name: newName })
      .eq('id', user.id)
      .select()
      .single()

    setAccountSaving(false)

    if (error || !data) {
      toast.error(error?.message ?? 'Failed to update account')
      return
    }

    const updated = data as User
    setUser({ ...user, ...updated })
    toast.success('Account updated')
  }

  async function onSavePassword() {
    setPasswordError('')
    if (newPassword.length < 12) {
      setPasswordError('Password must be at least 12 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordSaving(false)

    if (error) {
      setPasswordError(error.message)
      return
    }

    closePasswordModal()
    toast.success('Password updated')
  }

  async function inviteMember() {
    if (!isOwner || !inviteName.trim() || !inviteEmail.trim()) return
    setInviteSending(true)
    const { error } = await supabase.functions.invoke('invite-member', {
      body: { name: inviteName.trim(), email: inviteEmail.trim(), role: inviteRole },
    })
    setInviteSending(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setInviteName('')
    setInviteEmail('')
    setInviteRole('viewer')
    await loadTeam()
    toast.success('Invitation sent')
  }

  async function changeMemberRole(memberId: string, role: User['role']) {
    const { error } = await supabase.rpc('set_organization_member_role', {
      p_user_id: memberId,
      p_role: role,
    })
    if (error) {
      toast.error(error.message)
      return
    }
    await loadTeam()
    toast.success('Member role updated')
  }

  if (!org || !user) {
    return <p className="text-sm text-slate-500">Loading settings…</p>
  }

  return (
    <div>
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-6 font-semibold text-slate-900">Organization Settings</h2>
        <form onSubmit={onSaveOrg} className="space-y-5">
          <fieldset disabled={!isOwner} className="space-y-5 disabled:opacity-60">
          <div>
            <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-slate-700">
              Organization Name
            </label>
            <input
              id="org-name"
              type="text"
              {...register('name', { required: 'Organization name is required' })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {errors.name ? <p className="mt-1 text-sm text-red-600">{errors.name.message}</p> : null}
          </div>

          <div>
            <label htmlFor="org-fallback-phone" className="mb-1 block text-sm font-medium text-slate-700">
              Fallback Phone
            </label>
            <input
              id="org-fallback-phone"
              type="text"
              {...register('fallback_phone')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500">Shown to patients when no providers match</p>
          </div>

          <div>
            <label htmlFor="org-fallback-message" className="mb-1 block text-sm font-medium text-slate-700">
              Fallback Message
            </label>
            <textarea
              id="org-fallback-message"
              rows={3}
              {...register('fallback_message')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Message shown when widget finds no matching providers
            </p>
          </div>

          <div>
            <label htmlFor="org-domains" className="mb-1 block text-sm font-medium text-slate-700">
              Allowed Embed Domains
            </label>
            <textarea
              id="org-domains"
              rows={3}
              placeholder={'yourwebsite.com\napp.yourwebsite.com'}
              aria-invalid={domainProblem ? true : undefined}
              aria-describedby={domainProblem ? 'org-domains-problem' : undefined}
              {...register('allowed_domains_text', {
                validate: (text) => approvedDomainListProblem(text) ?? true,
              })}
              className={[
                'w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500',
                domainProblem ? 'border-red-400' : 'border-slate-300',
              ].join(' ')}
            />
            {/* Shown as soon as the list is loaded or edited, not only after a
                save attempt: a stored entry the rule rejects otherwise blocks
                every save on this form without saying why. */}
            {domainProblem ? (
              <p id="org-domains-problem" role="alert" className="mt-1 text-sm text-red-600">
                {domainProblem}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-slate-500">
              One full domain per line. Live widgets fail closed when this list is empty or invalid.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Default Booking Mode</label>
            <ul className="mb-2 space-y-1 text-xs text-slate-500">
              <li><span className="font-medium text-slate-600">Simple</span> — Provider uses the same booking link at every location</li>
              <li><span className="font-medium text-slate-600">Advanced</span> — Provider has different booking links per location</li>
            </ul>
            <select
              {...register('default_booking_mode')}
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="simple">Simple — Same link for all locations</option>
              <option value="advanced">Advanced — Different link per location</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Default Phone Mode</label>
            <ul className="mb-2 space-y-1 text-xs text-slate-500">
              <li><span className="font-medium text-slate-600">Simple</span> — Provider uses the same phone number at every location</li>
              <li><span className="font-medium text-slate-600">Advanced</span> — Provider has different phone numbers per location</li>
            </ul>
            <select
              {...register('default_phone_mode')}
              className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="simple">Simple — Same number for all locations</option>
              <option value="advanced">Advanced — Different number per location</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={!isDirty || orgSaving}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {orgSaving ? 'Saving…' : 'Save Organization Settings'}
          </button>
          </fieldset>
        </form>
        {!isOwner ? <p className="mt-3 text-xs text-slate-500">Only an organization owner can change these settings.</p> : null}
      </section>

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Team Access</h2>
            <p className="mt-1 text-xs text-slate-500">Viewers can read, editors can configure, and owners manage organization access.</p>
          </div>
          {teamLoading ? <span className="text-xs text-slate-400">Refreshing…</span> : null}
        </div>

        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{member.name || member.email}</p>
                <p className="truncate text-xs text-slate-500">{member.email}</p>
              </div>
              {isOwner ? (
                <select
                  value={member.role}
                  onChange={(event) => void changeMemberRole(member.id, event.target.value as User['role'])}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  aria-label={`Role for ${member.email}`}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs capitalize text-slate-600">{member.role}</span>
              )}
            </div>
          ))}
        </div>

        {isOwner ? (
          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <h3 className="mb-3 text-sm font-medium text-slate-800">Invite a team member</h3>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]">
              <input
                value={inviteName}
                onChange={(event) => setInviteName(event.target.value)}
                placeholder="Full name"
                maxLength={200}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@company.com"
                maxLength={320}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as User['role'])}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
              <button
                type="button"
                disabled={inviteSending || !inviteName.trim() || !inviteEmail.trim()}
                onClick={() => void inviteMember()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {inviteSending ? 'Sending…' : 'Invite'}
              </button>
            </div>
            {pendingInvitations.length > 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Pending: {pendingInvitations.map((invitation) => invitation.email).join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-6 font-semibold text-slate-900">Account</h2>

        <div className="mb-5">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email Address</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
            {user.email}
          </div>
          <p className="mt-1 text-xs text-slate-500">Email cannot be changed</p>
        </div>

        <div className="mb-5">
          <label htmlFor="account-name" className="mb-1 block text-sm font-medium text-slate-700">
            Your Name
          </label>
          <input
            id="account-name"
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <button
          type="button"
          disabled={!accountNameChanged || accountSaving}
          onClick={() => void onSaveAccount()}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {accountSaving ? 'Saving…' : 'Save Account'}
        </button>

        <button
          type="button"
          onClick={() => setModal({ type: 'change-password' })}
          className="mt-6 block w-full max-w-xs rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Change Password
        </button>
      </section>

      {modal.type === 'change-password' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onMouseDown={() => closePasswordModal()}
            aria-hidden
          />
          <div
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="change-password-title"
          >
            <h3 id="change-password-title" className="mb-4 text-lg font-semibold text-slate-900">
              Change Password
            </h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-slate-700">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-xs text-slate-500">At least 12 characters</p>
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-slate-700">
                  Confirm New Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {passwordError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {passwordError}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={passwordSaving}
                onClick={() => void onSavePassword()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {passwordSaving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
