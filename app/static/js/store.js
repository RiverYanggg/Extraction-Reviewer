// ---------------------------------------------------------------------------
// Annotation state store
//
// Holds the current paper's annotation document plus an undo/redo history.
// Every mutation goes through `commit()` which:
//   1. pushes the previous doc onto the undo stack,
//   2. appends an audit-log event,
//   3. notifies subscribers (UI re-render),
//   4. schedules a debounced autosave.
//
// The annotation *document* is the single source of truth the backend persists;
// derived data (fields, blocks, buckets) is immutable input from the server.
// ---------------------------------------------------------------------------
import { api } from "./api.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

export class Store {
  constructor() {
    this.paperId = null;
    this.data = null;       // immutable server payload (fields/blocks/buckets/meta)
    this.doc = null;        // mutable annotation document
    this.fieldIndex = {};   // field_id -> field
    this.blockIndex = {};   // block_id -> block
    this.undoStack = [];
    this.redoStack = [];
    this.subs = new Set();
    this.saveState = "saved"; // saved | dirty | saving | error
    this._saveTimer = null;
  }

  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _notify() { for (const fn of this.subs) fn(); }

  load(payload) {
    this.paperId = payload.paper_id;
    this.data = payload;
    this.doc = payload.annotation;
    this.fieldIndex = Object.fromEntries(payload.fields.map((f) => [f.field_id, f]));
    this.blockIndex = Object.fromEntries(payload.blocks.map((b) => [b.block_id, b]));
    this.undoStack = [];
    this.redoStack = [];
    this.saveState = "saved";
    this._notify();
  }

  // ---- derived read helpers -------------------------------------------- //
  fieldAnnot(fid) { return this.doc.fields[fid] || {}; }

  /** Effective review status for a field, resolving reviewer action first. */
  statusOf(fid) {
    return this.fieldAnnot(fid).review_status || "unprocessed";
  }

  currentValue(field) {
    const a = this.fieldAnnot(field.field_id);
    return "current_value" in a ? a.current_value : field.value;
  }

  effectiveRefs(field) {
    const a = this.fieldAnnot(field.field_id);
    return a.evidence_refs_override || field.evidence_refs || [];
  }

  progress() {
    const counts = { confirmed: 0, modified: 0, conflict: 0, needs_review: 0, unprocessed: 0 };
    for (const f of this.data.fields) {
      const st = this.statusOf(f.field_id);
      counts[st] = (counts[st] || 0) + 1;
    }
    const total = this.data.fields.length;
    const done = counts.confirmed + counts.modified;
    return { total, counts, done, pct: total ? Math.round((100 * done) / total) : 0,
             added: this.doc.added_fields.length };
  }

  // ---- mutation core --------------------------------------------------- //
  commit(mutator, event) {
    this.undoStack.push(clone(this.doc));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.doc);
    if (event) {
      this.doc.audit_log.push({ ts: new Date().toISOString(), ...event });
    }
    if (this.doc.task_status === "not_started") this.doc.task_status = "in_progress";
    this._markDirty();
    this._notify();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(clone(this.doc));
    this.doc = this.undoStack.pop();
    this._markDirty();
    this._notify();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(clone(this.doc));
    this.doc = this.redoStack.pop();
    this._markDirty();
    this._notify();
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  // ---- high-level actions ---------------------------------------------- //
  setStatus(fid, status) {
    const field = this.fieldIndex[fid];
    this.commit((d) => {
      const a = d.fields[fid] || (d.fields[fid] = {});
      // toggle off if same status re-applied (except modified, which is value-driven)
      if (a.review_status === status && status !== "modified") {
        a.review_status = "unprocessed";
      } else {
        a.review_status = status;
      }
      a.updated_at = new Date().toISOString();
    }, { field_id: fid, action: "set_status", to: status, path: field?.path });
  }

  setValue(fid, value) {
    const field = this.fieldIndex[fid];
    const from = this.currentValue(field);
    if (value === field.value) {
      // reverted to original -> clear modification
      this.commit((d) => {
        const a = d.fields[fid] || (d.fields[fid] = {});
        delete a.current_value;
        if (a.review_status === "modified") a.review_status = "unprocessed";
        a.updated_at = new Date().toISOString();
      }, { field_id: fid, action: "revert_value", from, to: field.value, path: field.path });
      return;
    }
    this.commit((d) => {
      const a = d.fields[fid] || (d.fields[fid] = {});
      a.current_value = value;
      a.review_status = "modified";
      a.updated_at = new Date().toISOString();
    }, { field_id: fid, action: "edit_value", from, to: value, path: field.path });
  }

  setNote(fid, note) {
    this.commit((d) => {
      const a = d.fields[fid] || (d.fields[fid] = {});
      a.note = note;
      a.updated_at = new Date().toISOString();
    }, { field_id: fid, action: "note", path: this.fieldIndex[fid]?.path });
  }

  setRefsOverride(fid, refs) {
    this.commit((d) => {
      const a = d.fields[fid] || (d.fields[fid] = {});
      a.evidence_refs_override = refs;
      a.updated_at = new Date().toISOString();
    }, { field_id: fid, action: "edit_evidence", to: refs, path: this.fieldIndex[fid]?.path });
  }

  setTaskStatus(status) {
    this.commit((d) => { d.task_status = status; },
      { action: "task_status", to: status });
  }

  addField({ bucket_id, section, parent_id = null, key = "", path, value }) {
    const tempId = "A" + (this.doc.added_fields.length + 1).toString().padStart(4, "0");
    this.commit((d) => {
      d.added_fields.push({
        temp_id: tempId, bucket_id, section, parent_id, key, path, value,
        review_status: "added", note: "", evidence_refs: [],
        created_at: new Date().toISOString(),
      });
    }, { action: "add_field", to: { path, value }, bucket_id });
    return tempId;
  }

  removeAddedField(tempId) {
    this.commit((d) => {
      d.added_fields = d.added_fields.filter((a) => a.temp_id !== tempId);
    }, { action: "remove_added_field", field_id: tempId });
  }

  setBucketStatus(bucketId, status) {
    this.commit((d) => {
      d.buckets[bucketId] = { ...(d.buckets[bucketId] || {}), status };
    }, { action: "bucket_status", bucket_id: bucketId, to: status });
  }

  // ---- persistence ----------------------------------------------------- //
  _markDirty() {
    this.saveState = "dirty";
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 800);
  }

  async flush() {
    if (!this.paperId) return;
    clearTimeout(this._saveTimer);
    this.saveState = "saving";
    this._notify();
    try {
      await api.saveAnnotation(this.paperId, this.doc);
      this.saveState = "saved";
    } catch (e) {
      console.error(e);
      this.saveState = "error";
    }
    this._notify();
  }
}

export const store = new Store();
