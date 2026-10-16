# Architecture

## Components

```mermaid
flowchart LR
  subgraph bbServer["bb server (any machine)"]
    S[server.ts<br/>settings · policy · tools · rpc · cli]
    UI[app.tsx<br/>settings section]
    UI -- rpc --> S
  end
  subgraph daemon["bb host daemon (thread's machine)"]
    H[host.ts<br/>binary lookup · status probe · MCP session]
    M[cua-driver mcp<br/>stdio JSON-RPC]
    H -- spawn + stdio --> M
  end
  subgraph cua["Cua Driver runtime"]
    D{{macOS: CuaDriver.app daemon<br/>Windows/Linux: in-process}}
    OS[(Desktop apps · Chromium windows · clipboard)]
    M --> D --> OS
  end
  P[Provider bridge<br/>Claude Code · Codex · Pi] -- tool call --> S
  S -- "host RPC: callTool {hostId}" --> H
  H -- "connectionChanged signal" --> S
```

## A tool call, end to end

```mermaid
sequenceDiagram
  participant A as Agent (provider)
  participant B as bb server
  participant S as plugin server.ts
  participant H as plugin host.ts (target machine)
  participant C as cua-driver mcp
  A->>B: cua_click {pid, element_token}
  B->>S: execute(args, {threadId, signal})
  S->>B: threads.get → environments.get
  B-->>S: hostId
  S->>H: callTool {name: click, arguments, session: bb-thr_x} (hostId)
  alt no MCP session yet
    H->>C: spawn `cua-driver mcp`, initialize, tools/list
    H-->>S: signal connectionChanged {connected: true}
  end
  H->>C: tools/call click {..., session}
  C-->>H: content[text, image], structuredContent
  H-->>S: {content, isError}
  S-->>B: PluginAgentToolResult
  B-->>A: text + image blocks
```

## Tool catalog, exposure and drift

```mermaid
flowchart TD
  R[refreshStatus: host status probe] --> V{installed, and catalog<br/>missing or another version?}
  V -- yes --> L[host listTools: tools/list + serverInfo.version]
  L --> K[normalize + compact<br/>store in kv catalog:hostId]
  K --> G[registerTool for names not yet registered<br/>permissive schema]
  K --> D[diff against src/driver-snapshot.json<br/>→ drift report]
  V -- no --> C
  G --> C[configure: meta tools + every tool<br/>whose exposure is tool, with the<br/>machine's own schema as override]
  X[exposure: managed or group off → off<br/>else user override<br/>else src/exposure.ts review<br/>else readOnlyHint ? call : off] --> C
  X --> CC[cua_call and bb cua call<br/>refuse tools that are off]
```

`start_session` and `end_session` are managed by the plugin and never exposed.
A name the machine has not reported triggers one fresh `tools/list` read
before the call is refused.

## Pinned installs

```mermaid
sequenceDiagram
  participant S as plugin server.ts
  participant H as plugin host.ts
  participant G as GitHub (cua-driver-rs-vX.Y.Z)
  S->>H: install {version: tested}
  H->>H: cua-driver stop (if installed)
  loop install.sh, _install-rust.sh, _install-common.sh
    H->>G: download
    H->>H: sha256 == src/driver-installer.json? else refuse
  end
  H->>H: CUA_DRIVER_RS_VERSION=X.Y.Z bash install.sh<br/>(loads its siblings from disk)
  Note over H: the installer verifies the archive<br/>against SHA256SUMS (+ Sigstore with cosign)
  H->>H: open CuaDriver.app, re-probe
```

`install {version: null}` (the newest, untested release) runs Cua's one-line
script from cua.ai instead.

## Session configuration

```mermaid
flowchart TD
  T[thread.start / turn.submit] --> C[bb.agents.configure ctx]
  C --> O{override for provider?}
  O -- yes --> D[decision = override]
  O -- no --> M{mode}
  M -- off --> OFF[tools: none]
  M -- cua-everywhere --> CUA[tools: meta + exposure tool<br/>skill: cua-computer-use<br/>instructions: readiness + drift lines]
  M -- prefer-native --> N{provider has native computer use?}
  N -- yes (codex) --> OFF
  N -- no --> CUA
  D --> CUA
  D --> OFF
```

## Process model per OS

| OS | What `cua-driver mcp` does | Who owns permissions | bb daemon requirement |
| --- | --- | --- | --- |
| macOS | proxies to the LaunchServices-launched `CuaDriver.app` daemon over a 0600 Unix socket | `CuaDriver.app` (Accessibility, Screen Recording) | none beyond a logged-in user |
| Windows | owns the runtime in-process | the interactive session the daemon runs in | daemon must run in an interactive session (not Session 0 / SSH) |
| Linux (X11/XWayland) | owns the runtime in-process | AT-SPI + X server | daemon inside the graphical session |

## Lifecycle rules the plugin relies on

- Tools are registered when the plugin loads (the tested snapshot plus each
  cached machine catalog) and when a machine reports a new name; `configure()`
  only selects them per resolution. Changes land on the next provider session
  start.
- Host workers are lazy and evicted after 5 idle minutes unless retained; the
  plugin retains the worker only while an MCP session is open and releases it
  on the 10-minute idle disconnect, so an idle machine runs no extra process.
- Reload replaces the server registration set atomically; the host worker
  moves to the new generation on its next call.
