"""Data-driven tool registry + plugin loader.

Historically, adding an agent tool to Odysseus meant editing SIX files
(tool_schemas, tool_parsing, agent_tools, agent_loop, tool_execution,
tool_index). That is brittle and not crowdsource-friendly.

This module collapses that into a single declaration. Define one `ToolSpec`
and call `register_tool(spec)` (or drop a plugin under `plugins/`), and the
tool is wired into every registry automatically — for both the native
tool_calls path (hosted models) and the fenced-code-block path (local models
like Ollama/qwen3).

A "plugin" is just a folder under `plugins/` containing a `plugin.py` that
imports `register_tool`/`ToolSpec` and registers one or more tools. Plugins can
live in their own repos and be dropped in — no fork of Odysseus core required.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# name -> ToolSpec. execute_tool_block consults this for execution; the other
# registries are mutated in-place by register_tool() so existing call sites
# (prompt assembly, fenced parsing, native schemas, permission gates) pick the
# tool up with no changes.
REGISTRY: Dict[str, "ToolSpec"] = {}


@dataclass
class ToolSpec:
    """One declarative tool definition. The only thing a plugin author writes."""
    name: str
    description: str
    execute: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]
    # JSON Schema for the tool's arguments (native tool_calls path).
    parameters: Dict[str, Any] = field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    aliases: List[str] = field(default_factory=list)
    # Prompt snippet teaching the fenced format to local models (optional but
    # strongly recommended — without it local models won't know the tool).
    prompt: str = ""
    permission: str = "user"            # "user" | "admin"
    # fenced content (string) -> args dict. Defaults to JSON-or-single-arg.
    parse: Optional[Callable[[str], Dict[str, Any]]] = None
    # native args dict -> fenced content string (for the tool_calls converter).
    serialize: Optional[Callable[[Dict[str, Any]], str]] = None
    tags: List[str] = field(default_factory=list)

    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def parse_content(self, content: str) -> Dict[str, Any]:
        if self.parse is not None:
            return self.parse(content)
        return _default_parse(self, content)

    def serialize_args(self, args: Dict[str, Any]) -> str:
        if self.serialize is not None:
            return self.serialize(args)
        # Default: JSON so parse_content's JSON branch round-trips it.
        return json.dumps(args)


def _default_parse(spec: ToolSpec, content: str) -> Dict[str, Any]:
    """Best-effort args from fenced content: JSON object if it looks like one,
    else map the whole (stripped) content to the single/first declared param."""
    text = (content or "").strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return data
        except (ValueError, TypeError):
            pass
    props = list((spec.parameters or {}).get("properties", {}).keys())
    required = (spec.parameters or {}).get("required", [])
    key = (required[0] if required else (props[0] if props else "input"))
    return {key: text}


def register_tool(spec: ToolSpec) -> None:
    """Wire a ToolSpec into every registry. Idempotent per name (re-register
    replaces). Safe to call at startup after the tool modules are imported."""
    if not spec.name or not callable(spec.execute):
        raise ValueError("ToolSpec needs a name and an async execute() callable")

    REGISTRY[spec.name] = spec

    # Mutate the scattered registries in place. Imported lazily so this module
    # stays import-light and avoids cycles.
    try:
        import src.tool_schemas as _ts
        # de-dup: drop any prior schema with this name before appending
        _ts.FUNCTION_TOOL_SCHEMAS[:] = [
            s for s in _ts.FUNCTION_TOOL_SCHEMAS
            if s.get("function", {}).get("name") != spec.name
        ]
        _ts.FUNCTION_TOOL_SCHEMAS.append(spec.to_openai_schema())
    except Exception as e:  # never let one registry failure break registration
        logger.debug("tool_schemas registration skipped for %s: %s", spec.name, e)

    try:
        import src.tool_parsing as _tp
        _tp._TOOL_NAME_MAP[spec.name] = spec.name
        for a in spec.aliases:
            # don't clobber an existing alias that points elsewhere
            if a not in _tp._TOOL_NAME_MAP:
                _tp._TOOL_NAME_MAP[a] = spec.name
    except Exception as e:
        logger.debug("tool_parsing registration skipped for %s: %s", spec.name, e)

    try:
        import src.agent_tools as _at
        _at.TOOL_TAGS.add(spec.name)
    except Exception as e:
        logger.debug("agent_tools registration skipped for %s: %s", spec.name, e)

    if spec.prompt:
        try:
            import src.agent_loop as _al
            _al.TOOL_SECTIONS[spec.name] = spec.prompt
        except Exception as e:
            logger.debug("agent_loop prompt registration skipped for %s: %s", spec.name, e)

    if spec.permission == "admin":
        try:
            import src.tool_execution as _te
            _te._ADMIN_TOOLS.add(spec.name)
        except Exception as e:
            logger.debug("admin gate registration skipped for %s: %s", spec.name, e)

    try:
        from src import tool_index as _ti
        if hasattr(_ti, "BUILTIN_TOOL_DESCRIPTIONS"):
            _ti.BUILTIN_TOOL_DESCRIPTIONS[spec.name] = spec.description
    except Exception as e:
        logger.debug("tool_index registration skipped for %s: %s", spec.name, e)

    logger.info("Registered tool '%s' (permission=%s)", spec.name, spec.permission)


def plugins_dir() -> str:
    return os.environ.get(
        "ODYSSEUS_PLUGINS_DIR",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "plugins"),
    )


def load_plugins(directory: Optional[str] = None) -> int:
    """Import every plugin under `directory` so their register_tool() calls run.

    A plugin is a subfolder with a `plugin.py`, or a top-level `*_plugin.py`.
    Returns the number of plugin modules loaded. Best-effort: a broken plugin is
    logged and skipped, never crashes startup.
    """
    import importlib.util

    directory = directory or plugins_dir()
    if not os.path.isdir(directory):
        return 0
    loaded = 0
    candidates: List[str] = []
    for entry in sorted(os.listdir(directory)):
        full = os.path.join(directory, entry)
        if os.path.isdir(full):
            pf = os.path.join(full, "plugin.py")
            if os.path.isfile(pf):
                candidates.append(pf)
        elif entry.endswith("_plugin.py"):
            candidates.append(full)
    for path in candidates:
        mod_name = "odysseus_plugin_" + os.path.splitext(os.path.basename(os.path.dirname(path) or path))[0]
        try:
            spec = importlib.util.spec_from_file_location(mod_name, path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # runs register_tool() calls
            loaded += 1
            logger.info("Loaded plugin: %s", path)
        except Exception as e:
            logger.error("Failed to load plugin %s: %s", path, e)
    if loaded:
        logger.info("Plugin loader: %d plugin module(s), %d tool(s) total in registry", loaded, len(REGISTRY))
    return loaded
