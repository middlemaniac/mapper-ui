import { createWorkspaceStore } from "./state.js";
import { createMapperView } from "./ui.js";

const workspaceStore = createWorkspaceStore({ validateSchema, resolveExistingMappings });
const state = workspaceStore.state;
const view = createMapperView(state, { fieldMap, mappingSourcePaths });

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

function mappingSourcePaths(mapping) {
  return [mapping.sourcePath];
}

function renderMappings() { view.renderMappings(); }
function drawConnectors() { view.drawConnectors(); }
function updateHint(message) { view.updateHint(message); }
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

async function loadSampleData() {
  if ((state.source.fields.length || state.target.fields.length || state.mappings.length) &&
      !await requestConfirmation("Replace workspace with sample data?", "Loading sample data will replace the current schemas and mappings.", "Load sample data")) {
    return false;
  }
  workspaceStore.loadSampleData();
  view.resetSearch();
  renderAll();
  showToast("Loaded the synthetic customer migration sample.");
  return true;
}

async function clearSchema(side) {
  const schema = side === "source" ? state.source : state.target;
  if (!schema.fields.length) return;
  if (state.mappings.length &&
      !await requestConfirmation(`Clear ${side} schema?`, `This will also remove all ${state.mappings.length} mapping${state.mappings.length === 1 ? "" : "s"}.`, `Clear ${side} schema`)) {
    return;
  }

  if (side === "source") {
    workspaceStore.update({ source: { name: "No source schema", root: "", fields: [] } });
    view.resetSearch();
    workspaceStore.update({ selectedSource: null });
  } else {
    workspaceStore.update({ target: { name: "No target schema", root: "", fields: [] } });
    view.resetSearch();
  }
  workspaceStore.update({ mappings: [], selectedMapping: null });
  renderAll();
  showToast(`Cleared the ${side} schema.`);
}

function createMapping(sourcePath, targetPath) {
  if (!fieldMap(state.source).has(sourcePath) || !fieldMap(state.target).has(targetPath)) {
    showToast("Could not find that field in the current schema.", true);
    return;
  }
  const existing = state.mappings.find((mapping) => mapping.targetPath === targetPath);
  if (existing) {
    workspaceStore.update({ selectedSource: null });
    renderAll();
    updateHint("That target already has a mapping. Remove it first to replace it.");
    showToast("This target is already mapped. Remove its existing mapping first.", true);
    return;
  }
  workspaceStore.addMapping({
    id: `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourcePath, targetPath
  });
  workspaceStore.update({ selectedSource: null, selectedMapping: null });
  renderAll();
  showToast(`${fieldMap(state.source).get(sourcePath).name} mapped to ${fieldMap(state.target).get(targetPath).name}`);
}

function handleFieldClick(dataset) {
  const { side, path } = dataset;
  if (side === "source") {
    workspaceStore.update({
      selectedSource: state.selectedSource === path ? null : path,
      selectedMapping: null
    });
    refreshTrees();
    updateHint();
  } else if (state.selectedSource) createMapping(state.selectedSource, path);
  else {
    updateHint("Choose a source field first");
    showToast("Select a source field first.", true);
  }
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

function xsdType(element, schemaElement) {
  const declaredType = element.getAttribute("type") || "";
  const inlineType = Array.from(element.children || []).find((child) => child.localName === "simpleType");
  const restriction = inlineType && Array.from(inlineType.getElementsByTagName("*")).find((child) => child.localName === "restriction");
  const base = (restriction && restriction.getAttribute("base")) || declaredType;
  const localType = base.split(":").pop().toLowerCase();
  if (schemaElement.getAttribute("maxOccurs") === "unbounded" || Number(schemaElement.getAttribute("maxOccurs")) > 1) return "array";
  if (["boolean"].includes(localType)) return "boolean";
  if (["byte", "short", "int", "integer", "long", "nonnegativeinteger", "positiveinteger"].includes(localType)) return "integer";
  if (["decimal", "float", "double"].includes(localType)) return "number";
  if (["date", "time", "datetime"].includes(localType)) return "datetime";
  return "string";
}

function parseXsd(text, fileName) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("The selected XSD is not valid XML.");
  const xsd = xml.getElementsByTagNameNS("*", "schema")[0] ||
    (xml.documentElement?.localName === "schema" ? xml.documentElement : null);
  if (!xsd) throw new Error("The selected XML file does not contain an XSD schema.");
  const globalElements = Array.from(xsd.children).filter((node) => node.localName === "element" && node.getAttribute("name"));
  const rootElement = globalElements[0];
  if (!rootElement) throw new Error("The XSD needs a named top-level element.");
  const namedTypes = new Map(Array.from(xsd.children)
    .filter((node) => node.localName === "complexType" && node.getAttribute("name"))
    .map((node) => [node.getAttribute("name"), node]));

  function elementFields(element) {
    const inline = Array.from(element.children).find((child) => child.localName === "complexType");
    const declaredName = (element.getAttribute("type") || "").split(":").pop();
    const complex = inline || namedTypes.get(declaredName);
    if (!complex) return [];
    const fields = [];
    function visit(node) {
      for (const child of Array.from(node.children || [])) {
        if (child.localName === "element" && child.getAttribute("name")) {
          const name = child.getAttribute("name");
          const nested = elementFields(child);
          const type = nested.length ? "object" : xsdType(child, xsd);
          fields.push({ name, type, ...(nested.length ? { children: nested } : {}) });
        } else if (["sequence", "all", "choice"].includes(child.localName)) {
          visit(child);
        }
      }
    }
    visit(complex);
    for (const attribute of Array.from(complex.getElementsByTagName("*")).filter((node) =>
      node.localName === "attribute" && node.getAttribute("name") && node.parentElement?.localName === "complexType"
    )) {
      fields.push({ name: `@${attribute.getAttribute("name")}`, type: xsdType(attribute, xsd) });
    }
    return fields;
  }

  const root = rootElement.getAttribute("name");
  const schema = { name: fileBaseName(fileName), root, fields: elementFields(rootElement) };
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

function parseXmlSample(text, fileName) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("The selected sample XML is not valid XML.");
  const rootElement = xml.documentElement;
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
      for (const attribute of Array.from(parent.attributes || [])) {
        if (!isDataAttribute(attribute)) continue;
        const name = `@${localName(attribute)}`;
        if (!attributes.has(name)) attributes.set(name, []);
        attributes.get(name).push(attribute.value);
      }

      const counts = new Map();
      for (const child of Array.from(parent.children || [])) {
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
      const textValues = elements.map((element) =>
        Array.from(element.childNodes || [])
          .filter((node) => node.nodeType === 3 || node.nodeType === 4)
          .map((node) => node.textContent)
          .join("")
      );
      const hasTextContent = textValues.some((value) => value.trim());
      const hasStructuredContent = elements.some((element) =>
        Array.from(element.children || []).length > 0 ||
        Array.from(element.attributes || []).some(isDataAttribute)
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

function keepMappingsForSchemas(mappings, sourceSchema, targetSchema) {
  const sourcePaths = new Set(flattenFields(sourceSchema).map((field) => field.path));
  const targetPaths = new Set(flattenFields(targetSchema).map((field) => field.path));
  const remaining = mappings.filter((mapping) =>
    mappingSourcePaths(mapping).every((path) => sourcePaths.has(path)) && targetPaths.has(mapping.targetPath)
  );
  return { mappings: remaining, removed: mappings.length - remaining.length };
}

async function importSchemaFile(text, fileName, side) {
  try {
    let schema;
    const xmlDocument = text.trimStart().startsWith("<");
    const xmlRoot = xmlDocument
      ? new DOMParser().parseFromString(text, "application/xml").documentElement
      : null;
    const isXsd = /\.xsd$/i.test(fileName) ||
      (xmlRoot?.localName === "schema" && xmlRoot.namespaceURI === "http://www.w3.org/2001/XMLSchema");
    if (isXsd) {
      schema = parseXsd(text, fileName);
    } else if (xmlDocument) {
      schema = parseXmlSample(text, fileName);
    } else {
      const data = JSON.parse(text);
      const embeddedSchema = data?.format === "fieldwork-schema" && data.version === 1
        ? data.schema
        : side === "source" ? data?.source : data?.target;
      schema = schemaFromJson(embeddedSchema || data, fileName);
    }
    const previousMappings = state.mappings;
    workspaceStore.update(side === "source" ? { source: schema } : { target: schema });
    const result = keepMappingsForSchemas(previousMappings, state.source, state.target);
    workspaceStore.update({ mappings: result.mappings, selectedSource: null, selectedMapping: null });
    view.resetSearch();
    renderAll();
    showToast(result.removed
      ? `Loaded ${schema.name}; removed ${result.removed} mapping${result.removed === 1 ? "" : "s"} that referenced missing fields.`
      : `Loaded ${schema.name} as the ${side} schema.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : `Could not load the ${side} schema.`, true);
  }
}

async function importMappingFile(text) {
  try {
    if (!state.source.fields.length || !state.target.fields.length) {
      throw new Error("Import both source and target schemas before loading mappings.");
    }
    const data = JSON.parse(text);
    let importedMappings;
    if (data && data.format === "fieldwork-mappings" && data.version === 1 && Array.isArray(data.mappings)) {
      importedMappings = data.mappings;
    } else if (data && data.version === 1 && Array.isArray(data.mappings)) {
      importedMappings = data.mappings;
    }
    if (!importedMappings) throw new Error("Unsupported mapping file. Choose Fieldwork mapping JSON.");
    const mappings = resolveExistingMappings(importedMappings, state.source, state.target);
    workspaceStore.update({ mappings, selectedSource: null, selectedMapping: null });
    renderAll();
    showToast(`Imported ${mappings.length} mapping${mappings.length === 1 ? "" : "s"} for the loaded schemas.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not import the mapping file.", true);
  }
}

function mappingExportData() {
  return {
    format: "fieldwork-mappings",
    version: 1,
    exportedAt: new Date().toISOString(),
    schemasIncluded: false,
    mappings: state.mappings.map((mapping) => {
      const sources = mappingSourcePaths(mapping);
      return {
        sourcePath: sources[0],
        targetPath: mapping.targetPath
      };
    })
  };
}

function openMappingExport() {
  if (!state.mappings.length) return;
  view.showExportPreview(`${JSON.stringify(mappingExportData(), null, 2)}\n`);
}

function getMappingExportJson() {
  if (!state.mappings.length) return "";
  return `${JSON.stringify(mappingExportData(), null, 2)}\n`;
}

function handleDragStart(dataset) {
  workspaceStore.update({ dragSource: dataset.path, selectedSource: dataset.path });
  updateHint();
}

function handleDragEnd() { workspaceStore.update({ dragSource: null }); }

function handleDrop(dataset) {
  if (!state.dragSource) return;
  createMapping(state.dragSource, dataset.path);
  workspaceStore.update({ dragSource: null });
}

function removeMapping(dataset) {
  const id = dataset.removeId;
  const mapping = workspaceStore.removeMapping(id);
  if (state.selectedMapping === id) workspaceStore.update({ selectedMapping: null });
  renderAll();
  showToast(mapping
    ? `Removed mapping for ${mappingSourcePaths(mapping).map((path) => path.split(".").pop()).join(", ")}.`
    : "Mapping removed.");
}

function selectMapping(dataset) {
  const id = dataset.mappingId;
  workspaceStore.update({ selectedMapping: state.selectedMapping === id ? null : id });
  renderMappings();
  drawConnectors();
}

function clearMappings() {
  if (!state.mappings.length) return;
  workspaceStore.update({ mappings: [], selectedMapping: null, selectedSource: null });
  renderAll();
  showToast("All mappings cleared.");
}

function importMappingsRequest() {
  if (!state.source.fields.length || !state.target.fields.length) {
    showToast("Import both source and target schemas before importing a mapping file.", true);
    return;
  }
  view.requestMappingFile();
}

function clearSelection() {
  if (!state.selectedSource && !state.selectedMapping) return;
  workspaceStore.update({ selectedSource: null, selectedMapping: null });
  renderAll();
  updateHint("Selection cleared");
}

view.bind({
  onFieldClick: handleFieldClick,
  onDragStart: handleDragStart,
  onDragEnd: handleDragEnd,
  onDrop: handleDrop,
  onRemoveMapping: removeMapping,
  onSelectMapping: selectMapping,
  onClearMappings: clearMappings,
  onOpenExport: openMappingExport,
  onGetExportJson: getMappingExportJson,
  onLoadSample: loadSampleData,
  onImportMappings: importMappingsRequest,
  onClearSchema: clearSchema,
  onSourceSchemaFile: (text, name) => importSchemaFile(text, name, "source"),
  onTargetSchemaFile: (text, name) => importSchemaFile(text, name, "target"),
  onMappingFile: (text) => importMappingFile(text),
  onClearSelection: clearSelection
});

const restoreResult = workspaceStore.restore(state);
renderAll();
if (restoreResult.error) showToast(restoreResult.error, true);
else if (restoreResult.restored) showToast("Restored your previous workspace from this browser.");