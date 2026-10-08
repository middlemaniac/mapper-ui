"use strict";

const sourceSchema = {
  name: "CRM export", root: "customer_record", fields: [
    { name: "id", type: "string" },
    { name: "first_name", type: "string" },
    { name: "last_name", type: "string" },
    { name: "email", type: "string" },
    { name: "phone", type: "string" },
    { name: "created_at", type: "datetime" },
    { name: "address", type: "object", children: [
      { name: "street", type: "string" }, { name: "city", type: "string" },
      { name: "postal_code", type: "string" }, { name: "country", type: "string" }
    ] }
  ]
};
const targetSchema = {
  name: "Customer API", root: "customer", fields: [
    { name: "customer_id", type: "string" },
    { name: "full_name", type: "string" },
    { name: "email_address", type: "string" },
    { name: "phone_number", type: "string" },
    { name: "registered_on", type: "datetime" },
    { name: "location", type: "object", children: [
      { name: "line1", type: "string" }, { name: "city", type: "string" },
      { name: "zip", type: "string" }, { name: "country_code", type: "string" }
    ] }
  ]
};
const sampleMappings = [
  { id: "sample-1", sourcePath: "customer_record.id", targetPath: "customer.customer_id" },
  { id: "sample-2", sourcePath: "customer_record.email", targetPath: "customer.email_address" },
  { id: "sample-3", sourcePath: "customer_record.phone", targetPath: "customer.phone_number" },
  { id: "sample-4", sourcePath: "customer_record.address.city", targetPath: "customer.location.city" }
];
const workspaceStorageKey = "fieldwork.workspace.v1";
const state = {
  source: { name: "No source schema", root: "", fields: [] },
  target: { name: "No target schema", root: "", fields: [] },
  mappings: [],
  selectedSource: null,
  selectedMapping: null,
  dragSource: null,
  toastTimer: null,
  toastDeadline: 0,
  toastRemaining: 2800,
  toastPaused: false,
  skipNextWorkspaceSave: false,
  storageWarningShown: false,
  restoreError: ""
};
const ui = {
  layout: document.querySelector("#mapping-layout"),
  connectors: document.querySelector("#connector-layer"),
  sourceTree: document.querySelector("#source-tree"),
  targetTree: document.querySelector("#target-tree"),
  list: document.querySelector("#mapping-list"),
  count: document.querySelector("#mapping-count"),
  summary: document.querySelector("#mapping-summary"),
  hint: document.querySelector("#mapping-hint"),
  status: document.querySelector("#footer-status-text"),
  toast: document.querySelector("#toast"),
  sourceSearch: document.querySelector("#source-search"),
  targetSearch: document.querySelector("#target-search"),
  sourceSchemaFile: document.querySelector("#source-schema-file"),
  targetSchemaFile: document.querySelector("#target-schema-file"),
  mappingFile: document.querySelector("#mapping-file")
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

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

function typeGlyph(type) {
  return ({ string: "Aa", number: "#", integer: "#", boolean: "◐", datetime: "◷", date: "◷" })[type.toLowerCase()] || "Aa";
}

function mappingSourcePaths(mapping) {
  return [mapping.sourcePath];
}

function renderTree(schema, side, search = "") {
  const mapped = new Set(state.mappings.flatMap((item) =>
    side === "source" ? mappingSourcePaths(item) : [item.targetPath]
  ));
  const query = search.trim().toLowerCase();
  let leafCount = 0;
  function renderFields(fields, parentPath) {
    return fields.map((field) => {
      const path = `${parentPath}.${field.name}`;
      const isObject = Array.isArray(field.children) && field.children.length > 0;
      const childrenHtml = isObject ? renderFields(field.children, path) : "";
      const ownMatch = `${field.name} ${path} ${field.type}`.toLowerCase().includes(query);
      const hasMatchingChild = isObject && childrenHtml.includes("data-field-path=");
      if (query && !ownMatch && !hasMatchingChild) return "";
      if (isObject) {
        return `<div class="tree-group" data-group-path="${escapeHtml(path)}">
          <button class="tree-group-label" type="button" aria-expanded="true">
            <span class="tree-chevron" aria-hidden="true">⌄</span><span class="object-icon" aria-hidden="true">{ }</span>
            <span>${escapeHtml(field.name)}</span><span class="field-type">${escapeHtml(field.type)}</span>
          </button><div class="tree-children">${childrenHtml}</div>
        </div>`;
      }
      leafCount += 1;
      const isSelected = side === "source" && state.selectedSource === path;
      const pathWithoutRoot = path.slice(schema.root.length + 1);
      return `<button class="tree-field${mapped.has(path) ? " is-mapped" : ""}${isSelected ? " is-selected" : ""}"
          type="button" draggable="${side === "source"}" data-side="${side}" data-path="${escapeHtml(path)}"
          data-field-path="${escapeHtml(`${side}:${path}`)}" aria-pressed="${isSelected}"
          aria-label="${escapeHtml(pathWithoutRoot)}, ${escapeHtml(field.type)}${mapped.has(path) ? ", mapped" : ""}">
        <span class="field-type" aria-hidden="true">${escapeHtml(typeGlyph(field.type))}</span>
        <span class="field-name">${escapeHtml(field.name)}</span>
        <span class="field-tail"><span class="mapped-check" aria-hidden="true">✓</span></span>
      </button>`;
    }).join("");
  }
  const html = renderFields(schema.fields, schema.root);
  const tree = side === "source" ? ui.sourceTree : ui.targetTree;
  tree.innerHTML = html || (schema.fields.length
    ? `<div class="tree-empty">No fields match your search.</div>`
    : `<div class="tree-empty schema-empty">
        <span>No ${side} schema loaded yet.</span>
        <button class="schema-empty-action" type="button" data-import-side="${side}">Import ${side} schema</button>
      </div>`);
  document.querySelector(`#${side}-field-count`).textContent = `${leafCount} fields`;
}

function updateHint(message) {
  const text = ui.hint.querySelector("span:nth-child(2)");
  if (message) text.textContent = message;
  else if (state.selectedSource) text.textContent = `${fieldMap(state.source).get(state.selectedSource)?.name || state.selectedSource} selected — choose a target field`;
  else if (!state.source.fields.length || !state.target.fields.length) {
    const missing = [];
    if (!state.source.fields.length) missing.push("source");
    if (!state.target.fields.length) missing.push("target");
    text.textContent = `Import ${missing.join(" and ")} schema${missing.length > 1 ? "s" : ""} to begin mapping`;
  }
  else text.textContent = "Select a source field to get started";
}

function renderMappings() {
  const sourceFields = fieldMap(state.source);
  const targetFields = fieldMap(state.target);
  ui.list.innerHTML = state.mappings.map((mapping) => {
    const sources = mappingSourcePaths(mapping).map((path) => sourceFields.get(path));
    const target = targetFields.get(mapping.targetPath);
    if (sources.some((source) => !source) || !target) return "";
    const sourceNames = sources.map((source) => source.name);
    const sourcePath = mappingSourcePaths(mapping).map((path) => path.slice(state.source.root.length + 1)).join(" + ");
    const targetPath = mapping.targetPath.slice(state.target.root.length + 1);
    return `<article class="mapping-card${state.selectedMapping === mapping.id ? " is-selected" : ""}" data-mapping-id="${escapeHtml(mapping.id)}">
      <div class="mapping-endpoint"><span class="mapping-field-name">${escapeHtml(sourceNames.join(" + "))}</span><span class="mapping-field-path">${escapeHtml(sourcePath)}</span></div>
      <span class="mapping-arrow" aria-hidden="true">→</span>
      <div class="mapping-endpoint"><span class="mapping-field-name">${escapeHtml(target.name)}</span><span class="mapping-field-path">${escapeHtml(targetPath)}</span></div>
      <button class="remove-mapping" type="button" data-remove-id="${escapeHtml(mapping.id)}" aria-label="Remove mapping from ${escapeHtml(sourceNames.join(" and "))} to ${escapeHtml(target.name)}" title="Remove mapping"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
    </article>`;
  }).join("");
  ui.count.textContent = String(state.mappings.length);
  document.querySelector("#mapping-columns").hidden = !state.mappings.length;
  const hasSchemas = state.source.fields.length > 0 && state.target.fields.length > 0;
  document.querySelector("#clear-mappings").disabled = !state.mappings.length;
  document.querySelector("#export-mappings-button").disabled = !state.mappings.length;
  const emptyState = document.querySelector("#empty-state");
  if (!state.mappings.length) {
    emptyState.innerHTML = `<div class="empty-art" aria-hidden="true"><span class="empty-source"></span><span class="empty-path"></span><span class="empty-target"></span></div>
      <strong>No mappings loaded</strong>
      <p>${hasSchemas
        ? "Import a mapping file, or connect fields by selecting a source and target."
        : "Import source and target schemas first so mapping field paths can be checked."}</p>
      <div class="empty-state-actions">
        <button class="button button-primary" id="empty-load-mapping" type="button">Import mapping</button>
      </div>`;
  }
  ui.summary.textContent = state.mappings.length
    ? `${state.mappings.length} field${state.mappings.length === 1 ? "" : "s"} connected`
    : "";
  ui.status.textContent = state.mappings.length
    ? `${state.mappings.length} mapping${state.mappings.length === 1 ? "" : "s"} ready`
    : hasSchemas ? "Ready to map" : "Import schemas to begin";
  updateHint();
}

function drawConnectors() {
  const rect = ui.layout.getBoundingClientRect();
  if (!rect.width || window.matchMedia("(max-width: 620px)").matches) {
    ui.connectors.replaceChildren();
    return;
  }
  ui.connectors.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  ui.connectors.setAttribute("preserveAspectRatio", "none");
  const paths = ['<defs><marker id="connector-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 7 7"><path d="M0 0 7 3.5 0 7z" fill="#8cab94"/></marker><marker id="connector-arrow-selected" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse" viewBox="0 0 7 7"><path d="M0 0 7 3.5 0 7z" fill="#ca7958"/></marker></defs>'];
  for (const mapping of state.mappings) {
    const target = ui.targetTree.querySelector(`[data-field-path="${CSS.escape(`target:${mapping.targetPath}`)}"]`);
    if (!target) continue;
    const b = target.getBoundingClientRect();
    const tx = b.left - rect.left + 1, ty = b.top + b.height / 2 - rect.top;
    const selected = state.selectedMapping === mapping.id;
    for (const sourcePath of mappingSourcePaths(mapping)) {
      const source = ui.sourceTree.querySelector(`[data-field-path="${CSS.escape(`source:${sourcePath}`)}"]`);
      if (!source) continue;
      const a = source.getBoundingClientRect();
      const sx = a.right - rect.left - 1, sy = a.top + a.height / 2 - rect.top;
      const bend = Math.max(32, (tx - sx) * 0.42);
      paths.push(`<path class="connector-path${selected ? " is-selected" : ""}" d="M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}" marker-end="url(#connector-arrow${selected ? "-selected" : ""})"/>`);
    }
  }
  ui.connectors.innerHTML = paths.join("");
}

function renderAll() {
  document.querySelector("#source-schema-name").textContent = state.source.name;
  document.querySelector("#target-schema-name").textContent = state.target.name;
  document.querySelector("#clear-source-schema").disabled = !state.source.fields.length;
  document.querySelector("#clear-target-schema").disabled = !state.target.fields.length;
  document.querySelector("#source-root-name").textContent = state.source.root || "Not loaded";
  document.querySelector("#target-root-name").textContent = state.target.root || "Not loaded";
  document.querySelector("#source-footnote-text").textContent = state.source.fields.length
    ? "Drag a field or select it to begin"
    : "Import a schema to see source fields";
  document.querySelector("#target-footnote-text").textContent = state.target.fields.length
    ? "Unmapped fields are ready to connect"
    : "Import a schema to see target fields";
  ui.sourceSearch.disabled = !state.source.fields.length;
  ui.targetSearch.disabled = !state.target.fields.length;
  renderTree(state.source, "source", ui.sourceSearch.value);
  renderTree(state.target, "target", ui.targetSearch.value);
  renderMappings();
  requestAnimationFrame(drawConnectors);
  if (state.skipNextWorkspaceSave) state.skipNextWorkspaceSave = false;
  else persistWorkspace();
}

function loadSampleData() {
  if ((state.source.fields.length || state.target.fields.length || state.mappings.length) &&
      !window.confirm("Loading sample data will replace the current schemas and mappings. Continue?")) {
    return false;
  }
  state.source = sourceSchema;
  state.target = targetSchema;
  state.mappings = sampleMappings.map((mapping) => ({ ...mapping }));
  state.selectedSource = null;
  state.selectedMapping = null;
  ui.sourceSearch.value = "";
  ui.targetSearch.value = "";
  renderAll();
  showToast("Loaded the synthetic customer migration sample.");
  return true;
}

function clearSchema(side) {
  const schema = side === "source" ? state.source : state.target;
  if (!schema.fields.length) return;
  if (state.mappings.length &&
      !window.confirm(`Clearing the ${side} schema will also remove all ${state.mappings.length} mapping${state.mappings.length === 1 ? "" : "s"}. Continue?`)) {
    return;
  }

  if (side === "source") {
    state.source = { name: "No source schema", root: "", fields: [] };
    ui.sourceSearch.value = "";
    state.selectedSource = null;
  } else {
    state.target = { name: "No target schema", root: "", fields: [] };
    ui.targetSearch.value = "";
  }
  state.mappings = [];
  state.selectedMapping = null;
  renderAll();
  showToast(`Cleared the ${side} schema.`);
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-error", isError);
  ui.toast.classList.add("is-visible");
  state.toastRemaining = 2800;
  state.toastPaused = ui.toast.matches(":hover");
  if (!state.toastPaused) scheduleToastDismissal();
}

function scheduleToastDismissal() {
  state.toastDeadline = performance.now() + state.toastRemaining;
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), state.toastRemaining);
}

ui.toast.addEventListener("pointerenter", () => {
  if (!ui.toast.classList.contains("is-visible") || state.toastPaused) return;
  clearTimeout(state.toastTimer);
  state.toastRemaining = Math.max(0, state.toastDeadline - performance.now());
  state.toastPaused = true;
});

ui.toast.addEventListener("pointerleave", () => {
  if (!state.toastPaused || ui.toast.matches(":hover")) return;
  state.toastPaused = false;
  scheduleToastDismissal();
});

function refreshTrees() {
  renderTree(state.source, "source", ui.sourceSearch.value);
  renderTree(state.target, "target", ui.targetSearch.value);
  requestAnimationFrame(drawConnectors);
}

function createMapping(sourcePath, targetPath) {
  if (!fieldMap(state.source).has(sourcePath) || !fieldMap(state.target).has(targetPath)) {
    showToast("Could not find that field in the current schema.", true);
    return;
  }
  const existing = state.mappings.find((mapping) => mapping.targetPath === targetPath);
  if (existing) {
    state.selectedSource = null;
    renderAll();
    updateHint("That target already has a mapping. Remove it first to replace it.");
    showToast("This target is already mapped. Remove its existing mapping first.", true);
    return;
  }
  state.mappings.push({
    id: `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sourcePath, targetPath
  });
  state.selectedSource = null;
  state.selectedMapping = null;
  renderAll();
  showToast(`${fieldMap(state.source).get(sourcePath).name} mapped to ${fieldMap(state.target).get(targetPath).name}`);
}

function handleFieldClick(event) {
  const field = event.target.closest(".tree-field");
  if (!field) return;
  const { side, path } = field.dataset;
  if (side === "source") {
    state.selectedSource = state.selectedSource === path ? null : path;
    state.selectedMapping = null;
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

function persistWorkspace() {
  try {
    if (!state.source.fields.length && !state.target.fields.length && !state.mappings.length) {
      localStorage.removeItem(workspaceStorageKey);
      return;
    }
    localStorage.setItem(workspaceStorageKey, JSON.stringify({
      version: 1,
      source: state.source,
      target: state.target,
      mappings: state.mappings
    }));
  } catch (error) {
    if (!state.storageWarningShown) {
      state.storageWarningShown = true;
      showToast(error instanceof Error
        ? `Could not save this workspace in browser storage: ${error.message}`
        : "Could not save this workspace in browser storage.", true);
    }
  }
}

function restoreWorkspace() {
  try {
    const savedText = localStorage.getItem(workspaceStorageKey);
    if (!savedText) return false;
    const saved = JSON.parse(savedText);
    if (!saved || saved.version !== 1 || !Array.isArray(saved.mappings)) {
      throw new Error("The saved workspace has an unsupported format.");
    }
    validateSchema(saved.source, "Saved source");
    validateSchema(saved.target, "Saved target");
    const mappings = resolveExistingMappings(saved.mappings, saved.source, saved.target);
    state.source = saved.source;
    state.target = saved.target;
    state.mappings = mappings;
    return true;
  } catch (error) {
    state.skipNextWorkspaceSave = true;
    state.storageWarningShown = true;
    state.restoreError = error instanceof Error
      ? `Could not restore the saved workspace: ${error.message}`
      : "Could not restore the saved workspace.";
    return false;
  }
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

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("The selected file could not be read.")));
    reader.readAsText(file);
  });
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

async function importSchemaFile(file, side) {
  if (!file) return;
  try {
    const text = await readFileText(file);
    let schema;
    const xmlDocument = text.trimStart().startsWith("<");
    const xmlRoot = xmlDocument
      ? new DOMParser().parseFromString(text, "application/xml").documentElement
      : null;
    const isXsd = /\.xsd$/i.test(file.name) ||
      (xmlRoot?.localName === "schema" && xmlRoot.namespaceURI === "http://www.w3.org/2001/XMLSchema");
    if (isXsd) {
      schema = parseXsd(text, file.name);
    } else if (xmlDocument) {
      schema = parseXmlSample(text, file.name);
    } else {
      const data = JSON.parse(text);
      const embeddedSchema = data?.format === "fieldwork-schema" && data.version === 1
        ? data.schema
        : side === "source" ? data?.source : data?.target;
      schema = schemaFromJson(embeddedSchema || data, file.name);
    }
    const previousMappings = state.mappings;
    if (side === "source") state.source = schema;
    else state.target = schema;
    const result = keepMappingsForSchemas(previousMappings, state.source, state.target);
    state.mappings = result.mappings;
    state.selectedSource = null;
    state.selectedMapping = null;
    ui.sourceSearch.value = "";
    ui.targetSearch.value = "";
    renderAll();
    showToast(result.removed
      ? `Loaded ${schema.name}; removed ${result.removed} mapping${result.removed === 1 ? "" : "s"} that referenced missing fields.`
      : `Loaded ${schema.name} as the ${side} schema.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : `Could not load the ${side} schema.`, true);
  } finally {
    (side === "source" ? ui.sourceSchemaFile : ui.targetSchemaFile).value = "";
  }
}

async function importMappingFile(file) {
  if (!file) return;
  try {
    if (!state.source.fields.length || !state.target.fields.length) {
      throw new Error("Import both source and target schemas before loading mappings.");
    }
    const data = JSON.parse(await readFileText(file));
    let importedMappings;
    if (data && data.format === "fieldwork-mappings" && data.version === 1 && Array.isArray(data.mappings)) {
      importedMappings = data.mappings;
    } else if (data && data.version === 1 && Array.isArray(data.mappings)) {
      importedMappings = data.mappings;
    }
    if (!importedMappings) throw new Error("Unsupported mapping file. Choose Fieldwork mapping JSON.");
    const mappings = resolveExistingMappings(importedMappings, state.source, state.target);
    state.mappings = mappings;
    state.selectedSource = null;
    state.selectedMapping = null;
    renderAll();
    showToast(`Imported ${mappings.length} mapping${mappings.length === 1 ? "" : "s"} for the loaded schemas.`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Could not import the mapping file.", true);
  } finally {
    ui.mappingFile.value = "";
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
  const dialog = document.querySelector("#mapping-export-dialog");
  const preview = document.querySelector("#mapping-export-preview");
  preview.value = `${JSON.stringify(mappingExportData(), null, 2)}\n`;
  dialog.showModal();
}

async function downloadMappingExport() {
  if (!state.mappings.length) return;
  const dialog = document.querySelector("#mapping-export-dialog");
  const preview = document.querySelector("#mapping-export-preview");
  const status = document.querySelector("#mapping-export-status");
  const downloadButton = document.querySelector("#download-mapping-export");
  const json = preview.value;

  try {
    downloadButton.disabled = true;
    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({
        suggestedName: "fieldwork-mappings-only.json",
        types: [{ description: "JSON mapping", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } else {
      const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "fieldwork-mappings-only.json";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }
    dialog.close();
    showToast("Mapping exported as JSON.");
  } catch (error) {
    if (error && error.name === "AbortError") {
      status.textContent = "Save cancelled.";
    } else {
      status.textContent = error instanceof Error ? `Could not export mapping: ${error.message}` : "Could not export mapping.";
      status.classList.add("is-error");
    }
  } finally {
    downloadButton.disabled = false;
  }
}

function toggleGroup(event) {
  const button = event.target.closest(".tree-group-label");
  if (!button) return;
  const group = button.parentElement;
  const collapsed = group.classList.toggle("is-collapsed");
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${group.dataset.groupPath.split(".").pop()} fields`);
  requestAnimationFrame(drawConnectors);
}

ui.sourceTree.addEventListener("click", (event) => {
  if (event.target.closest("[data-import-side='source']")) {
    ui.sourceSchemaFile.click();
    return;
  }
  handleFieldClick(event);
});
ui.targetTree.addEventListener("click", (event) => {
  if (event.target.closest("[data-import-side='target']")) {
    ui.targetSchemaFile.click();
    return;
  }
  handleFieldClick(event);
});
ui.sourceTree.addEventListener("click", toggleGroup);
ui.targetTree.addEventListener("click", toggleGroup);
ui.sourceTree.addEventListener("dragstart", (event) => {
  const field = event.target.closest(".tree-field");
  if (!field) return;
  state.dragSource = field.dataset.path;
  event.dataTransfer.setData("text/plain", state.dragSource);
  event.dataTransfer.effectAllowed = "link";
  state.selectedSource = state.dragSource;
  field.classList.add("is-selected");
  updateHint();
});
ui.sourceTree.addEventListener("dragend", () => { state.dragSource = null; });
ui.targetTree.addEventListener("dragover", (event) => {
  if (event.target.closest(".tree-field") && state.dragSource) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
  }
});
ui.targetTree.addEventListener("drop", (event) => {
  const field = event.target.closest(".tree-field");
  if (!field || !state.dragSource) return;
  event.preventDefault();
  createMapping(state.dragSource, field.dataset.path);
  state.dragSource = null;
});
ui.list.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-id]");
  if (remove) {
    const id = remove.dataset.removeId;
    const mapping = state.mappings.find((item) => item.id === id);
    state.mappings = state.mappings.filter((item) => item.id !== id);
    if (state.selectedMapping === id) state.selectedMapping = null;
    renderAll();
    showToast(mapping
      ? `Removed mapping for ${mappingSourcePaths(mapping).map((path) => path.split(".").pop()).join(", ")}.`
      : "Mapping removed.");
    return;
  }
  const card = event.target.closest("[data-mapping-id]");
  if (card && !event.target.closest("select")) {
    state.selectedMapping = state.selectedMapping === card.dataset.mappingId ? null : card.dataset.mappingId;
    renderMappings();
    requestAnimationFrame(drawConnectors);
  }
});
ui.sourceSearch.addEventListener("input", () => renderTree(state.source, "source", ui.sourceSearch.value));
ui.targetSearch.addEventListener("input", () => renderTree(state.target, "target", ui.targetSearch.value));
document.querySelector("#clear-mappings").addEventListener("click", () => {
  if (!state.mappings.length) return;
  state.mappings = [];
  state.selectedMapping = null;
  state.selectedSource = null;
  renderAll();
  showToast("All mappings cleared.");
});
document.querySelector("#export-mappings-button").addEventListener("click", openMappingExport);
document.querySelector("#download-mapping-export").addEventListener("click", downloadMappingExport);
document.querySelector("#close-mapping-export").addEventListener("click", () => {
  document.querySelector("#mapping-export-dialog").close();
});
document.querySelector("#cancel-mapping-export").addEventListener("click", () => {
  document.querySelector("#mapping-export-dialog").close();
});
document.querySelector("#load-sample-button").addEventListener("click", loadSampleData);
document.querySelector("#import-mappings-button").addEventListener("click", () => {
  if (!state.source.fields.length || !state.target.fields.length) {
    showToast("Import both source and target schemas before importing a mapping file.", true);
    return;
  }
  ui.mappingFile.click();
});
document.querySelector("#clear-source-schema").addEventListener("click", () => clearSchema("source"));
document.querySelector("#clear-target-schema").addEventListener("click", () => clearSchema("target"));
document.querySelector("#empty-state").addEventListener("click", (event) => {
  if (!event.target.closest("#empty-load-mapping")) return;
  if (!state.source.fields.length || !state.target.fields.length) {
    showToast("Import both source and target schemas before importing a mapping file.", true);
    return;
  }
  ui.mappingFile.click();
});
ui.sourceSchemaFile.addEventListener("change", () => {
  if (ui.sourceSchemaFile.files?.[0]) importSchemaFile(ui.sourceSchemaFile.files[0], "source");
});
ui.targetSchemaFile.addEventListener("change", () => {
  if (ui.targetSchemaFile.files?.[0]) importSchemaFile(ui.targetSchemaFile.files[0], "target");
});
ui.mappingFile.addEventListener("change", () => {
  if (ui.mappingFile.files?.[0]) importMappingFile(ui.mappingFile.files[0]);
});
document.querySelector("#source-menu").addEventListener("click", () => ui.sourceSchemaFile.click());
document.querySelector("#target-menu").addEventListener("click", () => ui.targetSchemaFile.click());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (state.selectedSource || state.selectedMapping)) {
    state.selectedSource = null;
    state.selectedMapping = null;
    renderAll();
    updateHint("Selection cleared");
  }
  if (event.key === "/" && !event.target.matches("input, textarea, select, [contenteditable='true']")) {
    event.preventDefault();
    ui.sourceSearch.focus();
  }
});
window.addEventListener("resize", drawConnectors);
const restoredWorkspace = restoreWorkspace();
renderAll();
if (state.restoreError) showToast(state.restoreError, true);
else if (restoredWorkspace) showToast("Restored your previous workspace from this browser.");