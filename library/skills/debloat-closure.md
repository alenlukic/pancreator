# Debloat closure

Use when removing harness facilities an operator selected from a debloat scan,
and the content those facilities exclusively own.

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC
2119 meanings.

## What the manifest means

`pan debloat impact` writes `runtime/debloat/<session-id>/closure.json`. It has
four parts and they are not interchangeable.

- `remove` lists paths to delete. Each entry names the facility that owns it
  and whether it is a facility definition or a test dedicated to removed
  facilities.
- `edit` lists files that survive but still name a removed facility. A registry
  row, an index line, a dispatch case, a grammar line, and a model mapping all
  land here. Each entry names the removed facilities that file references.
- `retained_because` lists facilities the cascade considered and spared, with
  the surviving referrer that saved each one. Read it to understand why a
  facility you expected to go is still present.
- `cascaded` lists facilities beyond the operator selection that the closure
  added because nothing surviving referenced them.

## Adjudication

The closure comes from a static reference graph. The graph reads paths and
identifiers, so three kinds of reference are invisible to it. Each one produces
a removal that looks safe and is not. Check all three before deleting anything,
and record what you found for each.

**Run-time paths.** A TypeScript expression such as
`path.join(directory, `${persona}.md`)` or a template literal that builds a
policy identifier produces no literal edge. Search the source for template
literals and variable interpolation that could reach a removed path. Grep the
removed facility's bare name across `src/` and `bin/` and read each hit.

**Prose references.** A file can name a facility in words without writing its
path or its identifier: "the hypervisor brief", "the investigation card". Read
the neighbors of each removed facility, meaning the files that reference it and
the files it references, for descriptions that stand in for its name.

**Unnamed test coupling.** A test can exercise a facility without naming its
path, so it is neither a dedicated test nor an edit. The full suite is the only
detector. Run it after the removal and attribute every failure before you
accept the closure.

When adjudication finds a reference the graph missed, keep the file. Record the
file, the reference, and the facility it protects in your outcome. Do not
delete it on the strength of the manifest.

## Order of work

1. Read the whole manifest before editing.
2. Adjudicate the three categories above and write down the exceptions.
3. Delete the `remove` paths you did not except.
4. Repair each `edit` entry. Drop only the removed facility's own entry and
   leave the rest of the file intact.
5. Run `pan models --sync` so the projected Cursor agents, commands, and rules
   match the sources that remain.
6. Run the configuration profile, the type check, and the full profile from
   `runtime/repository-checks.json`. Attribute every failure to the removal or
   to a condition that predates it.
7. Run `pan debloat verify --session <id>`. It fails while a listed path
   survives or a file still names a removed facility.

## Reporting

Return Markdown with four sections: what you deleted, what you repaired, what
you spared and the reference that saved it, and the result of each check. Name
every exception you took to the manifest. A removal that left a check failing
is reported as incomplete, never as success.
