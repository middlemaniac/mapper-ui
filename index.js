import { createWorkspaceStore } from "./state.js";
import { createMapperView } from "./ui.js";

const workspaceStore = createWorkspaceStore({ validateSchema, resolveExistingMappings });
const state = workspaceStore.state;
const view = createMapperView(state, { fieldMap });

function flattenFields(schema, parentPath = schema.root, result = []) {
  for (const field of schema.fields) {
    const path = `${parentPath}.${field.name}`;
    if (field.children && field.children.length) flattenFields({ fields: field.children }, path, result);
    else result.push({ ...field, path });
  }
  return result;
}

function fieldMap(schema) {
  return new Map(flattenFields(schema).map((field) => [field.path, field]));
}

function refreshTrees() { view.refreshTrees(); }
function showToast(message, isError = false) { view.showToast(message, isError); }
function requestConfirmation(title, message, confirmLabel) {
  return view.requestConfirmation(title, message, confirmLabel);
}
function renderAll() {
  view.renderAll();
  const warning = workspaceStore.save(state);
  if (warning) showToast(warning, true);
}

function hasAnyWorkspaceData() {
  return state.levels.some((level) => level.fields.length) || state.links.some((link) => link.mappings.length);
}

function loadSampleData() {
  view.openSampleDialog(workspaceStore.getSamples());
}

async function selectSample(sampleId) {
  view.hideOverlay(false);
  const sample = workspaceStore.getSamples().find((item) => item.id === sampleId);
  if (!sample) return false;
  if (hasAnyWorkspaceData() &&
      !await requestConfirmation("Replace workspace with sample data?", "Loading sample data will replace the current schemas and mappings.", "Load sample data")) {
    return false;
  }
  workspaceStore.loadSampleData(sampleId);
  view.resetSearch();
  renderAll();
  showToast(`Loaded the ${sample.name} sample.`);
  return true;
}

async function clearAll() {
  const hasExtraLevels = state.levels.length > 2;
  if (!hasAnyWorkspaceData() && !hasExtraLevels) return false;
  if (!await requestConfirmation("Clear all schemas and mappings?", "This will clear every schema and mapping and remove any additional target levels.", "Clear all")) {
    return false;
  }
  workspaceStore.clearWorkspace();
  view.resetSearch();
  renderAll();
  showToast("All schemas, mappings, and additional target levels cleared.");
  return true;
}

function totalMappingCount() {
  return state.links.reduce((sum, link) => sum + link.mappings.length, 0);
}

async function clearSchema(levelIndex) {
  const level = state.levels[levelIndex];
  if (!level || !level.fields.length) return;
  const affected = (state.links[levelIndex - 1]?.mappings.length || 0) + (state.links[levelIndex]?.mappings.length || 0);
  if (affected &&
      !await requestConfirmation(`Clear ${level.label} schema?`, `This will also remove ${affected} mapping${affected === 1 ? "" : "s"} connected to it.`, `Clear ${level.label} schema`)) {
    return;
  }
  workspaceStore.clearSchema(levelIndex);
  view.resetSearch();
  renderAll();
  showToast(`Cleared the ${level.label} schema.`);
}

function createMapping(linkIndex, sourcePath, targetPath) {
  const fromSchema = state.levels[linkIndex];
  const toSchema = state.levels[linkIndex + 1];
  if (!fieldMap(fromSchema).has(sourcePath) || !fieldMap(toSchema).has(targetPath)) {
    showToast("Could not find that field in the current schema.", true);
    return;
  }
  const existing = state.links[linkIndex].mappings.find((mapping) => mapping.targetPath === targetPath);
  if (existing) {
    workspaceStore.update({ selectedField: null });
    renderAll();
    showToast("This target is already mapped. Remove its existing mapping first.", true);
    return;
  }
  workspaceStore.addMapping(linkIndex, {
    id: `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourcePath, targetPath
  });
  workspaceStore.update({ selectedField: null, selectedMapping: null, selectedChain: null });
  renderAll();
  showToast(`${fieldMap(fromSchema).get(sourcePath).name} mapped to ${fieldMap(toSchema).get(targetPath).name}`);
}

function handleFieldClick(levelIndex, path) {
  const selected = state.selectedField;
  if (selected && selected.levelIndex === levelIndex - 1) {
    createMapping(levelIndex - 1, selected.path, path);
    return;
  }
  const isLastLevel = levelIndex === state.levels.length - 1;
  if (isLastLevel) {
    showToast("Select a field on the level to its left first.", true);
    return;
  }
  workspaceStore.update({
    selectedField: selected && selected.levelIndex === levelIndex && selected.path === path ? null : { levelIndex, path },
    selectedMapping: null,
    selectedChain: null
  });
  refreshTrees();
}

async function addLevel() {
  workspaceStore.addLevel();
  renderAll();
  showToast("Added a new target level.");
}

async function insertLevel(linkIndex) {
  const link = state.links[linkIndex];
  if (!link) return;
  if (link.mappings.length &&
      !await requestConfirmation("Insert target level here?", `This will remove ${link.mappings.length} mapping${link.mappings.length === 1 ? "" : "s"} between ${state.levels[linkIndex].label} and ${state.levels[linkIndex + 1].label}.`, "Insert target level")) {
    return;
  }
  workspaceStore.addLevel(linkIndex + 1);
  renderAll();
  showToast("Inserted a new target level.");
}

async function removeLevel(levelIndex) {
  const level = state.levels[levelIndex];
  if (!level) return;
  const affected = (state.links[levelIndex - 1]?.mappings.length || 0) + (state.links[levelIndex]?.mappings.length || 0);
  if (affected &&
      !await requestConfirmation(`Remove ${level.label}?`, `This will also remove ${affected} mapping${affected === 1 ? "" : "s"} connected to it.`, "Remove level")) {
    return;
  }
  workspaceStore.removeLevel(levelIndex);
  renderAll();
  showToast(`Removed ${level.label}.`);
}

function validateSchema(schema, label) {
  if (!schema || typeof schema !== "object" || typeof schema.name !== "string" ||
      typeof schema.root !== "string" || !Array.isArray(schema.fields)) {
    throw new Error(`${label} schema must include a name, root, and fields array.`);
  }
  function visit(fields, parent, seen) {
    for (const field of fields) {
      if (!field || typeof field.name !== "string" || !field.name.trim() ||
          typeof field.type !== "string" || !field.type.trim()) {
        throw new Error(`${label} schema contains a field without a name or type.`);
      }
      const path = `${parent}.${field.name}`;
      if (seen.has(path)) throw new Error(`${label} schema contains a duplicate field: ${path}`);
      seen.add(path);
      if (field.children !== undefined) {
        if (!Array.isArray(field.children) || !field.children.length) throw new Error(`${label} schema has invalid children for ${field.name}.`);
        visit(field.children, path, seen);
      }
    }
  }
  visit(schema.fields, schema.root, new Set());
}

function fileBaseName(fileName) {
  return fileName.replace(/\.[^.]+$/, "") || "Imported schema";
}

function inferJsonField(name, value) {
  if (Array.isArray(value)) {
    const example = value.find((item) => item !== null && item !== undefined);
    if (example && typeof example === "object") {
      const children = inferJsonFields(example);
      return { name, type: "array", ...(children.length ? { children } : {}) };
    }
    return { name, type: example === undefined ? "array" : `array<${inferJsonType(example)}>` };
  }
  if (value && typeof value === "object") {
    const children = inferJsonFields(value);
    return { name, type: "object", ...(children.length ? { children } : {}) };
  }
  return { name, type: inferJsonType(value) };
}

function inferJsonType(value) {
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function inferJsonFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Sample JSON must contain an object at its root.");
  }
  return Object.entries(value).map(([name, fieldValue]) => inferJsonField(name, fieldValue));
}

function schemaFromJson(data, fileName) {
  const name = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : fileBaseName(fileName);
  if (data && typeof data === "object" && !Array.isArray(data) &&
      typeof data.root === "string" && Array.isArray(data.fields)) {
    const schema = { name, root: data.root, fields: data.fields };
    validateSchema(schema, "Imported");
    return schema;
  }
  let root = fileBaseName(fileName).replace(/[^A-Za-z0-9_$-]/g, "_") || "root";
  let sample = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const entries = Object.entries(data);
    if (entries.length === 1 && entries[0][1] && typeof entries[0][1] === "object" && !Array.isArray(entries[0][1])) {
      [root, sample] = entries[0];
    }
  }
  const schema = { name, root, fields: inferJsonFields(sample) };
  validateSchema(schema, "Imported");
  return schema;
}

function xmlAttribute(node, name) {
  return node.attributes.find((attribute) => attribute.name === name || attribute.localName === name)?.value || "";
}

function xmlDescendants(node, localName) {
  const descendants = [];
  function visit(parent) {
    for (const child of parent.children) {
      if (!localName || child.localName === localName) descendants.push(child);
      visit(child);
    }
  }
  if (node) visit(node);
  return descendants;
}

function xsdType(element, schemaElement) {
  const declaredType = xmlAttribute(element, "type");
  const inlineType = element.children.find((child) => child.localName === "simpleType");
  const restriction = inlineType && xmlDescendants(inlineType, "restriction")[0];
  const base = (restriction && xmlAttribute(restriction, "base")) || declaredType;
  const localType = base.split(":").pop().toLowerCase();
  const maxOccurs = xmlAttribute(schemaElement, "maxOccurs");
  if (maxOccurs === "unbounded" || Number(maxOccurs) > 1) return "array";
  if (["boolean"].includes(localType)) return "boolean";
  if (["byte", "short", "int", "integer", "long", "nonnegativeinteger", "positiveinteger"].includes(localType)) return "integer";
  if (["decimal", "float", "double"].includes(localType)) return "number";
  if (["date", "time", "datetime"].includes(localType)) return "datetime";
  return "string";
}

function parseXsd(xmlDocument, fileName) {
  if (!xmlDocument || xmlDocument.hasParseError) throw new Error("The selected XSD is not valid XML.");
  const root = xmlDocument.root;
  const xsd = xmlDescendants(root, "schema")[0] || (root?.localName === "schema" ? root : null);
  if (!xsd) throw new Error("The selected XML file does not contain an XSD schema.");
  const globalElements = xsd.children.filter((node) => node.localName === "element" && xmlAttribute(node, "name"));
  const rootElement = globalElements[0];
  if (!rootElement) throw new Error("The XSD needs a named top-level element.");
  const namedTypes = new Map(xsd.children
    .filter((node) => node.localName === "complexType" && xmlAttribute(node, "name"))
    .map((node) => [xmlAttribute(node, "name"), node]));

  function elementFields(element) {
    const inline = element.children.find((child) => child.localName === "complexType");
    const declaredName = xmlAttribute(element, "type").split(":").pop();
    const complex = inline || namedTypes.get(declaredName);
    if (!complex) return [];
    const fields = [];
    function visit(node) {
      for (const child of node.children) {
        if (child.localName === "element" && xmlAttribute(child, "name")) {
          const name = xmlAttribute(child, "name");
          const nested = elementFields(child);
          const type = nested.length ? "object" : xsdType(child, xsd);
          fields.push({ name, type, ...(nested.length ? { children: nested } : {}) });
        } else if (["sequence", "all", "choice"].includes(child.localName)) {
          visit(child);
        }
      }
    }
    visit(complex);
    for (const attribute of complex.children.filter((node) => node.localName === "attribute" && xmlAttribute(node, "name"))) {
      fields.push({ name: `@${xmlAttribute(attribute, "name")}`, type: xsdType(attribute, xsd) });
    }
    return fields;
  }

  const schemaRoot = xmlAttribute(rootElement, "name");
  const schema = { name: fileBaseName(fileName), root: schemaRoot, fields: elementFields(rootElement) };
  validateSchema(schema, "XSD");
  return schema;
}

function inferXmlType(values) {
  const samples = values.map((value) => value.trim()).filter(Boolean);
  if (!samples.length) return "string";
  const types = samples.map((value) => {
    if (/^(true|false)$/i.test(value)) return "boolean";
    if (/^[+-]?\d+$/.test(value)) return "integer";
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return "number";
    if (/^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.+-]+Z?)?$/.test(value)) return "datetime";
    return "string";
  });
  return types.every((type) => type === types[0]) ? types[0] : "string";
}

function parseXmlSample(xmlDocument, fileName) {
  if (!xmlDocument || xmlDocument.hasParseError) throw new Error("The selected sample XML is not valid XML.");
  const rootElement = xmlDocument.root;
  if (!rootElement || rootElement.localName === "parsererror") throw new Error("The selected XML file is empty.");
  const xmlSchemaInstanceNamespace = "http://www.w3.org/2001/XMLSchema-instance";

  function localName(node) {
    return node.localName || node.nodeName.split(":").pop();
  }

  function isDataAttribute(attribute) {
    return attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/" &&
      attribute.namespaceURI !== xmlSchemaInstanceNamespace;
  }

  function fieldsFor(parents) {
    const fields = [];
    const attributes = new Map();
    const childGroups = new Map();
    const repeatedChildren = new Set();

    for (const parent of parents) {
      for (const attribute of parent.attributes) {
        if (!isDataAttribute(attribute)) continue;
        const name = `@${localName(attribute)}`;
        if (!attributes.has(name)) attributes.set(name, []);
        attributes.get(name).push(attribute.value);
      }

      const counts = new Map();
      for (const child of parent.children) {
        const name = localName(child);
        if (!childGroups.has(name)) childGroups.set(name, []);
        childGroups.get(name).push(child);
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      for (const [name, count] of counts) {
        if (count > 1) repeatedChildren.add(name);
      }
    }

    for (const [name, values] of attributes) {
      fields.push({ name, type: inferXmlType(values) });
    }

    for (const [name, elements] of childGroups) {
      const children = fieldsFor(elements);
      const textValues = elements.map((element) => element.textNodes.join(""));
      const hasTextContent = textValues.some((value) => value.trim());
      const hasStructuredContent = elements.some((element) =>
        element.children.length > 0 || element.attributes.some(isDataAttribute)
      );
      if (hasStructuredContent && hasTextContent) {
        children.push({ name: "#text", type: inferXmlType(textValues) });
      }
      const baseType = children.length ? "object" : inferXmlType(textValues);
      fields.push({
        name,
        type: repeatedChildren.has(name) ? "array" : baseType,
        ...(children.length ? { children } : {})
      });
    }
    return fields;
  }

  const schema = {
    name: fileBaseName(fileName),
    root: localName(rootElement),
    fields: fieldsFor([rootElement])
  };
  validateSchema(schema, "Sample XML");
  return schema;
}

function resolveExistingMappings(mappings, sourceSchema, targetSchema) {
  const sourcePaths = new Set(flattenFields(sourceSchema).map((field) => field.path));
  const targetPaths = new Set(flattenFields(targetSchema).map((field) => field.path));
  const usedTargets = new Set();
  return mappings.map((mapping, index) => {
    if (!mapping || typeof mapping.targetPath !== "string") {
      throw new Error(`Mapping ${index + 1} needs a targetPath.`);
    }
    if (Array.isArray(mapping.sourcePaths) && mapping.sourcePaths.length !== 1) {
      throw new Error(`Mapping ${index + 1} must connect exactly one source field. Multi-source mappings are no longer supported.`);
    }
    const sourcePath = Array.isArray(mapping.sourcePaths) ? mapping.sourcePaths[0] : mapping.sourcePath;
    if (typeof sourcePath !== "string" || !sourcePaths.has(sourcePath)) {
      throw new Error(`Mapping ${index + 1} refers to source field "${sourcePath}", which is not in the currently loaded source schema${sourceSchema.root ? ` "${sourceSchema.root}"` : ""}.`);
    }
    if (!targetPaths.has(mapping.targetPath)) {
      throw new Error(`Mapping ${index + 1} refers to target field "${mapping.targetPath}", which is not in the currently loaded target schema${targetSchema.root ? ` "${targetSchema.root}"` : ""}.`);
    }
    if (usedTargets.has(mapping.targetPath)) throw new Error(`More than one mapping points to ${mapping.targetPath}.`);
    usedTargets.add(mapping.targetPath);
    return {
      id: `import-${Date.now()}-${index}`,
      sourcePath,
      targetPath: mapping.targetPath
    };
  });
}

function keepMappingsForLink(mappings, sourceSchema, targetSchema) {
  const sourcePaths = new Set(flattenFields(sourceSchema).map((field) => field.path));
  const targetPaths = new Set(flattenFields(targetSchema).map((field) => field.path));
  const remaining = mappings.filter((mapping) => sourcePaths.has(mapping.sourcePath) && targetPaths.has(mapping.targetPath));
  return { mappings: remaining, removed: mappings.length - remaining.length };
}

async function importSchemaFile(text, fileName, levelIndex, xmlDocument) {
  const level = state.levels[levelIndex];
  const side = level.kind;
  try {
    let schema;
    const isXsd = /\.xsd$/i.test(fileName) ||
      (xmlDocument?.root?.localName === "schema" && xmlDocument.root.namespaceURI === "http://www.w3.org/2001/XMLSchema");
    if (isXsd) {
      schema = parseXsd(xmlDocument, fileName);
    } else if (xmlDocument) {
      schema = parseXmlSample(xmlDocument, fileName);
    } else {
      const data = JSON.parse(text);
      const schemaData = data?.format === "fieldwork-schema"
        ? data.schema
        : data;
      schema = schemaFromJson(schemaData, fileName);
    }
    const replacementLevel = { ...level, ...schema };
    let removed = 0;
    const incoming = state.links[levelIndex - 1];
    if (incoming) {
      const result = keepMappingsForLink(incoming.mappings, state.levels[levelIndex - 1], replacementLevel);
      workspaceStore.setLinkMappings(levelIndex - 1, result.mappings);
      removed += result.removed;
    }
    const outgoing = state.links[levelIndex];
    if (outgoing) {
      const result = keepMappingsForLink(outgoing.mappings, replacementLevel, state.levels[levelIndex + 1]);
      workspaceStore.setLinkMappings(levelIndex, result.mappings);
      removed += result.removed;
    }
    workspaceStore.replaceSchema(levelIndex, schema);
    workspaceStore.update({ selectedField: null, selectedMapping: null, selectedChain: null });
    view.resetSearch();
    renderAll();
    showToast(removed
      ? `Loaded ${schema.name}; removed ${removed} mapping${removed === 1 ? "" : "s"} that referenced missing fields.`
      : `Loaded ${schema.name} as the ${level.label} schema.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : `Could not load the ${level.label} schema.`, true);
  }
}

async function importMappingFile(linkIndex, text) {
  const fromSchema = state.levels[linkIndex];
  const toSchema = state.levels[linkIndex + 1];
  try {
    if (!fromSchema.fields.length || !toSchema.fields.length) {
      throw new Error(`Import both ${fromSchema.label} and ${toSchema.label} schemas before loading mappings.`);
    }
    const data = JSON.parse(text);
    if (!data || data.format !== "fieldwork-mappings" || !Array.isArray(data.mappings)) {
      throw new Error("Unsupported mapping file. Choose Fieldwork mapping JSON.");
    }
    const mappings = resolveExistingMappings(data.mappings, fromSchema, toSchema);
    workspaceStore.setLinkMappings(linkIndex, mappings);
    workspaceStore.update({ selectedField: null, selectedMapping: null, selectedChain: null });
    renderAll();
    showToast(`Imported ${mappings.length} mapping${mappings.length === 1 ? "" : "s"} for the loaded schemas.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not import the mapping file.", true);
  }
}

function mappingExportData(linkIndex) {
  return {
    format: "fieldwork-mappings",
    exportedAt: new Date().toISOString(),
    schemasIncluded: false,
    mappings: state.links[linkIndex].mappings.map((mapping) => ({
      sourcePath: mapping.sourcePath,
      targetPath: mapping.targetPath
    }))
  };
}

function openMappingExport(linkIndex) {
  if (!state.links[linkIndex].mappings.length) return;
  view.showExportPreview(`${JSON.stringify(mappingExportData(linkIndex), null, 2)}\n`, {
    title: "Export mapping",
    filename: `fieldwork-link-${linkIndex + 1}-mappings.json`
  });
}

function openExportAll() {
  if (!state.links.some((link) => link.mappings.length)) return;
  const data = {
    format: "fieldwork-workspace-mappings",
    exportedAt: new Date().toISOString(),
    schemasIncluded: false,
    levels: state.levels.map((level) => ({
      label: level.label,
      kind: level.kind,
      schemaName: level.name,
      root: level.root || null
    })),
    links: state.links.map((link, linkIndex) => ({
      sourceLevel: state.levels[linkIndex].label,
      targetLevel: state.levels[linkIndex + 1].label,
      mappings: link.mappings.map(({ sourcePath, targetPath }) => ({ sourcePath, targetPath }))
    }))
  };
  view.showExportPreview(`${JSON.stringify(data, null, 2)}\n`, {
    title: "Export all mappings",
    filename: "fieldwork-workspace-mappings.json"
  });
}

async function importAllMappings(text) {
  try {
    const data = JSON.parse(text);
    if (!data || data.format !== "fieldwork-workspace-mappings" ||
      !Array.isArray(data.levels) || !Array.isArray(data.links)) {
      throw new Error("Unsupported file. Choose a workspace mappings JSON exported via \"Export all mappings\".");
    }
    if (data.levels.length < 2) {
      throw new Error("The workspace mappings file must include at least a source and target level.");
    }
    if (data.links.length !== data.levels.length - 1) {
      throw new Error("The workspace mappings file must include one link between each adjacent level.");
    }
    if (data.links.some((link) => !link || !Array.isArray(link.mappings))) {
      throw new Error("Every workspace link must include a mappings array.");
    }
    let importedLevels = null;
    if (data.schemasIncluded === true) {
      const multipleTargets = data.levels.filter((level) => level?.kind === "target").length > 1;
      let targetIndex = 0;
      importedLevels = data.levels.map((level, index) => {
        if (!level || !level.schema || !["source", "target"].includes(level.kind)) {
          throw new Error(`Level ${index + 1} must include a schema and a valid kind.`);
        }
        validateSchema(level.schema, `Imported ${level.label || `level ${index + 1}`}`);
        const label = level.kind === "source" ? "Source" : multipleTargets ? `Target level ${++targetIndex}` : "Target";
        return { kind: level.kind, label, ...level.schema };
      });
      if (!importedLevels.length || importedLevels[0].kind !== "source" || importedLevels.slice(1).some((level) => level.kind !== "target")) {
        throw new Error("The imported workspace must start with one source level followed by target levels.");
      }
    }
    if ((hasAnyWorkspaceData() || (importedLevels && state.levels.length > 2)) &&
        !await requestConfirmation(
          importedLevels ? "Replace workspace schemas and mappings?" : "Replace all mappings?",
          importedLevels
            ? "This will replace the schemas and mappings in the current workspace."
            : "This will replace the mappings on every link with the ones from the imported file.",
          "Import all"
        )) {
      return false;
    }
    if (importedLevels) workspaceStore.replaceLevels(importedLevels);
    while (state.levels.length < data.levels.length) workspaceStore.addLevel();
    while (state.levels.length > data.levels.length) workspaceStore.removeLevel(state.levels.length - 1);
    let totalImported = 0;
    let totalSkipped = 0;
    data.links.forEach((linkData, linkIndex) => {
      const fromSchema = state.levels[linkIndex];
      const toSchema = state.levels[linkIndex + 1];
      if (!fromSchema || !toSchema) return;
      const sourcePaths = new Set(flattenFields(fromSchema).map((field) => field.path));
      const targetPaths = new Set(flattenFields(toSchema).map((field) => field.path));
      const usedTargets = new Set();
      const mappings = [];
      (linkData.mappings || []).forEach((mapping, index) => {
        if (mapping && sourcePaths.has(mapping.sourcePath) && targetPaths.has(mapping.targetPath) && !usedTargets.has(mapping.targetPath)) {
          usedTargets.add(mapping.targetPath);
          mappings.push({ id: `import-${Date.now()}-${linkIndex}-${index}`, sourcePath: mapping.sourcePath, targetPath: mapping.targetPath });
          totalImported += 1;
        } else {
          totalSkipped += 1;
        }
      });
      workspaceStore.setLinkMappings(linkIndex, mappings);
    });
    workspaceStore.update({ selectedField: null, selectedMapping: null, selectedChain: null, dragSource: null });
    view.resetSearch();
    renderAll();
    showToast(totalSkipped
      ? `Imported ${totalImported} mapping${totalImported === 1 ? "" : "s"}; skipped ${totalSkipped} that referenced fields not in the loaded schemas.`
      : `Imported ${totalImported} mapping${totalImported === 1 ? "" : "s"} across ${data.links.length} link${data.links.length === 1 ? "" : "s"}.`);
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not import the workspace mappings file.", true);
    return false;
  }
}

function handleDragStart(levelIndex, path) {
  workspaceStore.update({ dragSource: { levelIndex, path }, selectedField: { levelIndex, path } });
}

function handleDragEnd() { workspaceStore.update({ dragSource: null }); }

function handleDrop(levelIndex, path) {
  if (!state.dragSource || state.dragSource.levelIndex !== levelIndex - 1) return;
  createMapping(levelIndex - 1, state.dragSource.path, path);
  workspaceStore.update({ dragSource: null });
}

function removeMapping(linkIndex, id) {
  const mapping = workspaceStore.removeMapping(linkIndex, id);
  if (state.selectedMapping?.linkIndex === linkIndex && state.selectedMapping.id === id) {
    workspaceStore.update({ selectedMapping: null });
  }
  renderAll();
  showToast(mapping ? `Removed mapping for ${mapping.sourcePath.split(".").pop()}.` : "Mapping removed.");
}

function selectMapping(linkIndex, id) {
  const isSame = state.selectedMapping?.linkIndex === linkIndex && state.selectedMapping.id === id;
  workspaceStore.update({ selectedMapping: isSame ? null : { linkIndex, id } });
  view.renderLinkMappings(linkIndex);
  view.drawConnectors();
}

function selectChain(segments) {
  const isSame = state.selectedChain?.length === segments.length &&
    state.selectedChain.every((selected, index) => selected.linkIndex === segments[index].linkIndex && selected.id === segments[index].id);
  workspaceStore.update({ selectedChain: isSame ? null : segments });
  view.renderEndToEndMappings();
  view.drawConnectors();
}

function clearMappings(linkIndex) {
  const link = state.links[linkIndex];
  if (!link.mappings.length) return;
  workspaceStore.setLinkMappings(linkIndex, []);
  workspaceStore.update({ selectedMapping: null, selectedField: null, selectedChain: null });
  renderAll();
  showToast("Mappings cleared for this link.");
}

function importMappingsRequest(linkIndex) {
  const fromSchema = state.levels[linkIndex];
  const toSchema = state.levels[linkIndex + 1];
  if (!fromSchema.fields.length || !toSchema.fields.length) {
    showToast("Import both schemas for this link before importing a mapping file.", true);
    return;
  }
  view.requestMappingFile(linkIndex);
}

function clearSelection() {
  if (!state.selectedField && !state.selectedMapping && !state.selectedChain) return;
  workspaceStore.update({ selectedField: null, selectedMapping: null, selectedChain: null });
  renderAll();
}

view.bind({
  onFieldClick: handleFieldClick,
  onDragStart: handleDragStart,
  onDragEnd: handleDragEnd,
  onDrop: handleDrop,
  onRemoveMapping: removeMapping,
  onSelectMapping: selectMapping,
  onSelectChain: selectChain,
  onClearMappings: clearMappings,
  onOpenExport: openMappingExport,
  onOpenExportAll: openExportAll,
  onAllMappingsFile: importAllMappings,
  onLoadSample: loadSampleData,
  onSelectSample: selectSample,
  onClearAll: clearAll,
  onImportMappings: importMappingsRequest,
  onClearSchema: clearSchema,
  onSchemaFile: (levelIndex, text, name, xmlDocument) => importSchemaFile(text, name, levelIndex, xmlDocument),
  onMappingFile: (linkIndex, text) => importMappingFile(linkIndex, text),
  onClearSelection: clearSelection,
  onAddLevel: addLevel,
  onInsertLevel: insertLevel,
  onRemoveLevel: removeLevel
});

const restoreResult = workspaceStore.restore(state);
renderAll();
if (restoreResult.error) showToast(restoreResult.error, true);
else if (restoreResult.restored) showToast("Restored your previous workspace from this browser.");