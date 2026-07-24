# Facet Core (`@facet/core`)

The built-in extension that ships embedded in every Facet binary. It provides
the default context items, strategies, and slash commands — everything the app
can do out of the box is delivered through this one extension.

It is also the **reference example** of a well-formed Facet Extension: it is a
self-contained directory with a manifest at its root and capability files under
`context-items/`, `strategies/`, and `commands/`, and it imports the public SDK
exclusively via `facet/*` specifiers — exactly like any third-party extension
installed under `~/.facet/extensions/`. Nothing here reaches into app internals
that a third-party extension couldn't also reach.

## Layout

```
facet-core/
  facet.extension.json   manifest: id, version, permissions, provided globs
  context-items/           tools the model can call (read_file, edit, bash, …)
    edit/  execute/  rules/   private helpers for specific context items
  strategies/              how the agent loop runs (default, plan, research)
  commands/                slash commands (/clear, /compact, /thread, …)
```

The manifest's `provides` block globs the capability files by kebab-case suffix
(`*-context-item.js`, `*-strategy-type.js`, `*-command-type.js`). Files that are
private helpers (no suffix, or nested under `edit/`, `execute/`, `rules/`) are
imported by capability files but are not themselves registered.

## Relationship to the SDK

The base classes a capability extends — `ContextItem`, `StrategyType`,
`CommandType` and friends — live in `web/sdk/` (the platform), **not** here. This
extension imports them as `facet/context-item`, `facet/strategy-type`, etc.,
through the import map declared in the host HTML. See `docs/extension_guide.md`
for the authoring guide.

## License

This extension (everything under `web/extensions/`) is licensed under
[Apache-2.0](../LICENSE) — fork it as the starting point for your own
extension, open or closed source, with no copyleft obligation. See
`LICENSING.md` at the repository root for the full licensing map.
