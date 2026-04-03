import React, { useEffect, useState } from 'react'
import { Card, Space, Input, Button, message, Typography, Divider } from 'antd'
import { changePassword, getRbacMe, getUser, updateUser } from 'services/accounts'

const Profile: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [userId, setUserId] = useState<number | null>(null)
  const [canEdit, setCanEdit] = useState<boolean>(false)
  const [username, setUsername] = useState<string>('')
  const [email, setEmail] = useState<string>('')
  const [firstName, setFirstName] = useState<string>('')
  const [lastName, setLastName] = useState<string>('')
  const [oldPassword, setOldPassword] = useState<string>('')
  const [newPassword, setNewPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const me = await getRbacMe()
        const id = Number(me?.user_id)
        if (!id) throw new Error('Invalid current user')
        const perms = Array.isArray(me?.permissions) ? me.permissions : []
        const allowEdit = !!me?.is_superuser || perms.includes('auth.change_user') || perms.includes('accounts.change_user') || perms.includes('users.change_userprofile') || perms.some((p: string) => p.endsWith('.change_user') || p.endsWith('.change_userprofile'))
        setCanEdit(allowEdit)
        setUserId(id)
        const u = await getUser(id)
        setUsername(u?.username || '')
        setEmail(u?.email || '')
        setFirstName(u?.first_name || '')
        setLastName(u?.last_name || '')
      } catch (e: any) {
        message.error(e?.message || 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const emailValue = email.trim()
  const emailInvalid = emailValue.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)
  const newPasswordValue = newPassword.trim()
  const confirmPasswordValue = confirmPassword.trim()
  const passwordMismatch = newPasswordValue.length > 0 && confirmPasswordValue.length > 0 && newPasswordValue !== confirmPasswordValue

  const handleSave = async () => {
    if (!userId) return
    if (!canEdit) {
      message.error('No permission to update profile')
      return
    }
    if (emailInvalid) {
      message.error('Please enter a valid email address')
      return
    }
    setSaving(true)
    try {
      await updateUser(userId, {
        email: emailValue || undefined,
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      })
      message.success('Profile updated')
    } catch (e: any) {
      message.error(e?.message || 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!oldPassword.trim()) {
      message.error('Please enter your current password')
      return
    }
    if (!newPasswordValue) {
      message.error('Please enter a new password')
      return
    }
    if (newPasswordValue !== confirmPasswordValue) {
      message.error('Passwords do not match')
      return
    }
    setPasswordSaving(true)
    try {
      await changePassword({
        old_password: oldPassword,
        new_password: newPasswordValue,
        confirm_password: confirmPasswordValue,
      })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      message.success('Password updated')
    } catch (e: any) {
      const data = e?.response?.data
      const errText =
        data?.detail ||
        data?.message ||
        data?.old_password?.[0] ||
        data?.new_password?.[0] ||
        data?.confirm_password?.[0] ||
        e?.message
      message.error(errText || 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <Card title="My Profile" loading={loading}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Typography.Text type="secondary">Username</Typography.Text>
          <Input value={username} disabled />
        </Space>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Typography.Text type="secondary">Email</Typography.Text>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" disabled={!canEdit} />
          {emailInvalid ? <Typography.Text type="danger">Please enter a valid email address</Typography.Text> : null}
        </Space>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Typography.Text type="secondary">First name</Typography.Text>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" disabled={!canEdit} />
        </Space>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Typography.Text type="secondary">Last name</Typography.Text>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" disabled={!canEdit} />
        </Space>
        <Space>
          <Button type="primary" onClick={handleSave} loading={saving} disabled={!canEdit || emailInvalid}>Save</Button>
        </Space>
        <Divider />
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Typography.Text strong>Change Password</Typography.Text>
          <Input.Password
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="Current password"
          />
          <Input.Password
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
          />
          <Input.Password
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
          {passwordMismatch ? <Typography.Text type="danger">Passwords do not match</Typography.Text> : null}
          <Space>
            <Button type="primary" onClick={handleChangePassword} loading={passwordSaving}>Update password</Button>
          </Space>
        </Space>
      </Space>
    </Card>
  )
}

export default Profile
