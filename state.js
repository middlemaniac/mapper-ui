const workspaceStorageKey = "fieldwork.workspace";
const sampleSourceSchema = {
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
const sampleTargetSchema = {
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

const chainOrderSchema = {
  name: "Order export", root: "order", fields: [
    { name: "order_id", type: "string" },
    { name: "customer_email", type: "string" },
    { name: "item_sku", type: "string" },
    { name: "item_qty", type: "integer" },
    { name: "total_amount", type: "number" },
    { name: "placed_at", type: "datetime" }
  ]
};
const chainNormalizedSchema = {
  name: "Normalized order", root: "normalized_order", fields: [
    { name: "id", type: "string" },
    { name: "buyer_email", type: "string" },
    { name: "sku", type: "string" },
    { name: "quantity", type: "integer" },
    { name: "amount_total", type: "number" },
    { name: "created_at", type: "datetime" }
  ]
};
const chainInvoiceSchema = {
  name: "Invoice API", root: "invoice", fields: [
    { name: "invoice_id", type: "string" },
    { name: "billing_email", type: "string" },
    { name: "line_item", type: "object", children: [
      { name: "code", type: "string" }, { name: "units", type: "integer" }
    ] },
    { name: "grand_total", type: "number" },
    { name: "issued_at", type: "datetime" }
  ]
};
const chainOrderToNormalizedMappings = [
  { id: "chain-1", sourcePath: "order.order_id", targetPath: "normalized_order.id" },
  { id: "chain-2", sourcePath: "order.customer_email", targetPath: "normalized_order.buyer_email" },
  { id: "chain-3", sourcePath: "order.item_sku", targetPath: "normalized_order.sku" },
  { id: "chain-4", sourcePath: "order.item_qty", targetPath: "normalized_order.quantity" },
  { id: "chain-5", sourcePath: "order.total_amount", targetPath: "normalized_order.amount_total" },
  { id: "chain-6", sourcePath: "order.placed_at", targetPath: "normalized_order.created_at" }
];
const chainNormalizedToInvoiceMappings = [
  { id: "chain-7", sourcePath: "normalized_order.id", targetPath: "invoice.invoice_id" },
  { id: "chain-8", sourcePath: "normalized_order.buyer_email", targetPath: "invoice.billing_email" },
  { id: "chain-9", sourcePath: "normalized_order.sku", targetPath: "invoice.line_item.code" },
  { id: "chain-10", sourcePath: "normalized_order.quantity", targetPath: "invoice.line_item.units" },
  { id: "chain-11", sourcePath: "normalized_order.amount_total", targetPath: "invoice.grand_total" },
  { id: "chain-12", sourcePath: "normalized_order.created_at", targetPath: "invoice.issued_at" }
];

const samples = [
  {
    id: "customer-migration",
    name: "Customer migration",
    description: "2 levels · 4 mappings",
    format: "fieldwork-workspace-mappings",
    schemasIncluded: true,
    levels: [
      { kind: "source", label: "Source", schemaName: sampleSourceSchema.name, root: sampleSourceSchema.root, schema: sampleSourceSchema },
      { kind: "target", label: "Target", schemaName: sampleTargetSchema.name, root: sampleTargetSchema.root, schema: sampleTargetSchema }
    ],
    links: [{ sourceLevel: "Source", targetLevel: "Target", mappings: sampleMappings.map(({ sourcePath, targetPath }) => ({ sourcePath, targetPath })) }]
  },
  {
    id: "order-to-invoice-chain",
    name: "Order-to-invoice mapping chain",
    description: "3 levels · 12 mappings",
    format: "fieldwork-workspace-mappings",
    schemasIncluded: true,
    levels: [
      { kind: "source", label: "Source", schemaName: chainOrderSchema.name, root: chainOrderSchema.root, schema: chainOrderSchema },
      { kind: "target", label: "Target", schemaName: chainNormalizedSchema.name, root: chainNormalizedSchema.root, schema: chainNormalizedSchema },
      { kind: "target", label: "Target", schemaName: chainInvoiceSchema.name, root: chainInvoiceSchema.root, schema: chainInvoiceSchema }
    ],
    links: [
      { sourceLevel: "Source", targetLevel: "Target", mappings: chainOrderToNormalizedMappings.map(({ sourcePath, targetPath }) => ({ sourcePath, targetPath })) },
      { sourceLevel: "Target", targetLevel: "Target", mappings: chainNormalizedToInvoiceMappings.map(({ sourcePath, targetPath }) => ({ sourcePath, targetPath })) }
    ]
  }
];

function emptySchema(kind) {
  return { name: kind === "source" ? "No source schema" : "No target schema", root: "", fields: [] };
}

function emptyLevel(kind, label) {
  return { kind, label, ...emptySchema(kind) };
}

function relabelTargetLevels(levels) {
  const multipleTargets = levels.filter((level) => level.kind === "target").length > 1;
  let targetNumber = 0;
  for (const level of levels) {
    if (level.kind !== "target") continue;
    targetNumber += 1;
    level.label = multipleTargets ? `Target level ${targetNumber}` : "Target";
  }
}

export function createState() {
  return {
    levels: [emptyLevel("source", "Source"), emptyLevel("target", "Target")],
    links: [{ mappings: [] }],
    selectedField: null,
    selectedMapping: null,
    selectedChain: null,
    dragSource: null
  };
}

export function createWorkspaceStore({ validateSchema, resolveExistingMappings }) {
  const state = createState();
  let skipNextSave = false;
  let storageWarningShown = false;

  function update(changes) {
    Object.assign(state, changes);
  }

  function clearWorkspace() {
    Object.assign(state, createState());
  }

  function clearSchema(levelIndex) {
    const level = state.levels[levelIndex];
    if (!level) return;
    Object.assign(level, emptySchema(level.kind));
    if (state.links[levelIndex - 1]) state.links[levelIndex - 1].mappings = [];
    if (state.links[levelIndex]) state.links[levelIndex].mappings = [];
    update({ selectedField: null, selectedMapping: null, selectedChain: null });
  }

  function replaceSchema(levelIndex, schema) {
    const level = state.levels[levelIndex];
    if (!level) return false;
    Object.assign(level, schema);
    update({ selectedField: null, selectedMapping: null, selectedChain: null });
    return true;
  }

  function replaceLevels(levels) {
    state.levels = levels;
    state.links = levels.slice(1).map(() => ({ mappings: [] }));
    update({ selectedField: null, selectedMapping: null, selectedChain: null, dragSource: null });
    relabelTargetLevels(state.levels);
  }

  function setLinkMappings(linkIndex, mappings) {
    const link = state.links[linkIndex];
    if (!link) return false;
    link.mappings = mappings;
    return true;
  }

  function addMapping(linkIndex, mapping) {
    state.links[linkIndex].mappings.push(mapping);
  }

  function removeMapping(linkIndex, id) {
    const link = state.links[linkIndex];
    const mapping = link.mappings.find((item) => item.id === id);
    link.mappings = link.mappings.filter((item) => item.id !== id);
    return mapping;
  }

  function addLevel(insertIndex = state.levels.length) {
    if (!Number.isInteger(insertIndex) || insertIndex < 1 || insertIndex > state.levels.length) return 0;
    state.levels.splice(insertIndex, 0, emptyLevel("target", "Target level"));
    let replacedMappingCount = 0;
    if (insertIndex === state.links.length + 1) {
      state.links.push({ mappings: [] });
    } else {
      replacedMappingCount = state.links[insertIndex - 1].mappings.length;
      state.links.splice(insertIndex - 1, 1, { mappings: [] }, { mappings: [] });
    }
    state.selectedField = null;
    state.selectedMapping = null;
    state.selectedChain = null;
    relabelTargetLevels(state.levels);
    return replacedMappingCount;
  }

  function removeLevel(index) {
    if (index <= 0 || index >= state.levels.length) return;
    if (state.levels.filter((level) => level.kind === "target").length <= 1) return;
    state.levels.splice(index, 1);
    state.links.splice(index - 1, 1);
    if (index > 0 && index <= state.links.length) state.links[index - 1] = { mappings: [] };
    relabelTargetLevels(state.levels);
    if (state.selectedField && (state.selectedField.levelIndex === index || state.selectedField.levelIndex >= state.levels.length)) {
      state.selectedField = null;
    }
    state.selectedMapping = null;
    state.selectedChain = null;
  }

  function getSamples() {
    return samples.map(({ id, name, description }) => ({ id, name, description }));
  }

  function loadSampleData(sampleId) {
    const source = samples.find((item) => item.id === sampleId) || samples[0];
    const sample = JSON.parse(JSON.stringify(source));
    const levels = sample.levels.map((level) => ({
      kind: level.kind,
      label: level.label,
      ...level.schema
    }));
    const links = sample.links.map((link, linkIndex) => ({
      mappings: link.mappings.map((mapping, mappingIndex) => ({
        id: `sample-${linkIndex + 1}-${mappingIndex + 1}`,
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath
      }))
    }));
    relabelTargetLevels(levels);
    Object.assign(state, { levels, links }, {
      selectedField: null,
      selectedMapping: null,
      selectedChain: null,
      dragSource: null
    });
  }

  function save(state) {
    if (skipNextSave) {
      skipNextSave = false;
      return "";
    }
    try {
      const hasAnyData = state.levels.some((level) => level.fields.length) ||
        state.links.some((link) => link.mappings.length);
      if (!hasAnyData) {
        localStorage.removeItem(workspaceStorageKey);
        return "";
      }
      localStorage.setItem(workspaceStorageKey, JSON.stringify({
        levels: state.levels,
        links: state.links
      }));
    } catch (error) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        return error instanceof Error
          ? `Could not save this workspace in browser storage: ${error.message}`
          : "Could not save this workspace in browser storage.";
      }
    }
    return "";
  }

  function restore(state) {
    try {
      let savedText = localStorage.getItem(workspaceStorageKey);
      if (!savedText) return { restored: false, error: "" };
      const saved = JSON.parse(savedText);
      if (!Array.isArray(saved.levels) || !Array.isArray(saved.links)) {
        throw new Error("The saved workspace has an unsupported format.");
      }
      if (saved.levels.length < 2 || saved.links.length !== saved.levels.length - 1 ||
          saved.levels[0]?.kind !== "source" || saved.levels.slice(1).some((level) => level?.kind !== "target")) {
        throw new Error("The saved workspace has an invalid level and link structure.");
      }
      saved.levels.forEach((level, index) => validateSchema(level, index === 0 ? "Saved source" : `Saved ${level.label || "target"}`));
      for (let i = 0; i < saved.links.length; i += 1) {
        if (!saved.links[i] || !Array.isArray(saved.links[i].mappings)) {
          throw new Error(`Saved link ${i + 1} must include a mappings array.`);
        }
        saved.links[i].mappings = resolveExistingMappings(saved.links[i].mappings, saved.levels[i], saved.levels[i + 1]);
      }
      state.levels = saved.levels;
      state.links = saved.links;
      relabelTargetLevels(state.levels);
      return { restored: true, error: "" };
    } catch (error) {
      skipNextSave = true;
      storageWarningShown = true;
      return {
        restored: false,
        error: error instanceof Error
          ? `Could not restore the saved workspace: ${error.message}`
          : "Could not restore the saved workspace."
      };
    }
  }

  return {
    state, update, clearWorkspace, clearSchema, replaceSchema, replaceLevels, setLinkMappings,
    addMapping, removeMapping, addLevel, removeLevel, getSamples, loadSampleData, save, restore
  };
}