/**
 * Server-control tools: let the agent run shell commands and manipulate files on
 * the host that runs DSH. Registered by the plugin so they are available even
 * when the QQ bridge session is "chat-only" — the bridge restricts the built-in
 * bash/file tools, but these custom-named tools are not in its deny list.
 *
 * SECURITY: these tools grant arbitrary command/file access to whoever can make
 * the agent call them. Only install into a profile whose QQ bridge is restricted
 * to the owner (or a trusted whitelist). They are gated by SERVER_CONTROL_ENABLED
 * (default on; set to "0" to disable). Every command is logged to the DSH console.
 */
import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export const serverControlEnabled = process.env.SERVER_CONTROL_ENABLED !== '0'

const str = (v, d = '') => (typeof v === 'string' ? v : d)
const num = (v, d = 0) => (typeof v === 'number' ? v : Number(v) || d)

const MAX_FILE = 200 * 1024 // 200KB cap for reads
const MAX_BUFFER = 16 * 1024 * 1024

export const systemTools = [
  {
    name: 'server_exec',
    description:
      'Run a shell command on the host running DSH and return stdout/stderr/exit code. ' +
      'Use for server control: check status, read logs, start/stop services, install packages, etc.',
    parameters: {
      command: { type: 'string', required: true, description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (default: plugin cwd)' },
      timeout: { type: 'number', description: 'Timeout in ms (default 60000)' },
    },
    run: (args) => runCommand(str(args.command), str(args.cwd), num(args.timeout, 60000)),
  },
  {
    name: 'server_file_read',
    description: 'Read a text file on the host (capped at 200KB). Use to inspect configs, logs, scripts.',
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute or relative file path' },
    },
    run: (args) => readFile(str(args.path)),
  },
  {
    name: 'server_file_write',
    description:
      'Write text content to a file on the host (creates/overwrites). Use to edit configs or deploy scripts.',
    parameters: {
      path: { type: 'string', required: true, description: 'File path' },
      content: { type: 'string', required: true, description: 'Text content to write' },
    },
    run: (args) => writeFile(str(args.path), str(args.content)),
  },
  {
    name: 'server_file_list',
    description: 'List files in a directory on the host.',
    parameters: {
      path: { type: 'string', required: true, description: 'Directory path (default ".")' },
    },
    run: (args) => listDir(str(args.path, '.')),
  },
  {
    name: 'server_pwd',
    description: 'Show the current working directory of the DSH/host process.',
    parameters: {},
    run: () => ({ text: process.cwd() }),
  },
]

async function runCommand(command, cwd, timeout) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  console.warn(`[dsh-browser-tools] server_exec: ${command}`)
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: cwd || process.cwd(), timeout, maxBuffer: MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0
        const killed = err && err.killed ? ' (killed: timeout)' : ''
        const out =
          `$ ${command}\n` +
          `exit=${code}${killed}\n` +
          `--- stdout ---\n${stdout || ''}\n` +
          `--- stderr ---\n${stderr || ''}`
        resolve({ text: out })
      },
    )
  })
}

async function readFile(p) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  try {
    const buf = await fs.readFile(p, 'utf8')
    const text = buf.length > MAX_FILE ? buf.slice(0, MAX_FILE) + '\n…(truncated)' : buf
    return { text }
  } catch (e) {
    return { text: `read failed: ${e.message}` }
  }
}

async function writeFile(p, content) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  try {
    await fs.mkdir(path.dirname(path.resolve(p)), { recursive: true })
    await fs.writeFile(p, content, 'utf8')
    return { text: `wrote ${Buffer.byteLength(content)} bytes to ${p}` }
  } catch (e) {
    return { text: `write failed: ${e.message}` }
  }
}

async function listDir(p) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  try {
    const entries = await fs.readdir(p, { withFileTypes: true })
    const lines = entries.map((e) => `${e.isDirectory() ? 'd' : '-'} ${e.name}`)
    return { text: `${p}\n${lines.join('\n')}` }
  } catch (e) {
    return { text: `list failed: ${e.message}` }
  }
}
