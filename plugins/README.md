# Odysseus Tool Plugins

Add new agent tools to Odysseus **without editing core code**. A plugin is a
drop-in folder; its tools become available to the agent on the next restart, for
both hosted models (native tool calls) and local models like Ollama/qwen3
(fenced code blocks). Plugins can live in their own repositories.

## Quick start

Create `plugins/<your-plugin>/plugin.py` (or a single file `plugins/<name>_plugin.py`):

```python
from src.tool_registry import ToolSpec, register_tool

async def run(args):
    return {"output": f"You said: {args.get('text','')}", "exit_code": 0}

register_tool(ToolSpec(
    name="echo",
    description="Echo the input text back.",
    parameters={"type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"]},
    aliases=["say"],                 # extra names the model may use
    prompt="```echo\n<text>\n```\nEcho the text back.",  # teaches local models
    execute=run,                     # async (args: dict) -> {"output"/"error", "exit_code"}
    permission="user",               # "user" (everyone) or "admin"
))
```

Restart Odysseus — the agent can now call `echo`. See `example/plugin.py` for a
complete, working template.

## How it works

`register_tool(spec)` wires the tool into every registry at once (native schema,
the fenced-block name map + tool tags, the tool prompt, permission gating, and
RAG tool-selection). `execute_tool_block` runs it generically. There is exactly
**one** declaration — no more editing six files per tool.

- **`execute(args) -> dict`**: your async handler. Return `{"output": str, "exit_code": 0}`
  on success or `{"error": str, "exit_code": 1}` on failure.
- **`parameters`**: JSON Schema for the args (used by hosted-model tool calls).
- **`parse` / `serialize`** (optional): only needed for multi-field fenced
  formats. The default accepts a JSON object *or* maps the whole fenced block to
  the first required parameter, and round-trips both ways.
- **`permission`**: `"admin"` gates the tool behind admin users.

## Security

Plugins run in-process with the server's privileges. Install only plugins you
trust. `permission="admin"` restricts a tool to admins. (A future permission/
approval engine and optional sandboxed execution will harden this further.)

## Roadmap

- ✅ Data-driven `ToolSpec` registry + drop-in loader (this).
- ⏭ In-app **Plugins** panel + a curated **registry/marketplace** (browse, search,
  one-click install — like DokuWiki / Blender add-ons), indexing both native
  plugins and MCP servers.
- ⏭ Migrate the built-in tools onto the same registry.

Note: Odysseus is also an **MCP client** — any MCP server already adds tools from
its own separate codebase (any language). Native plugins are the lighter,
in-process complement for deep integrations.

`ODYSSEUS_PLUGINS_DIR` overrides the plugins directory.
