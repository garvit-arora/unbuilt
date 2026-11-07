# LocalPilot Starter Kit

A private, offline AI coding assistant on your own laptop, built from open-source tools you can inspect.
This kit is a setup guide and configuration, not a hosted service: after the one-time model download, nothing in
this setup needs the internet, and no code leaves your machine.

Prepared by UNBUILT Labs for the "Offline AI coding assistant" demand cluster on UNBUILT.

---

## What you get

1. **Ollama** runs code models locally and serves them on `127.0.0.1:11434` (loopback only).
2. **Continue.dev** in VS Code provides chat, inline edits and tab autocomplete backed by those local models.
3. **Model picks by RAM size**, so the assistant stays responsive on 8 GB laptops.
4. **A no-egress checklist** to verify for yourself that your code never leaves the machine.

Time needed: about 20 minutes, most of it the model download.

---

## 1. Install Ollama

- **macOS / Windows:** download the installer from <https://ollama.com/download> and run it.
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

Check that it runs:

```sh
ollama --version
curl http://127.0.0.1:11434/api/version
```

Do **not** set `OLLAMA_HOST=0.0.0.0`. The default binds to loopback, so other machines on your network cannot reach
the model server.

## 2. Pull models that fit your RAM

The models below are quantized (about 4 bits per weight). Leave a few GB free for your editor, browser and build tools.
Check the licence note at the end before using the 3B model for commercial work.

| Laptop RAM | Chat / edit model | Autocomplete model | Download size (approx.) |
|---|---|---|---|
| 8 GB | `qwen2.5-coder:3b` | `qwen2.5-coder:1.5b-base` | 2.9 GB |
| 16 GB | `qwen2.5-coder:7b` | `qwen2.5-coder:1.5b-base` | 5.7 GB |
| 32 GB or more | `qwen2.5-coder:14b` | `qwen2.5-coder:1.5b-base` | 10 GB |

For 8 GB:

```sh
ollama pull qwen2.5-coder:3b
ollama pull qwen2.5-coder:1.5b-base
ollama pull nomic-embed-text   # optional: lets Continue index your codebase locally
```

Tips for 8 GB machines:

- Close other memory-heavy apps while coding; the first response after loading a model takes a few seconds.
- If chat feels slow, use the 1.5B model for chat too. Autocomplete quality matters more than chat speed.
- `ollama ps` shows which models are loaded; `ollama stop <model>` frees memory.

## 3. Install Continue.dev in VS Code

1. Open VS Code, go to Extensions, and install **Continue** (publisher: Continue).
2. Open the Continue panel, choose to configure models yourself (skip any sign-in), and open the config file.
   Recent versions use `~/.continue/config.yaml` (on Windows `%USERPROFILE%\.continue\config.yaml`).
3. Replace its contents with the configuration below (8 GB version; change the chat model for more RAM):

```yaml
name: LocalPilot
version: 1.0.0
schema: v1
models:
  - name: Qwen2.5-Coder 3B (local)
    provider: ollama
    model: qwen2.5-coder:3b
    apiBase: http://127.0.0.1:11434
    roles:
      - chat
      - edit
      - apply
  - name: Qwen2.5-Coder 1.5B autocomplete (local)
    provider: ollama
    model: qwen2.5-coder:1.5b-base
    apiBase: http://127.0.0.1:11434
    roles:
      - autocomplete
  - name: Nomic Embed (local)
    provider: ollama
    model: nomic-embed-text
    apiBase: http://127.0.0.1:11434
    roles:
      - embed
```

4. Turn off telemetry. In VS Code settings (`settings.json`):

```json
{
  "telemetry.telemetryLevel": "off",
  "continue.telemetryEnabled": false
}
```

Setting names change between Continue releases; if `continue.telemetryEnabled` is not recognised, search the
Continue settings for "telemetry" and switch it off there.

5. Disable or uninstall other AI extensions (cloud copilots) in this VS Code profile so no other extension sends code
   elsewhere. A dedicated VS Code profile named "LocalPilot" keeps this clean.

## 4. Try it

- Press `Tab` to accept an inline suggestion while typing.
- Select code and press `Ctrl+I` (`Cmd+I` on macOS) to edit it with an instruction.
- Open the Continue chat panel (`Ctrl+L` / `Cmd+L`) and ask questions about the open file.

## 5. Verify that nothing leaves your machine

Do these checks once after setup and again after updating extensions.

1. **Airplane test.** Turn off Wi-Fi and unplug the network cable. Autocomplete, edit and chat must keep working.
   If anything fails, a component still depends on the network.
2. **Ollama listens on loopback only.**
   - macOS / Linux: `lsof -nP -iTCP -sTCP:LISTEN | grep -i ollama` should show `127.0.0.1:11434` only.
   - Windows (PowerShell): `Get-NetTCPConnection -State Listen -LocalPort 11434` should show `LocalAddress 127.0.0.1`.
3. **No outbound connections while you code.** With the network back on, use the editor for a few minutes, then list
   the connections of VS Code and Ollama:
   - macOS / Linux: `lsof -nP -i | grep -Ei "code|ollama"`
   - Windows (PowerShell):
     ```powershell
     Get-Process Code, ollama -ErrorAction SilentlyContinue | ForEach-Object {
       Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue
     } | Where-Object RemoteAddress -notin '127.0.0.1', '::1', '0.0.0.0', '::'
     ```
   Connections to `127.0.0.1` are the editor talking to Ollama. VS Code itself may contact the extension marketplace
   for updates; disable automatic extension updates (`"extensions.autoUpdate": false`) if you want zero outbound traffic.
4. **Optional firewall rule.** Block outbound traffic for the Ollama binary in your OS firewall. The assistant keeps
   working because the editor reaches Ollama over loopback.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Continue says it cannot reach the model | Run `ollama serve` or start the Ollama app; check `curl http://127.0.0.1:11434/api/version` |
| Suggestions are very slow | Use the 1.5B model for chat, close other apps, check `ollama ps` for extra loaded models |
| Out-of-memory errors | Pick the next smaller model; keep only one chat model loaded |
| No autocomplete | Confirm the `autocomplete` role is on `qwen2.5-coder:1.5b-base` and that "Enable Tab Autocomplete" is on in Continue |

## Licences

Ollama (MIT) and Continue (Apache 2.0) are open source. Qwen2.5-Coder 1.5B, 7B and 14B are released under Apache 2.0;
the 3B size uses the Qwen Research licence, which does not allow commercial use. For commercial work on an 8 GB laptop,
use `qwen2.5-coder:1.5b` for chat as well. Check each project's licence for your use case. This guide is provided by UNBUILT Labs; it does not include or
redistribute the tools themselves.
