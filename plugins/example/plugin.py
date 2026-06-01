"""Example Odysseus tool plugin — copy this as a template for your own.

Drop a folder like this under `plugins/` (or name a single file `*_plugin.py`)
and its tools become available to the agent on the next startup — with NO edits
to Odysseus core. Your plugin can live in its own repository.

A plugin just calls `register_tool(ToolSpec(...))` one or more times. Each
ToolSpec wires the tool into every registry (native tool_calls schema, the
fenced-block parser local models use, the tool prompt, permission gating, and
RAG tool-selection) automatically.
"""
from src.tool_registry import ToolSpec, register_tool


async def _word_count(args):
    text = args.get("text", "")
    return {
        "output": f"{len(text.split())} words, {len(text.splitlines())} lines, {len(text)} chars",
        "exit_code": 0,
    }


register_tool(ToolSpec(
    name="word_count",
    description="Count the words, lines, and characters in some text.",
    parameters={
        "type": "object",
        "properties": {"text": {"type": "string", "description": "Text to measure"}},
        "required": ["text"],
    },
    aliases=["wc", "count_words"],
    prompt=(
        "```word_count\n"
        "<text to measure>\n"
        "```\n"
        "Count words, lines, and characters in the given text."
    ),
    execute=_word_count,
    # No custom `parse`/`serialize` needed: the default accepts a JSON object
    # (hosted models' tool_calls) OR maps the whole fenced block to the first
    # required param (local models), and round-trips both ways. Override them
    # only for multi-field fenced formats (see edit_file's OLD/NEW block).
    permission="user",   # or "admin" to gate behind admin users
    tags=["text", "example"],
))
