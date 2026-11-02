const workspaceStorageKey = "fieldwork.workspace.v1";
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

export function createState() {
  return {
    source: { name: "No source schema", root: "", fields: [] },
    target: { name: "No target schema", root: "", fields: [] },
    mappings: [],
    selectedSource: null,
    selectedMapping: null,
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

  function addMapping(mapping) {
    state.mappings.push(mapping);
  }

  function removeMapping(id) {
    const mapping = state.mappings.find((item) => item.id === id);
    state.mappings = state.mappings.filter((item) => item.id !== id);
    return mapping;
  }

  function loadSampleData() {
    const sample = JSON.parse(JSON.stringify({
      source: sampleSourceSchema,
      target: sampleTargetSchema,
      mappings: sampleMappings
    }));
    Object.assign(state, sample, {
      selectedSource: null,
      selectedMapping: null,
      dragSource: null
    });
  }

  function save(state) {
    if (skipNextSave) {
      skipNextSave = false;
      return "";
    }
    try {
      if (!state.source.fields.length && !state.target.fields.length && !state.mappings.length) {
        localStorage.removeItem(workspaceStorageKey);
        return "";
      }
      localStorage.setItem(workspaceStorageKey, JSON.stringify({
        version: 1,
        source: state.source,
        target: state.target,
        mappings: state.mappings
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
      const savedText = localStorage.getItem(workspaceStorageKey);
      if (!savedText) return { restored: false, error: "" };
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

  return { state, update, addMapping, removeMapping, loadSampleData, save, restore };
}