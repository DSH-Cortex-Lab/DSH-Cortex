/**
 * 安全扫描（D14：输出必须是纯函数）。只返回命中模式标签，绝不回显密钥原文。
 *
 * @module dsh-review-core
 */

export type SecretKind =
  | 'aws-access-key'
  | 'openai-key'
  | 'generic-api-key'
  | 'private-key'
  | 'jwt'
  | 'slack-token'
  | 'github-token'

export function scanSecrets(text: string): SecretKind[] {
  const hits = new Set<SecretKind>()
  if (AWS_ACCESS_KEY.test(text)) hits.add('aws-access-key')
  if (OPENAI_KEY.test(text)) hits.add('openai-key')
  if (GENERIC_API_KEY.test(text)) hits.add('generic-api-key')
  if (PRIVATE_KEY.test(text)) hits.add('private-key')
  if (JWT.test(text)) hits.add('jwt')
  if (SLACK_TOKEN.test(text)) hits.add('slack-token')
  if (GITHUB_TOKEN.test(text)) hits.add('github-token')
  return [...hits]
}

export function hasSecrets(text: string): boolean {
  return scanSecrets(text).length > 0
}

const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/
const OPENAI_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/
const GENERIC_API_KEY = /\b(?:api[_-]?key|apikey|access[_-]?token|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/i
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
const SLACK_TOKEN = /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
const GITHUB_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/
