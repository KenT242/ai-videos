// Words that mark a small, well-scoped job, the kind CLAUDE.md hands to agy.
const SMALL = [
  /\b(?:fix|sửa)\b.{0,40}\b(?:lỗi|bug|typo|test|lint|warning|import)\b/i,
  /\b(?:rename|đổi tên)\b/i,
  /\b(?:thêm|viết|add|write)\s+(?:một\s+|a\s+|1\s+)?(?:unit\s+)?tests?\b/i,
  /\b(?:typo|boilerplate|docstring|comment|format|lint)\b/i,
  /\b(?:tóm tắt|summari[sz]e|liệt kê|list)\b.{0,30}\b(?:file|thư mục|folder|hàm|function)/i,
  /\b(?:đổi|change|update|cập nhật)\b.{0,30}\b(?:config|cấu hình|version|phiên bản)\b/i,
]

// Words that mark a job to keep here: design, many files, risk, or this conversation's context.
const KEEP_HERE = [
  /\b(?:thiết kế|design|kiến trúc|architecture|refactor|plan|kế hoạch|review|đánh giá|tại sao|why|giải thích|explain)\b/i,
  /\b(?:deploy|push|commit|merge|release|secret|credential|password|token|xoá|delete|drop)\b/i,
  /\b(?:toàn bộ|tất cả|cả repo|entire|whole|mọi file|all files)\b/i,
  /\b(?:agy|delegate|giao cho)\b/i,
]

// Whether a prompt reads like a job to delegate: short, one of the small kinds, none of the keep-here kinds.
export function looksDelegable(text: string): boolean {
  const prompt = text.trim()
  if (prompt === '' || prompt.startsWith('/') || prompt.startsWith('!')) return false
  if (prompt.length > 400 || prompt.split('\n').length > 6) return false
  if (KEEP_HERE.some(pattern => pattern.test(prompt))) return false
  return SMALL.some(pattern => pattern.test(prompt))
}
