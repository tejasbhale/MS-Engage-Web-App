//Editable, autosaving meeting summary. Same save contract as the action-item
//fields: debounce 500ms after the last keystroke, save immediately on blur
//(cancelling any pending debounce so no duplicate write), and don't clobber an
//in-progress edit when a live server update arrives.

import React, { useState, useRef, useEffect } from "react";

import { apiFetch } from "../api";
import "./SummaryEditor.css";

const DEBOUNCE_MS = 500;

const SummaryEditor = ({ callId, summary, placeholder }) => {
  const [value, setValue] = useState(summary || "");
  const timerRef = useRef(null);
  const dirtyRef = useRef(false);

  //Accept external (live) updates only when the user isn't mid-edit.
  useEffect(() => {
    if (!dirtyRef.current) setValue(summary || "");
  }, [summary]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const save = (text) => {
    dirtyRef.current = false;
    apiFetch(`/calls/${callId}`, {
      method: "PATCH",
      body: JSON.stringify({ summary: text }),
    }).catch((err) => console.error("Summary save failed:", err.message));
  };

  const onChange = (e) => {
    const text = e.target.value;
    setValue(text);
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      save(text);
    }, DEBOUNCE_MS);
  };

  const onBlur = (e) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      save(e.target.value);
    } else if (dirtyRef.current) {
      save(e.target.value);
    }
  };

  return (
    <textarea
      className="summary-editor"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder || "Add a summary…"}
      rows={4}
    />
  );
};

export default SummaryEditor;
