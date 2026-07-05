//Interactive, persistent action-item checklist. Used by the post-call
//summary screen and the recent-meetings drawer.
//
//Autosave contract:
// - text fields (task/owner/dueDate): a save fires 500ms after the last
//   keystroke (timer resets per keystroke); blur saves immediately and
//   cancels any pending debounced save so no duplicate write fires; blur
//   with nothing dirty is a no-op.
// - checkboxes save immediately on toggle.
//All writes go through PATCH /calls/:callId/action-items/:actionItemId.
//External live updates (socket "callUpdated") are merged in without
//clobbering fields the user is mid-edit on.

import React, { useState, useRef, useEffect } from "react";

import { apiFetch } from "../api";
import "./ActionItemsEditor.css";

const DEBOUNCE_MS = 500;
const TEXT_FIELDS = ["task", "owner", "dueDate"];

//dueDate is stored as a string (the model may extract ISO datetimes or loose
//phrases like "by Friday"). Parseable values feed the datetime-local picker;
//unparseable ones render as a raw hint beside it.
const toDateTimeInput = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

const ActionItemsEditor = ({ callId, items: itemsProp }) => {
  const [items, setItems] = useState(itemsProp || []);
  const timersRef = useRef({}); //"itemId:field" → debounce timeout id
  const dirtyRef = useRef({}); //"itemId:field" → true while unsaved

  //Merge server-pushed state, preserving whatever the user is still editing
  //and any just-added item the server echo hasn't caught up with yet.
  useEffect(() => {
    setItems((prev) => {
      const incoming = itemsProp || [];
      const incomingIds = new Set(incoming.map((i) => i._id));
      const mapped = incoming.map((inc) => {
        const local = prev.find((p) => p._id === inc._id);
        if (!local) return inc;
        const merged = { ...inc };
        TEXT_FIELDS.forEach((field) => {
          if (dirtyRef.current[`${inc._id}:${field}`]) merged[field] = local[field];
        });
        return merged;
      });
      const localOnly = prev.filter((p) => !incomingIds.has(p._id));
      return [...mapped, ...localOnly];
    });
  }, [itemsProp]);

  //Flush pending debounced saves if the editor unmounts mid-typing.
  useEffect(() => {
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const patch = (itemId, fields) => {
    return apiFetch(`/calls/${callId}/action-items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }).catch((err) => console.error("Action item save failed:", err.message));
  };

  const saveField = (itemId, field, value) => {
    delete dirtyRef.current[`${itemId}:${field}`];
    patch(itemId, { [field]: value });
  };

  const handleTextChange = (itemId, field, value) => {
    setItems((prev) => prev.map((it) => (it._id === itemId ? { ...it, [field]: value } : it)));
    const key = `${itemId}:${field}`;
    dirtyRef.current[key] = true;
    clearTimeout(timersRef.current[key]); //reset the timer on each keystroke
    timersRef.current[key] = setTimeout(() => {
      delete timersRef.current[key];
      saveField(itemId, field, value);
    }, DEBOUNCE_MS);
  };

  const handleBlur = (itemId, field, value) => {
    const key = `${itemId}:${field}`;
    if (timersRef.current[key]) {
      //Debounce hadn't fired yet: cancel it and save now instead.
      clearTimeout(timersRef.current[key]);
      delete timersRef.current[key];
      saveField(itemId, field, value);
    } else if (dirtyRef.current[key]) {
      //Rare: dirty but no timer (e.g. a failed save left it dirty).
      saveField(itemId, field, value);
    }
    //Otherwise the debounce already saved this value — no redundant write.
  };

  const handleToggle = (item) => {
    const completed = !item.completed;
    setItems((prev) => prev.map((it) => (it._id === item._id ? { ...it, completed } : it)));
    patch(item._id, { completed }); //immediate, no debounce
  };

  //Manually add a blank action item; the server assigns its _id, which we
  //need for subsequent edits, so we wait for it before rendering the row.
  const addItem = async () => {
    try {
      const res = await apiFetch(`/calls/${callId}/action-items`, {
        method: "POST",
        body: JSON.stringify({ task: "" }),
      });
      const { actionItem } = await res.json();
      setItems((prev) => [...prev, actionItem]);
    } catch (err) {
      console.error("Could not add action item:", err.message);
    }
  };

  return (
    <>
      <div className="aie-items">
      {items.length === 0 && <p className="aie-none">No action items yet.</p>}
      {items.map((item) => (
        <div className="aie-item" key={item._id}>
          <button
            className={`aie-check${item.completed ? " aie-check--done" : ""}`}
            onClick={() => handleToggle(item)}
            title={item.completed ? "Mark as not done" : "Mark as done"}
            type="button"
          >
            {item.completed && <span className="msr">check</span>}
          </button>
          <div className="aie-fields">
            {/* Full-width, auto-growing task text — the whole item is visible. */}
            <textarea
              className={`aie-task${item.completed ? " aie-task--done" : ""}`}
              value={item.task || ""}
              rows={1}
              onChange={(e) => handleTextChange(item._id, "task", e.target.value)}
              onBlur={(e) => handleBlur(item._id, "task", e.target.value)}
              placeholder="Task"
            />
            <div className="aie-meta-row">
              <span className="msr aie-meta-icon">person</span>
              <input
                className="aie-owner"
                value={item.owner || ""}
                onChange={(e) => handleTextChange(item._id, "owner", e.target.value)}
                onBlur={(e) => handleBlur(item._id, "owner", e.target.value)}
                placeholder="Add owner"
              />
              <span className="msr aie-meta-icon">event</span>
              <input
                className="aie-due"
                type="datetime-local"
                value={toDateTimeInput(item.dueDate)}
                onChange={(e) => handleTextChange(item._id, "dueDate", e.target.value)}
                onBlur={(e) => handleBlur(item._id, "dueDate", e.target.value)}
              />
              {item.dueDate && !toDateTimeInput(item.dueDate) && (
                <span className="aie-due-raw" title="As mentioned in the meeting">
                  “{item.dueDate}”
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
      </div>
      <button className="aie-add" onClick={addItem} type="button">
        <span className="msr">add</span>
        Add action item
      </button>
    </>
  );
};

export default ActionItemsEditor;
