import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runCommand, MAX_OUTPUT_BYTES } from '../../src/main/terminal/runner.js'

// A cross-platform node one-liner shell used for deterministic tests, so we do
// not depend on sh vs cmd builtins.
const nodeShell = { command: process.execPath, args: (cmd: string) => ['-e', cmd] }

describe('runCommand', () => {
  it('captures stdout and the exit code, running in cwd', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'oc-run-'))
    writeFileSync(path.join(dir, 'marker.txt'), 'x')
    const r = await runCommand('const fs=require("fs");process.stdout.write(fs.readdirSync(".").join(","))', {
      cwd: dir, shell: nodeShell,
    })
    expect(r.exitCode).toBe(0)
    expect(r.output).toContain('marker.txt')
    expect(r.timedOut).toBe(false)
  })

  it('reports a non-zero exit code', async () => {
    const r = await runCommand('process.exit(3)', { cwd: tmpdir(), shell: nodeShell })
    expect(r.exitCode).toBe(3)
  })

  it('truncates output past the cap', async () => {
    const r = await runCommand(`process.stdout.write("A".repeat(${MAX_OUTPUT_BYTES + 5000}))`, {
      cwd: tmpdir(), shell: nodeShell,
    })
    expect(r.truncated).toBe(true)
    expect(Buffer.byteLength(r.output)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES)
  })

  it('times out and marks the run', async () => {
    const r = await runCommand('setTimeout(()=>{}, 10000)', { cwd: tmpdir(), shell: nodeShell, timeoutMs: 200 })
    expect(r.timedOut).toBe(true)
  })

  it('kills the command on abort', async () => {
    const controller = new AbortController()
    const p = runCommand('setTimeout(()=>{}, 10000)', { cwd: tmpdir(), shell: nodeShell, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    const r = await p
    expect(r.aborted).toBe(true)
  })
})
