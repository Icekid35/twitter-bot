export async function request<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Signaldesk": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({
    error: { message: "The server returned an unreadable response." },
  }));
  if (!response.ok)
    throw new Error(
      data.error?.message || "The request could not be completed.",
    );
  return data;
}
