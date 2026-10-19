export interface AccountDisplayInput {
  id?: string
  name: string
  email?: string | null
}

export function accountDisplayName(account: AccountDisplayInput): string {
  return account.email?.trim() || '未提供邮箱'
}
