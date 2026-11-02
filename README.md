# MM Mapper

MM Mapper is a lightweight browser-based field mapping tool for comparing a source schema with a target schema and documenting the relationship between fields. It is designed for technical users who need to map data structures quickly without a heavy desktop application or backend setup.

## What it does

- Imports source and target schemas from JSON, XML, or XSD files
- Infers field structure from sample JSON and XML payloads
- Shows source and target trees side by side
- Lets you create mappings by click or drag-and-drop interaction
- Tracks mapped relationships and shows them in a central mapping list
- Exports the mapping result as portable JSON
- Saves the working session in browser storage so you can return to it later

## Features

- Searchable schema trees for both source and target sides
- Nested object support for hierarchical field paths
- Validation for imported schema files and mapping data
- Sample customer migration data built in for quick testing
- Mapping export that works in modern browsers with download support

## Project structure

```text
.
├── LICENSE
├── README.md
├── index.html
├── index.js
├── state.js
└── ui.js

```

### File overview

- `index.html` — application layout and UI elements
- `index.js` — schema parsing, mapping rules, and import/export data
- `state.js` — application state and mutation, built-in sample schemas/mappings and sample loading, and browser workspace persistence
- `ui.js` — DOM rendering, event interpretation, file selection/reading, downloads, dialogs, toasts, and connector drawing; passes datasets and plain file contents to the core
- `LICENSE` — project licensing information

## Supported inputs

### Schema sources

- JSON schema-like objects
- JSON payloads with nested structure inference
- XML samples
- XSD files

### Mapping export

- JSON mapping export in a native format

## Typical workflow

### Simple flow

1. Import a source schema.
2. Import a target schema.
3. Select a source field and choose the matching target field.
4. Review the mappings in the mapping list.
5. Export the mapping JSON when ready.

### Mapping chain flow

1. Import a source schema and the first target schema.
2. Add target levels with **Add target level**, or insert a level between existing levels.
3. For each adjacent pair of levels, select a field on the left and choose its matching field on the right. Continue mapping from each intermediate level to the next.
4. Review each adjacent-level mapping in its mapping list, then review the stitched paths across all levels in the **Mapping chain** panel.
5. Export the mapping JSON when ready.

## Browser considerations

This app depends on browser APIs such as:

- `FileReader` for importing files
- `localStorage` for saved workspaces
- `showSaveFilePicker` when supported, with a fallback download flow

Use a modern browser such as Chrome, Edge, or Firefox for the best experience.

## License

This project is released into the public domain under the Unlicense terms included in the `LICENSE` file.
