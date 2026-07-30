# Precipice

Precipice is a canvas-based workspace for turning product ideas into connected,
editable artifacts. The long-term goal is to make it easy to explore a product
concept as a living map of notes, journeys, wireframes, and AI-generated actions.

## Current state

This is an early walking skeleton rather than a finished product. The current
phase proves the main building blocks in standalone development harnesses:

- A React Flow canvas with objects, relationships, layout, selection, and undo.
- Note, Journey, and Wireframe object types with editable inspectors.
- Local persistence with autosave, action history, and `.scape` export/import.
- Early AI action and streaming foundations, including recorded fixtures for testing.

The main workspace and AI prompt flow are not connected yet. The screenshots below
show the current development surfaces and are intended to communicate progress,
not the final product experience.

## Screenshots

### Development harnesses

The route index collects the standalone surfaces used to exercise each workstream.

![Development harnesses](docs/screenshots/dev-harnesses.png)

### Object plugins

These views show the three supported object types, their visual treatments, scale
behavior, and the live inspector. Both light and dark themes are represented.

![Object plugins — dark theme](docs/screenshots/object-plugins-dark.png)

![Object plugins — light theme](docs/screenshots/object-plugins-light.png)

### Canvas

The canvas views show a connected fixture scape with automatic layout, typed nodes,
relationships, selection, and an action log. The canvas is currently a functional
development surface, not yet the complete product workspace.

![Canvas — dark theme](docs/screenshots/canvas-dark.png)

![Canvas — light theme](docs/screenshots/canvas-light.png)

### Persistence

The persistence view demonstrates local scapes, autosave, mutation history, and the
export/import workflow.

![Persistence harness](docs/screenshots/persistence-dark.png)

## What to expect next

Over the next few weeks, the focus is expected to be on:

- Connecting the existing canvas, objects, persistence, and AI pieces into one usable workspace.
- Adding the first end-to-end flow: create a scape, enter a prompt, and watch artifacts appear.
- Completing settings and API-key handling, then tightening error states and build reliability.
- Refining the interaction model and visual polish based on hands-on testing.

The project is intentionally being developed in small, testable phases. More features
will follow after the core workspace loop feels dependable.
