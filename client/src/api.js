//Single place the client talks HTTP to the backend: base URL + credentials
//(the httpOnly session cookie) applied consistently.

export const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5001";

export const apiFetch = (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });
};

//JSON helper: resolves with parsed body, rejects with the server's error.
export const apiJson = async (path, options = {}) => {
  const res = await apiFetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
};
