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
import { exec, execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const serverControlEnabled = process.env.SERVER_CONTROL_ENABLED !== '0'

const str = (v, d = '') => (typeof v === 'string' ? v : d)
const num = (v, d = 0) => (typeof v === 'number' ? v : Number(v) || d)

const MAX_FILE = 200 * 1024 // 200KB cap for reads
const MAX_BUFFER = 16 * 1024 * 1024

// --- terminal allowlist: restrict who may invoke terminal/process tools ---
// Identity is read from the DSH execution context (exec.agent.session), NOT from
// any agent-supplied argument, so it cannot be spoofed. Configure allowed
// session IDs via SERVER_TERMINAL_ALLOWLIST (comma/space separated) or a
// whitelist.json at the plugin root: { "allow": ["12345", "group:67890"] }.
// When the allowlist is empty the gate is inactive (global SERVER_CONTROL_ENABLED
// still applies) and the caller id is logged once so you can configure it.
let allowSet = null
let loggedCallerId = false

function loadAllowlist() {
  if (allowSet) return allowSet
  const set = new Set()
  const env = process.env.SERVER_TERMINAL_ALLOWLIST
  if (env) {
    for (const t of env.split(/[,\s]+/)) {
      const s = t.trim()
      if (s) set.add(s)
    }
  }
  try {
    const raw = JSON.parse(readFileSync(path.join(__dirname, '..', 'whitelist.json'), 'utf8'))
    if (raw && Array.isArray(raw.allow)) {
      for (const x of raw.allow) if (x != null) set.add(String(x))
    }
  } catch {
    /* no whitelist file */
  }
  allowSet = set
  return set
}

function resolveCallerId(execCtx) {
  if (!execCtx) return null
  const candidates = [
    execCtx.agent?.session?.id,
    execCtx.agent?.session?.key,
    execCtx.session?.id,
    execCtx.session?.key,
    execCtx.agent?.id,
    execCtx.user?.id,
    execCtx.caller?.id,
  ]
  for (const c of candidates) {
    if (c != null && String(c).length) return String(c)
  }
  return null
}

function checkWhitelist(execCtx) {
  const id = resolveCallerId(execCtx)
  const set = loadAllowlist()
  if (set.size === 0) {
    if (id && !loggedCallerId) {
      loggedCallerId = true
      console.warn(
        `[dsh-browser-tools] terminal caller id = ${id} (no allowlist set; configure SERVER_TERMINAL_ALLOWLIST to restrict)`,
      )
    }
    return { allowed: true, id }
  }
  if (!id) return { allowed: false, id: null }
  return { allowed: set.has(id), id }
}

const refusal = (id) =>
  `⛔ 终端/进程操作被白名单拒绝：caller=${id ?? 'unknown'} 不在允许列表。` +
  ` 把该 ID 加入 SERVER_TERMINAL_ALLOWLIST 或 whitelist.json 的 allow 数组即可授权。`

export const systemTools = [
  {
    name: 'server_exec',
    description:
      'Run a command on the host running DSH and return stdout/stderr/exit code. ' +
      'Supports shell selection: "powershell" (Windows default, more capable), "cmd" (cmd.exe), ' +
      '"bash"/"sh" on Linux. Use for server control: status, logs, services, installs, config edits.',
    parameters: {
      command: { type: 'string', required: true, description: 'Command to execute' },
      shell: { type: 'string', description: 'Shell: "powershell" (default on Windows), "cmd", "bash", "sh". Omit for OS default.' },
      cwd: { type: 'string', description: 'Working directory (default: plugin cwd)' },
      timeout: { type: 'number', description: 'Timeout in ms (default 60000)' },
    },
    run: (args, deps) => runCommand(str(args.command), str(args.shell), str(args.cwd), num(args.timeout, 60000), deps?.exec),
  },
  {
    name: 'server_terminal',
    description:
      'Open/use a PERSISTENT terminal session on the host (keeps cwd, environment and shell ' +
      'state between calls — like a real terminal). Default shell: powershell on Windows, bash on ' +
      'Linux. Pass shell:"cmd" for cmd.exe. Each call runs one command and returns its output; ' +
      'state (cd, variables, background jobs) persists across calls.',
    parameters: {
      command: { type: 'string', required: true, description: 'Command to run in the persistent terminal' },
      shell: { type: 'string', description: 'Shell for the session: "powershell" (default on Windows), "cmd", "bash", "sh". Set once; later calls reuse the same session.' },
      timeout: { type: 'number', description: 'Timeout in ms (default 60000)' },
    },
    run: (args, deps) => runInTerminal(str(args.command), str(args.shell), num(args.timeout, 60000), deps?.exec),
  },
  {
    name: 'server_process_list',
    description: 'List running processes on the host (tasklist on Windows, ps on Linux).',
    parameters: {},
    run: () => listProcesses(),
  },
  {
    name: 'server_process_kill',
    description:
      'Kill a process by PID on the host (taskkill /F on Windows, kill -9 on Linux). ' +
      'Destructive — only kill processes you control.',
    parameters: {
      pid: { type: 'integer', required: true, description: 'Process ID to kill' },
    },
    run: (args, deps) => killProcess(num(args.pid), deps?.exec),
  },
  {
    name: 'server_audio_capture',
    description:
      'Record the host audio output device for N seconds and save a WAV (so the AI can "listen"). ' +
      'Optional ASR: if AUDIO_ASR_CMD is set (e.g. "whisper %FILE%"), the transcript is returned. ' +
      'Windows needs an enabled loopback device in AUDIO_DEVICE (e.g. "Stereo Mix (Realtek)").',
    parameters: {
      duration: { type: 'number', description: 'Seconds to record (default 10)' },
      device: { type: 'string', description: 'Capture device override (else AUDIO_DEVICE env)' },
      asr: { type: 'boolean', description: 'Run ASR via AUDIO_ASR_CMD (default true when set)' },
    },
    run: (args, deps) => captureAudio(num(args.duration, 10) * 1000, str(args.device), args.asr !== false, deps?.exec),
  },
  {
    name: 'server_download',
    description:
      'Download a file/URL from the internet onto the host (curl / Invoke-WebRequest). ' +
      'Fetch installers, media, configs onto the server. Gated by the terminal whitelist.',
    parameters: {
      url: { type: 'string', required: true, description: 'URL to download (http/https)' },
      dest: { type: 'string', description: 'Destination path on host (default: cwd + URL basename)' },
    },
    run: (args, deps) => downloadFile(str(args.url), str(args.dest), deps?.exec),
  },
  {
    name: 'server_open',
    description:
      'Open a file or URL on the host with its default application (so a person at the server ' +
      'can see/hear it) — a video, document, or web page. Gated by the terminal whitelist.',
    parameters: {
      target: { type: 'string', required: true, description: 'File path or URL to open' },
    },
    run: (args, deps) => openOnHost(str(args.target), deps?.exec),
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

// ---------------------------------------------------------------------------
// Stateless command execution
// ---------------------------------------------------------------------------
async function runCommand(command, shell, cwd, timeout, execCtx) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  const effectiveShell = shell || (process.platform === 'win32' ? 'powershell' : 'sh')
  const isPs = effectiveShell === 'powershell' || effectiveShell === 'pwsh'
  console.warn(`[dsh-browser-tools] server_exec: (${effectiveShell}) ${command}`)
  const opts = { cwd: cwd || process.cwd(), timeout, maxBuffer: MAX_BUFFER, windowsHide: true }
  return new Promise((resolve) => {
    const cb = (err, stdout, stderr) => {
      const code = err && typeof err.code === 'number' ? err.code : err ? 1 : 0
      const killed = err && err.killed ? ' (killed: timeout)' : ''
      const out =
        `$ (${effectiveShell}) ${command}\n` +
        `exit=${code}${killed}\n` +
        `--- stdout ---\n${stdout || ''}\n` +
        `--- stderr ---\n${stderr || ''}`
      resolve({ text: out })
    }
    if (isPs) {
      // execFile avoids shell quoting pitfalls; passes the command verbatim to -Command.
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], opts, cb)
    } else {
      exec(command, { ...opts, shell: effectiveShell }, cb)
    }
  })
}

// ---------------------------------------------------------------------------
// Persistent terminal session (state survives between tool calls)
// ---------------------------------------------------------------------------
const TERMINAL_SENTINEL = `__DSH_TERM_DONE_${process.pid}__`
let terminal = null
let termQueue = Promise.resolve()

function enqueue(fn) {
  const run = termQueue.then(fn)
  termQueue = run.catch(() => {})
  return run
}

async function ensureTerminal(shell) {
  if (terminal && !terminal.exited) return terminal
  const effectiveShell = shell || (process.platform === 'win32' ? 'powershell' : 'bash')
  const isPs = effectiveShell === 'powershell' || effectiveShell === 'pwsh'
  let child
  if (isPs) {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true })
  } else if (effectiveShell === 'cmd') {
    child = spawn('cmd.exe', ['/Q', '/K'], { windowsHide: true })
  } else {
    child = spawn(effectiveShell, ['-i'], { windowsHide: true })
  }
  child.exited = false
  child.effectiveShell = effectiveShell
  child.buffer = ''
  child.stdout.setEncoding('utf8')
  child.on('exit', () => {
    child.exited = true
  })
  terminal = child
  return child
}

function wrapForShell(child, command, sentinel) {
  const s = child.effectiveShell
  if (s === 'powershell' || s === 'pwsh') return `${command}\nWrite-Output "${sentinel}"\n`
  if (s === 'cmd') return `${command}\r\necho ${sentinel}\r\n`
  return `${command}\necho "${sentinel}"\n`
}

export function runInTerminal(command, shell, timeoutMs, execCtx) {
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  return enqueue(() => doTerminalCommand(command, shell, timeoutMs))
}

async function doTerminalCommand(command, shell, timeoutMs) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const child = await ensureTerminal(shell)
  if (child.exited) {
    terminal = null
    return { text: 'terminal session exited unexpectedly; try again.' }
  }
  console.warn(`[dsh-browser-tools] server_terminal: (${child.effectiveShell}) ${command}`)
  const sentinel = TERMINAL_SENTINEL
  return new Promise((resolve) => {
    let done = false
    const finish = (text) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.stdout.removeListener('data', handler)
      child.stdout.removeListener('error', onErr)
      resolve({ text })
    }
    const timer = setTimeout(
      () => finish(`(timeout ${timeoutMs}ms — output so far)\n${child.buffer}`),
      timeoutMs || 60000,
    )
    const handler = (chunk) => {
      child.buffer += chunk
      const idx = child.buffer.indexOf(sentinel)
      if (idx === -1) return
      const out = child.buffer.slice(0, idx)
      child.buffer = child.buffer.slice(idx + sentinel.length)
      finish(out.trim())
    }
    const onErr = () => finish('(terminal stdout error)')
    child.stdout.on('data', handler)
    child.stdout.once('error', onErr)
    child.stdin.write(wrapForShell(child, command, sentinel))
  })
}

export function disposeTerminal() {
  try {
    terminal?.kill()
  } catch {
    /* ignore */
  }
  terminal = null
}

// ---------------------------------------------------------------------------
// Process management (native, no shell quoting)
// ---------------------------------------------------------------------------
async function listProcesses() {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const isWin = process.platform === 'win32'
  return new Promise((resolve) => {
    const cb = (err, stdout, stderr) => {
      const out = err ? `error: ${stderr || err.message}` : stdout || '(no output)'
      resolve({ text: out.slice(0, MAX_FILE) })
    }
    if (isWin) execFile('tasklist', ['/fo', 'csv', '/nh'], { maxBuffer: MAX_BUFFER }, cb)
    else exec('ps -eo pid,ppid,user,comm,%cpu,%mem', { maxBuffer: MAX_BUFFER, shell: '/bin/sh' }, cb)
  })
}

async function killProcess(pid, execCtx) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  if (!Number.isInteger(pid)) return { text: 'pid must be an integer.' }
  const isWin = process.platform === 'win32'
  return new Promise((resolve) => {
    const cb = (err, stdout, stderr) => {
      if (err) return resolve({ text: `kill ${pid} failed: ${stderr || err.message}` })
      resolve({ text: `kill ${pid}: ok${stdout ? '\n' + stdout : ''}` })
    }
    if (isWin) execFile('taskkill', ['/PID', String(pid), '/F'], { maxBuffer: MAX_BUFFER }, cb)
    else exec(`kill -9 ${pid}`, { maxBuffer: MAX_BUFFER, shell: '/bin/sh' }, cb)
  })
}

// ---------------------------------------------------------------------------
// Audio capture (host output -> WAV, optional ASR) — the AI "listening" path
// ---------------------------------------------------------------------------
async function captureAudio(durationMs, device, runAsr, execCtx) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  const ffmpeg = process.env.FFMPEG_BIN || 'ffmpeg'
  const isWin = process.platform === 'win32'
  const dev = device || process.env.AUDIO_DEVICE || ''
  const outPath = path.join(os.tmpdir(), `dsh-audio-${Date.now()}.wav`)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  if (isWin) {
    if (!dev) {
      return {
        text:
          'Windows loopback capture requires AUDIO_DEVICE (an enabled loopback device, e.g. ' +
          '"Stereo Mix (Realtek)" or a virtual audio cable). Set it and retry.',
      }
    }
    args.push('-f', 'dshow', '-i', `audio=${dev}`)
  } else {
    args.push('-f', 'pulse', '-i', dev || 'default')
  }
  args.push('-t', String(Math.ceil(durationMs / 1000)), '-ac', '1', '-ar', '16000', outPath)
  return new Promise((resolve) => {
    execFile(ffmpeg, args, { timeout: durationMs + 15000, maxBuffer: MAX_BUFFER }, async (err) => {
      if (err) {
        return resolve({
          text:
            `audio capture failed: ${err.message}. Need ffmpeg on PATH; Windows also needs an ` +
            'enabled loopback device in AUDIO_DEVICE.',
        })
      }
      let text = `audio captured -> ${outPath}`
      if (runAsr && process.env.AUDIO_ASR_CMD) {
        const cmd = process.env.AUDIO_ASR_CMD.replace(/%FILE%/g, outPath)
        try {
          const out = await new Promise((res) =>
            exec(cmd, { shell: true, maxBuffer: MAX_BUFFER }, (e, so) => res(e ? String(e.message) : so)),
          )
          text += `\n[ASR]\n${out}`
        } catch (e) {
          text += `\n[ASR failed] ${e?.message ?? e}`
        }
      } else if (runAsr) {
        text += '\n(set AUDIO_ASR_CMD to also transcribe, e.g. "whisper %FILE%")'
      }
      resolve({ text })
    })
  })
}

// ---------------------------------------------------------------------------
// Host helpers: download to host, open on host (both gated by the whitelist)
// ---------------------------------------------------------------------------
async function downloadFile(url, dest, execCtx) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  const target = String(url || '').trim()
  if (!/^https?:\/\//i.test(target)) return { text: 'url must start with http(s)://' }
  let out = String(dest || '').trim()
  if (!out) {
    let base = 'download.bin'
    try {
      base = path.basename(new URL(target).pathname) || 'download.bin'
    } catch {
      /* keep default */
    }
    out = path.join(process.cwd(), base)
  }
  const isWin = process.platform === 'win32'
  return new Promise((resolve) => {
    const done = (err) => {
      if (err) return resolve({ text: `download failed: ${err.message}` })
      resolve({ text: `downloaded ${target}\n-> ${out}` })
    }
    if (isWin) {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Invoke-WebRequest -Uri "${target}" -OutFile "${out}"`],
        { maxBuffer: MAX_BUFFER, timeout: 120000 },
        done,
      )
    } else {
      execFile('curl', ['-fsSL', target, '-o', out], { maxBuffer: MAX_BUFFER, timeout: 120000 }, done)
    }
  })
}

async function openOnHost(target, execCtx) {
  if (!serverControlEnabled) return { text: 'server control is disabled (SERVER_CONTROL_ENABLED=0).' }
  const w = checkWhitelist(execCtx)
  if (!w.allowed) return { text: refusal(w.id) }
  const t = String(target || '').trim()
  if (!t) return { text: 'target required (file path or URL).' }
  const isWin = process.platform === 'win32'
  // Launch the default application so a person at the server can see/hear it.
  return runCommand(
    isWin ? `Start-Process "${t}"` : `xdg-open "${t}"`,
    isWin ? 'powershell' : 'sh',
    '',
    15000,
    execCtx,
  )
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
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
