/** Map a filename to a markdown code-fence language, or '' when unknown. */
export function fenceLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', py: 'python', rs: 'rust', go: 'go',
    java: 'java', rb: 'ruby', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', sh: 'bash',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', html: 'html',
    css: 'css', sql: 'sql', xml: 'xml',
  }
  return map[ext] ?? ''
}

/** Format one file as the fenced code block used for context attachments. */
export function fencedAttachment(name: string, text: string): string {
  return `${name}:\n\n\`\`\`${fenceLang(name)}\n${text}\n\`\`\``
}
