// What the guard decides for one tool call: ask the person first, refuse, or let it pass.
export type Verdict = { ask: string } | { deny: string } | undefined

// Paths a recursive rm must never take: the root, home, the drives, the current folder.
const CATASTROPHIC = /^(\/|\/\*|~|~\/|~\/\*|\$\{?HOME\}?\/?\*?|\.|\.\/|\.\/\*|\.\.|\.\.\/|\*|\/home(\/[^/]+)?\/?|\/mnt\/[a-z]\/?|\/(usr|etc|var|bin|lib|opt|boot)\/?)$/
// Scratch places where clearing a tree is routine.
const SCRATCH = /^\/tmp\//

// Values that look like a credential: API keys, tokens, private keys, assigned passwords.
const SECRET_VALUES: [string, RegExp][] = [
  ['Anthropic API key', /\bsk-ant-[\w-]{16,}/],
  ['OpenAI-style API key', /\bsk-(?:proj-)?[A-Za-z0-9]{20,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[\w]{20,})/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abposr]-[\w-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['password or token', /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[^\s'"]{8,}/i],
]

// Files that hold credentials. `.env.example` and its kind are templates, not secrets.
const SECRET_FILES: [string, RegExp][] = [
  ['Claude credentials', /\.credentials\.json\b/],
  ['SSH private key', /\.ssh\/id_[a-z0-9]+(?!\.pub)\b/],
  ['AWS credentials', /\.aws\/credentials\b/],
  ['.netrc', /(^|[\s/'"=])\.netrc\b/],
  ['.pgpass', /(^|[\s/'"=])\.pgpass\b/],
  ['.env', /(^|[\s/'"=])\.env(?:\.(?!example\b|sample\b|template\b|dist\b)[\w-]+)?(?=$|[\s'";|&)])/],
]

export function secretValue(text: string): string | undefined {
  return SECRET_VALUES.find(([, pattern]) => pattern.test(text))?.[0]
}

export function secretFile(text: string): string | undefined {
  return SECRET_FILES.find(([, pattern]) => pattern.test(text))?.[0]
}

// The simple commands of a shell line: split on ; && || | and newlines, quotes kept rough.
function segments(command: string): string[][] {
  return command
    .split(/;|&&|\|\||\||\n/)
    .map(part => part.trim().split(/\s+/).filter(Boolean))
    .filter(words => words.length > 0)
}

const unquote = (word: string) => word.replace(/^['"]|['"]$/g, '')

function judgeRm(words: string[]): Verdict {
  const at = words[0] === 'sudo' ? 1 : 0
  if (words[at] !== 'rm') return undefined
  const args = words.slice(at + 1)
  const flags = args.filter(word => word.startsWith('-'))
  const targets = args.filter(word => !word.startsWith('-')).map(unquote)
  const isRecursive = flags.some(flag => flag === '--recursive' || /^-[a-zA-Z]*[rR]/.test(flag))
  if (!isRecursive) return undefined
  const fatal = targets.find(target => CATASTROPHIC.test(target))
  if (fatal !== undefined) return { deny: `rm đệ quy trên "${fatal}" là quá rộng, có thể xoá sạch dữ liệu.` }
  if (targets.length > 0 && targets.every(target => SCRATCH.test(target))) return undefined
  return { ask: `Xoá đệ quy: ${words.slice(at).join(' ')}` }
}

const GIT_ASK: [string, RegExp][] = [
  ['git push --force (ghi đè lịch sử remote)', /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*\s(?:--force(?![-\w])|-f\b|\+[\w/.-]+)/],
  ['git push xoá nhánh remote', /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*\s(?:--delete\b|-d\b|:[\w/.-]+)/],
  ['git reset --hard (mất thay đổi chưa commit)', /\bgit\b[^;&|\n]*\breset\b[^;&|\n]*--hard\b/],
  ['git clean -f (xoá file chưa track)', /\bgit\b[^;&|\n]*\bclean\b[^;&|\n]*\s-[a-zA-Z]*f/],
  ['git checkout/restore bỏ thay đổi', /\bgit\b[^;&|\n]*\b(?:checkout\s+(?:--\s+)?\.|restore\s+(?!--staged)[^;&|\n]*\.)(?:\s|$)/],
  ['git branch -D (xoá nhánh chưa merge)', /\bgit\b[^;&|\n]*\bbranch\b[^;&|\n]*\s-D\b/],
  ['git stash drop/clear', /\bgit\b[^;&|\n]*\bstash\s+(?:drop|clear)\b/],
]

const DENY: [string, RegExp][] = [
  ['format ổ đĩa (mkfs)', /\bmkfs(\.\w+)?\b/],
  ['ghi thẳng vào thiết bị đĩa', /\bdd\b[^;&|\n]*\bof=\/dev\/(?:sd|nvme|hd|disk)|>\s*\/dev\/(?:sd|nvme|hd)/],
  ['fork bomb', /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/],
  ['chmod/chown đệ quy trên thư mục hệ thống', /\bch(?:mod|own)\s+-[a-zA-Z]*R[^;&|\n]*\s(?:\/|~|\$HOME)\s*(?:$|[;&|])/],
]

export function judgeBash(command: string): Verdict {
  for (const [what, pattern] of DENY) if (pattern.test(command)) return { deny: `Chặn: ${what}.` }

  // A brief for agy leaves this machine's trust: no secrets in it, no pointing it at them.
  if (/\bagy(?:-tracked)?\b/.test(command)) {
    const value = secretValue(command)
    if (value !== undefined) return { deny: `Brief gửi agy có vẻ chứa ${value}. Bỏ secret khỏi brief rồi chạy lại.` }
    const file = secretFile(command)
    if (file !== undefined) return { deny: `Brief gửi agy nhắc tới file bí mật (${file}). Không giao việc đụng tới credentials cho agy.` }
  }

  for (const words of segments(command)) {
    const verdict = judgeRm(words)
    if (verdict !== undefined) return verdict
  }
  for (const [what, pattern] of GIT_ASK) if (pattern.test(command)) return { ask: what }
  if (/\b(?:curl|wget)\b[^;&\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(command)) {
    return { ask: 'Tải script từ mạng rồi chạy thẳng (curl | sh)' }
  }
  const file = secretFile(command)
  if (file !== undefined) return { ask: `Lệnh đụng tới file bí mật (${file})` }
  return undefined
}

// The path a file tool names, whichever field it uses.
function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

export function judge(tool: string, input: Record<string, unknown>): Verdict {
  if (tool === 'Bash' && typeof input.command === 'string') return judgeBash(input.command)
  if (['Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob'].includes(tool)) {
    const path = pathOf(input)
    const file = path === undefined ? undefined : secretFile(path)
    if (file !== undefined) return { ask: `${tool} file bí mật (${file}): ${path}` }
  }
  return undefined
}
